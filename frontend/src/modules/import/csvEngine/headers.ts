// Header normalization + synonym mapping. One source of truth for which raw
// CSV columns we recognize and what canonical role they play.

import type { ResolvedHeaders } from "./types";

// Synonyms are matched in priority order (most specific first). Match is
// case-insensitive after trimming. We try exact match first, then substring.
export const HEADER_SYNONYMS = {
  date:        ["transaction date", "posted date", "post date", "posting date", "date"],
  description: ["transaction description", "description", "details", "memo", "narrative", "payee", "name", "desc"],
  amount:      ["transaction amount", "amount"],
  debit:       ["debit", "withdrawal", "withdrawals", "amount debit"],
  credit:      ["credit", "deposit", "deposits", "amount credit"],
  type:        ["transaction type", "type", "tran type", "trans type"],
  account:     ["account", "account name", "account number"],
} as const;

export type CanonicalField = keyof typeof HEADER_SYNONYMS;

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase();
}

// Resolve raw headers from the file to our canonical fields.
// Exact match wins over substring; debit/credit aliasing skips the
// generic "amount" synonym so banks with `Withdrawal/Deposit` columns
// don't accidentally map "Withdrawal" to amount.
export function mapHeaders(rawHeaders: string[]): ResolvedHeaders {
  const lower = rawHeaders.map(normalizeHeader);

  function findExact(synonyms: readonly string[], excludeUsed: Set<string>): string | undefined {
    for (const syn of synonyms) {
      const idx = lower.findIndex((h, i) => h === syn && !excludeUsed.has(rawHeaders[i]));
      if (idx !== -1) return rawHeaders[idx];
    }
    return undefined;
  }

  function findSubstring(synonyms: readonly string[], excludeUsed: Set<string>): string | undefined {
    for (const syn of synonyms) {
      const idx = lower.findIndex((h, i) => h.includes(syn) && !excludeUsed.has(rawHeaders[i]));
      if (idx !== -1) return rawHeaders[idx];
    }
    return undefined;
  }

  const used = new Set<string>();
  function pick(field: CanonicalField): string | undefined {
    const synonyms = HEADER_SYNONYMS[field];
    const exact = findExact(synonyms, used);
    if (exact) { used.add(exact); return exact; }
    const sub = findSubstring(synonyms, used);
    if (sub) { used.add(sub); return sub; }
    return undefined;
  }

  // Resolution order matters: type / debit / credit before generic "amount" so
  // a "Withdrawal" header binds to debit, not to amount.
  const date        = pick("date");
  const description = pick("description");
  const type        = pick("type");
  const debit       = pick("debit");
  const credit      = pick("credit");
  const amount      = pick("amount");
  const account     = pick("account");

  return { date, description, amount, debit, credit, type, account };
}
