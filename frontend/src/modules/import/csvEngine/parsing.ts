// Shared scalar parsers for date and amount fields. Pure functions, no IO.
// Used by both detect.ts (sign sampling) and parsers.ts (row parsing).

/**
 * Parse a date cell into YYYY-MM-DD. Returns "" when unrecognized — callers
 * treat empty as a row-level error.
 *
 * Accepted forms:
 *   2026-01-15            (ISO)
 *   01/15/2026            (US slash, 4-digit year)
 *   1/15/26               (US slash, 2-digit year, > 50 → 19xx, else 20xx)
 *   01-15-2026            (US dash)
 *   Jan 15 2026 / 15 Jan 2026  (Date.parse fallback)
 */
export function parseDate(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const mdyShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShort) {
    const [, m, d, y] = mdyShort;
    const fullYear = parseInt(y, 10) > 50 ? `19${y}` : `20${y}`;
    return `${fullYear}-${pad2(m)}-${pad2(d)}`;
  }

  const mdyDash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdyDash) {
    const [, m, d, y] = mdyDash;
    return `${y}-${pad2(m)}-${pad2(d)}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return "";
}

/**
 * Parse a currency cell into a signed number. Returns NaN when unparseable —
 * callers treat NaN as a row-level error (don't coerce to 0).
 *
 * Handles:
 *   1,234.56     comma thousands
 *   $1,234.56    leading currency symbol
 *   (45.00)      accounting parens → -45.00
 *   - 45.00      leading sign with whitespace
 *   "45.00 Dr"   trailing Dr → expense (sign flipped)
 *   "45.00 Cr"   trailing Cr → income (sign untouched)
 */
export function parseAmount(raw: string): number {
  let s = (raw ?? "").trim();
  if (!s) return NaN;

  // Trailing Dr/Cr suffixes (some Indian/UK formats)
  let drCrFlip = false;
  const drCr = s.match(/^(.*?)\s*(dr|cr)\.?$/i);
  if (drCr) {
    s = drCr[1].trim();
    if (drCr[2].toLowerCase() === "dr") drCrFlip = true;  // debit → expense
  }

  // (123.45) → -123.45
  const parens = s.match(/^\(([^)]+)\)$/);
  if (parens) s = `-${parens[1]}`;

  s = s.replace(/[$£€,\s]/g, "");
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return drCrFlip ? -Math.abs(n) : n;
}

function pad2(s: string): string {
  return s.padStart(2, "0");
}
