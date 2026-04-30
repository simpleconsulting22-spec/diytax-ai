// Shared classifier for Plaid transactions — used by both initial fetch and
// the backfill function so they can never drift apart.

export interface PlaidTxnLike {
  name?: string | null;
  amount: number;
  personal_finance_category?: { primary?: string | null } | null;
  category?: string[] | null;
}

export interface ClassificationResult {
  /**
   * Three-state direction:
   *  - "income"  — money earned (paychecks, interest, dividends, etc.)
   *  - "expense" — money spent (purchases, fees, payments)
   *  - "refund"  — money returned from a previously-paid expense. In every
   *               aggregation, refunds reduce the expense category they came
   *               from rather than inflate income (matches IRS treatment
   *               for Schedule A / C / E).
   */
  type: "income" | "expense" | "refund";
  source: string;
  /**
   * Whether amount sign was the deciding signal. True for "amount-sign" /
   * "amount-sign-inverted" sources only — these are the at-risk classifications
   * that flip when an account's sign convention is wrong.
   */
  usedAmountSign: boolean;
}

export interface ClassifyOptions {
  /**
   * When true, use the inverted amount-sign convention (positive = inflow,
   * negative = outflow). PenFed and many credit unions use this convention,
   * the opposite of Plaid's documented standard.
   */
  amountSignInverted?: boolean;
  /**
   * When true, do not consult amount sign at all — every Plaid transaction on
   * this account has the same sign so the field carries zero direction info.
   * In this mode, transactions that would otherwise fall to amount-sign default
   * to expense, since the overwhelming majority of consumer transactions are
   * outflows.
   */
  ignoreAmountSign?: boolean;
}

// Pattern matching for direction-bearing description words. Matching order:
// refund first, then expense, then income — so "CREDIT CARD PAYMENT" hits
// PAYMENT (expense) before CREDIT (income), and "REVERSE PREAUTH WITHDRL"
// hits the refund branch before WITHDRL would route it to expense.
//
// Most patterns use word boundaries (\b…\b). A second alternative using \w*
// catches compound suffixes that real bank statements love:
//   CENTPAYROLL → PAYROLL  (income)
//   SLMLOANPMT  → PMT      (expense)
//   CRCARDPMT   → CRCARD   (expense)
const REFUND_KEYWORDS  = /\b(REFUND|REVERSAL|REIMBURSEMENT|REIMB|CHARGEBACK)\b|\bREVERSE\s+(PREAUTH|TRANS|CHARGE|WITHDRL|WITHDRAW|DEBIT|CREDIT|PAYMENT)\b/;
const EXPENSE_KEYWORDS = /\b(DEBIT|WITHDRAW|WITHDRL|PURCHASE|PAYMENT|AUTOPAY|ATM|FEE|CHARGE|NSF)\b|\b\w*(PMT|PYMT|CRCARD|CRCARDPMT|AUTOPYMT|LOANPMT|SLMLOAN)\b/;
const INCOME_KEYWORDS  = /\b(CREDIT|DEPOSIT|DIRECT\s*DEP|DIVIDEND|INTEREST\s+EARNED|COMMISSION)\b|\b\w*PAYROLL\b/;

// Five-layer chain. Description keywords now come BEFORE Plaid's PFC because
// PFC is unreliable for credit unions (e.g. PenFed labels outgoing transfers
// as TRANSFER_IN despite the description clearly saying "DEBIT"). When the
// bank's own description text says DEBIT or CREDIT, that's stronger evidence
// of direction than Plaid's ML categorization.
//
//   1. Description keywords (most direct signal — what the bank itself called it)
//   2. PFC INCOME / TRANSFER_IN / TRANSFER_OUT
//   3. PFC specific spending category (FOOD_AND_DRINK, MEDICAL, etc.) → expense
//   4. Legacy category array
//   5. Amount sign (Plaid standard, inverted, or "ignore" depending on account)
export function classifyTransactionType(
  txn: PlaidTxnLike,
  opts?: ClassifyOptions,
): ClassificationResult {
  const pfcPrimary    = (txn.personal_finance_category?.primary ?? "").toUpperCase();
  const legacyCats    = (txn.category ?? []) as string[];
  const legacyPrimary = legacyCats[0] ?? "";
  const descUpper     = (txn.name ?? "").toUpperCase();

  // Layer 0 — refund detection (REFUND / REVERSAL / REIMBURSEMENT /
  // CHARGEBACK). Stored as type="refund" so every aggregation that sums
  // expenses subtracts the refund amount, netting against the original expense
  // category rather than inflating reported income.
  if (REFUND_KEYWORDS.test(descUpper)) {
    return { type: "refund", source: "desc-refund", usedAmountSign: false };
  }

  // Layer 1 — description keywords (highest priority). Expense check first
  // so "CREDIT CARD PAYMENT" → expense (PAYMENT) not income (CREDIT).
  if (EXPENSE_KEYWORDS.test(descUpper)) {
    return { type: "expense", source: "desc-expense", usedAmountSign: false };
  }
  if (INCOME_KEYWORDS.test(descUpper)) {
    return { type: "income", source: "desc-income", usedAmountSign: false };
  }

  // Layer 2 — direction-bearing PFC values
  if (pfcPrimary === "INCOME" || pfcPrimary === "TRANSFER_IN") {
    return { type: "income", source: "pfc-income", usedAmountSign: false };
  }
  if (pfcPrimary === "TRANSFER_OUT") {
    return { type: "expense", source: "pfc-transfer-out", usedAmountSign: false };
  }
  // Layer 3 — specific spending PFC categories (FOOD_AND_DRINK, MEDICAL, etc).
  // "OTHER" means Plaid couldn't categorize — explicitly skipped, not assumed expense.
  if (pfcPrimary !== "" && pfcPrimary !== "OTHER") {
    return { type: "expense", source: "pfc-spending-category", usedAmountSign: false };
  }

  // Layer 4 — legacy categories
  if (legacyPrimary === "Payroll") {
    return { type: "income", source: "legacy-payroll", usedAmountSign: false };
  }
  if (legacyPrimary === "Transfer") {
    const t: "income" | "expense" = legacyCats.includes("Credit") ? "income" : "expense";
    return { type: t, source: `legacy-transfer-${t}`, usedAmountSign: false };
  }
  if (legacyPrimary !== "") {
    return { type: "expense", source: "legacy-merchant", usedAmountSign: false };
  }

  // Layer 5 — fallback. If the account's amount sign carries no info (every
  // Plaid txn has the same sign — common for credit unions like PenFed),
  // default to expense rather than guess from sign.
  if (opts?.ignoreAmountSign) {
    return { type: "expense", source: "default-expense-no-sign-info", usedAmountSign: false };
  }

  const inverted = opts?.amountSignInverted ?? false;
  let t: "income" | "expense";
  if (inverted) {
    t = txn.amount >= 0 ? "income" : "expense";
  } else {
    t = txn.amount >= 0 ? "expense" : "income";
  }
  return {
    type: t,
    source: inverted ? "amount-sign-inverted" : "amount-sign",
    usedAmountSign: true,
  };
}

/**
 * Auto-detects how to interpret amount sign for this account. Three outcomes:
 *
 *   - "standard"      → Plaid's documented convention: positive = outflow.
 *   - "inverted"      → opposite convention: positive = inflow (some banks).
 *   - "no-sign-info"  → every txn has the same sign (e.g. PenFed sends them
 *                       all negative), so the field carries zero direction info.
 *   - "unknown"       → mixed signs but not enough confidently-classified
 *                       transactions to take a position.
 */
export function detectAmountSignConvention(
  txns: PlaidTxnLike[],
): "standard" | "inverted" | "no-sign-info" | "unknown" {
  if (txns.length === 0) return "unknown";

  // First, check whether sign is even usable. If every txn has the same sign,
  // the field carries no direction information for this account.
  const allPositive = txns.every((t) => t.amount >= 0);
  const allNegative = txns.every((t) => t.amount < 0);
  if (allPositive || allNegative) return "no-sign-info";

  let standardVotes = 0;
  let invertedVotes = 0;

  for (const txn of txns) {
    // Classify WITHOUT using amount sign — we want a "ground truth"
    const result = classifyTransactionType(txn, { amountSignInverted: false });
    if (result.usedAmountSign) continue; // skip txns we can't classify independently
    if (result.type === "refund") continue; // refund is a "category" verdict, not direction

    const plaidStandardType: "income" | "expense" = txn.amount >= 0 ? "expense" : "income";

    if (result.type === plaidStandardType) standardVotes++;
    else invertedVotes++;
  }

  const total = standardVotes + invertedVotes;
  if (total < 5) return "unknown"; // need a meaningful sample

  const invertedRatio = invertedVotes / total;
  if (invertedRatio >= 0.7) return "inverted";
  if (invertedRatio <= 0.3) return "standard";
  return "unknown"; // mixed signal — don't guess
}
