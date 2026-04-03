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
        keywords: ["amazon", "staples", "office depot"],
        category: "Office Supplies",
        taxCategory: "Business Expense",
        taxSchedule: "Schedule C",
    },
    {
        keywords: ["uber", "lyft", "airlines", "hotel"],
        category: "Travel",
        taxCategory: "Business Expense",
        taxSchedule: "Schedule C",
    },
    {
        keywords: ["restaurant", "doordash", "grubhub"],
        category: "Meals",
        taxCategory: "Business Expense",
        taxSchedule: "Schedule C",
    },
    {
        keywords: ["church", "donation", "tithe"],
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
];
function applyKeywordRules(normalizedDescription) {
    for (const rule of KEYWORD_RULES) {
        if (rule.keywords.some((kw) => normalizedDescription.includes(kw))) {
            return {
                category: rule.category,
                taxCategory: rule.taxCategory,
                taxSchedule: rule.taxSchedule,
                confidence: 1.0,
                source: "rule",
            };
        }
    }
    return null;
}
// ─── User rule lookup (learning system) ──────────────────────────────────────
// Checks the categoryRules collection that updateTransactionCategory populates.
// Matches if normalizedDescription contains the stored vendorName.
async function checkUserRules(uid, normalizedDescription) {
    const db = admin.firestore();
    const snap = await db
        .collection("categoryRules")
        .where("uid", "==", uid)
        .get();
    for (const docSnap of snap.docs) {
        const rule = docSnap.data();
        const vendorName = (rule.vendorName ?? "").toLowerCase().trim();
        if (vendorName && normalizedDescription.includes(vendorName)) {
            return {
                category: rule.category ?? "",
                taxCategory: rule.taxCategory ?? "Business Expense",
                taxSchedule: rule.taxSchedule ?? "Schedule C",
                confidence: 0.95,
                source: "user_rule",
            };
        }
    }
    return null;
}
// ─── AI fallback ──────────────────────────────────────────────────────────────
async function callAI(transaction) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn("[CategorizationService] OPENAI_API_KEY not set — skipping AI categorization.");
        return null;
    }
    try {
        const openai = new openai_1.default({ apiKey });
        const prompt = `Classify this financial transaction into a category, tax category, and tax schedule for US tax purposes.\n\n` +
            `Transaction:\n` +
            `Description: ${transaction.description}\n` +
            `Amount: ${transaction.amount}\n` +
            `Type: ${transaction.type}\n\n` +
            `Return ONLY valid JSON with no markdown:\n` +
            `{\n` +
            `  "category": "<simple category name>",\n` +
            `  "taxCategory": "<tax category>",\n` +
            `  "taxSchedule": "<Schedule A | Schedule B | Schedule C | Schedule D | Schedule E | Form 1040 | Other>",\n` +
            `  "confidence": <0.0 to 1.0>\n` +
            `}`;
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
            temperature: 0,
        });
        const raw = completion.choices[0]?.message?.content?.trim() ?? "";
        // Strip markdown code fences if the model wraps the JSON
        const jsonText = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
        const parsed = JSON.parse(jsonText);
        return {
            category: parsed.category ?? "",
            taxCategory: parsed.taxCategory ?? "",
            taxSchedule: parsed.taxSchedule ?? "",
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.75,
            source: "ai",
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
 * Priority order:
 *   1. Hardcoded keyword rules (confidence = 1.0)
 *   2. User-specific categoryRules learned from manual edits (confidence = 0.95)
 *   3. OpenAI gpt-4o-mini (confidence from model response)
 *   4. No match — returns empty strings and confidence = 0
 */
async function categorizeTransaction(uid, transaction) {
    const normalizedDesc = (transaction.normalizedDescription ?? transaction.description).toLowerCase();
    const ruleResult = applyKeywordRules(normalizedDesc);
    if (ruleResult)
        return ruleResult;
    const userRuleResult = await checkUserRules(uid, normalizedDesc);
    if (userRuleResult)
        return userRuleResult;
    const aiResult = await callAI(transaction);
    if (aiResult)
        return aiResult;
    return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
}
//# sourceMappingURL=categorizationService.js.map