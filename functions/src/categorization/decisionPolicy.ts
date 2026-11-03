// One decision rule for every automatic categorization (ingest, the Review
// page's auto-categorize, re-categorize).
//
// Three separate questions — this file answers only the first two:
//   1. Categorization: what kind of transaction is this? (category)
//   2. Confirmation: has a person (or a rule they approved) confirmed it?
//      Automatic guesses never establish that an expense is deductible.
//   3. Deductibility and substantiation are tax determinations that depend on
//      the taxpayer's facts and records. The app maps a confirmed category to a
//      schedule; it does not decide deductibility, and nothing here does.
//
// Tiers:
//   sure    a rule the user approved, or the user themselves   → categorized
//   likely  a confident automatic guess that is NOT a
//           deductible expense (personal, income)               → categorized
//   ask     everything else, including every automatic guess
//           that would put an expense on Schedule C, E or A,
//           and anything that trips a review trigger            → needs_review
//
// Status keeps its existing meaning for reports ("needs_review" is left out of
// tax totals until confirmed). See docs/classification-policy.md.

import { CategorizationResult } from "../services/categorizationService";

export type ZachTier = "sure" | "likely" | "ask";

export interface Decision {
  status: "categorized" | "needs_review";
  tier: ZachTier;
  reviewTriggers: string[];
}

/** AI results at or above this confidence can be Likely (non-deductible only). */
export const AUTO_CONFIRM_CONFIDENCE = 0.85;

// ── Internal review triggers ────────────────────────────────────────────────
// These amounts decide only WHEN DIYTax AI asks the user to look at a
// transaction. They are NOT tests of deductibility. They are set at dollar
// levels where IRS recordkeeping rules commonly call for more documentation
// (e.g. receipts for business meals, travel and gifts, Treas. Reg.
// § 1.274-5(c)(2)(iii); written acknowledgment for gifts to charity,
// IRC § 170(f)(8)), so the user is asked while the details are fresh.
export const REVIEW_TRIGGER_MEALS_TRAVEL_USD = 75;
export const REVIEW_TRIGGER_CHARITY_USD = 250;

const LODGING =
  /\b(hotel|motel|resort|lodg|marriott|hilton|hyatt|sheraton|westin|holiday inn|hampton inn|courtyard|airbnb|vrbo|booking\.com|expedia|hotels\.com)/i;

/** Merchants that sell both business and personal goods. */
const MIXED_USE =
  /\b(amazon|amzn|costco|target|walmart|wal-mart|sam'?s club|samsclub|paypal|venmo|cash app|apple\.com|best buy|home depot|lowe'?s|staples|office depot|ebay|etsy)\b/i;

const MEALS_TRAVEL_CATEGORIES = new Set(["Business Meals", "Business Travel", "Entertainment"]);
/** Schedules on which an expense could reduce tax. */
export const DEDUCTIBLE_SCHEDULES = new Set(["Schedule C", "Schedule E", "Schedule A"]);

export interface DecisionTxn {
  amount: number;
  type?: string;
  description?: string;
  normalizedDescription?: string;
}

/** Reasons to ask the user. Not tax determinations. */
export function reviewTriggers(
  result: Pick<CategorizationResult, "category" | "taxSchedule">,
  txn: DecisionTxn
): string[] {
  const triggers: string[] = [];
  const text = `${txn.normalizedDescription ?? ""} ${txn.description ?? ""}`;
  const amount = Math.abs(Number(txn.amount) || 0);
  const deductibleSchedule = DEDUCTIBLE_SCHEDULES.has(result.taxSchedule ?? "");

  if (deductibleSchedule && LODGING.test(text)) triggers.push("lodging");
  if (MEALS_TRAVEL_CATEGORIES.has(result.category) && amount >= REVIEW_TRIGGER_MEALS_TRAVEL_USD) {
    triggers.push("meals_travel_75");
  }
  if (result.category === "Charitable Contribution" && amount >= REVIEW_TRIGGER_CHARITY_USD) {
    triggers.push("charity_250");
  }
  if (deductibleSchedule && MIXED_USE.test(text)) triggers.push("mixed_use_merchant");
  return triggers;
}

export function decide(result: CategorizationResult, txn: DecisionTxn): Decision {
  const triggers = reviewTriggers(result, txn);
  const ask = (extra?: string): Decision => ({
    status: "needs_review",
    tier: "ask",
    reviewTriggers: extra && !triggers.includes(extra) ? [...triggers, extra] : triggers,
  });

  // A rule the user approved is their decision: Sure, regardless of triggers.
  if (result.source === "user_rule" && result.category) {
    return { status: "categorized", tier: "sure", reviewTriggers: triggers };
  }
  if (!result.category || result.source === "none") return ask();
  if (triggers.length > 0) return ask();

  // An automatic guess never establishes a deductible expense: the business
  // (or rental, or itemized) purpose has to come from the user.
  const isExpense = (txn.type ?? "expense") === "expense";
  if (isExpense && DEDUCTIBLE_SCHEDULES.has(result.taxSchedule ?? "")) {
    return ask("needs_purpose_confirmation");
  }

  if (result.source === "rule") {
    return result.confidence >= AUTO_CONFIRM_CONFIDENCE
      ? { status: "categorized", tier: "likely", reviewTriggers: triggers }
      : ask();
  }
  return result.confidence >= AUTO_CONFIRM_CONFIDENCE
    ? { status: "categorized", tier: "likely", reviewTriggers: triggers }
    : ask();
}

export interface HistoryEntry {
  at: number;
  by: string;
  source: string;
  before: { category: string; taxCategory: string; taxSchedule: string; status: string };
  after: { category: string; taxCategory: string; taxSchedule: string; status: string };
}

export const HISTORY_LIMIT = 20;

export function snapshotFields(t: Record<string, unknown>): HistoryEntry["before"] {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    category: s(t.category),
    taxCategory: s(t.taxCategory),
    taxSchedule: s(t.taxSchedule),
    status: s(t.status),
  };
}

/** Append an entry, keeping only the most recent HISTORY_LIMIT. */
export function appendHistory(existing: unknown, entry: HistoryEntry): HistoryEntry[] {
  const list = Array.isArray(existing) ? (existing as HistoryEntry[]) : [];
  const next = [...list, entry];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export function changed(a: HistoryEntry["before"], b: HistoryEntry["before"]): boolean {
  return a.category !== b.category || a.taxCategory !== b.taxCategory || a.taxSchedule !== b.taxSchedule || a.status !== b.status;
}
