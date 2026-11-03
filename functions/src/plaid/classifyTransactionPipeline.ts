// Multi-layer transaction classification pipeline.
//
// Pipeline order (mandatory):
//   1. Base direction from amount sign (Plaid: positive = outflow, negative = inflow)
//   2. Transfer detection — description match (TRANSFER / FUNDS TRANSFER / OVERDRAFT TRANSFER / AUTOMATIC TRANSF)
//   3. Transfer pairing — same |amount|, ±1 day, different accounts, opposite direction
//   4. Refund detection — same merchant, same |amount|, opposite direction, within 7 days
//   5. Context matching — same merchant + same |amount| + same day → enforce one inflow, one outflow
//   6. Merchant consistency (non-P2P only) — same merchant should always classify the same direction
//   7. P2P handling — Cash App / Zelle / Venmo / PayPal-personal: needs_review unless paired
//
// Pure functions, no Firestore. The applyClassificationPipeline callable
// wraps these with DB load/save logic.

export interface TxnInput {
  plaidTransactionId: string;
  accountId:          string;
  signedAmount:       number;   // Plaid's signed amount (positive = outflow)
  absAmount:          number;   // |signedAmount| — what we display
  date:               string;   // YYYY-MM-DD
  description:        string;
  merchantName?:      string;
  // Optional context fields used for learning + safety:
  status?:            string;   // "needs_review" | "categorized" | "auto_resolved" | …
  institutionName?:   string;   // e.g. "PenFed Credit Union" — enables internal-payment detection
}

export type TxnType = "income" | "expense" | "refund" | "transfer";
export type Confidence = "high" | "medium" | "low";

export interface ClassifyOutput {
  type:               TxnType;
  status?:            "needs_review" | "auto_resolved";
  transferGroupId?:   string;
  reason:             string;            // diagnostic source
  excludeFromReports?: boolean;
  confidence:         Confidence;
  /**
   * For P2P / ambiguous cases: hint the UI about which direction the bank's
   * own data suggests. Lets the user resolve a conflict with one click instead
   * of guessing.
   */
  suggestedDirection?: "outflow" | "inflow";
  /**
   * Set on every member of a same-merchant + same-amount + same-day cluster
   * (count > 1). Lets the UI surface "you have N identical-looking
   * transactions on this date — review them together".
   */
  duplicateGroupId?:  string;
}

// ─── Pattern matchers ────────────────────────────────────────────────────────

const TRANSFER_KEYWORDS = /\b(?:FUNDS\s+TRANSFER|OVERDRAFT\s+TRANSFER|AUTOMATIC\s+TRANSF|FUNDS\s*TRANSFER\s*,?\s*(?:DEBIT|CREDIT)|TRANSFER\s+(?:TO|FROM|DEBIT|CREDIT))\b/i;

const P2P_KEYWORDS = /\b(?:CASH\s*APP|ZELLE|VENMO|PAYPAL\s*\*)/i;

const REFUND_DESC_KEYWORDS = /\b(REFUND|REVERSAL|REIMBURSEMENT|REIMB|CHARGEBACK)\b|\bREVERSE\s+(PREAUTH|TRANS|CHARGE|WITHDRL|WITHDRAW|DEBIT|CREDIT|PAYMENT)\b/i;

// Direction-bearing description keywords (used as ground truth for sign-
// convention detection AND as a deterministic fallback when an account's
// amount sign is unreliable).
const EXPENSE_DESC_KEYWORDS = /\b(DEBIT|WITHDRAW|WITHDRL|PURCHASE|PAYMENT|AUTOPAY|ATM|FEE|CHARGE|NSF)\b|\b\w*(PMT|PYMT|CRCARD|CRCARDPMT|AUTOPYMT|LOANPMT|SLMLOAN)\b/i;
const INCOME_DESC_KEYWORDS  = /\b(DEPOSIT|DIRECT\s*DEP|DIVIDEND|INTEREST\s+EARNED|COMMISSION)\b|\b\w*PAYROLL\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function baseDirection(signedAmount: number): "outflow" | "inflow" {
  return signedAmount > 0 ? "outflow" : "inflow";
}

function daysBetween(d1: string, d2: string): number {
  const a = new Date(d1).getTime();
  const b = new Date(d2).getTime();
  return Math.abs(a - b) / 86_400_000;
}

function normalizeMerchant(desc: string): string {
  if (!desc) return "";
  return desc
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Token-Jaccard similarity ≥ 0.5 means "same merchant" for our purposes.
 * Tokens of length ≤ 2 are dropped (CA, IL, NY noise).
 */
function merchantsMatch(a: string, b: string): boolean {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(" ").filter((t) => t.length > 2));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  const union = ta.size + tb.size - inter;
  return union > 0 && (inter / union) >= 0.5;
}

export function isP2PDescription(desc: string): boolean {
  return P2P_KEYWORDS.test(desc ?? "");
}

// ─── Credit card / internal payment detection ────────────────────────────────

const PAYMENT_KEYWORDS = /\b(?:CRCARDPMT|CARD\s+PMT|CARD\s+PAYMENT|AUTOPAY|AUTOPYMT|LOANPMT|SLMLOAN)\b|\b\w*(?:PMT|PAYMENT|PYMT)\b/i;

export function isPaymentPattern(desc: string): boolean {
  return PAYMENT_KEYWORDS.test(desc ?? "");
}

/**
 * Likely-internal payment heuristic: a payment-pattern outflow whose
 * description mentions the user's own institution (so it's the user paying
 * their own card/loan), OR has a matching opposite transaction on a different
 * linked account (pairing already does this — included as a fallback).
 */
function isLikelyInternalPayment(
  txn: TxnInput,
  allTransactions: TxnInput[],
  userInstitutions: Set<string>,
): boolean {
  if (!isPaymentPattern(txn.description)) return false;
  const upper = (txn.description ?? "").toUpperCase();

  // Same-institution mention. Match on the first word of the institution name
  // (e.g., "PenFed Credit Union" → "PENFED" appears in description) to be
  // resilient to suffixes Plaid appends.
  for (const inst of userInstitutions) {
    if (!inst) continue;
    const firstWord = inst.toUpperCase().split(/\s+/)[0];
    if (firstWord && firstWord.length >= 4 && upper.includes(firstWord)) return true;
  }

  // Opposite txn on another account, ±1 day, same |amount|
  const dir = baseDirection(txn.signedAmount);
  return allTransactions.some((other) =>
    other.plaidTransactionId !== txn.plaidTransactionId &&
    other.accountId !== txn.accountId &&
    Math.abs(other.absAmount - txn.absAmount) < 0.01 &&
    daysBetween(other.date, txn.date) <= 1 &&
    baseDirection(other.signedAmount) !== dir
  );
}

// ─── P2P helpers (per spec) ──────────────────────────────────────────────────

/**
 * Same-day, same |amount|, opposite-direction match — used to auto-resolve a
 * P2P transaction (pair clearly tells us direction).
 */
export function hasMatchingOppositeTransaction(
  txn: TxnInput,
  allTransactions: TxnInput[],
): boolean {
  const dir = baseDirection(txn.signedAmount);
  return allTransactions.some((other) =>
    other.plaidTransactionId !== txn.plaidTransactionId &&
    Math.abs(other.absAmount - txn.absAmount) < 0.01 &&
    daysBetween(other.date, txn.date) <= 1 &&
    baseDirection(other.signedAmount) !== dir
  );
}

export function inferDirectionFromPair(
  txn: TxnInput,
  _allTransactions: TxnInput[],
): "outflow" | "inflow" {
  // Pair confirms direction; Plaid's own sign is the source of truth.
  return baseDirection(txn.signedAmount);
}

/**
 * Learned direction for the same merchant (no amount in the lookup, per spec —
 * amount is too brittle).  We learn from transactions in this batch that
 * already have status="categorized" or "auto_resolved" (user-confirmed or
 * confidently classified).  If all known directions agree → return it. Mixed
 * directions → null (don't pretend to know).
 */
export function hasLearnedDirection(
  txn: TxnInput,
  allTransactions: TxnInput[],
): boolean {
  return getLearnedDirection(txn, allTransactions) !== null;
}

export function getLearnedDirection(
  txn: TxnInput,
  allTransactions: TxnInput[],
): "outflow" | "inflow" | null {
  const myMerchant = normalizeMerchant(txn.description);
  if (!myMerchant) return null;

  let outflow = 0;
  let inflow  = 0;
  for (const other of allTransactions) {
    if (other.plaidTransactionId === txn.plaidTransactionId) continue;
    if (!merchantsMatch(other.description, txn.description)) continue;
    // Only learn from confirmed transactions
    const confirmed = other.status === "categorized" || other.status === "auto_resolved";
    if (!confirmed) continue;
    if (baseDirection(other.signedAmount) === "outflow") outflow++;
    else inflow++;
  }
  if (outflow > 0 && inflow === 0) return "outflow";
  if (inflow > 0 && outflow === 0) return "inflow";
  return null;
}

export function isTransferDescription(desc: string): boolean {
  return TRANSFER_KEYWORDS.test(desc ?? "");
}

export function isRefundDescription(desc: string): boolean {
  return REFUND_DESC_KEYWORDS.test(desc ?? "");
}

// ─── Per-account sign-convention detection ───────────────────────────────────

export type SignConvention = "standard" | "inverted" | "no-info";

/**
 * Determine how to interpret amount sign for a given account by sampling its
 * transactions whose direction is unambiguous from the description (DEBIT /
 * WITHDRAWAL / FEE → outflow; PAYROLL / DEPOSIT / DIVIDEND → inflow), then
 * checking whether the amount sign agrees with that ground truth.
 *
 *   "standard"  = positive amount → outflow (Plaid's documented convention)
 *   "inverted"  = positive amount → inflow  (some credit unions)
 *   "no-info"   = sign carries no direction info (e.g., all amounts negative).
 *                 Caller should rely on description keywords + safe defaults.
 */
export function detectAccountSignConvention(
  transactions: TxnInput[],
  accountId: string,
): SignConvention {
  const acctTxns = transactions.filter((t) => t.accountId === accountId);
  if (acctTxns.length < 5) return "no-info";

  // If ALL amounts have the same sign, the field carries zero direction info
  const allPositive = acctTxns.every((t) => t.signedAmount >= 0);
  const allNegative = acctTxns.every((t) => t.signedAmount < 0);
  if (allPositive || allNegative) return "no-info";

  let standard = 0;
  let inverted = 0;
  for (const t of acctTxns) {
    const desc = (t.description || "").toUpperCase();
    let truth: "outflow" | "inflow" | null = null;
    if (EXPENSE_DESC_KEYWORDS.test(desc)) truth = "outflow";
    else if (INCOME_DESC_KEYWORDS.test(desc)) truth = "inflow";
    if (!truth) continue;

    const signSays: "outflow" | "inflow" = t.signedAmount > 0 ? "outflow" : "inflow";
    if (signSays === truth) standard++;
    else inverted++;
  }

  const total = standard + inverted;
  if (total < 3) return "no-info";
  if (standard / total >= 0.7) return "standard";
  if (inverted / total >= 0.7) return "inverted";
  return "no-info";
}

/**
 * Resolve actual direction (income vs expense) for a transaction, respecting
 * the per-account sign convention and description keywords.
 *
 * Description keywords win when present (deterministic). Otherwise we use
 * sign with the per-account convention. When convention is "no-info" we
 * default to outflow — the overwhelming majority of consumer transactions
 * are outflows, so this is the safe bias.
 */
export function actualDirection(
  txn: TxnInput,
  convention: SignConvention,
): "outflow" | "inflow" {
  const desc = (txn.description || "").toUpperCase();
  if (EXPENSE_DESC_KEYWORDS.test(desc)) return "outflow";
  if (INCOME_DESC_KEYWORDS.test(desc))  return "inflow";

  if (convention === "standard") return txn.signedAmount > 0 ? "outflow" : "inflow";
  if (convention === "inverted") return txn.signedAmount > 0 ? "inflow"  : "outflow";
  return "outflow"; // no-info default
}

/**
 * Deterministic transfer-group id derivable from the two paired plaidTransactionIds.
 * Sort the IDs so both transactions in the pair compute the same group id.
 */
function makeTransferGroupId(idA: string, idB: string): string {
  const [first, second] = [idA, idB].sort();
  return `tg_${first}_${second}`.slice(0, 100);
}

// ─── Step 3: Transfer pairing ────────────────────────────────────────────────

/**
 * Find every cross-account pair of transactions that look like the two halves
 * of a transfer between the user's own accounts. Returns a map from
 * plaidTransactionId → transferGroupId for every txn that's been paired.
 *
 * Match criteria:
 *   - same |amount| (within $0.01)
 *   - dates within 1 day
 *   - different accountId
 *   - opposite direction (one outflow, one inflow per Plaid sign)
 *
 * Each transaction matches at most one partner. We pick the closest-date
 * partner if multiple candidates exist.
 */
export function findTransferPairs(transactions: TxnInput[]): Map<string, string> {
  const pairs = new Map<string, string>();
  const used = new Set<string>();

  // Bucket by absAmount (rounded to cents) for O(N) discovery
  const byAmount = new Map<number, TxnInput[]>();
  for (const t of transactions) {
    const k = Math.round(t.absAmount * 100);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k)!.push(t);
  }

  for (const txns of byAmount.values()) {
    if (txns.length < 2) continue;
    for (let i = 0; i < txns.length; i++) {
      const a = txns[i];
      if (used.has(a.plaidTransactionId)) continue;
      let bestMatch: TxnInput | null = null;
      let bestDist = Infinity;
      for (let j = 0; j < txns.length; j++) {
        if (i === j) continue;
        const b = txns[j];
        if (used.has(b.plaidTransactionId)) continue;
        if (a.accountId === b.accountId) continue;
        if (baseDirection(a.signedAmount) === baseDirection(b.signedAmount)) continue;
        const dist = daysBetween(a.date, b.date);
        if (dist > 1) continue;
        if (dist < bestDist) { bestDist = dist; bestMatch = b; }
      }
      if (bestMatch) {
        const gid = makeTransferGroupId(a.plaidTransactionId, bestMatch.plaidTransactionId);
        pairs.set(a.plaidTransactionId, gid);
        pairs.set(bestMatch.plaidTransactionId, gid);
        used.add(a.plaidTransactionId);
        used.add(bestMatch.plaidTransactionId);
      }
    }
  }
  return pairs;
}

// ─── Step 4: Refund detection ────────────────────────────────────────────────

/**
 * Strong pair signal — same merchant + opposite direction + |amount| match +
 * within 3 days. Used to confirm refunds (tighter than the 7-day window we
 * had before, to reduce false positives where unrelated same-merchant
 * transactions on far-apart dates got mis-paired).
 */
export function hasStrongPairSignal(
  txn: TxnInput,
  allTransactions: TxnInput[],
): boolean {
  const dir = baseDirection(txn.signedAmount);
  return allTransactions.some((other) =>
    other.plaidTransactionId !== txn.plaidTransactionId &&
    baseDirection(other.signedAmount) !== dir &&
    Math.abs(other.absAmount - txn.absAmount) < 0.01 &&
    daysBetween(other.date, txn.date) <= 3 &&
    merchantsMatch(other.description, txn.description)
  );
}

/**
 * Identify transactions that are refunds of a previous expense.
 *
 * Two paths to "refund" (both must be high-confidence):
 *   (a) Description explicitly says REFUND / REVERSAL / REIMBURSEMENT / CHARGEBACK
 *   (b) Strong pair signal: same merchant + opposite direction + same |amount|
 *       + within 3 days  (was 7 days — tightened to avoid false positives)
 *
 * If neither holds, the inflow is left alone (default classification by sign).
 *
 * Only the inflow side is marked as refund; the outflow stays as expense and
 * nets down through the refund-aware aggregation helpers.
 */
export function detectRefunds(transactions: TxnInput[]): Set<string> {
  const refunds = new Set<string>();

  // Path A — explicit description keyword
  for (const t of transactions) {
    if (isRefundDescription(t.description)) refunds.add(t.plaidTransactionId);
  }

  // Path B — strong pair signal (only inflows, only with same-merchant outflow within 3 days)
  for (const t of transactions) {
    if (refunds.has(t.plaidTransactionId)) continue;
    if (baseDirection(t.signedAmount) !== "inflow") continue;
    if (hasStrongPairSignal(t, transactions)) refunds.add(t.plaidTransactionId);
  }
  return refunds;
}

// ─── Same-account transfer detection (single-sided) ─────────────────────────

/**
 * Loose match for the word "TRANSFER" anywhere in the description (broader
 * than isTransferDescription which requires specific strong patterns like
 * "FUNDS TRANSFER" / "OVERDRAFT TRANSFER"). Used as the fallback transfer
 * detector when no opposite-side pair exists in the user's other accounts —
 * common for sweeps/transfers to external accounts that aren't linked here.
 */
const LOOSE_TRANSFER_WORD = /\bTRANSFER\b/i;

export function hasTransferWord(desc: string): boolean {
  return LOOSE_TRANSFER_WORD.test(desc ?? "");
}

// ─── Same-day same-merchant same-amount duplicate grouping ──────────────────

/**
 * Compute a stable group id (hash of merchant + amount + date) for every
 * transaction whose (normalizedMerchant, absAmount, date) cluster has more
 * than one member. Single-occurrence transactions get no id.
 */
export function findDuplicateGroups(transactions: TxnInput[]): Map<string, string> {
  const buckets = new Map<string, TxnInput[]>();
  for (const t of transactions) {
    const merchant = normalizeMerchant(t.description);
    if (!merchant) continue;
    const key = `${merchant}|${Math.round(t.absAmount * 100)}|${t.date}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }
  const result = new Map<string, string>();
  for (const [key, members] of buckets.entries()) {
    if (members.length < 2) continue;
    const groupId = `dup_${hashKey(key)}`;
    for (const m of members) result.set(m.plaidTransactionId, groupId);
  }
  return result;
}

/** Stable string-to-id hash. Deterministic so re-runs produce the same id. */
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ─── Step 5+6: Context matching + merchant consistency ───────────────────────

/**
 * Same-day, same-merchant, same-amount: enforce one outflow + one inflow
 * (this catches Plaid quirks where both sides got mis-tagged).
 *
 * Same merchant across many days (non-P2P): if classifications would diverge,
 * trust amount sign — it's the deterministic ground truth.
 *
 * Both rules are implemented implicitly by always trusting the sign for
 * direction, then overriding with transfer/refund/p2p logic. We keep this
 * as a no-op helper for explicit policy compliance.
 */

// ─── Main classifier ─────────────────────────────────────────────────────────

export function classifyTransaction(
  txn: TxnInput,
  allTransactions: TxnInput[],
  precomputed?: {
    pairings: Map<string, string>;
    refunds: Set<string>;
    userInstitutions?: Set<string>;
    duplicateGroups?: Map<string, string>;
    accountConventions?: Map<string, SignConvention>;
  },
): ClassifyOutput {
  const accountConventions = precomputed?.accountConventions;
  const convention = accountConventions?.get(txn.accountId)
    ?? detectAccountSignConvention(allTransactions, txn.accountId);

  // Safety: never overwrite a user-confirmed classification
  if (txn.status === "categorized") {
    const adir = actualDirection(txn, convention);
    return {
      type: adir === "outflow" ? "expense" : "income",
      reason: "preserved-user-confirmed",
      confidence: "high",
      duplicateGroupId: precomputed?.duplicateGroups?.get(txn.plaidTransactionId),
    };
  }

  const pairings        = precomputed?.pairings        ?? findTransferPairs(allTransactions);
  const refunds         = precomputed?.refunds         ?? detectRefunds(allTransactions);
  const userInstitutions = precomputed?.userInstitutions ?? new Set<string>();
  const duplicateGroupId = precomputed?.duplicateGroups?.get(txn.plaidTransactionId);

  // dir = actual direction respecting per-account sign convention + description keywords
  const dir = actualDirection(txn, convention);
  const desc = txn.description ?? "";

  // ── Pipeline order ────────────────────────────────────────────────────────
  // 0. Preserve user-confirmed (above)
  // 1. baseDirection (computed: dir)
  // 2. Explicit transfer keywords (strong patterns)
  // 3. Refund detection
  // 4. Same-account / single-sided transfer (TRANSFER word, no opposite pair)
  // 5. Internal payment detection
  // 6. Cross-account transfer pairing
  // 7. P2P handling
  // 8. Default classification

  // 2. Explicit transfer keywords (strong patterns) — high confidence
  if (isTransferDescription(desc)) {
    const gid = pairings.get(txn.plaidTransactionId);
    return {
      type: "transfer",
      transferGroupId: gid,
      excludeFromReports: true,
      reason: gid ? "desc-transfer-paired" : "desc-transfer",
      confidence: "high",
      duplicateGroupId,
    };
  }

  // 3. Refunds (description keyword OR strong same-merchant pair within 3 days)
  if (refunds.has(txn.plaidTransactionId)) {
    return {
      type: "refund",
      reason: isRefundDescription(desc) ? "desc-refund" : "merchant-refund-pair",
      confidence: "high",
      duplicateGroupId,
    };
  }

  // 4. Single-sided transfer: description has loose "TRANSFER" word AND no
  //    matching opposite txn anywhere — this catches sweeps/movements to
  //    external accounts not linked here. Medium confidence.
  if (hasTransferWord(desc) && !hasMatchingOppositeTransaction(txn, allTransactions)) {
    return {
      type: "transfer",
      excludeFromReports: true,
      reason: "single-side-transfer",
      confidence: "medium",
      duplicateGroupId,
    };
  }

  // 5. Internal credit-card / loan payment → transfer
  if (isLikelyInternalPayment(txn, allTransactions, userInstitutions)) {
    const gid = pairings.get(txn.plaidTransactionId);
    return {
      type: "transfer",
      transferGroupId: gid,
      excludeFromReports: true,
      reason: gid ? "internal-payment-paired" : "internal-payment",
      confidence: gid ? "high" : "medium",
      duplicateGroupId,
    };
  }

  // 6. Cross-account pairing (catches unlabeled internal transfers)
  if (pairings.has(txn.plaidTransactionId)) {
    return {
      type: "transfer",
      transferGroupId: pairings.get(txn.plaidTransactionId),
      excludeFromReports: true,
      reason: "paired-transfer",
      confidence: "high",
      duplicateGroupId,
    };
  }

  // 7. P2P — paired → learned → review, with suggestedDirection on conflict
  if (isP2PDescription(desc)) {
    if (hasMatchingOppositeTransaction(txn, allTransactions)) {
      const inferred = inferDirectionFromPair(txn, allTransactions);
      return {
        type: inferred === "outflow" ? "expense" : "income",
        status: "auto_resolved",
        reason: "p2p-paired",
        confidence: "high",
        duplicateGroupId,
      };
    }
    const learned = getLearnedDirection(txn, allTransactions);
    if (learned) {
      if (learned !== dir) {
        // Conflict: bank's sign data says one thing, your past behavior says
        // another. Surface the conflict + give the UI a hint to resolve in one click.
        return {
          type: dir === "outflow" ? "expense" : "income",
          status: "needs_review",
          reason: "direction_conflict",
          suggestedDirection: dir,
          confidence: "low",
          duplicateGroupId,
        };
      }
      return {
        type: dir === "outflow" ? "expense" : "income",
        status: "auto_resolved",
        reason: "p2p-learned",
        confidence: "medium",
        duplicateGroupId,
      };
    }
    // No pair, no learned history → review with hint
    return {
      type: dir === "outflow" ? "expense" : "income",
      status: "needs_review",
      reason: "p2p-needs-review",
      suggestedDirection: dir,
      confidence: "low",
      duplicateGroupId,
    };
  }

  // 8. Default — sign tells us direction (per spec, reliable for Plaid)
  return {
    type: dir === "outflow" ? "expense" : "income",
    reason: "amount-sign",
    confidence: "high",
    duplicateGroupId,
  };
}

/**
 * Convenience: classify every transaction in one shot, returning a map from
 * plaidTransactionId → ClassifyOutput. Computes pairings and refunds once
 * for the whole batch (O(N) instead of O(N²)).
 */
export function classifyAll(transactions: TxnInput[]): Map<string, ClassifyOutput> {
  const pairings        = findTransferPairs(transactions);
  const refunds         = detectRefunds(transactions);
  const duplicateGroups = findDuplicateGroups(transactions);

  // Build set of user institutions from the inputs themselves
  const userInstitutions = new Set<string>();
  for (const t of transactions) {
    if (t.institutionName) userInstitutions.add(t.institutionName);
  }

  // Per-account sign-convention detection — done once per account up front
  const accountConventions = new Map<string, SignConvention>();
  const seenAccounts = new Set<string>();
  for (const t of transactions) seenAccounts.add(t.accountId);
  for (const acctId of seenAccounts) {
    accountConventions.set(acctId, detectAccountSignConvention(transactions, acctId));
  }

  const out = new Map<string, ClassifyOutput>();
  for (const t of transactions) {
    out.set(
      t.plaidTransactionId,
      classifyTransaction(t, transactions, {
        pairings, refunds, userInstitutions, duplicateGroups, accountConventions,
      }),
    );
  }
  return out;
}
