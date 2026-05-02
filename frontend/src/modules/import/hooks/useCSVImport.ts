import { useState, useRef } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  deleteDoc,
  writeBatch,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { apiClient } from "../../../services/apiClient";
import {
  ingestCsvFile,
  summarizeResult,
  type DetectionResult,
  type RowError,
} from "../csvEngine";
import {
  findDuplicates,
  computeRowDedupeHash,
  type MatchInfo,
} from "../csvEngine/findDuplicates";
import { track } from "../../../lib/telemetry";

// Diagnostic logging — opt-in via ?debug=1 query param so the noisy
// applyTypeRules / updateRowType / dumpTypeRules logs only appear when the
// user (or me) is intentionally instrumenting. Evaluated once at module load;
// to toggle, append/remove ?debug=1 and reload.
const DEBUG_LOGS =
  typeof window !== "undefined" &&
  /(?:\?|&)debug=1\b/.test(window.location.search);

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransactionType = "income" | "expense" | "transfer" | "refund";
export type TransactionSubType = "credit_card_payment" | "loan_payment";

export interface NormalizedRow {
  date: string;
  description: string;
  amount: number;           // NaN = unparseable/missing
  type: TransactionType;
  subType?: TransactionSubType;
  isTransfer: boolean;
  accountIdentifier: string | null;
  accountType: "bank" | "credit_card";
  rawData: Record<string, string>;
  userModified?: boolean;     // true when user manually overrode the type in the preview
  // ── Pre-import duplicate detection ──────────────────────────────────────
  // The canonical content key used by the backend's dedup decision. Frontend
  // computes the same hash for query + override-tracking purposes.
  dedupeHash?: string;
  // Set when findDuplicates() identified a likely duplicate. UI badges off this.
  possibleDuplicate?: MatchInfo | null;
}

// ─── Transfer detection ───────────────────────────────────────────────────────

// Bank-account transfer patterns (funds moving between your own accounts)
const BANK_TRANSFER_PATTERNS = [
  /\btransfer\b/i,
  /\bxfer\b/i,
  /\bmobile transfer\b/i,
  /\bonline transfer\b/i,
  /\baccount transfer\b/i,
  /\bbetween accounts\b/i,
  /^from\s+(checking|savings|account)/i,
  /^to\s+(checking|savings|account)/i,
];

// Credit-card "payment" patterns — payments TO a card from a bank account
const CREDIT_CARD_PAYMENT_PATTERNS = [
  /\bpayment\b/i,
  /\bautopay\b/i,
  /\bthank\s+you\b/i,
  /\bcredit\s+card\s+payment\b/i,
  /\bweb\s+payment\b/i,
  /\bmobile\s+payment\b/i,
];

// Patterns that indicate a payment going OUT from a bank to a credit card
// (more specific than generic "payment" to reduce false positives on bank imports)
const BANK_DEBT_PAYMENT_PATTERNS = [
  /\bcredit\s+card\b/i,
  /\bcard\s+payment\b/i,
  /\bcard\s+autopay\b/i,
  /\bamex\b/i,
  /\bamerican\s+express\b/i,
  /\bchase\s+card\b/i,
  /\bciti\s+card\b/i,
  /\bcapital\s+one\b/i,
  /\bdiscover\s+card\b/i,
  /\bbank\s+of\s+america\s+card\b/i,
  /\bwells\s+fargo\s+card\b/i,
  /\bbarclays\b/i,
  /\bsynchrony\b/i,
  /\bpayment\s+to\s+\w*\s*(card|visa|mastercard|amex)/i,
];

// Loan payment patterns — mortgage, auto, student, personal loans
const LOAN_PAYMENT_PATTERNS = [
  /\bmortgage\b/i,
  /\bhome\s+loan\b/i,
  /\bhome\s+equity\b/i,
  /\bheloc\b/i,
  /\bauto\s+loan\b/i,
  /\bcar\s+loan\b/i,
  /\bvehicle\s+loan\b/i,
  /\bstudent\s+loan\b/i,
  /\bsallie\s+mae\b/i,
  /\bnavient\b/i,
  /\bfedloan\b/i,
  /\bgreat\s+lakes\b/i,
  /\bnelnet\b/i,
  /\bpersonal\s+loan\b/i,
  /\bloan\s+payment\b/i,
  /\bloan\s+repayment\b/i,
];

function detectBankTransfer(description: string): boolean {
  return BANK_TRANSFER_PATTERNS.some((re) => re.test(description));
}

function detectCreditCardPayment(description: string): boolean {
  return CREDIT_CARD_PAYMENT_PATTERNS.some((re) => re.test(description));
}

function detectBankDebtPayment(description: string): boolean {
  return BANK_DEBT_PAYMENT_PATTERNS.some((re) => re.test(description));
}

function detectLoanPayment(description: string): boolean {
  return LOAN_PAYMENT_PATTERNS.some((re) => re.test(description));
}

// Refund / reversal / chargeback indicators in transaction descriptions.
const REFUND_KEYWORDS = /\b(REFUND|REVERSAL|REIMBURSEMENT|REIMB|CHARGEBACK)\b/i;

/** Derive transaction type based on account type, amount, and description. */
function deriveType(
  description: string,
  amount: number,
  accountType: "bank" | "credit_card"
): { type: TransactionType; subType?: TransactionSubType; isTransfer: boolean } {
  if (accountType === "credit_card") {
    // Credit card payment/autopay rows are not purchases — treat as transfer
    if (detectCreditCardPayment(description)) {
      return { type: "transfer", isTransfer: true };
    }
    // Negative = charge (expense); positive = credit/refund
    if (amount < 0) return { type: "expense", isTransfer: false };
    return { type: "refund", isTransfer: false };
  }

  // Bank account: loan payments (mortgage, auto, student) → transfer tagged as loan_payment
  if (detectLoanPayment(description)) {
    return { type: "transfer", subType: "loan_payment", isTransfer: true };
  }

  // Bank account: credit card payments → transfer tagged as credit_card_payment
  if (detectBankDebtPayment(description)) {
    return { type: "transfer", subType: "credit_card_payment", isTransfer: true };
  }

  // Generic account-to-account transfer
  if (detectBankTransfer(description)) {
    return { type: "transfer", isTransfer: true };
  }

  // Bank account refunds: description has REFUND/REVERSAL/etc. keyword.
  // type="refund" so the amount nets against the original expense category
  // rather than inflating reported income.
  if (REFUND_KEYWORDS.test(description)) {
    return { type: "refund", isTransfer: false };
  }

  return {
    type: !isNaN(amount) && amount >= 0 ? "income" : "expense",
    isTransfer: false,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Collapse whitespace, lowercase — used in importKey and stored on the doc
export function normalize(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── Vendor extraction ────────────────────────────────────────────────────────

// Common payment-processor prefixes to strip before extracting vendor name.
//
// The strip loop iterates this list in order, applies the first pattern that
// matches, then restarts. MORE-SPECIFIC PATTERNS MUST COME FIRST — e.g.
// "Zelle Sent to <name>" must be caught before the bare "Zelle <name>"
// fallback, otherwise the wider pattern would strip too little and leave
// "sent" as the apparent vendor.
//
// The P2P groups (Zelle / Venmo / Cash App / PayPal direct sends) intentionally
// peel both the brand AND the verb (Sent / Payment / Received / Deposit /
// Cashout) AND any to/from connector, so the recipient/sender NAME becomes
// the vendor key. That's what the pattern-learning cascade keys off of —
// without this, "Zelle Sent to Gregory" and "Zelle Sent to Pearl" both
// collapse to vendor="zelle" and a single correction would falsely cascade
// across unrelated recipients.
const VENDOR_LEADING_NOISE = [
  /^sq\s*\*\s*/i, /^tst\s*\*\s*/i, /^pp\s*\*\s*/i, /^paypal\s*\*\s*/i,
  /^amzn\s+mktp(\s+us)?\s*/i, /^amazon\.com\/bill\s*/i,
  /^ach\s+(credit|debit)?\s*/i, /^pos\s*#?\s*\d*\s*/i,
  /^debit\s+card\s+/i, /^purchase\s+at\s+/i, /^payment\s+to\s+/i,
  /^autopay\s+/i,

  // ── P2P platforms ──
  // Permissive form: strip "<brand> [up to 3 connector words] (to|from) " so
  // bank-specific phrasings like "Zelle money received from <name>" or
  // "Venmo Sent to <name>" all collapse to the recipient as the vendor key.
  // Capital One specifically formats Zelle entries as "Zelle money received
  // from / sent to" — without the {0,3} word allowance, every Zelle row in
  // their CSVs collapses to vendor="money" and breaks per-recipient learning.
  // Then a verb-only fallback (no recipient), then the bare-brand fallback.
  // Zelle
  /^zelle\s+(?:[a-z]+\s+){0,3}(?:to|from)\s+/i,
  /^zelle\s+(?:sent|payment|received|deposit|cashout|funds|money)\s+/i,
  /^zelle\s+/i,
  // Venmo
  /^venmo\s+(?:[a-z]+\s+){0,3}(?:to|from)\s+/i,
  /^venmo\s+(?:sent|payment|received|cashout|charge|funds|money)\s+/i,
  /^venmo\s+/i,
  // Cash App (handles "Cash App", "CashApp", "Cash app")
  /^cash\s*app\s+(?:[a-z]+\s+){0,3}(?:to|from)\s+/i,
  /^cash\s*app\s+(?:sent|payment|received|cashout|funds|money)\s+/i,
  /^cash\s*app\s+/i,
  // PayPal direct sends. "/^paypal\s*\*\s*/i" above handles the
  // "PayPal*Merchant" form for merchants billing through PayPal.
  /^paypal\s+(?:[a-z]+\s+){0,3}(?:to|from)\s+/i,
  /^paypal\s+(?:instant\s+transfer|sent|payment|received|transfer|funds|money)\s+/i,
  /^paypal\s+/i,

  /^recurring\s+/i, /^online\s+(payment|purchase)\s*/i,
  /^\d{4,}\s+/,
];
const VENDOR_BRAND_ALIASES: Array<[RegExp, string]> = [
  [/^amzn\b/i, "amazon"], [/^amazon\b/i, "amazon"],
  [/^wal.?mart\b/i, "walmart"], [/^starbucks\b/i, "starbucks"],
  [/^mcdonald/i, "mcdonalds"], [/^uber\s*eats/i, "uber eats"],
  [/^uber\b/i, "uber"], [/^lyft\b/i, "lyft"],
  [/^doordash\b/i, "doordash"], [/^netflix/i, "netflix"],
  [/^spotify/i, "spotify"], [/^apple\.?com/i, "apple"],
  [/^google\b/i, "google"], [/^microsoft\b/i, "microsoft"],
  [/^zoom\.?us/i, "zoom"], [/^dropbox\b/i, "dropbox"],
  [/^github\b/i, "github"], [/^aws\b/i, "amazon web services"],
  [/^shopify\b/i, "shopify"], [/^quickbooks/i, "quickbooks"],
];

// English articles that we never want to surface as the vendor key. Without
// this filter, descriptions like "Zelle THE AWESOME G" and "Zelle THE
// CITYLIGHT" both extract to vendor="the" and pattern-learning incorrectly
// groups them together.
const VENDOR_STOP_WORDS = new Set(["the", "a", "an"]);

export function extractVendor(normalizedDescription: string): string {
  if (!normalizedDescription) return "unknown";
  let s = normalizedDescription.toLowerCase().trim();

  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of VENDOR_LEADING_NOISE) {
      const next = s.replace(pat, "").trim();
      if (next !== s) { s = next; changed = true; break; }
    }
  }
  // Strip trailing store numbers / reference codes
  s = s.replace(/\s+#\d+.*/, "").replace(/\s+\d{6,}.*/, "").trim();

  for (const [pat, canonical] of VENDOR_BRAND_ALIASES) {
    if (pat.test(s)) return canonical;
  }

  const words = s
    .split(/\s+/)
    .filter((w) => /[a-z]/.test(w) && w.length >= 2 && !VENDOR_STOP_WORDS.has(w));
  if (words.length === 0) return normalizedDescription.split(" ")[0] || "unknown";
  return words[0].length <= 2 && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

// Date and amount parsing live in the csvEngine module — see
// frontend/src/modules/import/csvEngine/parsing.ts. Re-export not needed here.

// ─── Sign-issue detection ─────────────────────────────────────────────────────

/**
 * Returns true when the parsed rows look like a credit-card export where
 * charges are positive (e.g. American Express).
 *
 * Heuristic: if > 65% of non-transfer amounts are positive AND none of the
 * descriptions look like payroll / interest / deposits, the signs are likely
 * inverted and the user should be prompted to flip them.
 */
export function detectSignIssue(rows: NormalizedRow[]): boolean {
  const nonTransfer = rows.filter((r) => !r.isTransfer && !isNaN(r.amount));
  if (nonTransfer.length < 5) return false;

  const positiveCount = nonTransfer.filter((r) => r.amount > 0).length;
  const ratio = positiveCount / nonTransfer.length;
  if (ratio < 0.65) return false;

  // If any row description looks like legitimate income, trust the signs
  const hasLegitIncome = nonTransfer.some((r) =>
    /payroll|direct\s+deposit|salary|dividend|interest\s+earned|refund|ach\s+credit/i.test(
      r.description
    )
  );
  return !hasLegitIncome;
}

// ─── Type-rule learning ───────────────────────────────────────────────────────

/**
 * Load user's learned type rules from Firestore and apply them to parsed rows.
 * Rows whose vendor matches a saved rule have their type overridden automatically.
 *
 * NOTE: This silently rewrites row.type at parse time. Phase-1 instrumentation
 * below logs every match so we can see when this fires and which rules are
 * involved. Phase 2 will move this to a non-destructive suggestion model.
 */
async function applyTypeRules(userId: string, rows: NormalizedRow[]): Promise<NormalizedRow[]> {
  try {
    const snap = await getDocs(
      query(collection(db, "typeRules"), where("uid", "==", userId))
    );
    if (snap.empty) {
      if (DEBUG_LOGS) console.log(`[applyTypeRules] uid=${userId} rulesLoaded=0 — no rules to apply`);
      return rows;
    }

    const rules     = new Map<string, TransactionType>();
    const ruleMeta  = new Map<string, { docId: string; updatedAt?: unknown; usageCount?: number }>();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.vendorName && data.type) {
        rules.set(data.vendorName as string, data.type as TransactionType);
        ruleMeta.set(data.vendorName as string, {
          docId:      d.id,
          updatedAt:  data.updatedAt,
          usageCount: data.usageCount as number | undefined,
        });
      }
    });

    interface Hit {
      idx:      number;
      desc:     string;
      vendor:   string;
      fromType: string;
      toType:   string;
      ruleDoc:  string;
      usageCount: number | undefined;
    }
    const hits: Hit[] = [];

    const out = rows.map((row, idx) => {
      const vendor = extractVendor(normalize(row.description));
      const learnedType = rules.get(vendor);
      if (learnedType && learnedType !== row.type) {
        const meta = ruleMeta.get(vendor);
        hits.push({
          idx,
          desc:     row.description,
          vendor,
          fromType: row.type,
          toType:   learnedType,
          ruleDoc:  meta?.docId ?? "(unknown)",
          usageCount: meta?.usageCount,
        });
        return { ...row, type: learnedType, isTransfer: learnedType === "transfer" };
      }
      return row;
    });

    if (DEBUG_LOGS) {
      console.groupCollapsed(
        `[applyTypeRules] scanned=${rows.length} rulesLoaded=${rules.size} hits=${hits.length}`,
      );
      if (hits.length > 0) {
        console.table(hits);
      } else {
        console.log("(no rule matched any row in this batch)");
      }
      console.log("ruleKeys:", [...rules.keys()].sort());
      console.groupEnd();
    }

    return out;
  } catch (e) {
    if (DEBUG_LOGS) console.warn("[applyTypeRules] failed:", e);
    return rows; // non-blocking — fail silently
  }
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a CSV file into normalised rows.
 *
 * Handles two common export layouts:
 *  1. Single Amount column (positive or negative)
 *  2. Separate Debit / Credit columns (both positive, opposite conventions)
 *
 * @param flipSign    When true, negate all parsed amounts before deriving type.
 *                    Use this for AmEx-style exports where charges are positive.
 * @param accountType Controls type derivation logic. "credit_card" uses payment
 *                    pattern detection; "bank" uses amount sign. Default: "bank".
 */
export interface ParseCsvOutput {
  rows:      NormalizedRow[];
  detection: DetectionResult;
  errors:    RowError[];
  warnings:  string[];
}

/**
 * Parse a CSV file via the modular csvEngine and adapt its output to the
 * NormalizedRow shape the rest of this hook expects.
 *
 * The engine emits canonical (positive=inflow) signed amounts based on file
 * format; this wrapper applies the per-account flipSign override (Amex /
 * Capital One credit-card style) AFTER the engine has parsed, then re-runs
 * deriveType so the existing preview heuristics (credit-card-payment,
 * loan-payment, refund keywords) still tag rows for the UI.
 */
export async function parseCSVFile(
  file:    File,
  options?: { flipSign?: boolean; accountType?: "bank" | "credit_card" },
): Promise<ParseCsvOutput> {
  const flipSign    = options?.flipSign    ?? false;
  const accountType = options?.accountType ?? "bank";

  const engine = await ingestCsvFile(file);

  const accountHeader = engine.detection.resolvedHeaders.account;

  const rows: NormalizedRow[] = engine.rows.map((r) => {
    // Apply per-account sign-inversion override (e.g. Amex CSVs encode
    // charges as positive in the source). The engine itself stays
    // file-format-aware; account-aware sign correction lives here.
    const amount = flipSign ? -r.amount : r.amount;

    const { type, subType, isTransfer } = deriveType(r.description, amount, accountType);

    return {
      date:              r.date,
      description:       r.description,
      amount,
      type,
      subType,
      isTransfer,
      accountIdentifier: accountHeader ? (r.rawRow[accountHeader] ?? "").trim() || null : null,
      accountType,
      rawData:           r.rawRow,
    };
  });

  return {
    rows,
    detection: engine.detection,
    errors:    engine.errors,
    warnings:  summarizeResult(engine),
  };
}

const DEDUP_CHUNK_SIZE = 30;

// ─── Write logic — delegates to unified backend ingestTransactions callable ──

const BATCH_SIZE = 499;

interface IngestReportLite {
  total:    number;
  imported: number;
  skipped:  number;
  errors:   string[];
  importId: string | null;
}

interface WriteResult {
  importId: string;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  transferCount: number;
}

async function writeTransactions(
  rows: NormalizedRow[],
  fileName: string,
  accountId: string,
  forceImportHashes: string[],
): Promise<WriteResult> {
  // Validation: drop rows missing date or amount before sending to backend.
  // (Per spec, we do NOT filter duplicates client-side — backend is the single
  // source of truth on dedup. We only drop rows that can't be persisted at all.)
  let validationSkipped = 0;
  const validRows: NormalizedRow[] = [];
  for (const row of rows) {
    if (!row.date || isNaN(row.amount)) { validationSkipped++; continue; }
    validRows.push(row);
  }

  const transactions = validRows.map((r) => ({
    date:        r.date,
    description: r.description,
    amount:      r.amount,
    rawRow:      r.rawData,
    // Honor preview edits: only ship type/subType when the user explicitly
    // changed it. Unmodified rows fall through to the unified backend
    // classifier (which has cross-account context the frontend doesn't).
    ...(r.userModified ? { type: r.type } : {}),
    ...(r.userModified && r.subType ? { subType: r.subType } : {}),
  }));

  // Backend pipeline: normalize → enrich → classify → store + categorize.
  const report = await apiClient.call<IngestReportLite>("ingestTransactions", {
    source:       "csv",
    accountId,
    transactions,
    importLabel:  fileName,
    forceImportHashes,
  });

  return {
    importId:      report.importId ?? "",
    importedCount: report.imported,
    skippedCount:  validationSkipped + report.errors.length,
    duplicateCount: report.skipped,
    transferCount: 0, // Backend pipeline classifies transfers; not tracked client-side anymore.
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface ImportResult {
  importId: string;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  transferCount: number;
  fileName: string;
}

interface ImportState {
  fileName: string;
  parseError: string;
  rows: NormalizedRow[];
  importing: boolean;
  importError: string;
  importResult: ImportResult | null;
  flipSign: boolean;
  signWarning: boolean;
  accountType: "bank" | "credit_card";
  cascadeMessage: string;
  signConventionMessage: string;   // "Auto-detected positive=charge for this account…"
  signConventionLocked: boolean;   // true once amountSignInverted is persisted on the account
  detection: DetectionResult | null;
  engineWarnings: string[];
  engineErrors: RowError[];
  /** Hashes the user clicked to "import anyway" — bypasses backend dedup skip. */
  forceImportHashes: string[];
}

export function useCSVImport() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const lastFileRef = useRef<File | null>(null);

  const [state, setState] = useState<ImportState>({
    fileName: "",
    parseError: "",
    rows: [],
    importing: false,
    importError: "",
    importResult: null,
    flipSign: false,
    signWarning: false,
    accountType: "bank",
    cascadeMessage: "",
    signConventionMessage: "",
    signConventionLocked: false,
    detection: null,
    engineWarnings: [],
    engineErrors: [],
    forceImportHashes: [],
  });

  // Per-vendor correction history for pattern-based learning. First correction
  // of a vendor → only that row changes. Second matching correction of the
  // same vendor → cascade to all matching rows + save typeRule.
  // Lives in a ref because it should NOT trigger re-renders; UI reads
  // cascadeMessage from state when the cascade actually fires.
  const correctionHistoryRef = useRef<Map<string, {
    type:    TransactionType;
    subType?: TransactionSubType;
    indices: Set<number>;
  }>>(new Map());

  // Reset correction history when a new file is parsed.
  function resetCorrectionHistory() {
    correctionHistoryRef.current.clear();
  }

  // Look up the persisted sign convention on the account doc (set by either
  // Plaid sync's per-account auto-detection or a prior CSV import).
  async function loadAccountSignConvention(accountId: string): Promise<{
    flipSign: boolean;
    locked: boolean;
  }> {
    if (!accountId || accountId === "__new__") return { flipSign: false, locked: false };
    try {
      const snap = await getDoc(doc(db, "accounts", accountId));
      if (!snap.exists()) return { flipSign: false, locked: false };
      const data = snap.data();
      const inverted = data.amountSignInverted === true;
      const locked   = !!data.amountSignDetectedAt;
      return { flipSign: inverted, locked };
    } catch {
      return { flipSign: false, locked: false };
    }
  }

  // Persist sign convention to the account doc so future imports auto-apply.
  async function persistAccountSignConvention(
    accountId: string,
    flipSign: boolean,
    method: "csv-auto" | "csv-manual",
  ): Promise<void> {
    if (!accountId || accountId === "__new__") return;
    try {
      await updateDoc(doc(db, "accounts", accountId), {
        amountSignInverted:        flipSign,
        amountSignDetectedAt:      serverTimestamp(),
        amountSignDetectionMethod: method,
      });
    } catch {
      // Non-blocking — best-effort.
    }
  }

  async function handleFileChange(file: File | null, accountId?: string) {
    if (!file) return;
    lastFileRef.current = file;
    resetCorrectionHistory();
    setState((prev) => ({
      ...prev,
      fileName: file.name,
      parseError: "",
      rows: [],
      importResult: null,
      flipSign: false,
      signWarning: false,
      signConventionMessage: "",
      signConventionLocked: false,
    }));
    try {
      // 1. Seed flip from the account's stored convention (if any)
      const { flipSign: storedFlip, locked: convLocked } = accountId
        ? await loadAccountSignConvention(accountId)
        : { flipSign: false, locked: false };

      let parsed = await parseCSVFile(file, { flipSign: storedFlip, accountType: state.accountType });
      let rows   = parsed.rows;
      if (user) rows = await applyTypeRules(ownerUid, rows);

      // 2. If the account has no stored convention yet, auto-detect from this file
      let resolvedFlip = storedFlip;
      let conventionMessage = "";
      if (!convLocked && accountId) {
        const seemsInverted = detectSignIssue(rows);
        if (seemsInverted !== storedFlip) {
          resolvedFlip = seemsInverted;
          parsed = await parseCSVFile(file, {
            flipSign: resolvedFlip,
            accountType: state.accountType,
          });
          rows = parsed.rows;
          if (user) rows = await applyTypeRules(ownerUid, rows);
        }
        // 3. Persist whatever we landed on so we don't have to redo this
        await persistAccountSignConvention(accountId, resolvedFlip, "csv-auto");
        conventionMessage = resolvedFlip
          ? `Auto-detected positive-charge format (e.g. American Express) for this account. Saved — future imports will apply automatically.`
          : `Detected standard sign convention (negative=expense) for this account. Saved — future imports will apply automatically.`;
      } else if (storedFlip) {
        conventionMessage = `Sign convention already saved for this account: charges are positive. Auto-flipped on import.`;
      }

      // 4. Pre-import duplicate detection — annotate every row with hash +
      //    possibleDuplicate so the preview can show badges before the user
      //    clicks Import. Does not change the import behavior; default skip
      //    on collision is still enforced by the backend.
      const annotated = await annotateDuplicates(ownerUid, accountId, rows);

      setState((prev) => ({
        ...prev,
        rows: annotated,
        flipSign: resolvedFlip,
        signWarning: false,
        signConventionMessage: conventionMessage,
        signConventionLocked: true,
        detection: parsed.detection,
        engineWarnings: parsed.warnings,
        engineErrors:   parsed.errors,
        forceImportHashes: [],   // fresh parse → discard prior overrides
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to parse CSV.",
      }));
    }
  }

  /** Helper: compute hashes + run findDuplicates. Pure, no setState. */
  async function annotateDuplicates(
    uid:       string,
    accountId: string | undefined,
    rows:      NormalizedRow[],
  ): Promise<NormalizedRow[]> {
    const withHashes = rows.map((r) => {
      if (!r.date || isNaN(r.amount) || !accountId) return r;
      return { ...r, dedupeHash: computeRowDedupeHash(accountId, r.date, r.amount, r.description) };
    });
    if (!uid || !accountId) return withHashes;
    const matches = await findDuplicates(uid, accountId, withHashes);
    return withHashes.map((r, i) => ({ ...r, possibleDuplicate: matches.get(i) ?? null }));
  }

  // Manual override — toggles the flip AND persists the user's choice to the
  // account doc, so the override sticks for next time.
  async function handleFlipSign(accountId?: string) {
    if (!lastFileRef.current) return;
    const nextFlip = !state.flipSign;
    setState((prev) => ({ ...prev, flipSign: nextFlip, rows: [] }));
    try {
      const parsed = await parseCSVFile(lastFileRef.current, {
        flipSign: nextFlip,
        accountType: state.accountType,
      });
      let rows = parsed.rows;
      if (user) rows = await applyTypeRules(ownerUid, rows);
      if (accountId) {
        await persistAccountSignConvention(accountId, nextFlip, "csv-manual");
      }
      const annotated = await annotateDuplicates(ownerUid, accountId, rows);
      setState((prev) => ({
        ...prev,
        rows: annotated,
        detection: parsed.detection,
        engineWarnings: parsed.warnings,
        engineErrors:   parsed.errors,
        forceImportHashes: [],   // overrides invalidated by re-parse
        signConventionMessage: nextFlip
          ? "Flipped: charges are now read as expenses. Saved for this account."
          : "Reverted: amounts read at face value. Saved for this account.",
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to re-parse CSV.",
      }));
    }
  }

  async function handleAccountTypeChange(accountType: "bank" | "credit_card") {
    setState((prev) => ({ ...prev, accountType, rows: [], signWarning: false }));
    if (!lastFileRef.current) return;
    try {
      const parsed = await parseCSVFile(lastFileRef.current, {
        flipSign: state.flipSign,
        accountType,
      });
      let rows = parsed.rows;
      if (user) rows = await applyTypeRules(ownerUid, rows);
      const signWarning = accountType === "bank" && detectSignIssue(rows);
      setState((prev) => ({
        ...prev,
        rows,
        signWarning,
        detection: parsed.detection,
        engineWarnings: parsed.warnings,
        engineErrors:   parsed.errors,
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to re-parse CSV.",
      }));
    }
  }

  /**
   * Apply a type change to one preview row.
   *
   * Refunds are special — they're transaction-level by nature (this charge
   * was refunded, but the next one wasn't), so they NEVER cascade, never
   * count toward pattern detection, and never write a typeRule. The user
   * gets a one-line note explaining this on the first refund edit.
   *
   * For every other type, the 2-vote pattern detector still runs but does
   * NOT cascade silently. On the second matching correction, a confirmation
   * banner appears with "Apply to all" / "Just these" buttons. The cascade +
   * rule write only happen if the user clicks Apply to all.
   */
  async function updateRowType(
    index: number,
    newType: TransactionType,
    newSubType?: TransactionSubType,
  ) {
    const row = state.rows[index];
    if (!row || !user) return;

    track("type_selected", { type: newType, subType: newSubType ?? null });

    // ── Refunds: ALWAYS single-row, never learn ────────────────────────
    if (newType === "refund") {
      setState((prev) => ({
        ...prev,
        rows: prev.rows.map((r, i) =>
          i === index
            ? { ...r, type: "refund", subType: undefined, isTransfer: false, userModified: true }
            : r,
        ),
        cascadeMessage:
          "Refunds are applied per transaction and won't be applied to other transactions.",
        // Editing a row to refund clears any pending non-refund prompt.
      }));
      // Refund does NOT advance the correction history — keep it pristine
      // so subsequent expense/income/transfer edits aren't confused by a
      // refund "vote" that doesn't apply to them.
      return;
    }

    const targetVendor = extractVendor(normalize(row.description));

    // ── 2-vote pattern detection — auto-cascade when triggered ─────────
    // First matching edit on a vendor → only the clicked row changes. Second
    // matching edit (same vendor, same target type+subType) is interpreted
    // as the user establishing a pattern: cascade to every other matching
    // row + persist a typeRule for future imports. A conflicting second
    // edit (same vendor, different type) resets the history so no false
    // cascade fires.
    const prior = correctionHistoryRef.current.get(targetVendor);
    const sameAsPrior =
      !!prior && prior.type === newType && prior.subType === newSubType;
    const isPatternCommit = !!prior && sameAsPrior && !prior.indices.has(index);

    if (DEBUG_LOGS) {
      console.log("[updateRowType]", {
        index, description: row.description, targetVendor, newType, newSubType,
        prior: prior ? { type: prior.type, subType: prior.subType, indices: [...prior.indices] } : null,
        sameAsPrior, isPatternCommit,
      });
    }

    if (!prior || !sameAsPrior) {
      correctionHistoryRef.current.set(targetVendor, {
        type: newType, subType: newSubType, indices: new Set([index]),
      });
    } else {
      prior.indices.add(index);
    }

    let cascadeCount = 0;
    setState((prev) => {
      const rows = prev.rows.map((r, i) => {
        if (!r || isNaN(r.amount)) return r;
        const isTarget = i === index;
        if (isTarget) {
          return {
            ...r,
            type: newType,
            subType: newSubType,
            isTransfer: newType === "transfer",
            userModified: true,
          };
        }
        if (!isPatternCommit) return r;
        const sameVendor =
          targetVendor && extractVendor(normalize(r.description)) === targetVendor;
        if (!sameVendor) return r;
        if (r.type === newType && r.subType === newSubType) return r;
        cascadeCount++;
        return {
          ...r,
          type: newType,
          subType: newSubType,
          isTransfer: newType === "transfer",
          userModified: true,
        };
      });
      return {
        ...prev,
        rows,
        cascadeMessage: isPatternCommit
          ? cascadeCount > 0
            ? `Pattern detected — applied "${newType}" to ${cascadeCount} other "${targetVendor}" row${cascadeCount !== 1 ? "s" : ""} and saved a rule for future imports.`
            : `Pattern detected for "${targetVendor}" — saved a rule for future imports.`
          : prior
          ? ""
          : `Got it — only this row changed. Mark another "${targetVendor}" row the same way to apply to all matching rows.`,
      };
    });

    if (DEBUG_LOGS) console.log(`[updateRowType:result] cascadeCount=${cascadeCount} (isPatternCommit=${isPatternCommit})`);

    // Save the typeRule on pattern commit so the cascade also informs
    // future imports of this account.
    if (isPatternCommit) {
      try {
        const ruleRef = doc(db, "typeRules", `${ownerUid}_${targetVendor}`);
        await setDoc(
          ruleRef,
          {
            uid: ownerUid,
            vendorName: targetVendor,
            type: newType,
            ...(newSubType ? { subType: newSubType } : {}),
            usageCount: increment(1),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch {
        // Non-blocking — rule writing is best-effort.
      }
    }
  }

  function clearCascadeMessage() {
    setState((prev) => ({ ...prev, cascadeMessage: "" }));
  }

  /**
   * Toggle the user's "import anyway" override on a row that the duplicate
   * detector flagged. Soft matches are not togglable (they always import);
   * exact + intra-csv matches default to skip and become force-imported when
   * toggled on. The hash gets added/removed from forceImportHashes — the
   * canonical key the backend uses to decide.
   */
  function toggleForceImport(rowIndex: number) {
    setState((prev) => {
      const row = prev.rows[rowIndex];
      if (!row || !row.dedupeHash) return prev;
      const dup = row.possibleDuplicate;
      if (!dup || dup.kind === "soft") return prev;   // not togglable
      const set = new Set(prev.forceImportHashes);
      if (set.has(row.dedupeHash)) set.delete(row.dedupeHash);
      else                         set.add(row.dedupeHash);
      return { ...prev, forceImportHashes: [...set] };
    });
  }

  async function handleImport(accountId: string) {
    if (!user || state.rows.length === 0) return;
    if (!accountId) {
      setState((prev) => ({ ...prev, importError: "Please select an account before importing." }));
      return;
    }
    setState((prev) => ({ ...prev, importing: true, importError: "" }));
    try {
      // Spec: send ALL rows to backend; backend decides skip vs write based on
      // dedupeHash. Override list lets the user keep specific duplicates.
      const result = await writeTransactions(
        state.rows,
        state.fileName,
        accountId,
        state.forceImportHashes,
      );
      setState((prev) => ({
        ...prev,
        importing: false,
        rows: [],
        importResult: { ...result, transferCount: result.transferCount, fileName: prev.fileName },
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        importing: false,
        importError: e instanceof Error ? e.message : "Import failed. Please try again.",
      }));
    }
  }

  function resetImport() {
    lastFileRef.current = null;
    setState({
      fileName: "",
      parseError: "",
      rows: [],
      importing: false,
      importError: "",
      importResult: null,
      flipSign: false,
      signWarning: false,
      accountType: "bank",
      cascadeMessage: "",
      signConventionMessage: "",
      signConventionLocked: false,
      detection: null,
      engineWarnings: [],
      engineErrors: [],
      forceImportHashes: [],
    });
  }

  async function deleteImport(importId: string): Promise<void> {
    if (!user) return;
    // Delete all transactions belonging to this import in batches
    const txnSnap = await getDocs(
      query(
        collection(db, "transactions"),
        where("uid", "==", ownerUid),
        where("importId", "==", importId)
      )
    );
    for (let i = 0; i < txnSnap.docs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      txnSnap.docs.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    // Delete the import record itself
    await deleteDoc(doc(db, "imports", importId));
  }

  return { state, handleFileChange, handleFlipSign, handleAccountTypeChange, handleImport, resetImport, deleteImport, updateRowType, clearCascadeMessage, toggleForceImport };
}
