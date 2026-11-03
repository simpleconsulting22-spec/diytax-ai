// Shared helpers for refund-aware transaction aggregation. Use these
// everywhere expenses or income are summed so refunds always net against the
// original expense category, never inflate income.
//
// Three transaction `type` values flow through here:
//   - "income"   — money earned (paychecks, dividends, etc.)
//   - "expense"  — money spent (purchases, fees, payments)
//   - "refund"   — money returned from a previously-paid expense; reduces the
//                  expense category total instead of inflating income

export interface TxnLike {
  type?: "income" | "expense" | "refund" | "transfer" | string | null;
  amount?: number | null;
}

/**
 * Numeric contribution this transaction makes to the EXPENSE total of its
 * category. Normal expenses contribute positive; refunds contribute negative;
 * income / transfer transactions contribute 0.
 */
export function expenseContribution(t: TxnLike): number {
  const amt = Number(t.amount ?? 0);
  if (t.type === "expense") return amt;
  if (t.type === "refund")  return -amt;
  return 0;
}

/**
 * Numeric contribution to INCOME total. Real income only — refunds are NOT
 * counted as income (they net against expenses instead).
 */
export function incomeContribution(t: TxnLike): number {
  if (t.type !== "income") return 0;
  return Number(t.amount ?? 0);
}

/** True if this transaction is a real expense (not a refund or transfer). */
export function isRealExpense(t: TxnLike): boolean {
  return t.type === "expense";
}

/** True if this transaction is a refund. */
export function isRefundTxn(t: TxnLike): boolean {
  return t.type === "refund";
}

/**
 * Sum the expense contributions of a list of transactions. Refunds reduce
 * the total. Use this anywhere you'd otherwise write
 * `txns.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0)`.
 */
export function sumExpenses(txns: TxnLike[]): number {
  return txns.reduce((s, t) => s + expenseContribution(t), 0);
}

export function sumIncome(txns: TxnLike[]): number {
  return txns.reduce((s, t) => s + incomeContribution(t), 0);
}
