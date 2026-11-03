// Quick-capture category suggestion.
//
// Uses the same path as every other categorization: the user's rules, then
// built-in keywords, then Claude (via the shared categorizer, which reserves
// cost against the monthly AI limit). Returns the Sure / Likely / Ask decision
// so the client can save an AI-suggested deductible category as Needs review
// rather than as a confirmed deduction.

import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { requireFreshMfa, resolveEffectiveOwner } from "../middleware/auth";
import { categorizeTransactionsBatch, loadUserRules } from "../services/categorizationService";
import { decide } from "./decisionPolicy";
import { loadZachConfig } from "../zach/zachConfig";
import { checkDailyCounter } from "../zach/zachUsage";

export const SUGGESTIONS_PER_DAY = 200;

export interface SuggestionResult {
  category: string;
  taxCategory: string;
  taxSchedule: string;
  confidence: number;
  source: "user_rule" | "rule" | "ai" | "none";
  tier: "sure" | "likely" | "ask" | null;
  /** True when saving this suggestion as-is would claim a deduction the user hasn't confirmed. */
  needsPurposeConfirmation: boolean;
  explanation: string;
}

const EMPTY: SuggestionResult = {
  category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none", tier: null,
  needsPurposeConfirmation: false, explanation: "",
};

export async function suggestCategoryCore(
  ownerUid: string,
  description: string,
  amount: number | undefined,
  type: "income" | "expense" | "refund"
): Promise<SuggestionResult> {
  const desc = description.trim().slice(0, 200);
  if (desc.length < 3) return EMPTY;
  const rules = await loadUserRules(ownerUid);
  const res = (
    await categorizeTransactionsBatch(
      [{ idx: 0, txn: { description: desc, normalizedDescription: desc.toLowerCase(), vendor: "", amount: amount ?? 0, type } }],
      rules,
      []
    )
  ).get(0);
  if (!res || !res.category || res.source === "none") return EMPTY;
  const d = decide(res, { amount: amount ?? 0, type, description: desc });
  return {
    category: res.category,
    taxCategory: res.taxCategory || res.category,
    taxSchedule: res.taxSchedule,
    confidence: res.confidence,
    source: res.source,
    tier: d.tier,
    needsPurposeConfirmation: d.reviewTriggers.includes("needs_purpose_confirmation"),
    explanation: res.categorizationExplanation,
  };
}

export const suggestCategory = onCall(
  { cors: true, invoker: "public", secrets: ["ANTHROPIC_API_KEY"] },
  async (request): Promise<SuggestionResult> => {
    const callerUid = requireFreshMfa(request);
    const data = (request.data ?? {}) as { description?: unknown; amount?: unknown; type?: unknown };
    if (typeof data.description !== "string") return EMPTY;
    const amount = typeof data.amount === "number" && Number.isFinite(data.amount) ? data.amount : undefined;
    const type = data.type === "income" || data.type === "refund" ? data.type : "expense";
    const db = admin.firestore();
    const cfg = await loadZachConfig(db);
    if (!cfg.enabled) return EMPTY;
    await checkDailyCounter(db, callerUid, "suggestCount", SUGGESTIONS_PER_DAY, new Date(),
      "You've reached today's limit for category suggestions. You can still pick a category yourself.");
    const { effectiveOwnerUid } = await resolveEffectiveOwner(request);
    try {
      return await suggestCategoryCore(effectiveOwnerUid, data.description, amount, type);
    } catch (err) {
      console.error("[suggestCategory] error:", err instanceof Error ? err.message : err);
      if (err instanceof HttpsError) throw err;
      return EMPTY;
    }
  }
);
