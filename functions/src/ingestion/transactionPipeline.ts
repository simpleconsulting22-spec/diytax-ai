// Unified transaction ingestion pipeline.
// All three sources (Plaid sync, CSV import, AI parser) flow through:
//
//   normalize → enrich → classify → store
//
// This file holds the shared normalization + processing primitives. The
// ingestTransactionsCore() helper composes them with Firestore writes and is
// invoked by the ingestTransactions HTTPS callable AND by the Plaid
// fetch path, so all sources end up writing identically-shaped docs.

import {
  classifyTransaction,
  classifyAll,
  ClassifyOutput,
  TxnInput,
} from "../plaid/classifyTransactionPipeline";

// ─── Source raw shapes ───────────────────────────────────────────────────────

export type Source = "plaid" | "csv" | "ai";

export interface RawPlaidInput {
  transaction_id: string;
  account_id:     string;
  amount:         number;     // signed, Plaid convention: positive = outflow
  date:           string;     // YYYY-MM-DD
  name:           string;
  merchant_name?: string | null;
  personal_finance_category?: { primary?: string | null } | null;
  category?:      string[] | null;
  pending?:       boolean;
}

export interface RawCsvInput {
  date:        string;        // YYYY-MM-DD
  description: string;
  amount:      number;        // signed (positive = inflow per CSV convention; flipped to Plaid sign by normalizer)
  rawRow?:     Record<string, string>;
  // When the user explicitly edits a row's type in the CSV preview, the
  // frontend ships that override here. Treated identically to AI parser's
  // preassigned type — wins over classifier output unless a transfer pair is
  // detected (transfer pairing is the strongest cross-account signal).
  type?:       "income" | "expense" | "refund" | "transfer";
  subType?:    "credit_card_payment" | "loan_payment";
}

export interface RawAiInput {
  date:        string;
  description: string;
  amount:      number;        // POSITIVE; AI emits absolute value plus a type
  type:        "income" | "expense" | "refund" | "transfer";
  // Only meaningful when type === "transfer". Lets the normalizer assign
  // an opposite-sign signedAmount to each side of an internal transfer so
  // the classifier's findTransferPairs can match them. When absent on a
  // transfer, the row falls back to inflow + status: "needs_review".
  direction?:  "outflow" | "inflow";
}

// ─── Normalized shape (what every source produces after normalize step) ─────

export interface NormalizedTransaction {
  date:                  string;
  description:           string;
  normalizedDescription: string;
  amount:                number;   // |signedAmount|
  signedAmount:          number;   // Plaid convention: positive = outflow
  accountId:             string;
  source:                Source;
  rawSourceData:         unknown;

  // Plaid-only fields preserved when source==="plaid"
  plaidTransactionId?:   string;
  plaidAccountId?:       string;
  plaidPfcPrimary?:      string | null;
  plaidLegacyCategories?: string[];
  pending?:              boolean;

  // Optional pre-classified type (AI parser, or CSV preview edit)
  preassignedType?:      "income" | "expense" | "refund" | "transfer";
  // Sub-type tag (e.g. credit_card_payment); preserved on the saved doc for
  // downstream UIs that want to distinguish a CC payment from a generic transfer.
  subType?:              "credit_card_payment" | "loan_payment";
  // Set true when an AI-parsed transfer row arrives with no direction. The
  // ingest writer forces status="needs_review" so the user knows to verify.
  needsManualReview?:    boolean;

  // Hash for cross-source dedup
  dedupeHash:            string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDescription(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Cross-source dedup hash. Same content from any source ends up with the
 * same hash (within rounding tolerance), so a Plaid sync that overlaps a
 * CSV import won't double-import.
 *
 * Includes direction (P/N) so a refund of $100 and a charge of $100 don't
 * collide.
 */
export function computeDedupeHash(
  accountId: string,
  date: string,
  signedAmount: number,
  description: string,
): string {
  const cents     = Math.round(Math.abs(signedAmount) * 100);
  const direction = signedAmount > 0 ? "P" : signedAmount < 0 ? "N" : "Z";
  const desc      = normalizeDescription(description).slice(0, 60);
  return `${accountId}|${date}|${cents}|${direction}|${desc}`;
}

// ─── Step 1: normalizeTransaction ───────────────────────────────────────────

export function normalizeTransaction(
  input:    RawPlaidInput | RawCsvInput | RawAiInput,
  source:   Source,
  accountId: string,
): NormalizedTransaction {
  let date:        string;
  let description: string;
  let signedAmount: number;
  let preassignedType: NormalizedTransaction["preassignedType"];
  let subType: NormalizedTransaction["subType"];
  let needsManualReview: boolean | undefined;
  let plaidTransactionId:   string | undefined;
  let plaidAccountId:       string | undefined;
  let plaidPfcPrimary:      string | null | undefined;
  let plaidLegacyCategories: string[] | undefined;
  let pending: boolean | undefined;

  switch (source) {
    case "plaid": {
      const p = input as RawPlaidInput;
      date         = p.date;
      description  = p.name ?? "";
      signedAmount = p.amount;
      plaidTransactionId    = p.transaction_id;
      plaidAccountId        = p.account_id;
      plaidPfcPrimary       = p.personal_finance_category?.primary ?? null;
      plaidLegacyCategories = (p.category ?? []) as string[];
      pending               = p.pending;
      break;
    }
    case "csv": {
      const c = input as RawCsvInput;
      date         = c.date;
      description  = c.description ?? "";
      // CSV convention: positive = inflow, negative = outflow.
      // Plaid convention: positive = outflow. Flip sign so the classifier
      // sees one canonical convention.
      signedAmount = -c.amount;
      // Honor explicit user override from preview (only set when user edited).
      if (c.type)    preassignedType = c.type;
      if (c.subType) subType         = c.subType;
      break;
    }
    case "ai": {
      const a = input as RawAiInput;
      date         = a.date;
      description  = a.description ?? "";

      // AI emits a positive amount + an explicit type. We trust the type
      // (preassignedType) and synthesize a Plaid-convention sign so the
      // classifier still has a meaningful signedAmount.
      //
      // For transfers, sign must come from the explicit `direction` field —
      // otherwise both halves of an internal transfer collapse to the same
      // sign and findTransferPairs can't match them. Existing income/expense/
      // refund logic stays unchanged.
      if (a.type === "transfer") {
        if (a.direction === "outflow") {
          signedAmount = +Math.abs(a.amount);
        } else if (a.direction === "inflow") {
          signedAmount = -Math.abs(a.amount);
        } else {
          // Direction missing — sign is unknown. Default to inflow (matches
          // pre-fix behavior) but flag the row so ingest forces needs_review.
          signedAmount       = -Math.abs(a.amount);
          needsManualReview  = true;
        }
      } else {
        signedAmount = a.type === "expense" ? Math.abs(a.amount) : -Math.abs(a.amount);
      }

      preassignedType = a.type;
      break;
    }
  }

  return {
    date,
    description,
    normalizedDescription: normalizeDescription(description),
    amount:                Math.abs(signedAmount),
    signedAmount,
    accountId,
    source,
    rawSourceData:         input,
    plaidTransactionId,
    plaidAccountId,
    plaidPfcPrimary,
    plaidLegacyCategories,
    pending,
    preassignedType,
    subType,
    needsManualReview,
    dedupeHash:            computeDedupeHash(accountId, date, signedAmount, description),
  };
}

// ─── Step 2: processTransaction ─────────────────────────────────────────────

export interface ProcessedTransaction {
  normalized: NormalizedTransaction;
  result:     ClassifyOutput;
  finalType:  "income" | "expense" | "refund" | "transfer";
}

/**
 * Run the unified classifier on a normalized transaction. Honors the
 * preassignedType when present (AI parser's explicit "this is a refund")
 * but lets the classifier override for transfer detection (cross-account
 * pairing on identical-amount transactions still wins, regardless of source).
 */
export function processTransaction(
  normalized: NormalizedTransaction,
  allInBatch: NormalizedTransaction[],
  precomputed?: {
    pairings:           Map<string, string>;
    refunds:            Set<string>;
    duplicateGroups?:   Map<string, string>;
    userInstitutions?:  Set<string>;
    accountConventions?: Map<string, "standard" | "inverted" | "no-info">;
  },
): ProcessedTransaction {
  const myInput = toTxnInput(normalized);
  const allInputs = allInBatch.map(toTxnInput);
  const result = classifyTransaction(myInput, allInputs, precomputed);

  // Trust user-set type from AI parser unless classifier found a transfer
  // pair (transfer pairing is the strongest signal — preserves cross-account
  // accounting integrity).
  let finalType: ProcessedTransaction["finalType"] = result.type;
  if (normalized.preassignedType && result.type !== "transfer") {
    finalType = normalized.preassignedType;
  }

  return { normalized, result, finalType };
}

function toTxnInput(n: NormalizedTransaction): TxnInput {
  return {
    plaidTransactionId: n.plaidTransactionId ?? n.dedupeHash, // synthetic id for non-Plaid
    accountId:          n.accountId,
    signedAmount:       n.signedAmount,
    absAmount:          n.amount,
    date:               n.date,
    description:        n.description,
  };
}

/** Run the classifier across an entire batch in one pass — O(N) helper used
 *  by ingestTransactionsCore. */
export function processBatch(
  normalized: NormalizedTransaction[],
  userInstitutions: Set<string> = new Set(),
): Map<string, ProcessedTransaction> {
  const inputs = normalized.map(toTxnInput);
  const classifications = classifyAll(inputs);

  const out = new Map<string, ProcessedTransaction>();
  for (const n of normalized) {
    const key = n.plaidTransactionId ?? n.dedupeHash;
    const result = classifications.get(key);
    if (!result) continue;
    let finalType: ProcessedTransaction["finalType"] = result.type;
    if (n.preassignedType && result.type !== "transfer") {
      finalType = n.preassignedType;
    }
    out.set(key, { normalized: n, result, finalType });
  }
  return out;
}

// ─── Step 3: build deterministic Firestore doc id ───────────────────────────

/**
 * Build a deterministic doc id. Plaid keeps its existing
 * `plaid_<transaction_id>` scheme to preserve idempotency with already-imported
 * docs. CSV and AI use the dedupe hash so the same content from the same
 * account never produces two docs no matter how many times you re-import.
 */
export function buildDocId(n: NormalizedTransaction): string {
  if (n.source === "plaid" && n.plaidTransactionId) {
    return `plaid_${n.plaidTransactionId}`;
  }
  // Sanitize: Firestore doc ids can't contain / and shouldn't be too long.
  const safe = n.dedupeHash.replace(/[\/\|]/g, "_").slice(0, 250);
  return `${n.source}_${safe}`;
}
