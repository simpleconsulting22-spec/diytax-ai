// Shared classifier for Plaid transactions — used by both initial fetch and
// the backfill function so they can never drift apart.

export interface PlaidTxnLike {
  name?: string | null;
  amount: number;
  personal_finance_category?: { primary?: string | null } | null;
  category?: string[] | null;
}

export interface ClassificationResult {
  type: "income" | "expense";
  source: string;
}

const EXPENSE_KEYWORDS = /\b(DEBIT|WITHDRAW|PURCHASE|PAYMENT|AUTOPAY|ATM|FEE|CHARGE)\b/;
const INCOME_KEYWORDS  = /\b(CREDIT|DEPOSIT|PAYROLL|DIRECT\s*DEP|DIVIDEND|INTEREST\s+EARNED|REFUND)\b/;

// Four-layer chain — first match wins.
//   1. Plaid PFC (institution-agnostic ML label)
//   2. Plaid legacy category array
//   3. Description keywords (handles credit unions that omit PFC/legacy)
//   4. Amount sign (Plaid standard: positive = outflow = expense)
export function classifyTransactionType(txn: PlaidTxnLike): ClassificationResult {
  const pfcPrimary    = (txn.personal_finance_category?.primary ?? "").toUpperCase();
  const legacyCats    = (txn.category ?? []) as string[];
  const legacyPrimary = legacyCats[0] ?? "";
  const descUpper     = (txn.name ?? "").toUpperCase();

  if (pfcPrimary === "INCOME" || pfcPrimary === "TRANSFER_IN") {
    return { type: "income", source: "pfc-income" };
  }
  if (pfcPrimary !== "") {
    return { type: "expense", source: "pfc-other" };
  }
  if (legacyPrimary === "Payroll") {
    return { type: "income", source: "legacy-payroll" };
  }
  if (legacyPrimary === "Transfer") {
    const t: "income" | "expense" = legacyCats.includes("Credit") ? "income" : "expense";
    return { type: t, source: `legacy-transfer-${t}` };
  }
  if (legacyPrimary !== "") {
    return { type: "expense", source: "legacy-merchant" };
  }
  if (EXPENSE_KEYWORDS.test(descUpper)) {
    return { type: "expense", source: "desc-expense" };
  }
  if (INCOME_KEYWORDS.test(descUpper)) {
    return { type: "income", source: "desc-income" };
  }
  const t: "income" | "expense" = txn.amount >= 0 ? "expense" : "income";
  return { type: t, source: "amount-sign" };
}
