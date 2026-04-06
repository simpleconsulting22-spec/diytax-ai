import { DateRange } from "./periodRange";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpendingRecord {
  id: string;
  date: string;
  category: string | null;
  amount: number;
  type: string;
  subType?: string;
  status: string;
}

export interface BudgetCategory {
  category: string;
  limit: number;
}

export interface BudgetStatus {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  percentageUsed: number;
}

export interface CategoryAnalysis {
  category: string;
  current: number;
  previous: number;
  changePercent: number;
}

export interface Insight {
  type: "warning" | "info" | "tax";
  message: string;
}

// ─── Tax deductibility notes ──────────────────────────────────────────────────

export const TAX_NOTES: Record<string, string> = {
  "Meals & Entertainment":    "Only 50% of meals & entertainment is tax deductible (IRS §274).",
  "Travel":                   "Business travel is 100% deductible — keep all receipts and a trip log.",
  "Home Office":              "Home office requires exclusive, regular business use — track square footage.",
  "Vehicle & Mileage":        "Business mileage rate is $0.70/mile — keep a mileage log.",
  "Professional Services":    "Legal and professional fees are fully deductible.",
  "Advertising":              "Advertising and marketing expenses are fully deductible.",
  "Office Supplies":          "Office supplies are fully deductible in the year purchased.",
  "Software & Subscriptions": "Business software subscriptions are fully deductible.",
  "Equipment":                "Equipment may qualify for Section 179 immediate expensing.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum absolute expense amounts by category within a date range.
 * Excludes transfers, refunds, and income rows.
 */
function sumByCategory(
  transactions: SpendingRecord[],
  range: DateRange
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const txn of transactions) {
    if (!txn.category) continue;
    if (txn.type !== "expense") continue;
    if (txn.status === "transfer") continue;
    if (txn.date < range.start || txn.date > range.end) continue;
    totals[txn.category] = (totals[txn.category] ?? 0) + Math.abs(txn.amount);
  }
  return totals;
}

/**
 * Sum absolute amounts of debt payment transactions (subType === "credit_card_payment")
 * within a date range.
 */
export function sumDebtPayments(
  transactions: SpendingRecord[],
  range: DateRange
): number {
  return round2(
    transactions
      .filter(
        (txn) =>
          txn.subType === "credit_card_payment" &&
          txn.date >= range.start &&
          txn.date <= range.end
      )
      .reduce((sum, txn) => sum + Math.abs(txn.amount), 0)
  );
}

// ─── Core analysis functions ──────────────────────────────────────────────────

/**
 * Computes per-category budget status for the current period.
 */
export function computeBudgetStatus(
  transactions: SpendingRecord[],
  budgetCategories: BudgetCategory[],
  currentRange: DateRange
): BudgetStatus[] {
  const spent = sumByCategory(transactions, currentRange);
  return budgetCategories
    .filter((b) => b.limit > 0)
    .map(({ category, limit }) => {
      const s = round2(spent[category] ?? 0);
      return {
        category,
        limit,
        spent: s,
        remaining: round2(limit - s),
        percentageUsed: Math.round((s / limit) * 100),
      };
    })
    .sort((a, b) => b.percentageUsed - a.percentageUsed);
}

/**
 * Computes period-over-period spending change per category.
 * Sorted by current period spend descending.
 */
export function analyzeSpending(
  transactions: SpendingRecord[],
  currentRange: DateRange,
  previousRange: DateRange
): CategoryAnalysis[] {
  const current = sumByCategory(transactions, currentRange);
  const previous = sumByCategory(transactions, previousRange);

  const categories = new Set([...Object.keys(current), ...Object.keys(previous)]);

  return [...categories]
    .map((category) => {
      const curr = current[category] ?? 0;
      const prev = previous[category] ?? 0;
      const changePercent =
        prev === 0
          ? curr > 0 ? 100 : 0
          : Math.round(((curr - prev) / prev) * 100);
      return {
        category,
        current: round2(curr),
        previous: round2(prev),
        changePercent,
      };
    })
    .filter((a) => a.current > 0 || a.previous > 0)
    .sort((a, b) => b.current - a.current);
}

/**
 * Generates rule-based AI insights from budget status and spending analysis.
 *
 * Rules:
 *  - spending ≥ 100% of budget → exceeded warning
 *  - spending ≥ 90% of budget → near-limit warning
 *  - period-over-period increase ≥ 30% → trend warning
 *  - period-over-period decrease ≥ 30% → positive trend info
 *  - category has a tax note → tax insight (deduplicated)
 */
export function generateInsights(
  budgetStatuses: BudgetStatus[],
  analysis: CategoryAnalysis[]
): Insight[] {
  const insights: Insight[] = [];
  const taxNotesShown = new Set<string>();

  for (const status of budgetStatuses) {
    if (status.limit === 0) continue;

    if (status.percentageUsed >= 100) {
      insights.push({
        type: "warning",
        message: `You've exceeded your ${status.category} budget — spent $${status.spent.toFixed(0)} of $${status.limit.toFixed(0)}.`,
      });
    } else if (status.percentageUsed >= 90) {
      insights.push({
        type: "warning",
        message: `You're close to your ${status.category} budget — ${status.percentageUsed}% used, $${Math.max(0, status.remaining).toFixed(0)} remaining.`,
      });
    }

    const taxNote = TAX_NOTES[status.category];
    if (taxNote && !taxNotesShown.has(status.category)) {
      taxNotesShown.add(status.category);
      insights.push({ type: "tax", message: taxNote });
    }
  }

  for (const item of analysis) {
    if (item.changePercent >= 30) {
      insights.push({
        type: "warning",
        message: `${item.category} spending increased ↑${item.changePercent}% vs last period ($${item.previous.toFixed(0)} → $${item.current.toFixed(0)}).`,
      });
      const taxNote = TAX_NOTES[item.category];
      if (taxNote && !taxNotesShown.has(item.category)) {
        taxNotesShown.add(item.category);
        insights.push({ type: "tax", message: taxNote });
      }
    } else if (item.changePercent <= -30) {
      insights.push({
        type: "info",
        message: `${item.category} spending decreased ↓${Math.abs(item.changePercent)}% vs last period ($${item.previous.toFixed(0)} → $${item.current.toFixed(0)}).`,
      });
    }
  }

  return insights;
}
