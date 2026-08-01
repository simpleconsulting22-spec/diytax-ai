import { describe, it, expect } from "vitest";
import { quickTaxEstimate } from "../src/utils/taxEstimate";
import { computeFederalEstimate, ESTIMATE_EXCLUSIONS } from "../src/shared/taxConstants";

describe("quickTaxEstimate", () => {
  it("computes a 2025 single-filer estimate from the 2025 tables", () => {
    const e = quickTaxEstimate({ scheduleCNet: 100_000, filingStatus: "single", taxYear: 2025 });

    // SE tax on 92,350 of net earnings: 12.4% OASDI + 2.9% Medicare.
    expect(e.selfEmploymentTax).toBeCloseTo(14_129.55, 2);
    expect(e.seTaxBase).toBe(100_000);
    expect(e.taxYear).toBe(2025);
  });

  it("gives a different answer for 2024 than 2025 — the year actually matters (D4)", () => {
    const a = quickTaxEstimate({ scheduleCNet: 100_000, filingStatus: "single", taxYear: 2024 });
    const b = quickTaxEstimate({ scheduleCNet: 100_000, filingStatus: "single", taxYear: 2025 });
    expect(a.totalTax).not.toBeCloseTo(b.totalTax, 2);
  });

  it("taxes a married-filing-separately filer more than married-filing-jointly (D1)", () => {
    const mfj = quickTaxEstimate({ scheduleCNet: 600_000, filingStatus: "married_jointly", taxYear: 2025 });
    const mfs = quickTaxEstimate({ scheduleCNet: 600_000, filingStatus: "married_separately", taxYear: 2025 });
    expect(mfs.totalTax).toBeGreaterThan(mfj.totalTax);
  });

  it("accepts the forecast pages' vocabulary as well as the profile's", () => {
    const a = quickTaxEstimate({ scheduleCNet: 80_000, filingStatus: "married_jointly", taxYear: 2025 });
    const b = quickTaxEstimate({ scheduleCNet: 80_000, filingStatus: "married_filing_jointly", taxYear: 2025 });
    expect(b.totalTax).toBeCloseTo(a.totalTax, 6);
    expect(b.filingStatus).toBe("married_jointly");
  });

  it("supports head of household with its own brackets and deduction", () => {
    const hoh = quickTaxEstimate({ scheduleCNet: 120_000, filingStatus: "head_of_household", taxYear: 2025 });
    const single = quickTaxEstimate({ scheduleCNet: 120_000, filingStatus: "single", taxYear: 2025 });
    expect(hoh.filingStatus).toBe("head_of_household");
    expect(hoh.totalTax).toBeLessThan(single.totalTax);
  });

  it("falls back to single for an unusable profile value rather than throwing", () => {
    // Scheduled-notification path: a bad profile field must not break the
    // morning push for everyone else.
    expect(
      quickTaxEstimate({ scheduleCNet: 50_000, filingStatus: "not_a_status", taxYear: 2025 }).filingStatus
    ).toBe("single");
  });

  it("charges SE tax on Schedule C net only, never on wages or portfolio income", () => {
    const e = quickTaxEstimate({
      scheduleCNet: 0,
      w2Wages: 150_000,
      otherOrdinaryIncome: 40_000,
      scheduleENet: 25_000,
      filingStatus: "single",
      taxYear: 2025,
    });
    expect(e.seTaxBase).toBe(0);
    expect(e.selfEmploymentTax).toBe(0);
    // But the income is still taxed as ordinary income.
    expect(e.federalTax).toBeGreaterThan(0);
  });

  it("reports a zero effective rate when there is no income", () => {
    const e = quickTaxEstimate({ scheduleCNet: 0, filingStatus: "single", taxYear: 2025 });
    expect(e.totalTax).toBe(0);
    expect(e.effectiveRate).toBe(0);
  });

  it("uses the latest known tables for a year the IRS has not published", () => {
    expect(quickTaxEstimate({ scheduleCNet: 50_000, filingStatus: "single", taxYear: 2031 }).taxYear).toBe(2026);
  });
});

// ─── QBI: no silent cliff ─────────────────────────────────────────────────────

describe("QBI deduction status", () => {
  it("computes the 20% deduction below the § 199A threshold", () => {
    const e = computeFederalEstimate({
      scheduleCNet: 100_000, scheduleENet: 0, w2Wages: 0, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(e.qbiStatus).toBe("calculated");
    expect(e.qbiDeduction).toBeGreaterThan(0);
    // 20% of QBI, capped at 20% of taxable income before the QBI deduction.
    expect(e.qbiDeduction).toBeCloseTo(
      Math.min(100_000 * 0.2, Math.max(0, e.agi - e.deductionUsed) * 0.2), 2
    );
  });

  it("does NOT present a calculated deduction above the threshold", () => {
    // Above the threshold the deduction depends on W-2 wages paid and UBIA of
    // qualified property, which this app does not collect. Reporting $0 as if
    // it were computed is the "cliff" that had to go — the status now says so.
    const e = computeFederalEstimate({
      scheduleCNet: 400_000, scheduleENet: 0, w2Wages: 0, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(e.agi).toBeGreaterThan(197_300);
    expect(e.qbiStatus).toBe("not_calculated_above_threshold");
    expect(e.qbiDeduction).toBe(0);
  });

  it("reports no QBI when there is no qualified business income", () => {
    const e = computeFederalEstimate({
      scheduleCNet: 0, scheduleENet: 30_000, w2Wages: 80_000, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(e.qbiStatus).toBe("none");
    expect(e.qbiDeduction).toBe(0);
  });

  it("does not grant QBI on rental income — that needs a safe-harbor election", () => {
    const e = computeFederalEstimate({
      scheduleCNet: 0, scheduleENet: 50_000, w2Wages: 0, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(e.qbiDeduction).toBe(0);
    expect(e.qbiStatus).toBe("none");
  });
});

describe("estimate disclosures", () => {
  it("names the things the estimate cannot compute", () => {
    const joined = ESTIMATE_EXCLUSIONS.join(" | ").toLowerCase();
    for (const topic of ["state", "credit", "capital gains", "qbi", "salt", "net operating loss", "alternative minimum"]) {
      expect(joined, `exclusions should mention ${topic}`).toContain(topic);
    }
  });

  it("mentions the OBBBA deductions that are not modeled", () => {
    const joined = ESTIMATE_EXCLUSIONS.join(" | ").toLowerCase();
    expect(joined).toContain("senior");
    expect(joined).toContain("tips");
    expect(joined).toContain("overtime");
    expect(joined).toContain("auto-loan-interest");
  });
});

// ─── Itemized vs standard, and AGI assembly ───────────────────────────────────

describe("deduction selection and AGI", () => {
  it("uses itemized deductions only when they beat the standard deduction", () => {
    const small = computeFederalEstimate({
      scheduleCNet: 80_000, scheduleENet: 0, w2Wages: 0, otherOrdinaryIncome: 0,
      itemizedDeductions: 5_000, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(small.usingItemized).toBe(false);
    expect(small.deductionUsed).toBe(15_750);

    const large = computeFederalEstimate({
      scheduleCNet: 80_000, scheduleENet: 0, w2Wages: 0, otherOrdinaryIncome: 0,
      itemizedDeductions: 25_000, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(large.usingItemized).toBe(true);
    expect(large.deductionUsed).toBe(25_000);
  });

  it("lets a Schedule C loss offset wages in AGI", () => {
    const e = computeFederalEstimate({
      scheduleCNet: -20_000, scheduleENet: 0, w2Wages: 100_000, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(e.agi).toBe(80_000);
    expect(e.seTax).toBe(0); // no SE tax on a loss
  });

  it("floors AGI at zero — NOL carryforward is not modeled", () => {
    const e = computeFederalEstimate({
      scheduleCNet: -90_000, scheduleENet: 0, w2Wages: 30_000, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(e.agi).toBe(0);
    expect(e.totalTax).toBe(0);
  });
});
