import { useState, useRef } from "react";
import Papa from "papaparse";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { getUserEntities, UserEntity } from "../../../services/entityService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NormalizedRow {
  date: string;
  description: string;
  amount: number;           // NaN = unparseable/missing
  type: "income" | "expense" | "transfer";
  isTransfer: boolean;
  accountIdentifier: string | null;
  rawData: Record<string, string>;
}

// ─── Transfer detection ───────────────────────────────────────────────────────

const TRANSFER_PATTERNS = [
  /\btransfer\b/i,
  /\bxfer\b/i,
  /\bmobile transfer\b/i,
  /\bonline transfer\b/i,
  /\baccount transfer\b/i,
  /\bbetween accounts\b/i,
  /^from\s+(checking|savings|account)/i,
  /^to\s+(checking|savings|account)/i,
];

function detectTransfer(description: string): boolean {
  return TRANSFER_PATTERNS.some((re) => re.test(description));
}

interface PreparedRow {
  row: NormalizedRow;
  accountId: string | null;
  normalizedDescription: string;
  importKey: string;
  possibleDuplicate: boolean;
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

// ─── Fuzzy duplicate detection ────────────────────────────────────────────────

// Word-bag Jaccard similarity — fast, no external deps
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 1));
  const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 1));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  let intersection = 0;
  wordsA.forEach((w) => { if (wordsB.has(w)) intersection++; });
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 1 : intersection / union;
}

// Returns a set of importKeys that appear to be cross-batch fuzzy duplicates.
// Skips if date range > 90 days to bound query cost.
async function findCrossBatchFuzzyDuplicates(
  userId: string,
  candidates: PreparedRow[]
): Promise<Set<string>> {
  const flagged = new Set<string>();
  if (candidates.length === 0) return flagged;

  const dates = candidates.map((p) => p.row.date).filter(Boolean).sort();
  if (dates.length === 0) return flagged;

  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const daySpan =
    (new Date(maxDate).getTime() - new Date(minDate).getTime()) /
    (1000 * 60 * 60 * 24);

  // Skip fuzzy check for very wide date ranges — too many existing transactions
  if (daySpan > 90) return flagged;

  const uniqueDates = [...new Set(dates)];
  const existingTxns: Array<{ date: string; amount: number; normalizedDescription: string }> = [];

  for (let i = 0; i < uniqueDates.length; i += DEDUP_CHUNK_SIZE) {
    const chunk = uniqueDates.slice(i, i + DEDUP_CHUNK_SIZE);
    const snap = await getDocs(
      query(
        collection(db, "transactions"),
        where("uid", "==", userId),
        where("date", "in", chunk)
      )
    );
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.date && data.amount !== undefined && data.normalizedDescription) {
        existingTxns.push({
          date: data.date as string,
          amount: data.amount as number,
          normalizedDescription: data.normalizedDescription as string,
        });
      }
    });
    // Guard: bail if we'd be comparing against a huge set
    if (existingTxns.length > 2000) return flagged;
  }

  for (const candidate of candidates) {
    for (const existing of existingTxns) {
      if (candidate.row.date !== existing.date) continue;
      if (Math.abs(candidate.row.amount - existing.amount) > 0.01) continue;
      const sim = jaccardSimilarity(
        candidate.normalizedDescription,
        existing.normalizedDescription
      );
      if (sim >= 0.8) {
        flagged.add(candidate.importKey);
        break;
      }
    }
  }

  return flagged;
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

// ─── CSV parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a CSV file into normalised rows.
 *
 * Handles two common export layouts:
 *  1. Single Amount column (positive or negative)
 *  2. Separate Debit / Credit columns (both positive, opposite conventions)
 *
 * @param flipSign  When true, negate all parsed amounts before deriving type.
 *                  Use this for AmEx-style exports where charges are positive.
 */
export function parseCSVFile(
  file: File,
  options?: { flipSign?: boolean }
): Promise<NormalizedRow[]> {
  const flipSign = options?.flipSign ?? false;

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
            const isTransfer  = detectTransfer(description);
            const type: NormalizedRow["type"] = isTransfer
              ? "transfer"
              : (!isNaN(amount) && amount >= 0 ? "income" : "expense");

            return {
              date: parseDate(row[dateCol] ?? ""),
              description,
              amount,
              type,
              isTransfer,
              accountIdentifier: acctCol ? (row[acctCol] ?? "").trim() || null : null,
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

// ─── Account resolution ───────────────────────────────────────────────────────

// Look up an existing account by name or last4; create one if not found.
// Uses "uid" field to match the existing Firestore security rules.
async function resolveAccount(userId: string, identifier: string): Promise<string> {
  const snap = await getDocs(
    query(collection(db, "accounts"), where("uid", "==", userId))
  );

  const identLower = identifier.toLowerCase();
  const possibleLast4 = identifier.replace(/\D/g, "").slice(-4);

  for (const d of snap.docs) {
    const data = d.data();
    if (
      (data.name ?? "").toLowerCase() === identLower ||
      (data.last4 && data.last4 === possibleLast4)
    ) {
      return d.id;
    }
  }

  const newDoc = await addDoc(collection(db, "accounts"), {
    uid: userId,
    name: identifier,
    last4: possibleLast4.length === 4 ? possibleLast4 : null,
    createdAt: serverTimestamp(),
  });
  return newDoc.id;
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

// Firestore "in" operator accepts up to 30 values per query.
// Requires composite index: transactions(uid ASC, importKey ASC) — see firestore.indexes.json
const DEDUP_CHUNK_SIZE = 30;

async function findExistingImportKeys(userId: string, keys: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  const uniqueKeys = [...new Set(keys)];

  for (let i = 0; i < uniqueKeys.length; i += DEDUP_CHUNK_SIZE) {
    const chunk = uniqueKeys.slice(i, i + DEDUP_CHUNK_SIZE);
    const snap = await getDocs(
      query(
        collection(db, "transactions"),
        where("uid", "==", userId),
        where("importKey", "in", chunk)
      )
    );
    snap.docs.forEach((d) => {
      const k = d.data().importKey as string | undefined;
      if (k) existing.add(k);
    });
  }
  return existing;
}

// ─── Write logic ──────────────────────────────────────────────────────────────

const BATCH_SIZE = 499;

interface WriteResult {
  importId: string;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  transferCount: number;
}

async function writeTransactions(
  userId: string,
  rows: NormalizedRow[],
  fileName: string
): Promise<WriteResult> {
  // ── 0. Resolve default entity (auto-assign if exactly one entity) ──────────
  const entities = await getUserEntities(userId);
  const defaultEntity: UserEntity | null =
    entities.length === 1 ? entities[0] : null;

  // ── 1. Validation ──────────────────────────────────────────────────────────
  let skippedCount = 0;
  const validRows: NormalizedRow[] = [];

  for (const row of rows) {
    if (!row.date) {
      skippedCount++;
      continue;
    }
    if (isNaN(row.amount)) {
      skippedCount++;
      continue;
    }
    validRows.push(row);
  }

  console.log(`[CSV Import] Total rows parsed: ${rows.length}`);
  console.log(`[CSV Import] Valid rows: ${validRows.length}`);
  console.log(`[CSV Import] Skipped rows (validation): ${skippedCount}`);

  // ── 2. Resolve accounts ────────────────────────────────────────────────────
  const accountMap = new Map<string, string>();
  const uniqueIdentifiers = [
    ...new Set(
      validRows.map((r) => r.accountIdentifier).filter((id): id is string => id !== null)
    ),
  ];
  for (const ident of uniqueIdentifiers) {
    accountMap.set(ident, await resolveAccount(userId, ident));
  }

  // ── 3. Build importKeys ────────────────────────────────────────────────────
  const prepared: PreparedRow[] = validRows.map((row) => {
    const accountId = row.accountIdentifier
      ? (accountMap.get(row.accountIdentifier) ?? null)
      : null;
    const normalizedDescription = normalize(row.description);
    const importKey = `${userId}|${accountId ?? "na"}|${row.date}|${row.amount}|${normalizedDescription}`;
    return { row, accountId, normalizedDescription, importKey, possibleDuplicate: false };
  });

  // ── 4. Strict deduplication against existing transactions ─────────────────
  const allKeys = prepared.map((p) => p.importKey);
  const existingKeys = await findExistingImportKeys(userId, allKeys);

  let duplicateCount = 0;
  let transferCount = 0;
  const rowsToWrite = prepared.filter(({ importKey }) => {
    if (existingKeys.has(importKey)) {
      duplicateCount++;
      return false;
    }
    return true;
  });

  // ── 4b. Fuzzy duplicate detection (cross-batch) ────────────────────────────
  // Flag rows that look like near-duplicates of existing transactions.
  // These are still written but marked possibleDuplicate: true so the
  // review UI can surface them for user confirmation.
  try {
    const fuzzyKeys = await findCrossBatchFuzzyDuplicates(userId, rowsToWrite);
    for (const row of rowsToWrite) {
      if (fuzzyKeys.has(row.importKey)) row.possibleDuplicate = true;
    }
  } catch {
    // Non-blocking — fuzzy detection is best-effort
  }

  console.log(`[CSV Import] Duplicates skipped: ${duplicateCount}`);
  console.log(`[CSV Import] Rows to write: ${rowsToWrite.length}`);

  // ── 5. Create import record ────────────────────────────────────────────────
  const importRef = await addDoc(collection(db, "imports"), {
    userId,
    fileName,
    rowCount: rows.length,
    importedCount: rowsToWrite.length,
    skippedCount: skippedCount + duplicateCount,
    createdAt: serverTimestamp(),
  });
  const importId = importRef.id;

  // ── 6. Write transactions in batches ───────────────────────────────────────
  for (let i = 0; i < rowsToWrite.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = rowsToWrite.slice(i, i + BATCH_SIZE);

    for (const { row, accountId, normalizedDescription, importKey, possibleDuplicate } of chunk) {
      const ref = doc(collection(db, "transactions"));
      if (row.isTransfer) transferCount++;
      const vendor = extractVendor(normalizedDescription);
      batch.set(ref, {
        uid: userId,
        accountId,
        date: row.date,
        description: row.description,
        normalizedDescription,
        vendor,
        amount: row.amount,
        type: row.type,
        status: row.isTransfer ? "transfer" : "needs_review",
        source: "csv",
        importId,
        importKey,
        rawData: row.rawData,
        entityId: row.isTransfer ? null : (defaultEntity?.id ?? null),
        entityType: row.isTransfer ? null : (defaultEntity?.type ?? "personal"),
        entityName: row.isTransfer ? null : (defaultEntity?.name ?? null),
        ...(possibleDuplicate ? { possibleDuplicate: true } : {}),
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  }

  return { importId, importedCount: rowsToWrite.length, skippedCount, duplicateCount, transferCount };
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
}

export function useCSVImport() {
  const { user } = useAuth();
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
      const rows = await parseCSVFile(file);
      const signWarning = detectSignIssue(rows);
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
      const rows = await parseCSVFile(lastFileRef.current, { flipSign: nextFlip });
      setState((prev) => ({ ...prev, rows }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to re-parse CSV.",
      }));
    }
  }

  async function handleImport() {
    if (!user || state.rows.length === 0) return;
    setState((prev) => ({ ...prev, importing: true, importError: "" }));
    try {
      const result = await writeTransactions(user.uid, state.rows, state.fileName);
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
    });
  }

  async function deleteImport(importId: string): Promise<void> {
    if (!user) return;
    // Delete all transactions belonging to this import in batches
    const txnSnap = await getDocs(
      query(
        collection(db, "transactions"),
        where("uid", "==", user.uid),
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

  return { state, handleFileChange, handleFlipSign, handleImport, resetImport, deleteImport };
}
