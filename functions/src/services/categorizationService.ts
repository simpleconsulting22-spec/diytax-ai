import * as admin from "firebase-admin";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionInput {
  description: string;
  normalizedDescription?: string;
  vendor?: string;
  amount: number;
  type: string;
}

export interface CategorizationResult {
  category: string;
  taxCategory: string;
  taxSchedule: string;
  confidence: number;
  source: "rule" | "user_rule" | "ai" | "none";
  // Entity prediction — populated from user rules when available
  entityId?: string | null;
  entityName?: string | null;
  entityType?: string;
  // AI-suggested entity name (before ID resolution in batch)
  aiAssignment?: string | null;
  // AI-suggested transaction type (to catch transfers)
  aiType?: "income" | "expense" | "transfer";
  // Human-readable explanation of how the category was decided
  categorizationExplanation: string;
}

// ─── Hard-coded keyword rules ─────────────────────────────────────────────────

interface KeywordRule {
  keywords: string[];
  category: string;
  taxCategory: string;
  taxSchedule: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: ["amazon", "staples", "office depot", "officemax"],
    category: "Office Supplies",
    taxCategory: "Business Expense",
    taxSchedule: "Schedule C",
  },
  {
    keywords: ["uber", "lyft", "airlines", "united air", "delta air", "southwest", "american air", "hotel", "marriott", "hilton", "airbnb", "expedia"],
    category: "Travel",
    taxCategory: "Business Expense",
    taxSchedule: "Schedule C",
  },
  {
    keywords: ["restaurant", "doordash", "grubhub", "ubereats", "uber eats", "instacart", "starbucks", "chipotle", "mcdonalds", "subway", "chick-fil-a"],
    category: "Meals & Entertainment",
    taxCategory: "Business Expense",
    taxSchedule: "Schedule C",
  },
  {
    keywords: ["church", "donation", "tithe", "npo", "nonprofit", "non-profit", "united way", "red cross"],
    category: "Charitable Contribution",
    taxCategory: "Charitable Contribution",
    taxSchedule: "Schedule A",
  },
  {
    keywords: ["ssa", "social security"],
    category: "Income",
    taxCategory: "Social Security Income",
    taxSchedule: "Form 1040",
  },
  {
    keywords: ["github", "aws", "amazon web services", "digitalocean", "heroku", "netlify", "vercel", "stripe", "twilio", "sendgrid"],
    category: "Software & Subscriptions",
    taxCategory: "Business Expense",
    taxSchedule: "Schedule C",
  },
  {
    keywords: ["netflix", "spotify", "adobe", "microsoft", "google workspace", "dropbox", "notion", "slack", "zoom", "figma", "shopify", "quickbooks"],
    category: "Software & Subscriptions",
    taxCategory: "Business Expense",
    taxSchedule: "Schedule C",
  },
  {
    keywords: ["shell", "chevron", "exxon", "mobil", "bp ", "sunoco", "speedway", "circle k", "gas station"],
    category: "Vehicle & Mileage",
    taxCategory: "Business Expense",
    taxSchedule: "Schedule C",
  },
];

function applyKeywordRules(
  normalizedDescription: string
): (CategorizationResult & { matchedKeyword: string }) | null {
  for (const rule of KEYWORD_RULES) {
    const matched = rule.keywords.find((kw) => normalizedDescription.includes(kw));
    if (matched) {
      return {
        category: rule.category,
        taxCategory: rule.taxCategory,
        taxSchedule: rule.taxSchedule,
        confidence: 1.0,
        source: "rule",
        entityId: null,
        entityName: null,
        entityType: undefined,
        categorizationExplanation: `Matched built-in keyword rule for "${matched}"`,
        matchedKeyword: matched,
      };
    }
  }
  return null;
}

// ─── User rule lookup ─────────────────────────────────────────────────────────

interface UserRuleDoc {
  vendorName: string;
  category: string;
  taxCategory?: string;
  taxSchedule?: string;
  usageCount?: number;
  entityId?: string;
  entityName?: string;
  entityType?: string;
}

async function checkUserRules(
  uid: string,
  normalizedDescription: string,
  vendor: string
): Promise<CategorizationResult | null> {
  const db = admin.firestore();
  const snap = await db.collection("categoryRules").where("uid", "==", uid).get();

  // Prefer exact vendor match, then description substring match
  let bestMatch: (UserRuleDoc & { docId: string }) | null = null;
  let matchType: "exact_vendor" | "substring" = "substring";

  for (const docSnap of snap.docs) {
    const rule = docSnap.data() as UserRuleDoc;
    const ruleVendor = (rule.vendorName ?? "").toLowerCase().trim();
    if (!ruleVendor) continue;

    if (vendor && ruleVendor === vendor.toLowerCase()) {
      bestMatch = { ...rule, docId: docSnap.id };
      matchType = "exact_vendor";
      break; // exact vendor match wins immediately
    }
    if (!bestMatch && normalizedDescription.includes(ruleVendor)) {
      bestMatch = { ...rule, docId: docSnap.id };
    }
  }

  if (!bestMatch) return null;

  const usageCount = bestMatch.usageCount ?? 1;
  const explanation =
    matchType === "exact_vendor"
      ? `Matched your past categorization of "${bestMatch.vendorName}" → ${bestMatch.category} (used ${usageCount} ${usageCount === 1 ? "time" : "times"})`
      : `Description contains "${bestMatch.vendorName}" which you previously categorized as ${bestMatch.category}`;

  return {
    category: bestMatch.category,
    taxCategory: bestMatch.taxCategory ?? "Business Expense",
    taxSchedule: bestMatch.taxSchedule ?? "Schedule C",
    confidence: 0.95,
    source: "user_rule",
    entityId: bestMatch.entityId ?? null,
    entityName: bestMatch.entityName ?? null,
    entityType: bestMatch.entityType,
    categorizationExplanation: explanation,
  };
}

// ─── Related rules for AI context ────────────────────────────────────────────

interface RelatedRule {
  vendorName: string;
  category: string;
}

async function getRelatedRules(uid: string, limit = 5): Promise<RelatedRule[]> {
  const db = admin.firestore();
  try {
    const snap = await db
      .collection("categoryRules")
      .where("uid", "==", uid)
      .limit(50) // fetch more, dedupe client-side
      .get();

    const seen = new Set<string>();
    const rules: RelatedRule[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      const key = `${data.vendorName}:${data.category}`;
      if (!seen.has(key) && data.vendorName && data.category) {
        seen.add(key);
        rules.push({ vendorName: data.vendorName as string, category: data.category as string });
        if (rules.length >= limit) break;
      }
    }
    return rules;
  } catch {
    return [];
  }
}

// ─── User entity loader (for AI prompt context) ───────────────────────────────

interface EntityForAI {
  name: string;
  type: "business" | "rental";
}

async function getUserEntitiesForAI(uid: string): Promise<EntityForAI[]> {
  const db = admin.firestore();
  try {
    const snap = await db.collection("entities").where("userId", "==", uid).get();
    return snap.docs.map((d) => ({
      name: d.data().name as string,
      type: d.data().type as "business" | "rental",
    }));
  } catch {
    return [];
  }
}

// ─── AI fallback ──────────────────────────────────────────────────────────────

async function callAI(
  uid: string,
  transaction: TransactionInput
): Promise<CategorizationResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[CategorizationService] OPENAI_API_KEY not set — skipping AI.");
    return null;
  }

  // Fetch user's entities and past rules in parallel
  const [entities, relatedRules] = await Promise.all([
    getUserEntitiesForAI(uid),
    getRelatedRules(uid, 5),
  ]);

  const rulesContext =
    relatedRules.length > 0
      ? `\nThis user's past categorizations (for context):\n${relatedRules
          .map((r) => `  - "${r.vendorName}" → ${r.category}`)
          .join("\n")}\n`
      : "";

  // Build entity list for assignment — AI sees names, uses type internally
  const entityLines = entities.map((e) =>
    `  - "${e.name}" (${e.type === "business" ? "business/Schedule C" : "rental/Schedule E"})`
  );
  const entityContext =
    entityLines.length > 0
      ? `\nUser's entities (assign transaction to best match, or "Personal"):\n${entityLines.join("\n")}\n  - "Personal" (default for non-business/non-rental)\n`
      : `\nAssign to: "Personal" (no business/rental entities configured)\n`;

  const prompt =
    `Classify this financial transaction for US tax purposes.\n\n` +
    `Transaction:\n` +
    `  Vendor: ${transaction.vendor ?? "(unknown)"}\n` +
    `  Description: ${transaction.description}\n` +
    `  Amount: $${Math.abs(transaction.amount).toFixed(2)} (${transaction.type})\n` +
    `  Sign convention: negative amount = expense, positive = income\n` +
    `${rulesContext}` +
    `${entityContext}\n` +
    `CRITICAL RULES:\n` +
    `  - Credit card payments, loan payments, and internal account transfers → type "transfer" (NEVER expense)\n` +
    `  - Rental-related expenses (mortgage, property tax, repairs on rental) → assign to rental entity\n` +
    `  - Business expenses → assign to business entity\n` +
    `  - Personal/unclear → assign to "Personal"\n\n` +
    `Tax categories:\n` +
    `  Income: Business Income, Rental Income, Investment Income, Other Income\n` +
    `  Business (Sch. C): Advertising & Marketing, Auto & Vehicle, Business Meals, Business Travel,\n` +
    `    Computer & Software, Contract Labor, Home Office, Legal & Professional, Office Supplies,\n` +
    `    Phone & Internet, Rent & Lease, Repairs & Maintenance, Wages & Salaries, Other Business Expense\n` +
    `  Rental (Sch. E): Mortgage Interest (Rental), Property Management, Property Taxes,\n` +
    `    Rental Insurance, Rental Repairs & Maintenance, Rental Utilities\n` +
    `  Deductions (Sch. A): Charitable Contribution, Medical Expense, Mortgage Interest\n` +
    `  Personal: Groceries, Dining & Restaurants, Entertainment, Healthcare, Other Personal\n\n` +
    `Return ONLY valid JSON with no markdown:\n` +
    `{\n` +
    `  "category": "<category from the list above>",\n` +
    `  "taxCategory": "<brief tax category label>",\n` +
    `  "taxSchedule": "<Schedule A|Schedule C|Schedule E|Form 1040|Personal>",\n` +
    `  "type": "<income|expense|transfer>",\n` +
    `  "assignment": "<exact entity name from the list above, or Personal>",\n` +
    `  "confidence": <number between 0.60 and 0.90>,\n` +
    `  "explanation": "<one concise sentence explaining why>"\n` +
    `}`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 250,
      temperature: 0,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const jsonText = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonText) as {
      category?: string;
      taxCategory?: string;
      taxSchedule?: string;
      type?: string;
      assignment?: string;
      confidence?: number;
      explanation?: string;
    };

    // Clamp AI confidence to [0.60, 0.90] — rules own the extremes
    const rawConf = typeof parsed.confidence === "number" ? parsed.confidence : 0.75;
    const confidence = Math.min(0.9, Math.max(0.6, rawConf));

    // Validate AI type — default to original transaction type if invalid
    const aiType = (["income", "expense", "transfer"].includes(parsed.type ?? ""))
      ? (parsed.type as "income" | "expense" | "transfer")
      : undefined;

    // Validate assignment — must be a known entity name or "Personal"
    const validNames = new Set([...entities.map((e) => e.name), "Personal"]);
    const aiAssignment =
      parsed.assignment && validNames.has(parsed.assignment) ? parsed.assignment : null;

    return {
      category: parsed.category ?? "",
      taxCategory: parsed.taxCategory ?? "",
      taxSchedule: parsed.taxSchedule ?? "",
      confidence,
      source: "ai",
      entityId: null,
      entityName: null,
      entityType: undefined,
      aiAssignment,
      aiType,
      categorizationExplanation:
        parsed.explanation
          ? `AI: ${parsed.explanation}`
          : `AI classified as ${parsed.category ?? "unknown"} (confidence ${Math.round(confidence * 100)}%)`,
    };
  } catch (err) {
    console.error("[CategorizationService] AI error:", err);
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Categorize a single transaction.
 *
 * Priority:
 *   1. Hard-coded keyword rules  (confidence = 1.0)
 *   2. User categoryRules        (confidence = 0.95, may include entityId)
 *   3. OpenAI gpt-4o-mini        (confidence clamped to 0.60–0.90)
 *   4. No match                  (confidence = 0, source = "none")
 */
export async function categorizeTransaction(
  uid: string,
  transaction: TransactionInput
): Promise<CategorizationResult> {
  const normalizedDesc = (
    transaction.normalizedDescription ?? transaction.description
  ).toLowerCase();

  const vendor = transaction.vendor ?? "";

  // 1. Hard keyword rules
  const ruleResult = applyKeywordRules(normalizedDesc);
  if (ruleResult) return ruleResult;

  // 2. User-specific learned rules
  const userRuleResult = await checkUserRules(uid, normalizedDesc, vendor);
  if (userRuleResult) return userRuleResult;

  // 3. AI fallback
  const aiResult = await callAI(uid, transaction);
  if (aiResult) return aiResult;

  return {
    category: "",
    taxCategory: "",
    taxSchedule: "",
    confidence: 0,
    source: "none",
    entityId: null,
    entityName: null,
    entityType: undefined,
    categorizationExplanation: "Could not determine category",
  };
}
