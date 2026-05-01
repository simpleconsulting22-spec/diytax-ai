import { useState, useRef } from "react";
import Papa from "papaparse";
import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  writeBatch,
  doc,
  setDoc,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { apiClient } from "../../../services/apiClient";

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
  userModified?: boolean;   // true when user manually overrode the type in the preview
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

// Find the first header whose lowercase form contains any candidate substring
function findColumn(headers: string[], candidates: string[]): string | undefined {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

// Collapse whitespace, lowercase — used in importKey and stored on the doc
export function normalize(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── Vendor extraction ────────────────────────────────────────────────────────

// Common payment-processor prefixes to strip before extracting vendor name
const VENDOR_LEADING_NOISE = [
  /^sq\s*\*\s*/i, /^tst\s*\*\s*/i, /^pp\s*\*\s*/i, /^paypal\s*\*\s*/i,
  /^amzn\s+mktp(\s+us)?\s*/i, /^amazon\.com\/bill\s*/i,
  /^ach\s+(credit|debit)?\s*/i, /^pos\s*#?\s*\d*\s*/i,
  /^debit\s+card\s+/i, /^purchase\s+at\s+/i, /^payment\s+to\s+/i,
  /^autopay\s+/i, /^zelle\s+(to|from)\s+/i, /^venmo\s+/i,
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

  const words = s.split(/\s+/).filter((w) => /[a-z]/.test(w) && w.length >= 2);
  if (words.length === 0) return normalizedDescription.split(" ")[0] || "unknown";
  return words[0].length <= 2 && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

// Normalise a date string to YYYY-MM-DD; returns empty string when unrecognised
function parseDate(raw: string): string {
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const mdyShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShort) {
    const [, m, d, y] = mdyShort;
    const fullYear = parseInt(y) > 50 ? `19${y}` : `20${y}`;
    return `${fullYear}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const mdyDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdyDash) {
    const [, m, d, y] = mdyDash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return "";
}

// Parse an amount string to a number.
// Returns NaN for empty or unparseable input (not coerced to 0)
// so validation in writeTransactions can detect missing/invalid amounts.
function parseAmount(raw: string): number {
  let s = raw.trim();
  if (!s) return NaN;

  // (123.45) → -123.45
  const parens = s.match(/^\(([^)]+)\)$/);
  if (parens) s = `-${parens[1]}`;

  s = s.replace(/[$,\s]/g, "");
  return parseFloat(s);
}

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
 */
async function applyTypeRules(userId: string, rows: NormalizedRow[]): Promise<NormalizedRow[]> {
  try {
    const snap = await getDocs(
      query(collection(db, "typeRules"), where("uid", "==", userId))
    );
    if (snap.empty) return rows;

    const rules = new Map<string, TransactionType>();
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.vendorName && data.type) {
        rules.set(data.vendorName as string, data.type as TransactionType);
      }
    });

    return rows.map((row) => {
      const vendor = extractVendor(normalize(row.description));
      const learnedType = rules.get(vendor);
      if (learnedType && learnedType !== row.type) {
        return { ...row, type: learnedType, isTransfer: learnedType === "transfer" };
      }
      return row;
    });
  } catch {
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
export function parseCSVFile(
  file: File,
  options?: { flipSign?: boolean; accountType?: "bank" | "credit_card" }
): Promise<NormalizedRow[]> {
  const flipSign = options?.flipSign ?? false;
  const accountType = options?.accountType ?? "bank";

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];

        const dateCol = findColumn(headers, ["date", "posted", "posting", "transaction date"]);
        const descCol = findColumn(headers, ["description", "memo", "name", "payee", "desc", "narrative"]);
        const acctCol = findColumn(headers, ["account", "account name", "account number"]);

        // ── Column layout detection ────────────────────────────────────────
        // Prefer a single Amount column. Fall back to separate Debit/Credit
        // columns only when there is no Amount column at all.
        const singleAmtCol = findColumn(headers, ["amount", "transaction amount"]);
        const debitCol  = findColumn(headers, ["debit"]);
        const creditCol = findColumn(headers, ["credit"]);

        // "Split" layout: separate Debit + Credit columns, no Amount column
        const hasSplitColumns =
          !singleAmtCol && !!debitCol && !!creditCol && debitCol !== creditCol;

        const amtCol = singleAmtCol ?? (!hasSplitColumns ? (debitCol ?? creditCol) : undefined);

        if (!dateCol || !descCol || (!amtCol && !hasSplitColumns)) {
          reject(
            new Error(
              `Could not detect required columns. Found: ${headers.join(", ")}. ` +
              `Need columns for Date, Description, and Amount (or separate Debit/Credit).`
            )
          );
          return;
        }

        const rows: NormalizedRow[] = results.data
          .map((row) => {
            // ── Amount resolution ──────────────────────────────────────────
            let amount: number;

            if (hasSplitColumns) {
              // Split Debit/Credit layout: both columns are positive values.
              // Debit = money out (expense) → store as negative.
              // Credit = money in (income) → store as positive.
              const debitVal  = parseAmount(row[debitCol!]  ?? "");
              const creditVal = parseAmount(row[creditCol!] ?? "");

              if (!isNaN(debitVal) && debitVal > 0) {
                amount = flipSign ? debitVal : -debitVal;
              } else if (!isNaN(creditVal) && creditVal > 0) {
                amount = flipSign ? -creditVal : creditVal;
              } else {
                amount = NaN;
              }
            } else {
              // Single Amount column (positive or negative)
              const raw = parseAmount(row[amtCol!] ?? "");
              amount = flipSign ? -raw : raw;
            }

            const description = (row[descCol] ?? "").trim();
            const { type, subType, isTransfer } = deriveType(description, amount, accountType);

            return {
              date: parseDate(row[dateCol] ?? ""),
              description,
              amount,
              type,
              subType,
              isTransfer,
              accountIdentifier: acctCol ? (row[acctCol] ?? "").trim() || null : null,
              accountType,
              rawData: row,
            };
          })
          .filter((r) => r.description.length > 0 || !isNaN(r.amount));

        resolve(rows);
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
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
): Promise<WriteResult> {
  // Validation: drop rows missing date or amount before sending to backend.
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
  }));

  // Backend pipeline: normalize → enrich → classify → store + categorize.
  const report = await apiClient.call<IngestReportLite>("ingestTransactions", {
    source:       "csv",
    accountId,
    transactions,
    importLabel:  fileName,
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
  });

  async function handleFileChange(file: File | null) {
    if (!file) return;
    lastFileRef.current = file;
    setState((prev) => ({
      ...prev,
      fileName: file.name,
      parseError: "",
      rows: [],
      importResult: null,
      flipSign: false,
      signWarning: false,
    }));
    try {
      let rows = await parseCSVFile(file, { accountType: state.accountType });
      if (user) rows = await applyTypeRules(ownerUid, rows);
      const signWarning = state.accountType === "bank" && detectSignIssue(rows);
      setState((prev) => ({ ...prev, rows, signWarning }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to parse CSV.",
      }));
    }
  }

  async function handleFlipSign() {
    if (!lastFileRef.current) return;
    const nextFlip = !state.flipSign;
    setState((prev) => ({ ...prev, flipSign: nextFlip, rows: [] }));
    try {
      let rows = await parseCSVFile(lastFileRef.current, {
        flipSign: nextFlip,
        accountType: state.accountType,
      });
      if (user) rows = await applyTypeRules(ownerUid, rows);
      setState((prev) => ({ ...prev, rows }));
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
      let rows = await parseCSVFile(lastFileRef.current, {
        flipSign: state.flipSign,
        accountType,
      });
      if (user) rows = await applyTypeRules(ownerUid, rows);
      const signWarning = accountType === "bank" && detectSignIssue(rows);
      setState((prev) => ({ ...prev, rows, signWarning }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to re-parse CSV.",
      }));
    }
  }

  async function updateRowType(index: number, newType: TransactionType) {
    const row = state.rows[index];
    if (!row || !user) return;

    // Update preview immediately
    setState((prev) => {
      const rows = [...prev.rows];
      rows[index] = {
        ...rows[index],
        type: newType,
        isTransfer: newType === "transfer",
        userModified: true,
      };
      return { ...prev, rows };
    });

    // Persist as a learned type rule for future imports
    try {
      const vendor = extractVendor(normalize(row.description));
      const ruleRef = doc(db, "typeRules", `${ownerUid}_${vendor}`);
      await setDoc(
        ruleRef,
        {
          uid: ownerUid,
          vendorName: vendor,
          type: newType,
          usageCount: increment(1),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // Non-blocking — rule writing is best-effort
    }
  }

  async function handleImport(accountId: string) {
    if (!user || state.rows.length === 0) return;
    if (!accountId) {
      setState((prev) => ({ ...prev, importError: "Please select an account before importing." }));
      return;
    }
    setState((prev) => ({ ...prev, importing: true, importError: "" }));
    try {
      const result = await writeTransactions(state.rows, state.fileName, accountId);
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

  return { state, handleFileChange, handleFlipSign, handleAccountTypeChange, handleImport, resetImport, deleteImport, updateRowType };
}
