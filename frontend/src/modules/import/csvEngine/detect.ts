// Mode detection. Given resolved headers + a sample of raw rows, decide which
// of the 5 modes (template / type / split / sign / positive) applies.
//
// The order of checks is significant — earlier checks are stricter and "win"
// when their preconditions hold.

import { parseAmount } from "./parsing";
import type { DetectionResult, IngestionMode, ResolvedHeaders } from "./types";

const SAMPLE_SIZE = 50;     // inspect at most this many rows for amount-sign heuristics

export function detectMode(
  headers:  ResolvedHeaders,
  rawRows:  Record<string, string>[],
): DetectionResult {
  const warnings: string[] = [];

  // ── Hard requirements ─────────────────────────────────────────────────────
  if (!headers.date) {
    return unknown(headers, "Missing required Date column");
  }
  if (!headers.description) {
    return unknown(headers, "Missing required Description column");
  }

  const sample = rawRows.slice(0, SAMPLE_SIZE);

  // ── 1. Type mode: explicit "Transaction Type" column with Debit/Credit ────
  if (headers.type && (headers.amount || headers.debit || headers.credit)) {
    const typeValues = sample
      .map((r) => (r[headers.type!] ?? "").toLowerCase().trim())
      .filter(Boolean);
    const hasDebitOrCredit = typeValues.some(
      (t) => t === "debit" || t === "credit" || t === "dr" || t === "cr",
    );
    if (hasDebitOrCredit) {
      return ok("type", "bank", "Bank format detected (Type column)", warnings, headers);
    }
  }

  // ── 2. Split mode: separate Debit + Credit columns (no shared "Amount") ───
  if (headers.debit && headers.credit && headers.debit !== headers.credit) {
    return ok("split", "bank", "Bank format detected (Debit / Credit columns)", warnings, headers);
  }

  // ── 3 & 4 & 5. Single-amount-column paths ─────────────────────────────────
  if (headers.amount) {
    const numbers = sample
      .map((r) => parseAmount(r[headers.amount!] ?? ""))
      .filter((n): n is number => !isNaN(n));

    if (numbers.length === 0) {
      return unknown(headers, "Amount column is empty or unparseable");
    }

    const hasNegative = numbers.some((n) => n < 0);
    const hasPositive = numbers.some((n) => n > 0);

    if (hasNegative && hasPositive) {
      // Mixed signs — could be the simple template or a typical bank export.
      // Distinguish by the absence/presence of bank-specific signals:
      //   • no Type column AND no Debit/Credit columns → template
      //   • otherwise → sign mode (bank)
      const looksLikeTemplate = !headers.type && !headers.debit && !headers.credit;
      return looksLikeTemplate
        ? ok("template", "template", "Template detected", warnings, headers)
        : ok("sign", "bank", "Bank format detected (Signed amounts)", warnings, headers);
    }

    if (hasPositive && !hasNegative) {
      warnings.push(
        "All amounts in this file are positive. Direction will be inferred from description keywords. Please review the preview.",
      );
      return ok("positive", "bank", "Bank format detected (All positive)", warnings, headers);
    }

    if (hasNegative && !hasPositive) {
      // All-negative is unusual but valid — treat the same as sign mode (bank).
      return ok("sign", "bank", "Bank format detected (Signed amounts)", warnings, headers);
    }
  }

  return unknown(headers, "Need at least Date + Description + Amount, or separate Debit/Credit columns");
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function ok(
  mode: IngestionMode,
  source: "template" | "bank",
  badge: string,
  warnings: string[],
  headers: ResolvedHeaders,
): DetectionResult {
  return { mode, source, badge, warnings, resolvedHeaders: headers };
}

function unknown(headers: ResolvedHeaders, reason: string): DetectionResult {
  return {
    mode: "unknown",
    source: "bank",
    badge: "Unknown format",
    warnings: [reason],
    resolvedHeaders: headers,
  };
}
