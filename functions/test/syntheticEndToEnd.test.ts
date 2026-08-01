import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Synthetic end-to-end proof ───────────────────────────────────────────────
//
// SYNTHETIC DATA ONLY — no real user, no real financial data, no network.
// Firestore is replaced with an in-memory fake so the real access-control and
// aggregation code paths execute unchanged.
//
// The point is numerical: every total below is hand-derived from the fixture
// and asserted, so this is a proof of the arithmetic rather than a navigation
// smoke test.

// ── In-memory Firestore fake ──────────────────────────────────────────────────

interface FakeDoc { id: string; data: Record<string, unknown> }

const store: Record<string, FakeDoc[]> = { transactions: [], users: [], taxSessions: [], forecasts: [] };
const written: Record<string, Record<string, unknown>> = {};

function makeQuery(collectionName: string, filters: Array<[string, string, unknown]> = []) {
  return {
    where(field: string, op: string, value: unknown) {
      return makeQuery(collectionName, [...filters, [field, op, value]]);
    },
    async get() {
      const rows = (store[collectionName] ?? []).filter((doc) =>
        filters.every(([field, op, value]) => {
          const actual = doc.data[field];
          if (op === "==") return actual === value;
          if (op === ">=") return String(actual) >= String(value);
          if (op === "<=") return String(actual) <= String(value);
          return true;
        })
      );
      return {
        size: rows.length,
        docs: rows.map((r) => ({ id: r.id, data: () => r.data })),
        forEach(fn: (d: { id: string; data: () => Record<string, unknown> }) => void) {
          rows.forEach((r) => fn({ id: r.id, data: () => r.data }));
        },
      };
    },
  };
}

const fakeDb = {
  collection(name: string) {
    return {
      ...makeQuery(name),
      doc(id: string) {
        return {
          async get() {
            const hit = (store[name] ?? []).find((d) => d.id === id);
            return { exists: !!hit, data: () => hit?.data };
          },
          async set(value: Record<string, unknown>) {
            written[`${name}/${id}`] = value;
          },
        };
      },
    };
  },
};

vi.mock("firebase-admin", () => ({
  firestore: Object.assign(() => fakeDb, {
    FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
  }),
  default: {},
}));

vi.mock("firebase-functions/v2/https", async () => {
  class HttpsError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return {
    HttpsError,
    // Unwrap the handler so tests can call it directly with a fake request.
    onCall: (_opts: unknown, handler: unknown) => handler,
  };
});

const { generateTaxSummary } = await import("../src/tax/generateTaxSummary");
const { getTaxForecast } = await import("../src/forecast/getTaxForecast");

// ── Synthetic fixture ─────────────────────────────────────────────────────────

const OWNER = "uid_owner_synthetic";
const SPOUSE = "uid_spouse_synthetic";
const ACCOUNTANT = "uid_accountant_synthetic";
const STRANGER = "uid_stranger_synthetic";
const YEAR = 2025;

/**
 * Hand-computed expectations for the fixture below.
 *
 *   Schedule C gross receipts          120,000
 *   Schedule C expenses         9,000 + 6,000 = 15,000
 *   Schedule C NET                     105,000   ← the only SE tax base
 *   Schedule E rent                     24,000
 *   Schedule E expenses                  4,000
 *   Schedule E NET                      20,000
 *   W-2 wages                           65,000
 *   Interest 1,200 + dividends 2,300 =   3,500   (other ordinary)
 *   Schedule A charitable                2,000
 *   Personal (groceries 7,000 + owner draw 10,000 + loan principal 5,000) = 22,000
 *   Total income  120,000 + 24,000 + 65,000 + 3,500 =              212,500
 *   Deductible expenses 15,000 + 4,000 + 2,000 =                    21,000
 *   Excluded: 2 transfers, 1 needs_review, 1 uncategorized
 */
const TXNS: Array<Record<string, unknown>> = [
  { category: "Business Income", amount: 120000, type: "income", status: "categorized" },
  { category: "Office Supplies", amount: 9000, type: "expense", status: "categorized" },
  { category: "Business Meals", amount: 6000, type: "expense", status: "categorized" },
  { category: "Rental Income", amount: 24000, type: "income", status: "categorized" },
  { category: "Rental Repairs & Maintenance", amount: 4000, type: "expense", status: "categorized" },
  { category: "Wages & Salaries", amount: 65000, type: "income", status: "categorized" },
  { category: "Interest Income", amount: 1200, type: "income", status: "categorized" },
  { category: "Dividend Income", amount: 2300, type: "income", status: "categorized" },
  { category: "Charitable Contribution", amount: 2000, type: "expense", status: "categorized" },
  { category: "Groceries", amount: 7000, type: "expense", status: "categorized" },
  { category: "Owner Draw / Distribution", amount: 10000, type: "expense", status: "categorized" },
  { category: "Loan Principal Payment", amount: 5000, type: "expense", status: "categorized" },
  // Excluded rows
  { category: "Business Income", amount: 50000, type: "transfer", status: "categorized" },
  { category: "Office Supplies", amount: 3000, type: "transfer", status: "auto_resolved" },
  { category: "Business Income", amount: 99999, type: "income", status: "needs_review" },
  { category: "", amount: 400, type: "expense", status: "categorized" },
  // Unknown category — must not become a deduction
  { category: "Crypto Mining Rig", amount: 8000, type: "expense", status: "categorized" },
];

beforeEach(() => {
  store.transactions = TXNS.map((t, i) => ({
    id: `txn_${i}`,
    data: { ...t, uid: OWNER, taxYear: YEAR, date: `${YEAR}-06-0${(i % 9) + 1}` },
  }));
  // A stranger's data, to prove queries never cross owners.
  store.transactions.push({
    id: "txn_stranger",
    data: {
      uid: STRANGER, taxYear: YEAR, date: `${YEAR}-06-01`,
      category: "Business Income", amount: 999_999, type: "income", status: "categorized",
    },
  });

  store.users = [
    { id: OWNER, data: {} },
    { id: SPOUSE, data: { ownerUid: OWNER, role: "spouse" } },
    { id: ACCOUNTANT, data: { ownerUid: OWNER, role: "accountant" } },
    { id: STRANGER, data: {} },
  ];
  store.taxSessions = [{ id: `${OWNER}_${YEAR}`, data: { answers: { hasSelfEmployment: true } } }];
  for (const k of Object.keys(written)) delete written[k];
});

const callAs = (uid: string) => ({ auth: { uid }, data: { taxYear: YEAR } });

// ── Access control ────────────────────────────────────────────────────────────

describe("access control", () => {
  it("gives the owner their own data", async () => {
    const r = await (generateTaxSummary as any)(callAs(OWNER));
    expect(r.totalIncome).toBe(212_500);
  });

  it("gives a spouse the OWNER's data via effectiveOwnerUid", async () => {
    const r = await (generateTaxSummary as any)(callAs(SPOUSE));
    expect(r.totalIncome).toBe(212_500);
    expect(r.scheduleCNet).toBe(105_000);
  });

  it("gives an accountant the OWNER's data via effectiveOwnerUid", async () => {
    const r = await (generateTaxSummary as any)(callAs(ACCOUNTANT));
    expect(r.totalIncome).toBe(212_500);
  });

  it("never leaks one owner's transactions to an unrelated user", async () => {
    const r = await (generateTaxSummary as any)(callAs(STRANGER));
    // The stranger sees only their own single 999,999 row.
    expect(r.totalIncome).toBe(999_999);
    expect(r.scheduleCNet).toBe(999_999);
    expect(r.transactionCount).toBe(1);
  });

  it("rejects an unauthenticated call", async () => {
    await expect((generateTaxSummary as any)({ data: { taxYear: YEAR } })).rejects.toThrow(/logged in/i);
  });

  it("rejects an auth object carrying no usable uid", async () => {
    // A malformed bearer token can produce `request.auth` with an empty uid.
    // Without an explicit check that reached Firestore as an empty document
    // path and surfaced as an opaque 500 rather than a clean 401. Found by the
    // emulator integration test with a junk token.
    for (const badAuth of [{ uid: "" }, { uid: undefined }, {}]) {
      await expect(
        (generateTaxSummary as any)({ auth: badAuth, data: { taxYear: YEAR } })
      ).rejects.toThrow(/logged in/i);
    }
  });
});

// ── Summary reconciliation ────────────────────────────────────────────────────

describe("summary reconciliation — expected vs actual", () => {
  it("reconciles every lane against the hand-computed fixture", async () => {
    const r = await (generateTaxSummary as any)(callAs(OWNER));

    expect(r.taxYear).toBe(2025);

    // Income lanes
    expect(r.totalIncome).toBe(212_500);
    expect(r.scheduleCIncome).toBe(120_000);
    expect(r.scheduleEIncome).toBe(24_000);
    expect(r.ordinaryIncome).toBe(68_500);
    expect(r.w2Wages).toBe(65_000);
    expect(r.otherOrdinaryIncome).toBe(3_500);

    // Expense lanes
    expect(r.scheduleCExpenses).toBe(15_000);
    expect(r.scheduleEExpenses).toBe(4_000);
    expect(r.scheduleADeductions).toBe(2_000);
    expect(r.totalExpenses).toBe(21_000);

    // Nets
    expect(r.scheduleCNet).toBe(105_000);
    expect(r.scheduleENet).toBe(20_000);
    expect(r.netProfit).toBe(105_000); // Schedule C net, NOT 212,500 − 21,000

    // Non-deductible tracked but never deducted:
    // groceries 7,000 + owner draw 10,000 + loan principal 5,000 + unknown 8,000
    expect(r.personalSpending).toBe(30_000);

    // Exclusions, reported rather than silently dropped
    expect(r.excluded).toEqual({ transfers: 2, needsReview: 1, uncategorized: 1 });
    expect(r.transactionCount).toBe(17);

    // The tax session answers still come through
    expect(r.answers).toEqual({ hasSelfEmployment: true });
  });

  it("keeps the 99,999 unreviewed row out of every total", async () => {
    const r = await (generateTaxSummary as any)(callAs(OWNER));
    expect(r.totalIncome).not.toBe(212_500 + 99_999);
    expect(r.scheduleCIncome).toBe(120_000);
  });

  it("keeps the unknown category out of deductions", async () => {
    const r = await (generateTaxSummary as any)(callAs(OWNER));
    // 8,000 "Crypto Mining Rig" is tracked as non-deductible, not deducted.
    expect(r.scheduleCExpenses).toBe(15_000);
    expect(r.totalExpenses).toBe(21_000);
  });
});

// ── Forecast ──────────────────────────────────────────────────────────────────

describe("forecast", () => {
  it("charges self-employment tax on Schedule C net ONLY", async () => {
    const r = await (getTaxForecast as any)({
      auth: { uid: OWNER },
      data: { taxYear: YEAR, filingStatus: "single" },
    });

    // 2025 is a completed year as of the test's clock, so progress is 1 and
    // YTD passes through unscaled.
    expect(r.progressPercent).toBe(100);
    expect(r.ytdScheduleCNet).toBe(105_000);

    // THE ASSERTION UNDER AUDIT: the 65,000 wages, 3,500 portfolio income and
    // 20,000 rental net must NOT be in the SE tax base.
    expect(r.seTaxBase).toBe(105_000);
    const expectedSE = Math.round(105_000 * 0.9235 * 0.124 + 105_000 * 0.9235 * 0.029);
    expect(r.projectedSETax).toBe(expectedSE);

    // Sanity: taxing the pooled figure would be far larger.
    const pooledWrong = (212_500 - 21_000) * 0.9235 * 0.153;
    expect(r.projectedSETax).toBeLessThan(pooledWrong);
  });

  it("still counts wages, interest, dividends and rent in AGI", async () => {
    const r = await (getTaxForecast as any)({
      auth: { uid: OWNER },
      data: { taxYear: YEAR, filingStatus: "single" },
    });
    // 105,000 Sch C + 20,000 Sch E + 65,000 wages + 3,500 portfolio − SE ded.
    const seDeduction = r.projectedSEDeduction;
    expect(r.projectedAGI).toBe(Math.round(193_500 - seDeduction));
  });

  it("serves a spouse the owner's forecast", async () => {
    const r = await (getTaxForecast as any)({
      auth: { uid: SPOUSE },
      data: { taxYear: YEAR, filingStatus: "single" },
    });
    expect(r.uid).toBe(OWNER);
    expect(r.ytdScheduleCNet).toBe(105_000);
    // Written under the OWNER's key, not the spouse's.
    expect(written[`forecasts/${OWNER}_${YEAR}`]).toBeDefined();
    expect(written[`forecasts/${SPOUSE}_${YEAR}`]).toBeUndefined();
  });

  it("rejects an unsupported filing status instead of guessing", async () => {
    await expect(
      (getTaxForecast as any)({ auth: { uid: OWNER }, data: { taxYear: YEAR, filingStatus: "married" } })
    ).rejects.toThrow(/Unsupported filing status/);
  });

  it("reports no next deadline for a completed year", async () => {
    const r = await (getTaxForecast as any)({
      auth: { uid: OWNER },
      data: { taxYear: 2025, filingStatus: "single" },
    });
    // Every 2025 estimated-tax deadline (last: 2026-01-15) has passed.
    expect(r.nextQuarterlyDue).toBeNull();
    expect(r.nextQuarterLabel).toBeNull();
    expect(r.remainingQuarters).toBe(0);
  });

  it("labels itself an estimate and lists what it excludes", async () => {
    const r = await (getTaxForecast as any)({
      auth: { uid: OWNER },
      data: { taxYear: YEAR, filingStatus: "single" },
    });
    expect(r.isEstimate).toBe(true);
    expect(r.exclusions.length).toBeGreaterThan(5);
    expect(r.qbiStatus).toBeDefined();
  });

  it("uses the correct dynamic year label rather than a hard-coded 2025", async () => {
    const r = await (getTaxForecast as any)({
      auth: { uid: OWNER },
      data: { taxYear: 2024, filingStatus: "single" },
    });
    expect(r.taxYear).toBe(2024);
    expect(r.tableYear).toBe(2024);
    expect(r.standardDeduction).toBe(14_600); // 2024, not 2025's 15,750
  });
});
