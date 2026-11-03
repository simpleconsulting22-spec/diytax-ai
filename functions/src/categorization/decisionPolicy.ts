// One decision rule for every automatic categorization (ingest, the Review
// page's auto-categorize, re-categorize). It turns a categorizer result into
// a status and a Zach tier:
//
//   sure    a rule the user approved (or the user themselves)  → categorized
//   likely  built-in keyword or confident AI, no risk flag     → categorized
//   ask     low confidence, or any risk flag                   → needs_review
//
// Status keeps its existing meaning for reports ("needs_review" is left out of
// tax totals until the user confirms it). The tier is extra information for
// Zach and the UI; it never changes report inclusion by itself.

import { CategorizationResult } from "../services/categorizationService";

export type ZachTier = "sure" | "likely" | "ask";

export interface Decision {
  status: "categorized" | "needs_review";
  tier: ZachTier;
  riskFlags: string[];
}

/** AI results at or above this confidence (and with no risk flag) are Likely. */
export const AUTO_CONFIRM_CONFIDENCE = 0.85;

/** IRC § 274(d) substantiation threshold for travel, meals and gifts. */
export const SUBSTANTIATION_USD = 75;
/** IRC § 170(f)(8): written acknowledgment needed at $250 and above. */
export const CHARITY_ACK_USD = 250;

const LODGING =
  /\b(hotel|motel|resort|lodg|marriott|hilton|hyatt|sheraton|westin|holiday inn|hampton inn|courtyard|airbnb|vrbo|booking\.com|expedia|hotels\.com)/i;

/** Merchants that sell both business and personal goods. */
const MIXED_USE =
  /\b(amazon|amzn|costco|target|walmart|wal-mart|sam'?s club|samsclub|paypal|venmo|cash app|apple\.com|best buy|home depot|lowe'?s|staples|office depot|ebay|etsy)\b/i;

const SUBSTANTIATION_CATEGORIES = new Set(["Business Meals", "Business Travel", "Entertainment"]);
const DEDUCTIBLE_SCHEDULES = new Set(["Schedule C", "Schedule E", "Schedule A"]);

export interface DecisionTxn {
  amount: number;
  description?: string;
  normalizedDescription?: string;
}

export function riskFlags(result: Pick<CategorizationResult, "category" | "taxSchedule">, txn: DecisionTxn): string[] {
  const flags: string[] = [];
  const text = `${txn.normalizedDescription ?? ""} ${txn.description ?? ""}`;
  const amount = Math.abs(Number(txn.amount) || 0);
  const deductible = DEDUCTIBLE_SCHEDULES.has(result.taxSchedule ?? "");

  if (deductible && LODGING.test(text)) flags.push("lodging");
  if (SUBSTANTIATION_CATEGORIES.has(result.category) && amount >= SUBSTANTIATION_USD) {
    flags.push("substantiation_75");
  }
  if (result.category === "Charitable Contribution" && amount >= CHARITY_ACK_USD) {
    flags.push("charity_250");
  }
  if (deductible && MIXED_USE.test(text)) flags.push("mixed_use_merchant");
  return flags;
}

export function decide(result: CategorizationResult, txn: DecisionTxn): Decision {
  const flags = riskFlags(result, txn);

  // A rule the user approved is their decision: Sure, regardless of flags.
  if (result.source === "user_rule" && result.category) {
    return { status: "categorized", tier: "sure", riskFlags: flags };
  }
  if (!result.category || result.source === "none") {
    return { status: "needs_review", tier: "ask", riskFlags: flags };
  }
  if (flags.length > 0) {
    return { status: "needs_review", tier: "ask", riskFlags: flags };
  }
  // Built-in keyword rules are a good guess, never a certainty.
  if (result.source === "rule") {
    return result.confidence >= AUTO_CONFIRM_CONFIDENCE
      ? { status: "categorized", tier: "likely", riskFlags: flags }
      : { status: "needs_review", tier: "ask", riskFlags: flags };
  }
  // AI
  return result.confidence >= AUTO_CONFIRM_CONFIDENCE
    ? { status: "categorized", tier: "likely", riskFlags: flags }
    : { status: "needs_review", tier: "ask", riskFlags: flags };
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
