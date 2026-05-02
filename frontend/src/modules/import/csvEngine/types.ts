// Public types for the CSV ingestion engine. Pure data; no React, no Firestore.
//
// Pipeline shape:
//   raw csv → headers → detect mode → parse rows → validate → IngestionResult

export type IngestionMode =
  | "template"   // Date / Description / Amount  (signed, no Type column)
  | "type"       // has explicit Transaction Type column with Debit/Credit
  | "split"      // separate Debit + Credit columns
  | "sign"       // single Amount column with mixed signs (bank export)
  | "positive"   // single Amount column with all-positive amounts (no direction info)
  | "unknown";   // could not decide — caller must surface error to user

export type RowSource = "template" | "bank";

export interface DetectionResult {
  mode:     IngestionMode;
  source:   RowSource;          // "template" only when mode === "template"
  badge:    string;             // human-readable label for the UI
  warnings: string[];           // soft warnings (e.g. all-positive inference)
  // Diagnostic — which raw header strings the engine resolved to canonical fields.
  resolvedHeaders: ResolvedHeaders;
}

export interface ResolvedHeaders {
  date?:        string;
  description?: string;
  amount?:      string;
  debit?:       string;
  credit?:      string;
  type?:        string;
  account?:     string;
}

// One row that passed parsing + validation.
export interface ParsedRow {
  date:        string;        // YYYY-MM-DD
  description: string;        // trimmed
  amount:      number;        // signed, natural convention (positive = inflow)
  type:        "income" | "expense";   // engine output; backend may upgrade to "transfer" / "refund"
  source:      RowSource;
  rawRow:      Record<string, string>;
  // For "positive" mode, the engine guessed direction from description keywords;
  // surface that for the UI so the user knows to verify.
  inferredDirection?: boolean;
}

export interface RowError {
  rowIndex: number;            // 0-based, matching the input order
  field?:   keyof ParsedRow | "header";
  message:  string;
  rawRow:   Record<string, string>;
}

export interface IngestionResult {
  detection: DetectionResult;
  rows:      ParsedRow[];
  errors:    RowError[];
  totalRows: number;           // input rows (including ones that errored)
}
