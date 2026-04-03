import { useState } from "react";
import Papa from "papaparse";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
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
  type: "income" | "expense";
  accountIdentifier: string | null;
  rawData: Record<string, string>;
}

interface PreparedRow {
  row: NormalizedRow;
  accountId: string | null;
  normalizedDescription: string;
  importKey: string;
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

// Extract the first meaningful word from a normalised description as the vendor name
export function extractVendor(normalizedDescription: string): string {
  if (!normalizedDescription) return "unknown";
  return normalizedDescription.split(" ")[0] || "unknown";
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

// ─── CSV parsing ─────────────────────────────────────────────────────────────

export function parseCSVFile(file: File): Promise<NormalizedRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];

        const dateCol = findColumn(headers, ["date", "posted", "posting", "transaction date"]);
        const descCol = findColumn(headers, ["description", "memo", "name", "payee", "desc", "narrative"]);
        const amtCol  = findColumn(headers, ["amount", "transaction amount", "debit", "credit"]);
        const acctCol = findColumn(headers, ["account", "account name", "account number"]);

        if (!dateCol || !descCol || !amtCol) {
          reject(
            new Error(
              `Could not detect required columns. Found: ${headers.join(", ")}. ` +
              `Need columns for Date, Description, and Amount.`
            )
          );
          return;
        }

        const rows: NormalizedRow[] = results.data
          .map((row) => {
            const amount = parseAmount(row[amtCol] ?? "");
            return {
              date: parseDate(row[dateCol] ?? ""),
              description: (row[descCol] ?? "").trim(),
              amount,
              type: (!isNaN(amount) && amount >= 0 ? "income" : "expense") as "income" | "expense",
              accountIdentifier: acctCol ? (row[acctCol] ?? "").trim() || null : null,
              rawData: row,
            };
          })
          // Keep rows that have at least a description OR a valid amount — invalid rows
          // are surfaced in the preview so the user can see them, but writeTransactions
          // will skip and count them separately.
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
    return { row, accountId, normalizedDescription, importKey };
  });

  // ── 4. Deduplicate against existing transactions ───────────────────────────
  const allKeys = prepared.map((p) => p.importKey);
  const existingKeys = await findExistingImportKeys(userId, allKeys);

  let duplicateCount = 0;
  const rowsToWrite = prepared.filter(({ importKey }) => {
    if (existingKeys.has(importKey)) {
      duplicateCount++;
      return false;
    }
    return true;
  });

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

    for (const { row, accountId, normalizedDescription, importKey } of chunk) {
      const ref = doc(collection(db, "transactions"));
      batch.set(ref, {
        uid: userId,
        accountId,
        date: row.date,
        description: row.description,
        normalizedDescription,
        vendor: extractVendor(normalizedDescription),
        amount: row.amount,
        type: row.type,
        status: "needs_review",
        source: "csv",
        importId,
        importKey,
        rawData: row.rawData,
        entityId: defaultEntity?.id ?? null,
        entityType: defaultEntity?.type ?? "personal",
        entityName: defaultEntity?.name ?? null,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  }

  return { importId, importedCount: rowsToWrite.length, skippedCount, duplicateCount };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface ImportState {
  fileName: string;
  parseError: string;
  rows: NormalizedRow[];
  importing: boolean;
  importError: string;
}

export function useCSVImport() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState<ImportState>({
    fileName: "",
    parseError: "",
    rows: [],
    importing: false,
    importError: "",
  });

  async function handleFileChange(file: File | null) {
    if (!file) return;
    setState((prev) => ({ ...prev, fileName: file.name, parseError: "", rows: [] }));
    try {
      const rows = await parseCSVFile(file);
      setState((prev) => ({ ...prev, rows }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        parseError: e instanceof Error ? e.message : "Failed to parse CSV.",
      }));
    }
  }

  async function handleImport() {
    if (!user || state.rows.length === 0) return;
    setState((prev) => ({ ...prev, importing: true, importError: "" }));
    try {
      await writeTransactions(user.uid, state.rows, state.fileName);
      navigate("/transactions");
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        importing: false,
        importError: e instanceof Error ? e.message : "Import failed. Please try again.",
      }));
    }
  }

  return { state, handleFileChange, handleImport };
}
