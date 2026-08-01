import { describe, it, expect } from "vitest";
import { buildDocId, computeDedupeHash, normalizeTransaction } from "../src/ingestion/transactionPipeline";

// ─── Duplicate protection ─────────────────────────────────────────────────────
//
// Protection is DETERMINISTIC on purpose. Plaid rows key on the stable
// `transaction_id` the provider assigns; CSV / AI rows key on an exact hash of
// account + date + signed amount + normalized description. There is no fuzzy
// matching anywhere, because a near-miss heuristic would silently discard
// legitimate transactions — two identical $4.50 coffees on the same day are a
// real pattern, and dropping one is a worse failure than keeping both.
//
// The residual limitation is the mirror image of that guarantee and is
// disclosed in the UI: genuinely distinct rows that are identical on all four
// fields collapse to one.

describe("Plaid — idempotent on the provider's transaction id", () => {
  const plaidRow = (id: string, over: Record<string, unknown> = {}) =>
    normalizeTransaction(
      { transaction_id: id, account_id: "acct_1", date: "2025-06-01", name: "ACME LLC", amount: 250, ...over } as never,
      "plaid",
      "acct_1"
    );

  it("produces the same doc id for the same Plaid transaction, every sync", () => {
    const a = buildDocId(plaidRow("plaid-txn-abc"));
    const b = buildDocId(plaidRow("plaid-txn-abc"));
    expect(a).toBe("plaid_plaid-txn-abc");
    expect(b).toBe(a);
  });

  it("keeps distinct Plaid transactions distinct even when they look identical", () => {
    // Same merchant, same day, same amount — different provider ids. Both are
    // real and both must survive.
    const a = buildDocId(plaidRow("plaid-txn-1"));
    const b = buildDocId(plaidRow("plaid-txn-2"));
    expect(a).not.toBe(b);
  });
});

describe("CSV / AI — exact-match hash, never fuzzy", () => {
  it("matches only when account, date, amount and description are all identical", () => {
    const base = computeDedupeHash("acct_1", "2025-06-01", -100.0, "ACME LLC");

    expect(computeDedupeHash("acct_1", "2025-06-01", -100.0, "ACME LLC")).toBe(base);
    // Any single field differing produces a different key — no fuzzy collapse.
    expect(computeDedupeHash("acct_2", "2025-06-01", -100.0, "ACME LLC")).not.toBe(base);
    expect(computeDedupeHash("acct_1", "2025-06-02", -100.0, "ACME LLC")).not.toBe(base);
    expect(computeDedupeHash("acct_1", "2025-06-01", -100.01, "ACME LLC")).not.toBe(base);
    expect(computeDedupeHash("acct_1", "2025-06-01", -100.0, "ACME LLC #2")).not.toBe(base);
  });

  it("distinguishes an inflow from an outflow of the same size", () => {
    expect(computeDedupeHash("a", "2025-06-01", 100, "X"))
      .not.toBe(computeDedupeHash("a", "2025-06-01", -100, "X"));
  });

  it("does not treat a similar description as a duplicate", () => {
    // "Fuzzy" would merge these. Deterministic matching must not.
    expect(computeDedupeHash("a", "2025-06-01", -50, "STARBUCKS STORE 123"))
      .not.toBe(computeDedupeHash("a", "2025-06-01", -50, "STARBUCKS STORE 456"));
  });

  it("gives the same CSV row the same doc id so re-importing a file is a no-op", () => {
    const row = () =>
      normalizeTransaction(
        { date: "2025-06-01", description: "ACME LLC", amount: -100 } as never,
        "csv",
        "acct_1"
      );
    expect(buildDocId(row())).toBe(buildDocId(row()));
  });
});

describe("force import — the one path that can double-count", () => {
  const row = () =>
    normalizeTransaction(
      { date: "2025-06-01", description: "ACME LLC", amount: -100 } as never,
      "csv",
      "acct_1"
    );

  it("gets a unique doc id so it sits alongside the original", () => {
    const normal = buildDocId(row());
    const forced = buildDocId(row(), { forceImport: true });
    expect(forced).not.toBe(normal);
    expect(forced.startsWith(normal)).toBe(true); // lineage preserved in the id
  });

  it("keeps the canonical hash on the row so it stays part of the duplicate group", () => {
    // The saved doc carries the original dedupeHash, which is what makes the
    // "possible duplicate" disclosure on the tax summary possible.
    expect(row().dedupeHash).toBe(computeDedupeHash("acct_1", "2025-06-01", 100, "ACME LLC"));
  });
});
