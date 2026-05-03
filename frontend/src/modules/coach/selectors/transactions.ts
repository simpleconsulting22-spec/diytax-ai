// Shared transaction-shape selectors. The coach reads from the same
// transactions collection the rest of the app uses, but applies its own
// reconciliation policy:
//
//   • Only categorized + non-transfer + non-pending rows enter rollups.
//   • Transfers are excluded entirely (they net out across accounts).
//   • Refunds reduce expense category totals (existing convention).
//
// These selectors are pure — they take an already-loaded array and a date
// range and return derived shapes. The hook does the Firestore fetch.

import type {
  CategoryRollup, InsightDriver, TrustMeta,
} from "../types";
import type { DateRange } from "./period";

export interface CoachTransaction {
  id:            string;
  date:          string;          // YYYY-MM-DD
  description:   string;
  merchantName?: string;
  vendor?:       string | null;
  amount:        number;          // absolute dollars (existing convention on saved docs)
  type:          "income" | "expense" | "transfer" | "refund";
  category:      string | null;
  status:        string;          // "needs_review" | "categorized" | "auto_resolved" …
}

const RECONCILED_STATUSES = new Set(["categorized", "auto_resolved"]);

/** Returns true when a row should contribute to spending/category math. */
export function isReconciledExpense(t: CoachTransaction): boolean {
  if (t.type === "transfer") return false;
  if (!RECONCILED_STATUSES.has(t.status)) return false;
  return t.type === "expense" || t.type === "refund";
}

export function isReconciledIncome(t: CoachTransaction): boolean {
  if (t.type !== "income") return false;
  return RECONCILED_STATUSES.has(t.status);
}

export function inRange(t: CoachTransaction, range: DateRange): boolean {
  return t.date >= range.start && t.date <= range.end;
}

/** Sum NET expenses (expense − refund) within the range. */
export function sumExpenses(txns: CoachTransaction[], range: DateRange): number {
  let total = 0;
  for (const t of txns) {
    if (!isReconciledExpense(t)) continue;
    if (!inRange(t, range)) continue;
    const abs = Math.abs(t.amount);
    if (t.type === "expense") total += abs;
    else if (t.type === "refund") total -= abs;
  }
  return round2(total);
}

export function sumIncome(txns: CoachTransaction[], range: DateRange): number {
  let total = 0;
  for (const t of txns) {
    if (!isReconciledIncome(t)) continue;
    if (!inRange(t, range)) continue;
    total += Math.abs(t.amount);
  }
  return round2(total);
}

/** Top N categories by net spending (current period), with prior-period comparison. */
export function topCategories(
  txns:        CoachTransaction[],
  current:     DateRange,
  previous:    DateRange,
  trustBuilder:(args: { rowCount: number; drivers: InsightDriver[] }) => TrustMeta,
  limit = 5,
): CategoryRollup[] {
  const curByCat:  Record<string, number> = {};
  const prevByCat: Record<string, number> = {};
  const merchByCat: Record<string, Record<string, number>> = {};

  let totalCurrent = 0;
  let totalRows    = 0;

  for (const t of txns) {
    if (!isReconciledExpense(t)) continue;
    const cat = t.category ?? "(uncategorized)";
    const merchant = t.merchantName?.trim() || t.vendor?.trim() || t.description.trim() || "(unknown)";
    const abs = Math.abs(t.amount);
    const signed = t.type === "expense" ? abs : -abs;

    if (inRange(t, current)) {
      curByCat[cat] = (curByCat[cat] ?? 0) + signed;
      merchByCat[cat] ??= {};
      merchByCat[cat][merchant] = (merchByCat[cat][merchant] ?? 0) + signed;
      totalCurrent += signed;
      totalRows++;
    } else if (inRange(t, previous)) {
      prevByCat[cat] = (prevByCat[cat] ?? 0) + signed;
    }
  }

  const cats = Object.keys(curByCat)
    .filter((cat) => curByCat[cat] > 0)
    .sort((a, b) => curByCat[b] - curByCat[a])
    .slice(0, limit);

  return cats.map((category) => {
    const cur  = round2(curByCat[category]);
    const prev = round2(prevByCat[category] ?? 0);
    const changePct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
    const merchants = Object.entries(merchByCat[category] ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }));
    const drivers: InsightDriver[] = merchants.map((m) => ({
      kind: "merchant", label: m.merchant, amount: m.amount,
    }));
    const trust = trustBuilder({ rowCount: totalRows, drivers });
    return {
      category,
      current:      cur,
      previous:     prev,
      changePct,
      shareOfTotal: totalCurrent > 0 ? cur / totalCurrent : 0,
      topMerchants: merchants,
      trust,
    };
  });
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
