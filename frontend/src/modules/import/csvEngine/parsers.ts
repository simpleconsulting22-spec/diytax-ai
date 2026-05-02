// Per-mode row parsers. Each parser takes a raw CSV row + resolved headers
// and returns either { row } (success) or { error } (validation failure).
// Errors are collected by the orchestrator — never thrown.

import { parseAmount, parseDate } from "./parsing";
import type { ParsedRow, ResolvedHeaders, RowError, RowSource } from "./types";

// Direction-keyword heuristics for "positive" mode (no signs in the file).
// Order: refund/credit keywords first (more specific), then expense, then
// generic income. Falls through to expense default if nothing matches.
const EXPENSE_KEYWORDS = /\b(payment|purchase|withdrawal|withdrawl|debit|pos|atm|fee|charge|autopay|pmt|pymt|bill\s*pay)\b/i;
const INCOME_KEYWORDS  = /\b(deposit|interest\s+earned|interest|refund|credit|payroll|direct\s+deposit|salary|dividend|reimbursement|reversal)\b/i;

interface ParseInput {
  rawRow:    Record<string, string>;
  rowIndex:  number;
  headers:   ResolvedHeaders;
}

interface ParseOutcome {
  row?:    ParsedRow;
  error?:  RowError;
}

// ─── Common pre-flight: shared date + description + amount cells ────────────

interface CommonFields {
  date:        string;
  description: string;
}

function readCommon({ rawRow, rowIndex, headers }: ParseInput):
  | { ok: true; common: CommonFields }
  | { ok: false; error: RowError } {
  const date = parseDate(rawRow[headers.date!] ?? "");
  if (!date) {
    return {
      ok: false,
      error: { rowIndex, field: "date", message: "Missing or unparseable Date", rawRow },
    };
  }
  const description = (rawRow[headers.description!] ?? "").trim();
  if (!description) {
    return {
      ok: false,
      error: { rowIndex, field: "description", message: "Missing Description", rawRow },
    };
  }
  return { ok: true, common: { date, description } };
}

function buildRow(
  common: CommonFields,
  signedAmount: number,
  source: RowSource,
  rawRow: Record<string, string>,
  inferredDirection?: boolean,
): ParsedRow {
  return {
    date:        common.date,
    description: common.description,
    amount:      signedAmount,
    type:        signedAmount >= 0 ? "income" : "expense",
    source,
    rawRow,
    ...(inferredDirection ? { inferredDirection: true } : {}),
  };
}

// ─── Mode parsers ───────────────────────────────────────────────────────────

/** TEMPLATE: Date / Description / Amount. amount > 0 → income, < 0 → expense. */
export function parseTemplate(input: ParseInput): ParseOutcome {
  const pre = readCommon(input);
  if (!pre.ok) return { error: pre.error };

  const amt = parseAmount(input.rawRow[input.headers.amount!] ?? "");
  if (isNaN(amt)) {
    return {
      error: { rowIndex: input.rowIndex, field: "amount", message: "Amount must be a number", rawRow: input.rawRow },
    };
  }
  return { row: buildRow(pre.common, amt, "template", input.rawRow) };
}

/** TYPE: explicit Transaction Type column (Debit / Credit). */
export function parseTypeMode(input: ParseInput): ParseOutcome {
  const pre = readCommon(input);
  if (!pre.ok) return { error: pre.error };

  const typeRaw = (input.rawRow[input.headers.type!] ?? "").toLowerCase().trim();
  const isCredit = typeRaw === "credit" || typeRaw === "cr";
  const isDebit  = typeRaw === "debit"  || typeRaw === "dr";
  if (!isCredit && !isDebit) {
    return {
      error: {
        rowIndex: input.rowIndex,
        field: "type",
        message: `Unrecognized Transaction Type "${typeRaw}" (expected Debit or Credit)`,
        rawRow: input.rawRow,
      },
    };
  }

  // Amount may live in any of: amount / debit / credit columns. Take the
  // first non-NaN absolute value, then sign it from the type column.
  const candidates = [input.headers.amount, input.headers.debit, input.headers.credit]
    .filter((h): h is string => !!h)
    .map((h) => parseAmount(input.rawRow[h] ?? ""));
  const found = candidates.find((n) => !isNaN(n));
  if (found === undefined) {
    return {
      error: { rowIndex: input.rowIndex, field: "amount", message: "Amount cell is empty or unparseable", rawRow: input.rawRow },
    };
  }
  const abs = Math.abs(found);
  const signed = isCredit ? abs : -abs;
  return { row: buildRow(pre.common, signed, "bank", input.rawRow) };
}

/** SPLIT: separate Debit + Credit columns, both positive. */
export function parseSplit(input: ParseInput): ParseOutcome {
  const pre = readCommon(input);
  if (!pre.ok) return { error: pre.error };

  const debitVal  = parseAmount(input.rawRow[input.headers.debit!]  ?? "");
  const creditVal = parseAmount(input.rawRow[input.headers.credit!] ?? "");
  const debitOk   = !isNaN(debitVal)  && debitVal  > 0;
  const creditOk  = !isNaN(creditVal) && creditVal > 0;

  if (debitOk && creditOk) {
    // Both filled — most banks only fill one. Prefer the larger one and warn.
    const bigger = debitVal >= creditVal ? -debitVal : creditVal;
    return { row: buildRow(pre.common, bigger, "bank", input.rawRow) };
  }
  if (debitOk)  return { row: buildRow(pre.common, -debitVal,  "bank", input.rawRow) };
  if (creditOk) return { row: buildRow(pre.common,  creditVal, "bank", input.rawRow) };

  return {
    error: { rowIndex: input.rowIndex, field: "amount", message: "Both Debit and Credit are empty", rawRow: input.rawRow },
  };
}

/** SIGN: single Amount column, mixed signs. positive → income, negative → expense. */
export function parseSign(input: ParseInput): ParseOutcome {
  const pre = readCommon(input);
  if (!pre.ok) return { error: pre.error };

  const amt = parseAmount(input.rawRow[input.headers.amount!] ?? "");
  if (isNaN(amt)) {
    return {
      error: { rowIndex: input.rowIndex, field: "amount", message: "Amount must be a number", rawRow: input.rawRow },
    };
  }
  return { row: buildRow(pre.common, amt, "bank", input.rawRow) };
}

/** POSITIVE: all amounts positive, direction inferred from description keywords. */
export function parsePositive(input: ParseInput): ParseOutcome {
  const pre = readCommon(input);
  if (!pre.ok) return { error: pre.error };

  const amtRaw = parseAmount(input.rawRow[input.headers.amount!] ?? "");
  if (isNaN(amtRaw)) {
    return {
      error: { rowIndex: input.rowIndex, field: "amount", message: "Amount must be a number", rawRow: input.rawRow },
    };
  }
  const abs = Math.abs(amtRaw);

  // Order: income keywords first (refund/deposit/payroll). Otherwise expense
  // by default — overwhelming majority of real-world rows are outflows.
  let signed: number;
  if (INCOME_KEYWORDS.test(pre.common.description)) {
    signed = abs;
  } else if (EXPENSE_KEYWORDS.test(pre.common.description)) {
    signed = -abs;
  } else {
    signed = -abs;   // default to expense
  }

  return { row: buildRow(pre.common, signed, "bank", input.rawRow, /* inferred */ true) };
}
