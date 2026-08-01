// Pure tax-summary aggregation — no Firestore, no auth, fully testable.
//
// Money is routed by CANONICAL TAX BUCKET (shared/taxMap.ts), not by matching
// the literal category string "Income". Matching the string meant Business
// Income, Wages & Salaries, Interest Income, Dividend Income, Investment Income
// and Other Income were all silently excluded from `totalIncome` — and so from
// `netProfit` — under-reporting income for anyone who used a specific income
// category, which is the normal case.

import { expenseContribution, incomeContribution } from "../shared/transactionMath";
import { getTaxBucket, isIncomeBucket } from "../shared/taxMap";

export interface SummarizableTransaction {
  category?: string | null;
  taxCategory?: string | null;
  taxSchedule?: string | null;
  type?: string | null;
  entityType?: string | null;
  status?: string | null;
  amount?: number | null;
}

export interface TaxSummaryTotals {
  totalIncome: number;
  /** Deductible expenses only. Personal spending is reported separately. */
  totalExpenses: number;
  personalSpending: number;
  netProfit: number;
  scheduleCIncome: number;
  scheduleCExpenses: number;
  scheduleCNet: number;
  scheduleEIncome: number;
  scheduleEExpenses: number;
  scheduleENet: number;
  scheduleADeductions: number;
  ordinaryIncome: number;
  byCategory: Array<{ category: string; total: number }>;
  excluded: {
    transfers: number;
    needsReview: number;
    uncategorized: number;
  };
  transactionCount: number;
}

/**
 * Aggregate one tax year's transactions.
 *
 * Rows excluded from the tax math, and why:
 *   - `type === "transfer"`       — moving your own money is neither income nor
 *                                   expense; counting it double-counts both
 *   - `status === "needs_review"` — not yet confirmed by the user; baking
 *                                   unreviewed guesses into a filing figure
 *                                   presents a guess as a fact
 *   - no category                 — nothing to route it by
 * All three are counted and returned so the UI can say what was left out
 * instead of quietly showing a smaller number.
 *
 * Refunds (`type === "refund"`) net against the expense category they reverse
 * rather than inflating income — see shared/transactionMath.ts.
 */
export function summarizeTransactions(txns: SummarizableTransaction[]): TaxSummaryTotals {
  const categoryTotals: Record<string, number> = {};

  let totalIncome = 0;
  let totalExpenses = 0;
  let personalSpending = 0;

  let scheduleCIncome = 0;
  let scheduleCExpenses = 0;
  let scheduleEIncome = 0;
  let scheduleEExpenses = 0;
  let scheduleADeductions = 0;
  let ordinaryIncome = 0;

  let transfers = 0;
  let needsReview = 0;
  let uncategorized = 0;

  for (const txn of txns) {
    if (txn.type === "transfer") {
      transfers++;
      continue;
    }
    if (txn.status === "needs_review") {
      needsReview++;
      continue;
    }
    if (!txn.category) {
      uncategorized++;
      continue;
    }

    const cat = txn.category;
    const bucket = getTaxBucket({
      category: txn.category,
      taxCategory: txn.taxCategory,
      taxSchedule: txn.taxSchedule,
      type: txn.type ?? undefined,
      entityType: txn.entityType,
    });

    const expContrib = expenseContribution({ type: txn.type, amount: txn.amount });
    const incContrib = incomeContribution({ type: txn.type, amount: txn.amount });

    if (isIncomeBucket(bucket)) {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + incContrib;
      totalIncome += incContrib;
      if (bucket === "se_income") scheduleCIncome += incContrib;
      else if (bucket === "rental_income") scheduleEIncome += incContrib;
      else ordinaryIncome += incContrib;
      continue;
    }

    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + expContrib;

    if (bucket === "personal") {
      personalSpending += expContrib;
      continue;
    }

    totalExpenses += expContrib;
    if (bucket === "se_expense") scheduleCExpenses += expContrib;
    else if (bucket === "rental_expense") scheduleEExpenses += expContrib;
    else if (bucket === "itemized_deduction") scheduleADeductions += expContrib;
  }

  const byCategory = Object.entries(categoryTotals)
    .map(([category, total]) => ({ category, total: round2(total) }))
    .sort((a, b) => b.total - a.total);

  return {
    totalIncome: round2(totalIncome),
    totalExpenses: round2(totalExpenses),
    personalSpending: round2(personalSpending),
    netProfit: round2(totalIncome - totalExpenses),
    scheduleCIncome: round2(scheduleCIncome),
    scheduleCExpenses: round2(scheduleCExpenses),
    scheduleCNet: round2(scheduleCIncome - scheduleCExpenses),
    scheduleEIncome: round2(scheduleEIncome),
    scheduleEExpenses: round2(scheduleEExpenses),
    scheduleENet: round2(scheduleEIncome - scheduleEExpenses),
    scheduleADeductions: round2(scheduleADeductions),
    ordinaryIncome: round2(ordinaryIncome),
    byCategory,
    excluded: { transfers, needsReview, uncategorized },
    transactionCount: txns.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
