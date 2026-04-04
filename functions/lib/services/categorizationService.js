"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeTransaction = categorizeTransaction;
const admin = __importStar(require("firebase-admin"));
const openai_1 = __importDefault(require("openai"));
const KEYWORD_RULES = [
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
function applyKeywordRules(normalizedDescription) {
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
async function checkUserRules(uid, normalizedDescription, vendor) {
    const db = admin.firestore();
    const snap = await db.collection("categoryRules").where("uid", "==", uid).get();
    // Prefer exact vendor match, then description substring match
    let bestMatch = null;
    let matchType = "substring";
    for (const docSnap of snap.docs) {
        const rule = docSnap.data();
        const ruleVendor = (rule.vendorName ?? "").toLowerCase().trim();
        if (!ruleVendor)
            continue;
        if (vendor && ruleVendor === vendor.toLowerCase()) {
            bestMatch = { ...rule, docId: docSnap.id };
            matchType = "exact_vendor";
            break; // exact vendor match wins immediately
        }
        if (!bestMatch && normalizedDescription.includes(ruleVendor)) {
            bestMatch = { ...rule, docId: docSnap.id };
        }
    }
    if (!bestMatch)
        return null;
    const usageCount = bestMatch.usageCount ?? 1;
    const explanation = matchType === "exact_vendor"
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
async function getRelatedRules(uid, limit = 5) {
    const db = admin.firestore();
    try {
        const snap = await db
            .collection("categoryRules")
            .where("uid", "==", uid)
            .limit(50) // fetch more, dedupe client-side
            .get();
        const seen = new Set();
        const rules = [];
        for (const d of snap.docs) {
            const data = d.data();
            const key = `${data.vendorName}:${data.category}`;
            if (!seen.has(key) && data.vendorName && data.category) {
                seen.add(key);
                rules.push({ vendorName: data.vendorName, category: data.category });
                if (rules.length >= limit)
                    break;
            }
        }
        return rules;
    }
    catch {
        return [];
    }
}
// ─── AI fallback ──────────────────────────────────────────────────────────────
async function callAI(uid, transaction) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn("[CategorizationService] OPENAI_API_KEY not set — skipping AI.");
        return null;
    }
    // Fetch a few of the user's past rules to give the model context
    const relatedRules = await getRelatedRules(uid, 5);
    const rulesContext = relatedRules.length > 0
        ? `\nThis user's past categorizations (for context):\n${relatedRules
            .map((r) => `  - "${r.vendorName}" → ${r.category}`)
            .join("\n")}\n`
        : "";
    const prompt = `Classify this financial transaction for US tax purposes.\n\n` +
        `Transaction:\n` +
        `  Vendor: ${transaction.vendor ?? "(unknown)"}\n` +
        `  Description: ${transaction.description}\n` +
        `  Amount: $${Math.abs(transaction.amount).toFixed(2)} (${transaction.type})\n` +
        `  Sign convention: negative amount = expense, positive = income\n` +
        `${rulesContext}\n` +
        `Tax categories to choose from:\n` +
        `  Income, Advertising, Meals & Entertainment, Travel, Office Supplies,\n` +
        `  Software & Subscriptions, Home Office, Vehicle & Mileage,\n` +
        `  Professional Services, Equipment, Charitable Contribution,\n` +
        `  Medical Expense, Other\n\n` +
        `Tax schedules: Schedule A (itemized deductions), Schedule C (business/self-employment),\n` +
        `  Schedule E (rental income), Form 1040 (wages/retirement/SSA), Other\n\n` +
        `Return ONLY valid JSON with no markdown:\n` +
        `{\n` +
        `  "category": "<category from the list above>",\n` +
        `  "taxCategory": "<brief tax category label>",\n` +
        `  "taxSchedule": "<one schedule from the list above>",\n` +
        `  "confidence": <number between 0.60 and 0.90>,\n` +
        `  "explanation": "<one concise sentence explaining why>"\n` +
        `}`;
    try {
        const openai = new openai_1.default({ apiKey });
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0,
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? "";
        const jsonText = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
        const parsed = JSON.parse(jsonText);
        // Clamp AI confidence to [0.60, 0.90] — rules own the extremes
        const rawConf = typeof parsed.confidence === "number" ? parsed.confidence : 0.75;
        const confidence = Math.min(0.9, Math.max(0.6, rawConf));
        return {
            category: parsed.category ?? "",
            taxCategory: parsed.taxCategory ?? "",
            taxSchedule: parsed.taxSchedule ?? "",
            confidence,
            source: "ai",
            entityId: null,
            entityName: null,
            entityType: undefined,
            categorizationExplanation: parsed.explanation
                ? `AI: ${parsed.explanation}`
                : `AI classified as ${parsed.category ?? "unknown"} (confidence ${Math.round(confidence * 100)}%)`,
        };
    }
    catch (err) {
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
async function categorizeTransaction(uid, transaction) {
    const normalizedDesc = (transaction.normalizedDescription ?? transaction.description).toLowerCase();
    const vendor = transaction.vendor ?? "";
    // 1. Hard keyword rules
    const ruleResult = applyKeywordRules(normalizedDesc);
    if (ruleResult)
        return ruleResult;
    // 2. User-specific learned rules
    const userRuleResult = await checkUserRules(uid, normalizedDesc, vendor);
    if (userRuleResult)
        return userRuleResult;
    // 3. AI fallback
    const aiResult = await callAI(uid, transaction);
    if (aiResult)
        return aiResult;
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
//# sourceMappingURL=categorizationService.js.map