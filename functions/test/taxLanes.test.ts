import { describe, it, expect } from "vitest";
import { summarizeTransactions } from "../src/tax/summarizeTransactions";
import { TAX_MAP, getTaxBucket, isValidCategory } from "../src/shared/taxMap";
import { computeFederalEstimate } from "../src/shared/taxConstants";

// ─── The category → tax lane matrix ───────────────────────────────────────────
//
// Self-employment tax applies to net earnings from a trade or business
// (IRC § 1402(a)). It does NOT apply to wages, interest, dividends, retirement
// distributions, Social Security, or rental real estate — § 1402(a)(1) excludes
// rentals from real estate explicitly. These tests prove, per category, that a
// dollar lands in exactly the right lanes and nowhere else.

const AMOUNT = 10_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Lanes {
  totalIncome: number;
  scheduleCGross: number;
  scheduleCNet: number;
  scheduleENet: number;
  agi: number;
  seTaxBase: number;
}

/** Run one $10,000 transaction of `category` through the whole pipeline. */
function lanesFor(category: string, type: "income" | "expense"): Lanes {
  const s = summarizeTransactions([
    { category, amount: AMOUNT, type, status: "categorized" },
  ]);
  const e = computeFederalEstimate({
    scheduleCNet: s.scheduleCNet,
    scheduleENet: s.scheduleENet,
    w2Wages: s.w2Wages,
    otherOrdinaryIncome: s.otherOrdinaryIncome,
    itemizedDeductions: s.scheduleADeductions,
    iraContributions: 0,
    filingStatus: "single",
    taxYear: 2025,
  });
  return {
    totalIncome: s.totalIncome,
    scheduleCGross: s.scheduleCIncome,
    scheduleCNet: s.scheduleCNet,
    scheduleENet: s.scheduleENet,
    agi: e.agi,
    seTaxBase: e.seTaxBase,
  };
}

describe("income lane separation", () => {
  // The exact claim under audit: these may contribute to overall income, but
  // must never reach Schedule C net profit or the self-employment tax base.
  const NON_SE_INCOME = [
    "Wages & Salaries",
    "Interest Income",
    "Dividend Income",
    "Investment Income",
    "Other Income",
  ];

  it.each(NON_SE_INCOME)(
    "%s counts as income but never as Schedule C or SE earnings",
    (category) => {
      const l = lanesFor(category, "income");

      expect(l.totalIncome).toBe(AMOUNT);
      expect(l.scheduleCGross).toBe(0);
      expect(l.scheduleCNet).toBe(0);
      expect(l.scheduleENet).toBe(0);
      expect(l.seTaxBase).toBe(0);
      // Still flows into AGI — it is taxable, just not self-employment income.
      expect(l.agi).toBe(AMOUNT);
    }
  );

  it("Business Income is Schedule C gross receipts and IS subject to SE tax", () => {
    const l = lanesFor("Business Income", "income");

    expect(l.totalIncome).toBe(AMOUNT);
    expect(l.scheduleCGross).toBe(AMOUNT);
    expect(l.scheduleCNet).toBe(AMOUNT);
    expect(l.scheduleENet).toBe(0);
    expect(l.seTaxBase).toBe(AMOUNT);
  });

  it("Rental Income stays in the Schedule E lane and is never SE income", () => {
    const l = lanesFor("Rental Income", "income");

    expect(l.totalIncome).toBe(AMOUNT);
    expect(l.scheduleCGross).toBe(0);
    expect(l.scheduleCNet).toBe(0);
    expect(l.scheduleENet).toBe(AMOUNT);
    expect(l.seTaxBase).toBe(0); // IRC § 1402(a)(1)
    expect(l.agi).toBe(AMOUNT);
  });

  it("only W-2 wages consume the Social Security wage base", () => {
    // $200k of interest must NOT shelter self-employment earnings from the
    // 12.4% OASDI portion the way $200k of W-2 wages does.
    const withWages = computeFederalEstimate({
      scheduleCNet: 50_000, scheduleENet: 0, w2Wages: 200_000,
      otherOrdinaryIncome: 0, itemizedDeductions: 0, iraContributions: 0,
      filingStatus: "single", taxYear: 2025,
    });
    const withInterest = computeFederalEstimate({
      scheduleCNet: 50_000, scheduleENet: 0, w2Wages: 0,
      otherOrdinaryIncome: 200_000, itemizedDeductions: 0, iraContributions: 0,
      filingStatus: "single", taxYear: 2025,
    });

    // Wages exhaust the base → Medicare only. (seTax is rounded to cents, so
    // compare against the same rounding rather than the unrounded product.)
    expect(withWages.seTax).toBe(round2(50_000 * 0.9235 * 0.029));
    // Interest does not → full 15.3%.
    expect(withInterest.seTax).toBe(round2(50_000 * 0.9235 * 0.153));
    expect(withInterest.seTax).toBeGreaterThan(withWages.seTax);
  });

  it("a mixed year keeps every lane separate simultaneously", () => {
    const s = summarizeTransactions([
      { category: "Business Income", amount: 90_000, type: "income", status: "ok" },
      { category: "Office Supplies", amount: 10_000, type: "expense", status: "ok" },
      { category: "Wages & Salaries", amount: 60_000, type: "income", status: "ok" },
      { category: "Interest Income", amount: 2_000, type: "income", status: "ok" },
      { category: "Dividend Income", amount: 3_000, type: "income", status: "ok" },
      { category: "Rental Income", amount: 24_000, type: "income", status: "ok" },
      { category: "Rental Repairs & Maintenance", amount: 4_000, type: "expense", status: "ok" },
      { category: "Charitable Contribution", amount: 1_000, type: "expense", status: "ok" },
      { category: "Groceries", amount: 8_000, type: "expense", status: "ok" },
    ]);

    expect(s.totalIncome).toBe(179_000);
    expect(s.scheduleCNet).toBe(80_000);   // 90,000 − 10,000 only
    expect(s.scheduleENet).toBe(20_000);   // 24,000 − 4,000 only
    expect(s.w2Wages).toBe(60_000);
    expect(s.otherOrdinaryIncome).toBe(5_000);
    expect(s.scheduleADeductions).toBe(1_000);
    expect(s.personalSpending).toBe(8_000);

    const e = computeFederalEstimate({
      scheduleCNet: s.scheduleCNet, scheduleENet: s.scheduleENet,
      w2Wages: s.w2Wages, otherOrdinaryIncome: s.otherOrdinaryIncome,
      itemizedDeductions: s.scheduleADeductions, iraContributions: 0,
      filingStatus: "single", taxYear: 2025,
    });

    // SE tax on Schedule C net ONLY — not on the 60k wages, 5k portfolio
    // income, or 20k rental net.
    expect(e.seTaxBase).toBe(80_000);
    expect(e.seTax).toBeCloseTo(80_000 * 0.9235 * 0.153, 2);
  });
});

describe("expense lane separation", () => {
  it("Schedule A and Schedule E expenses never reduce Schedule C profit", () => {
    const s = summarizeTransactions([
      { category: "Business Income", amount: 100_000, type: "income", status: "ok" },
      { category: "Mortgage Interest", amount: 12_000, type: "expense", status: "ok" },
      { category: "Rental Insurance", amount: 3_000, type: "expense", status: "ok" },
    ]);

    expect(s.scheduleCNet).toBe(100_000);
    expect(s.scheduleCExpenses).toBe(0);
    expect(s.scheduleADeductions).toBe(12_000);
    expect(s.scheduleEExpenses).toBe(3_000);
  });

  it("non-deductible money movements never reduce Schedule C profit", () => {
    // Owner draws, loan principal and reimbursed costs all look like business
    // spending in a bank feed. None of them are deductible.
    const NON_DEDUCTIBLE = [
      "Owner Draw / Distribution",
      "Loan Principal Payment",
      "Reimbursed Expense",
      "Income Tax Payment",
    ];

    for (const category of NON_DEDUCTIBLE) {
      const s = summarizeTransactions([
        { category: "Business Income", amount: 50_000, type: "income", status: "ok" },
        { category, amount: 9_000, type: "expense", status: "ok" },
      ]);

      expect(s.scheduleCNet, `${category} must not reduce Sch C`).toBe(50_000);
      expect(s.scheduleCExpenses, `${category} is not a Sch C expense`).toBe(0);
      expect(s.totalExpenses, `${category} is not deductible`).toBe(0);
      expect(s.personalSpending, `${category} is tracked as non-deductible`).toBe(9_000);
    }
  });

  it("tagging a personal category to a business entity does not make it deductible", () => {
    const s = summarizeTransactions([
      { category: "Business Income", amount: 50_000, type: "income", status: "ok" },
      { category: "Owner Draw / Distribution", amount: 9_000, type: "expense", status: "ok", entityType: "business" },
      { category: "Groceries", amount: 500, type: "expense", status: "ok", entityType: "business" },
    ]);

    expect(s.scheduleCNet).toBe(50_000);
    expect(s.totalExpenses).toBe(0);
  });

  it("transfers never reduce Schedule C profit", () => {
    const s = summarizeTransactions([
      { category: "Business Income", amount: 50_000, type: "income", status: "ok" },
      { category: "Office Supplies", amount: 20_000, type: "transfer", status: "ok" },
    ]);

    expect(s.scheduleCNet).toBe(50_000);
    expect(s.excluded.transfers).toBe(1);
  });

  it("documents the supported Schedule C deduction categories", () => {
    const deductible = TAX_MAP
      .filter((m) => m.taxBucket === "se_expense")
      .map((m) => m.category);

    // Every one of these reduces Schedule C net profit and nothing else.
    for (const category of deductible) {
      const s = summarizeTransactions([
        { category: "Business Income", amount: 100_000, type: "income", status: "ok" },
        { category, amount: 1_000, type: "expense", status: "ok" },
      ]);
      expect(s.scheduleCNet, `${category} should reduce Sch C net`).toBe(99_000);
      expect(s.scheduleADeductions).toBe(0);
      expect(s.scheduleEExpenses).toBe(0);
    }

    expect(deductible).toContain("Office Supplies");
    expect(deductible).toContain("Business Meals");
    expect(deductible.length).toBeGreaterThanOrEqual(20);
  });
});

describe("unknown categories stay review-required", () => {
  it("does not recognize a category outside the tax map", () => {
    expect(isValidCategory("Crypto Mining Rig")).toBe(false);
  });

  it("falls back to personal for an unknown expense — never a silent deduction", () => {
    // The safe direction: an unrecognized expense must not claim a deduction.
    expect(getTaxBucket({ category: "Crypto Mining Rig", type: "expense" })).toBe("personal");

    const s = summarizeTransactions([
      { category: "Business Income", amount: 50_000, type: "income", status: "ok" },
      { category: "Crypto Mining Rig", amount: 5_000, type: "expense", status: "ok" },
    ]);
    expect(s.scheduleCNet).toBe(50_000);
    expect(s.totalExpenses).toBe(0);
  });

  it("keeps an unreviewed row out of every lane until the user confirms it", () => {
    const s = summarizeTransactions([
      { category: "Business Income", amount: 50_000, type: "income", status: "needs_review" },
    ]);
    expect(s.totalIncome).toBe(0);
    expect(s.scheduleCNet).toBe(0);
    expect(s.excluded.needsReview).toBe(1);
  });

  it("counts an uncategorized row instead of guessing a lane for it", () => {
    const s = summarizeTransactions([{ amount: 5_000, type: "expense", status: "ok" }]);
    expect(s.excluded.uncategorized).toBe(1);
    expect(s.totalExpenses).toBe(0);
  });
});

describe("full matrix — every category lands in exactly one lane", () => {
  it("no category contributes to both Schedule C and Schedule E", () => {
    for (const m of TAX_MAP) {
      const type = m.group === "Income" ? "income" : "expense";
      const l = lanesFor(m.category, type);

      const touchesC = l.scheduleCNet !== 0;
      const touchesE = l.scheduleENet !== 0;
      expect(touchesC && touchesE, `${m.category} touches both C and E`).toBe(false);
    }
  });

  it("only se_income categories produce a self-employment tax base", () => {
    for (const m of TAX_MAP) {
      const type = m.group === "Income" ? "income" : "expense";
      const l = lanesFor(m.category, type);
      const expected = m.taxBucket === "se_income" ? AMOUNT : 0;
      expect(l.seTaxBase, `${m.category} SE base`).toBe(expected);
    }
  });

  it("personal categories touch no tax lane at all", () => {
    for (const m of TAX_MAP.filter((x) => x.taxBucket === "personal")) {
      const l = lanesFor(m.category, "expense");
      expect(l.scheduleCNet, m.category).toBe(0);
      expect(l.scheduleENet, m.category).toBe(0);
      expect(l.seTaxBase, m.category).toBe(0);
      expect(l.agi, m.category).toBe(0);
    }
  });
});
