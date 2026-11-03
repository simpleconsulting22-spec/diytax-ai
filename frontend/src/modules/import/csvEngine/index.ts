// Public API for the CSV ingestion engine.
//
//   ingestCsvFile(file) → IngestionResult { detection, rows, errors, totalRows }
//
// Pipeline: papaparse → mapHeaders → detectMode → mode-specific parser per row
// → row-level validation. Errors are collected; the engine never throws on a
// bad row (it produces an IngestionResult containing the collected errors).
//
// Transfer detection is intentionally NOT done here. Cross-account transfer
// pairing requires visibility into the user's other accounts and lives in
// `functions/src/plaid/classifyTransactionPipeline.ts → findTransferPairs`,
// which runs server-side after ingestion. The engine emits `income | expense`;
// the backend may upgrade rows to `transfer` or `refund`.

import Papa from "papaparse";

import { detectMode } from "./detect";
import { mapHeaders } from "./headers";
import {
  parsePositive,
  parseSign,
  parseSplit,
  parseTemplate,
  parseTypeMode,
} from "./parsers";
import type {
  DetectionResult,
  IngestionResult,
  IngestionMode,
  ParsedRow,
  ResolvedHeaders,
  RowError,
} from "./types";

export type {
  DetectionResult,
  IngestionMode,
  IngestionResult,
  ParsedRow,
  ResolvedHeaders,
  RowError,
} from "./types";

export { mapHeaders } from "./headers";
export { detectMode } from "./detect";
export { parseAmount, parseDate } from "./parsing";

// ─── Public API ─────────────────────────────────────────────────────────────

export function ingestCsvFile(file: File): Promise<IngestionResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rawHeaders = results.meta.fields ?? [];
        const headers = mapHeaders(rawHeaders);
        const rawRows = results.data;

        const detection = detectMode(headers, rawRows);
        const result: IngestionResult = {
          detection,
          rows:      [],
          errors:    [],
          totalRows: rawRows.length,
        };

        if (detection.mode === "unknown") {
          // Surface header issue as a synthetic row error so the UI can show
          // it alongside any per-row diagnostics.
          result.errors.push({
            rowIndex: -1,
            field:    "header",
            message:  detection.warnings[0] ?? "Could not detect CSV format",
            rawRow:   {},
          });
          resolve(result);
          return;
        }

        const parser = pickParser(detection.mode);
        for (let i = 0; i < rawRows.length; i++) {
          const outcome = parser({ rawRow: rawRows[i], rowIndex: i, headers });
          if (outcome.row)   result.rows.push(outcome.row);
          if (outcome.error) result.errors.push(outcome.error);
        }

        resolve(result);
      },
      error: (err) => reject(new Error(err.message)),
    });
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type ParserFn = typeof parseTemplate;

function pickParser(mode: IngestionMode): ParserFn {
  switch (mode) {
    case "template": return parseTemplate;
    case "type":     return parseTypeMode;
    case "split":    return parseSplit;
    case "sign":     return parseSign;
    case "positive": return parsePositive;
    case "unknown":  // unreachable — handled before pickParser is called
    default:         return parseTemplate;
  }
}

// ─── Validation summary helpers (for the UI) ────────────────────────────────

/** Aggregate user-facing warnings about the result. UI can render these
 *  above the preview without needing to inspect detection internals. */
export function summarizeResult(result: IngestionResult): string[] {
  const out: string[] = [...result.detection.warnings];

  if (result.detection.mode === "unknown") {
    return out;   // detection.warnings already contains the reason
  }

  if (result.errors.length > 0) {
    out.push(`${result.errors.length} row${result.errors.length !== 1 ? "s" : ""} could not be parsed and will be skipped.`);
  }

  if (result.rows.length === 0 && result.totalRows > 0) {
    out.push("No usable rows found — please check the file format.");
  }

  return out;
}
