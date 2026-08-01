import { describe, it, expect, beforeAll } from "vitest";
import {
  assertEmulatorOnly,
  callFunction,
  clearCollection,
  createUserWithIdToken,
  db,
} from "./emulatorHarness";

// ─── Emulator integration test ────────────────────────────────────────────────
//
// Runs against the real Firebase Auth + Firestore + Functions emulators with
// SYNTHETIC accounts and SYNTHETIC transactions. No production credentials, no
// production data. Auth tokens are genuinely minted and genuinely verified by
// the Functions emulator, and Firestore reads go through the real client.

const OWNER = { uid: "it_owner", email: "owner@synthetic.test" };
const SPOUSE = { uid: "it_spouse", email: "spouse@synthetic.test" };
const ACCOUNTANT = { uid: "it_accountant", email: "accountant@synthetic.test" };
const OTHER_OWNER = { uid: "it_other_owner", email: "other@synthetic.test" };

const YEAR = 2025;

let ownerToken: string;
let spouseToken: string;
let accountantToken: string;
let otherOwnerToken: string;

/**
 * Owner fixture — hand-derived expectations:
 *
 *   Schedule C gross receipts                        120,000
 *   Schedule C expenses (9,000 + 6,000)               15,000
 *   Schedule C NET                                   105,000  ← only SE base
 *   Schedule E rent 24,000 − repairs 4,000            20,000
 *   W-2 wages                                         65,000
 *   Interest 1,200 + dividends 2,300                   3,500
 *   Schedule A charitable                              2,000
 *   Personal: groceries 7,000 + owner draw 10,000
 *             + loan principal 5,000 + unknown 8,000  30,000
 *   Total income 120,000 + 24,000 + 65,000 + 3,500   212,500
 *   Deductible   15,000 + 4,000 + 2,000               21,000
 *   Excluded: 2 transfers, 1 needs_review, 1 uncategorized
 */
const OWNER_TXNS = [
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
  { category: "Business Income", amount: 50000, type: "transfer", status: "categorized" },
  { category: "Office Supplies", amount: 3000, type: "transfer", status: "auto_resolved" },
  { category: "Business Income", amount: 99999, type: "income", status: "needs_review" },
  { category: "", amount: 400, type: "expense", status: "categorized" },
  { category: "Crypto Mining Rig", amount: 8000, type: "expense", status: "categorized" },
];

/** Unrelated owner — completely different numbers, must never mix. */
const OTHER_TXNS = [
  { category: "Business Income", amount: 777_000, type: "income", status: "categorized" },
];

beforeAll(async () => {
  assertEmulatorOnly();

  await clearCollection("transactions");
  await clearCollection("users");
  await clearCollection("taxSessions");
  await clearCollection("forecasts");

  [ownerToken, spouseToken, accountantToken, otherOwnerToken] = await Promise.all([
    createUserWithIdToken(OWNER.uid, OWNER.email),
    createUserWithIdToken(SPOUSE.uid, SPOUSE.email),
    createUserWithIdToken(ACCOUNTANT.uid, ACCOUNTANT.email),
    createUserWithIdToken(OTHER_OWNER.uid, OTHER_OWNER.email),
  ]);

  // Shared-access wiring: spouse and accountant point at the owner.
  await db().collection("users").doc(OWNER.uid).set({ email: OWNER.email });
  await db().collection("users").doc(SPOUSE.uid).set({ ownerUid: OWNER.uid, role: "spouse" });
  await db().collection("users").doc(ACCOUNTANT.uid).set({ ownerUid: OWNER.uid, role: "accountant" });
  await db().collection("users").doc(OTHER_OWNER.uid).set({ email: OTHER_OWNER.email });

  const batch = db().batch();
  OWNER_TXNS.forEach((t, i) => {
    batch.set(db().collection("transactions").doc(`it_owner_txn_${i}`), {
      ...t, uid: OWNER.uid, taxYear: YEAR, date: `${YEAR}-06-${String((i % 28) + 1).padStart(2, "0")}`,
    });
  });
  OTHER_TXNS.forEach((t, i) => {
    batch.set(db().collection("transactions").doc(`it_other_txn_${i}`), {
      ...t, uid: OTHER_OWNER.uid, taxYear: YEAR, date: `${YEAR}-06-01`,
    });
  });
  await batch.commit();

  await db().collection("taxSessions").doc(`${OWNER.uid}_${YEAR}`)
    .set({ answers: { hasSelfEmployment: true } });
});

// ─── Access control, end to end ───────────────────────────────────────────────

describe("access control through real Auth tokens", () => {
  it("rejects an unauthenticated call", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("UNAUTHENTICATED");
  });

  it("rejects a garbage bearer token", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR }, "not-a-real-token");
    expect(r.ok).toBe(false);
  });

  it("serves the owner their own data", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR }, ownerToken);
    expect(r.ok).toBe(true);
    expect(r.result!.totalIncome).toBe(212_500);
    expect(r.result!.scheduleCNet).toBe(105_000);
  });

  it("serves a SPOUSE the owner's data via effectiveOwnerUid", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR }, spouseToken);
    expect(r.ok).toBe(true);
    expect(r.result!.totalIncome).toBe(212_500);
    expect(r.result!.scheduleCNet).toBe(105_000);
  });

  it("serves an ACCOUNTANT the owner's data via effectiveOwnerUid", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR }, accountantToken);
    expect(r.ok).toBe(true);
    expect(r.result!.totalIncome).toBe(212_500);
  });

  it("never leaks one owner's data to an unrelated owner", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR }, otherOwnerToken);
    expect(r.ok).toBe(true);
    expect(r.result!.totalIncome).toBe(777_000);
    expect(r.result!.transactionCount).toBe(1);
    expect(r.result!.totalIncome).not.toBe(212_500);
  });
});

// ─── Summary reconciliation, expected vs actual ───────────────────────────────

describe("summary reconciliation against the emulator", () => {
  it("matches the hand-derived totals in every lane", async () => {
    const r = await callFunction("generateTaxSummary", { taxYear: YEAR }, ownerToken);
    const s = r.result!;

    expect(s.totalIncome).toBe(212_500);
    expect(s.scheduleCIncome).toBe(120_000);
    expect(s.scheduleCExpenses).toBe(15_000);
    expect(s.scheduleCNet).toBe(105_000);
    expect(s.scheduleEIncome).toBe(24_000);
    expect(s.scheduleEExpenses).toBe(4_000);
    expect(s.scheduleENet).toBe(20_000);
    expect(s.w2Wages).toBe(65_000);
    expect(s.otherOrdinaryIncome).toBe(3_500);
    expect(s.scheduleADeductions).toBe(2_000);
    expect(s.totalExpenses).toBe(21_000);
    expect(s.personalSpending).toBe(30_000);
    expect(s.netProfit).toBe(105_000);
    expect(s.excluded).toEqual({ transfers: 2, needsReview: 1, uncategorized: 1 });
    expect(s.answers).toEqual({ hasSelfEmployment: true });
  });
});

// ─── The SE arithmetic proof ──────────────────────────────────────────────────

describe("Schedule SE arithmetic — $10,000 profit → $9,235 net earnings", () => {
  const SE_UID = "it_se_owner";
  let seToken: string;

  beforeAll(async () => {
    seToken = await createUserWithIdToken(SE_UID, "se@synthetic.test");
    await db().collection("users").doc(SE_UID).set({ email: "se@synthetic.test" });
    await db().collection("transactions").doc("it_se_txn").set({
      uid: SE_UID, taxYear: YEAR, date: `${YEAR}-03-01`,
      category: "Business Income", amount: 10_000, type: "income", status: "categorized",
    });
  });

  it("takes 92.35% of Schedule C profit as net earnings before applying any rate", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, seToken
    );
    expect(r.ok).toBe(true);
    const f = r.result!;

    // Schedule SE line 2 → line 4a.
    expect(f.seTaxBase).toBe(10_000);
    expect(f.seNetEarnings).toBe(9_235);

    // 12.4% OASDI + 2.9% Medicare, both on the 9,235 — not on the 10,000.
    expect(f.seSocialSecurityTax).toBeCloseTo(9_235 * 0.124, 2); // 1,145.14
    expect(f.seMedicareTax).toBeCloseTo(9_235 * 0.029, 2);       //   267.82
    expect(f.projectedSETax).toBe(Math.round(9_235 * 0.153));    //     1,413
  });

  it("leaves the full OASDI wage base available when there are no W-2 wages", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, seToken
    );
    // 2025 Social Security wage base, untouched.
    expect(r.result!.seSocialSecurityHeadroom).toBe(176_100);
  });
});

describe("W-2 wages affect ONLY the Social Security wage-base limit", () => {
  const W2_UID = "it_w2_owner";
  let w2Token: string;

  beforeAll(async () => {
    w2Token = await createUserWithIdToken(W2_UID, "w2@synthetic.test");
    await db().collection("users").doc(W2_UID).set({ email: "w2@synthetic.test" });
    const batch = db().batch();
    // Same $10,000 of Schedule C profit, plus W-2 wages above the 2025 base.
    batch.set(db().collection("transactions").doc("it_w2_txn_c"), {
      uid: W2_UID, taxYear: YEAR, date: `${YEAR}-03-01`,
      category: "Business Income", amount: 10_000, type: "income", status: "categorized",
    });
    batch.set(db().collection("transactions").doc("it_w2_txn_w"), {
      uid: W2_UID, taxYear: YEAR, date: `${YEAR}-03-02`,
      category: "Wages & Salaries", amount: 180_000, type: "income", status: "categorized",
    });
    await batch.commit();
  });

  it("does not change the 92.35% net-earnings figure", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, w2Token
    );
    const f = r.result!;
    expect(f.seTaxBase).toBe(10_000);
    // Identical to the no-wages case — W-2 income never touches this step.
    expect(f.seNetEarnings).toBe(9_235);
  });

  it("exhausts the OASDI headroom, zeroing the Social Security portion only", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, w2Token
    );
    const f = r.result!;

    // 180,000 of wages > the 176,100 base → no OASDI room left.
    expect(f.seSocialSecurityHeadroom).toBe(0);
    expect(f.seSocialSecurityTax).toBe(0);

    // Medicare is uncapped and is unchanged from the no-wages case.
    expect(f.seMedicareTax).toBeCloseTo(9_235 * 0.029, 2);
    expect(f.projectedSETax).toBe(Math.round(9_235 * 0.029));
  });

  it("still taxes the wages as ordinary income", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, w2Token
    );
    const f = r.result!;
    expect(f.ytdW2Wages).toBe(180_000);
    expect(f.projectedIncomeTax as number).toBeGreaterThan(0);
    // But the wages are NOT in the self-employment base.
    expect(f.seTaxBase).toBe(10_000);
  });
});

// ─── Forecast behaviour ───────────────────────────────────────────────────────

describe("forecast through the emulator", () => {
  it("charges SE tax on Schedule C net only for the mixed-income owner", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, ownerToken
    );
    const f = r.result!;

    expect(f.seTaxBase).toBe(105_000);
    expect(f.seNetEarnings).toBe(Math.round(105_000 * 0.9235 * 100) / 100);
    // Not the pooled 212,500 − 21,000 = 191,500.
    expect(f.seTaxBase).not.toBe(191_500);
  });

  it("writes the forecast under the OWNER's key when a spouse runs it", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, spouseToken
    );
    expect(r.result!.uid).toBe(OWNER.uid);

    const ownerDoc = await db().collection("forecasts").doc(`${OWNER.uid}_${YEAR}`).get();
    const spouseDoc = await db().collection("forecasts").doc(`${SPOUSE.uid}_${YEAR}`).get();
    expect(ownerDoc.exists).toBe(true);
    expect(spouseDoc.exists).toBe(false);
  });

  it("rejects an unsupported filing status", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "married" }, ownerToken
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("INVALID_ARGUMENT");
  });

  it("accepts every supported filing status", async () => {
    for (const status of [
      "single", "married_jointly", "married_filing_jointly",
      "married_separately", "head_of_household", "qualifying_surviving_spouse",
    ]) {
      const r = await callFunction("getTaxForecast", { taxYear: YEAR, filingStatus: status }, ownerToken);
      expect(r.ok, `status ${status}`).toBe(true);
    }
  });

  it("reports no next deadline for a completed year", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: 2025, filingStatus: "single" }, ownerToken
    );
    expect(r.result!.nextQuarterlyDue).toBeNull();
    expect(r.result!.remainingQuarters).toBe(0);
  });

  it("uses the requested year's tables, not a hard-coded 2025", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: 2024, filingStatus: "single" }, ownerToken
    );
    expect(r.result!.taxYear).toBe(2024);
    expect(r.result!.standardDeduction).toBe(14_600);
  });

  it("labels the output an estimate and lists exclusions", async () => {
    const r = await callFunction(
      "getTaxForecast", { taxYear: YEAR, filingStatus: "single" }, ownerToken
    );
    expect(r.result!.isEstimate).toBe(true);
    expect((r.result!.exclusions as string[]).length).toBeGreaterThan(5);
  });
});
