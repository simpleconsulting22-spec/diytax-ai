import * as admin from "firebase-admin";
import OpenAI from "openai";
import {
  buildAIPromptCategoryList,
  fallbackCategoryForType,
  getMappingFuzzy,
  isValidCategory,
  scheduleForCategory,
} from "../shared/taxMap";
import { extractVendor as canonicalExtractVendor } from "../shared/vendorExtraction";

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
  entityId?: string | null;
  entityName?: string | null;
  entityType?: string;
  aiAssignment?: string | null;
  aiType?: "income" | "expense" | "transfer" | "refund";
  categorizationExplanation: string;
}

// ─── Shared context types (loaded once per batch) ─────────────────────────────

export interface UserRule {
  vendorName: string;
  category: string;
  taxCategory?: string;
  taxSchedule?: string;
  entityId?: string;
  entityName?: string;
  entityType?: string;
  usageCount?: number;
}

export interface EntityForAI {
  name: string;
  type: "business" | "rental";
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
    keywords: ["payroll", "direct dep", "direct deposit", "salary", "paycheck", "adp ", "gusto", "paychex", "intuit payroll", "rippling"],
    category: "Wages & Salaries",
    taxCategory: "Wages & Salaries",
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
): CategorizationResult | null {
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
      };
    }
  }
  return null;
}

// ─── Batch loaders (call once per batch, not per transaction) ─────────────────

export async function loadUserRules(uid: string): Promise<UserRule[]> {
  const db = admin.firestore();
  try {
    const snap = await db.collection("categoryRules").where("uid", "==", uid).get();
    return snap.docs.map((d) => d.data() as UserRule);
  } catch {
    return [];
  }
}

export async function loadUserEntities(uid: string): Promise<EntityForAI[]> {
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

// ─── User rule matching (uses pre-loaded rules) ───────────────────────────────

function matchUserRule(
  rules: UserRule[],
  normalizedDescription: string,
  vendor: string
): CategorizationResult | null {
  let bestMatch: UserRule | null = null;
  let matchType: "exact_vendor" | "substring" = "substring";

  for (const rule of rules) {
    const ruleVendor = (rule.vendorName ?? "").toLowerCase().trim();
    if (!ruleVendor) continue;

    if (vendor && ruleVendor === vendor.toLowerCase()) {
      bestMatch = rule;
      matchType = "exact_vendor";
      break;
    }
    if (!bestMatch && normalizedDescription.includes(ruleVendor)) {
      bestMatch = rule;
    }
  }

  if (!bestMatch) return null;

  const usageCount = bestMatch.usageCount ?? 1;
  const explanation =
    matchType === "exact_vendor"
      ? `Matched your saved rule for vendor "${bestMatch.vendorName}" (used ${usageCount} time${usageCount !== 1 ? "s" : ""})`
      : `Matched your saved rule for "${bestMatch.vendorName}" (substring match)`;

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

// ─── Batch AI categorization (up to AI_BATCH_SIZE transactions per call) ──────

const AI_BATCH_SIZE = 10;

interface AIBatchItem {
  index: number;
  category: string;
  taxCategory: string;
  taxSchedule: string;
  type: string;
  assignment: string;
  confidence: number;
  explanation: string;
}

async function callAIBatch(
  transactions: Array<{ idx: number; txn: TransactionInput }>,
  entities: EntityForAI[],
  userRules: UserRule[]
): Promise<Map<number, CategorizationResult>> {
  const results = new Map<number, CategorizationResult>();
  if (transactions.length === 0) return results;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[CategorizationService] OPENAI_API_KEY not set — skipping AI.");
    return results;
  }

  const entityLines = entities.map((e) =>
    `  - "${e.name}" (${e.type === "business" ? "Schedule C" : "Schedule E"})`
  );
  const entityContext =
    entityLines.length > 0
      ? `\nUser entities:\n${entityLines.join("\n")}\n  - "Personal"\n`
      : `\nAssign to: "Personal" (no entities configured)\n`;

  // Show up to 20 most-used rules (sorted by usageCount) so AI learns from history.
  // Include entity assignment so AI can replicate entity choices for known vendors.
  const rulesSample = [...userRules]
    .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
    .slice(0, 20);
  const rulesContext =
    rulesSample.length > 0
      ? `\nUser's past categorizations (most-used first):\n${rulesSample.map((r) => {
          const entityPart = r.entityName ? ` [${r.entityName}]` : r.entityType === "personal" ? " [Personal]" : "";
          return `  - "${r.vendorName}" → ${r.category}${entityPart}`;
        }).join("\n")}\n`
      : "";

  const txnLines = transactions.map(({ idx, txn }) =>
    `[${idx}] vendor="${txn.vendor ?? ""}" desc="${txn.description}" amount=$${Math.abs(txn.amount).toFixed(2)} type=${txn.type}`
  );

  const prompt =
    `Classify these financial transactions for US tax purposes.\n` +
    `${entityContext}` +
    `${rulesContext}\n` +
    `CRITICAL RULES:\n` +
    `  - Credit card payments, loan payments, internal transfers → type "transfer"\n` +
    `  - Rental expenses → assign to rental entity\n` +
    `  - Business expenses → assign to business entity\n` +
    `  - Personal/unclear → assign to "Personal"\n` +
    `  - "category" MUST be EXACTLY one of the categories listed below — do not invent variations\n\n` +
    `Categories (use EXACT spelling, including ampersands):\n` +
    `${buildAIPromptCategoryList()}\n\n` +
    `Transactions to classify:\n${txnLines.join("\n")}\n\n` +
    `Return ONLY a valid JSON array, one object per transaction, no markdown:\n` +
    `[{"index":<number>,"category":"<category>","taxCategory":"<label>","taxSchedule":"<Schedule A|Schedule C|Schedule E|Form 1040|Personal>","type":"<income|expense|transfer|refund>","assignment":"<entity name or Personal>","confidence":<0.60-0.90>,"explanation":"<one sentence>"}]`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300 * transactions.length,
      temperature: 0,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const jsonText = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonText) as AIBatchItem[];

    const validEntityNames = new Set([...entities.map((e) => e.name), "Personal"]);

    for (const item of parsed) {
      const rawConf = typeof item.confidence === "number" ? item.confidence : 0.75;
      let confidence = Math.min(0.9, Math.max(0.6, rawConf));
      const aiType = (["income", "expense", "transfer", "refund"].includes(item.type ?? ""))
        ? (item.type as "income" | "expense" | "transfer" | "refund")
        : undefined;
      const aiAssignment =
        item.assignment && validEntityNames.has(item.assignment) ? item.assignment : null;

      // Validate the AI's category against the canonical TAX_MAP. Three cases:
      //  1) Exact match → trust the AI; pull canonical taxSchedule/taxBucket
      //     from TAX_MAP rather than the AI's separately-emitted fields.
      //  2) Fuzzy match (case/whitespace differs) → accept the canonical form
      //     but knock down confidence so the row routes to needs_review.
      //  3) No match → drop the AI's category entirely, fall back to the
      //     "Other ..." bucket appropriate for this txn type, low confidence
      //     so the user sees it in needs_review.
      let resolvedCategory: string;
      let resolvedTaxSchedule: string;
      const txnType = transactions.find((t) => t.idx === item.index)?.txn.type ?? "expense";
      if (item.category && isValidCategory(item.category)) {
        const sched = scheduleForCategory(item.category)!;
        resolvedCategory     = item.category;
        resolvedTaxSchedule  = sched.taxSchedule;
      } else if (item.category && getMappingFuzzy(item.category)) {
        const m = getMappingFuzzy(item.category)!;
        resolvedCategory     = m.category; // canonical form
        resolvedTaxSchedule  = m.taxSchedule;
        confidence = Math.min(confidence, 0.7); // route to needs_review
        console.warn(`[AI] fuzzy-matched "${item.category}" → "${m.category}" — clamping confidence to 0.7`);
      } else {
        const fb = fallbackCategoryForType(txnType);
        resolvedCategory     = fb.category;
        resolvedTaxSchedule  = fb.taxSchedule;
        confidence = 0.5; // forces needs_review
        console.warn(`[AI] unknown category "${item.category}" — falling back to "${fb.category}"`);
      }

      results.set(item.index, {
        category: resolvedCategory,
        taxCategory: item.taxCategory ?? resolvedCategory,
        taxSchedule: resolvedTaxSchedule,
        confidence,
        source: "ai",
        entityId: null,
        entityName: null,
        entityType: undefined,
        aiAssignment,
        aiType,
        categorizationExplanation: item.explanation
          ? `AI: ${item.explanation}`
          : `AI classified as ${resolvedCategory} (${Math.round(confidence * 100)}%)`,
      });
    }
  } catch (err) {
    console.error("[CategorizationService] AI batch error:", err);
  }

  return results;
}

// ─── Batch-aware categorization (the main export for batch flows) ─────────────

/**
 * Categorize an array of transactions using pre-loaded rules and entities.
 * Runs keyword rules + user rules synchronously, then batches remaining
 * transactions to AI in groups of AI_BATCH_SIZE (one OpenAI call per group).
 *
 * `options.bypassUserRules` — skip the user-vendor-rule matcher. Used when
 * force-recategorizing a batch where the existing user rules are known to be
 * wrong (e.g. all rows wrongly tagged "Laundry" learned a poisoned rule for
 * every vendor). Built-in keyword rules and AI still apply.
 */
export async function categorizeTransactionsBatch(
  transactions: Array<{ idx: number; txn: TransactionInput }>,
  userRules: UserRule[],
  entities: EntityForAI[],
  options: { bypassUserRules?: boolean } = {}
): Promise<Map<number, CategorizationResult>> {
  const results = new Map<number, CategorizationResult>();
  const needsAI: Array<{ idx: number; txn: TransactionInput }> = [];

  // Phase 0 — Pre-classification guards.
  //
  // (a) Transfers and refunds: hard-routed before any rule/AI can fire.
  //     Transfers have no tax-category. Refunds shouldn't poison categoryRules.
  // (b) Generic-rail rows: when the canonical vendor extractor returns ""
  //     because the description is purely a generic payment-method token
  //     (ZELLE, ACH, WIRE, CHECK with no payee), refuse to auto-categorize
  //     and route to needs_review. AI guessing on these creates noise.
  for (const { idx, txn } of transactions) {
    if (txn.type === "transfer") {
      results.set(idx, {
        category: "",
        taxCategory: "",
        taxSchedule: "",
        confidence: 1.0,
        source: "rule",
        entityId: null,
        entityName: null,
        entityType: undefined,
        aiType: "transfer",
        categorizationExplanation: "Transfer — no tax category by design",
      });
      continue;
    }
    if (txn.type === "refund") {
      // Confidence < 0.8 forces needs_review — user should decide if the
      // refund offsets a specific expense / entity / category.
      results.set(idx, {
        category: "",
        taxCategory: "",
        taxSchedule: "",
        confidence: 0.5,
        source: "rule",
        entityId: null,
        entityName: null,
        entityType: undefined,
        aiType: "refund",
        categorizationExplanation: "Refund — review and categorize against the original expense",
      });
      continue;
    }
    const fingerprint = canonicalExtractVendor({
      description:           txn.description,
      normalizedDescription: txn.normalizedDescription,
      vendor:                txn.vendor,
    });
    if (!fingerprint) {
      const fb = fallbackCategoryForType(txn.type);
      results.set(idx, {
        category: fb.category,
        taxCategory: fb.category,
        taxSchedule: fb.taxSchedule,
        confidence: 0.5, // forces needs_review
        source: "none",
        entityId: null,
        entityName: null,
        entityType: undefined,
        categorizationExplanation: "Generic payment rail (Zelle/ACH/wire/etc.) — needs counterparty memo to classify",
      });
      continue;
    }
    needsAI.push({ idx, txn });
  }

  // Phase 1: user rules first (explicit user choices beat built-in keywords),
  // then keyword rules for everything not yet matched. The user-rule layer
  // is skipped when caller asks (force re-categorize against poisoned rules).
  const stillUnmatched: Array<{ idx: number; txn: TransactionInput }> = [];
  for (const { idx, txn } of needsAI) {
    const normalizedDesc = (txn.normalizedDescription ?? txn.description).toLowerCase();
    const vendor = txn.vendor ?? "";

    if (!options.bypassUserRules) {
      const userRuleResult = matchUserRule(userRules, normalizedDesc, vendor);
      if (userRuleResult && userRuleResult.category) {
        results.set(idx, userRuleResult);
        continue;
      }
    }

    const keywordResult = applyKeywordRules(normalizedDesc);
    if (keywordResult) {
      results.set(idx, keywordResult);
      continue;
    }

    stillUnmatched.push({ idx, txn });
  }

  // Phase 2: batch AI for remaining transactions
  for (let i = 0; i < stillUnmatched.length; i += AI_BATCH_SIZE) {
    const chunk = stillUnmatched.slice(i, i + AI_BATCH_SIZE);
    const aiResults = await callAIBatch(chunk, entities, userRules);
    for (const [idx, result] of aiResults) {
      results.set(idx, result);
    }
  }

  return results;
}

// ─── Single-transaction categorization (kept for backward compat) ─────────────

export async function categorizeTransaction(
  uid: string,
  transaction: TransactionInput
): Promise<CategorizationResult> {
  const [userRules, entities] = await Promise.all([
    loadUserRules(uid),
    loadUserEntities(uid),
  ]);

  const resultMap = await categorizeTransactionsBatch(
    [{ idx: 0, txn: transaction }],
    userRules,
    entities
  );

  return resultMap.get(0) ?? {
    category: "",
    taxCategory: "",
    taxSchedule: "",
    confidence: 0,
    source: "none",
    entityId: null,
    entityName: null,
    categorizationExplanation: "No category could be determined.",
  };
}
