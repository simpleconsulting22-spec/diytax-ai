// Pre-import duplicate detection for CSV preview rows.
//
// Three layers of detection, evaluated per row in this priority order:
//   1. Hard match — same accountId + same dedupeHash already in Firestore
//   2. Intra-CSV  — earlier row in the same upload has the same dedupeHash
//   3. Soft match — same accountId, ±1 day, same |amount|, jaccard ≥ 0.75
//                   on the description (after normalize)
//
// Returns one MatchInfo per row that matched something. The UI uses `kind`
// to decide badge style + clickability (hard / intra-csv = clickable
// "import anyway"; soft = informational only).

import {
  collection, query, where, getDocs, type DocumentData,
} from "firebase/firestore";
import { db } from "../../../firebase";
import type { NormalizedRow } from "../hooks/useCSVImport";

// computeRowDedupeHash mirrors functions/src/ingestion/transactionPipeline.ts
// → computeDedupeHash. Kept in lockstep manually (frontend doesn't bundle the
// functions package). If you change the canonical hash there, change it here.
//
// IMPORTANT — sign convention:
//   Frontend NormalizedRow.amount uses CSV "natural" convention
//   (positive = inflow, negative = outflow).
//   Backend canonicalizes that to PLAID convention before hashing
//   (positive = OUTFLOW). For an income row of +0.04 in the CSV, backend
//   stores direction "N"; for an expense row of -50.00 in the CSV, backend
//   stores direction "P". The frontend MUST mirror this — i.e. flip the sign
//   before computing direction — or the lookup never matches an existing doc
//   and "already imported" detection falls through to intra-CSV only.
export function computeRowDedupeHash(
  accountId: string,
  date: string,
  amount: number,             // CSV natural sign (positive = inflow)
  description: string,
): string {
  const plaidSigned = -amount;   // flip to backend's canonical convention
  const cents       = Math.round(Math.abs(plaidSigned) * 100);
  const direction   = plaidSigned > 0 ? "P" : plaidSigned < 0 ? "N" : "Z";
  const desc        = (description ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
  return `${accountId}|${date}|${cents}|${direction}|${desc}`;
}

export type DuplicateKind = "exact" | "intra-csv" | "soft";

export interface MatchInfo {
  kind:          DuplicateKind;
  matchSummary:  string;             // one-line description shown in tooltip
  matchedDate:   string;             // YYYY-MM-DD of the matched row (for "most recent" tie-break)
}

const FUZZY_JACCARD_THRESHOLD = 0.75;
const IN_LIMIT                = 30;   // Firestore "in" cap

/** Whitespace + punctuation normalization for jaccard comparison. */
function normalizeForJaccard(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeForJaccard(a).split(/\s+/).filter((w) => w.length > 1));
  const wb = new Set(normalizeForJaccard(b).split(/\s+/).filter((w) => w.length > 1));
  if (wa.size === 0 && wb.size === 0) return 1;
  let inter = 0;
  wa.forEach((w) => { if (wb.has(w)) inter++; });
  const union = wa.size + wb.size - inter;
  return union === 0 ? 0 : inter / union;
}

interface ExistingTxn {
  date:        string;
  amount:      number;             // absolute amount as stored on the doc
  signedAmount?: number;           // plaidSignedAmount when present
  description: string;
  dedupeHash?: string;
}

// Chunked Firestore "in" query for hard hashes.
async function fetchExistingByDedupeHash(
  uid:       string,
  accountId: string,
  hashes:    string[],
): Promise<Map<string, ExistingTxn[]>> {
  const result = new Map<string, ExistingTxn[]>();
  const unique = [...new Set(hashes.filter((h) => h && h.length > 0))];
  if (unique.length === 0) return result;

  for (let i = 0; i < unique.length; i += IN_LIMIT) {
    const chunk = unique.slice(i, i + IN_LIMIT);
    try {
      const snap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid",        "==", uid),
          where("accountId",  "==", accountId),
          where("dedupeHash", "in", chunk),
        ),
      );
      snap.docs.forEach((d) => {
        const data = d.data() as DocumentData;
        const hash = data.dedupeHash as string | undefined;
        if (!hash) return;
        const existing: ExistingTxn = {
          date:        (data.date as string) ?? "",
          amount:      typeof data.amount === "number" ? data.amount : 0,
          signedAmount: typeof data.plaidSignedAmount === "number" ? data.plaidSignedAmount : undefined,
          description: (data.description as string) ?? "",
          dedupeHash:  hash,
        };
        const arr = result.get(hash) ?? [];
        arr.push(existing);
        result.set(hash, arr);
      });
    } catch (e) {
      console.warn(`[findDuplicates] hard-match chunk ${i} failed:`, e);
    }
  }
  return result;
}

// Single date-range query for soft-match candidates.
async function fetchExistingByDateRange(
  uid:       string,
  accountId: string,
  minDate:   string,
  maxDate:   string,
): Promise<ExistingTxn[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "transactions"),
        where("uid",       "==", uid),
        where("accountId", "==", accountId),
        where("date",      ">=", minDate),
        where("date",      "<=", maxDate),
      ),
    );
    return snap.docs.map((d) => {
      const data = d.data() as DocumentData;
      return {
        date:        (data.date as string) ?? "",
        amount:      typeof data.amount === "number" ? data.amount : 0,
        signedAmount: typeof data.plaidSignedAmount === "number" ? data.plaidSignedAmount : undefined,
        description: (data.description as string) ?? "",
        dedupeHash:  data.dedupeHash as string | undefined,
      };
    });
  } catch (e) {
    console.warn(`[findDuplicates] soft-match date-range query failed:`, e);
    return [];
  }
}

/** Add or subtract one day to a YYYY-MM-DD string without timezone games. */
function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function fmtAmount(absAmount: number): string {
  return `$${absAmount.toFixed(2)}`;
}

/**
 * Scan rows + Firestore for duplicates.
 *
 * Returns: Map keyed by row index → MatchInfo. Rows not in the map have no
 * detected duplicate.
 */
export async function findDuplicates(
  uid:       string,
  accountId: string,
  rows:      NormalizedRow[],
): Promise<Map<number, MatchInfo>> {
  const out = new Map<number, MatchInfo>();
  if (!uid || !accountId || rows.length === 0) return out;

  // Compute hash for every valid row up front — used by all three layers.
  const hashes: string[] = rows.map((r) => {
    if (!r.date || isNaN(r.amount)) return "";
    return computeRowDedupeHash(accountId, r.date, r.amount, r.description);
  });

  // ── 1. Hard match (existing dedupeHash collisions) ─────────────────────
  const hardMatches = await fetchExistingByDedupeHash(uid, accountId, hashes);

  // ── 2. Intra-CSV duplicates (same hash earlier in this batch) ──────────
  const seenInBatch = new Map<string, number>(); // hash → first occurrence index

  // ── 3. Soft match candidate set — load once, scan in memory ────────────
  const validDates = rows.map((r) => r.date).filter(Boolean).sort();
  let candidates: ExistingTxn[] = [];
  if (validDates.length > 0) {
    const minDate = shiftDate(validDates[0],                    -1);
    const maxDate = shiftDate(validDates[validDates.length - 1], +1);
    candidates = await fetchExistingByDateRange(uid, accountId, minDate, maxDate);
  }

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i];
    const hash = hashes[i];
    if (!hash) continue;     // skip rows missing date/amount

    // Priority 1 — hard match against existing Firestore docs
    const hardHits = hardMatches.get(hash);
    if (hardHits && hardHits.length > 0) {
      const best = pickMostRecent(hardHits);
      out.set(i, {
        kind: "exact",
        matchSummary: `Already imported: ${best.description || "(no description)"} · ${best.date} · ${fmtAmount(Math.abs(best.amount))}`,
        matchedDate: best.date,
      });
      seenInBatch.set(hash, i);
      continue;
    }

    // Priority 2 — intra-CSV duplicate (earlier row had the same hash)
    if (seenInBatch.has(hash)) {
      const firstIdx = seenInBatch.get(hash)!;
      const firstRow = rows[firstIdx];
      out.set(i, {
        kind: "intra-csv",
        matchSummary: `Same as row #${firstIdx + 1} in this CSV · ${firstRow.date} · ${fmtAmount(Math.abs(firstRow.amount))} · ${firstRow.description || "(no description)"}`,
        matchedDate: firstRow.date,
      });
      continue;
    }
    seenInBatch.set(hash, i);

    // Priority 3 — soft (fuzzy) match against date-range candidates
    const softHits = candidates.filter((c) => {
      if (!c.date) return false;
      // Same |amount| within $0.01
      if (Math.abs(Math.abs(c.amount) - Math.abs(row.amount)) > 0.01) return false;
      // Within ±1 day
      const dayDelta = Math.abs(
        (new Date(c.date).getTime() - new Date(row.date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (dayDelta > 1) return false;
      // Description fuzzy
      const sim = jaccardSimilarity(c.description, row.description);
      return sim >= FUZZY_JACCARD_THRESHOLD;
    });
    if (softHits.length > 0) {
      const best = pickMostRecent(softHits);
      out.set(i, {
        kind: "soft",
        matchSummary: `Looks similar: ${best.description || "(no description)"} · ${best.date} · ${fmtAmount(Math.abs(best.amount))}`,
        matchedDate: best.date,
      });
    }
  }

  return out;
}

function pickMostRecent(matches: ExistingTxn[]): ExistingTxn {
  if (matches.length === 1) return matches[0];
  return [...matches].sort((a, b) => b.date.localeCompare(a.date))[0];
}
