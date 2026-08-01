import { describe, it, expect } from "vitest";
import { quickTaxEstimate } from "../src/utils/taxEstimate";

describe("quickTaxEstimate", () => {
  it("computes a 2025 single-filer estimate from the 2025 tables", () => {
    const e = quickTaxEstimate(100_000, 0, "single", 2025);

    // SE tax on 92,350 of net earnings: 12.4% OASDI + 2.9% Medicare.
    expect(e.selfEmploymentTax).toBeCloseTo(14_129.55, 2);
    // AGI 92,935.225 − 15,750 standard deduction = 77,185.225 taxable.
    expect(e.federalTax).toBeCloseTo(11_894.7495, 2);
    expect(e.totalTax).toBeCloseTo(26_024.2995, 2);
    expect(e.taxYear).toBe(2025);
  });

  it("gives a different answer for 2024 than 2025 — the year actually matters (D4)", () => {
    // The old file hard-coded 2024 constants, so selecting a year changed
    // nothing. These must differ: the standard deduction and brackets moved.
    const a = quickTaxEstimate(100_000, 0, "single", 2024);
    const b = quickTaxEstimate(100_000, 0, "single", 2025);
    expect(a.totalTax).not.toBeCloseTo(b.totalTax, 2);
  });

  it("taxes a married-filing-separately filer more than married-filing-jointly (D1)", () => {
    // MFS was routed to the MFJ bracket table, understating tax materially.
    const mfj = quickTaxEstimate(600_000, 0, "married_jointly", 2025);
    const mfs = quickTaxEstimate(600_000, 0, "married_separately", 2025);
    expect(mfs.totalTax).toBeGreaterThan(mfj.totalTax);
  });

  it("accepts the forecast pages' vocabulary as well as the profile's", () => {
    const a = quickTaxEstimate(80_000, 0, "married_jointly", 2025);
    const b = quickTaxEstimate(80_000, 0, "married_filing_jointly", 2025);
    expect(b.totalTax).toBeCloseTo(a.totalTax, 6);
    expect(b.filingStatus).toBe("married_jointly");
  });

  it("supports head of household with its own brackets and deduction", () => {
    const hoh = quickTaxEstimate(120_000, 0, "head_of_household", 2025);
    const single = quickTaxEstimate(120_000, 0, "single", 2025);
    expect(hoh.filingStatus).toBe("head_of_household");
    expect(hoh.totalTax).toBeLessThan(single.totalTax);
  });

  it("falls back to single for an unusable profile value rather than throwing", () => {
    // This is the scheduled-notification path; a bad profile field must not
    // break the morning push for everyone else.
    expect(quickTaxEstimate(50_000, 0, "not_a_status", 2025).filingStatus).toBe("single");
  });

  it("lets W-2 wages consume the Social Security wage base first", () => {
    // With W-2 wages already past the base, SE earnings owe Medicare only.
    const e = quickTaxEstimate(50_000, 200_000, "single", 2025);
    expect(e.selfEmploymentTax).toBeCloseTo(50_000 * 0.9235 * 0.029, 2);
  });

  it("reports a zero effective rate when there is no income", () => {
    const e = quickTaxEstimate(0, 0, "single", 2025);
    expect(e.totalTax).toBe(0);
    expect(e.effectiveRate).toBe(0);
  });

  it("uses the latest known tables for a year the IRS has not published", () => {
    expect(quickTaxEstimate(50_000, 0, "single", 2031).taxYear).toBe(2026);
  });
});
