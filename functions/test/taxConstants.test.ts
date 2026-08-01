import { describe, it, expect } from "vitest";
import {
  BRACKETS_BY_YEAR,
  QBI_THRESHOLD_BY_YEAR,
  SS_WAGE_BASE_BY_YEAR,
  STANDARD_DEDUCTION_BY_YEAR,
  applyBrackets,
  businessMileageRate,
  effectiveTaxYear,
  federalIncomeTax,
  normalizeFilingStatus,
  nextQuarterlyDueDate,
  quarterlyDueDates,
  selfEmploymentTax,
  FILING_STATUSES,
} from "../src/shared/taxConstants";

// ─── Published figures ────────────────────────────────────────────────────────
// These lock in numbers verified against IRS.gov / SSA.gov. A failure here means
// either someone edited a table without re-checking the source, or the IRS
// published a change that needs a deliberate update.

describe("published IRS/SSA figures", () => {
  it("uses the OBBBA 2025 standard deduction for all five filing statuses", () => {
    // Rev. Proc. 2024-40 originally said 15,000 / 30,000 / 22,500. The One Big
    // Beautiful Bill Act raised them retroactively for tax year 2025.
    // Verified against the 2025 Instructions for Form 1040 standard deduction
    // chart: "Single or Married filing separately $15,750; Married filing
    // jointly or Qualifying surviving spouse $31,500; Head of household
    // $23,625."
    expect(STANDARD_DEDUCTION_BY_YEAR[2025]).toEqual({
      single: 15750,
      married_separately: 15750,
      married_jointly: 31500,
      qualifying_surviving_spouse: 31500,
      head_of_household: 23625,
    });
  });

  it("has no filing status left on the superseded pre-OBBBA 2025 amounts", () => {
    const superseded = [15000, 30000, 22500];
    for (const status of FILING_STATUSES) {
      expect(superseded, `${status} still on a pre-OBBBA amount`)
        .not.toContain(STANDARD_DEDUCTION_BY_YEAR[2025][status]);
    }
  });

  it("has the 2024 and 2026 standard deductions", () => {
    expect(STANDARD_DEDUCTION_BY_YEAR[2024].single).toBe(14600);
    expect(STANDARD_DEDUCTION_BY_YEAR[2024].married_jointly).toBe(29200);
    expect(STANDARD_DEDUCTION_BY_YEAR[2026].single).toBe(16100);
    expect(STANDARD_DEDUCTION_BY_YEAR[2026].married_jointly).toBe(32200);
    expect(STANDARD_DEDUCTION_BY_YEAR[2026].head_of_household).toBe(24150);
  });

  it("has the 2025 rate thresholds for every filing status", () => {
    const t = (s: keyof (typeof BRACKETS_BY_YEAR)[2025]) =>
      BRACKETS_BY_YEAR[2025][s].map((b) => b.max);

    expect(t("single")).toEqual([11925, 48475, 103350, 197300, 250525, 626350, Infinity]);
    expect(t("married_jointly")).toEqual([23850, 96950, 206700, 394600, 501050, 751600, Infinity]);
    expect(t("married_separately")).toEqual([11925, 48475, 103350, 197300, 250525, 375800, Infinity]);
    expect(t("head_of_household")).toEqual([17000, 64850, 103350, 197300, 250500, 626350, Infinity]);
  });

  it("has the 2026 rate thresholds from Rev. Proc. 2025-32", () => {
    const t = (s: keyof (typeof BRACKETS_BY_YEAR)[2026]) =>
      BRACKETS_BY_YEAR[2026][s].map((b) => b.max);

    expect(t("single")).toEqual([12400, 50400, 105700, 201775, 256225, 640600, Infinity]);
    expect(t("married_jointly")).toEqual([24800, 100800, 211400, 403550, 512450, 768700, Infinity]);
    expect(t("married_separately")).toEqual([12400, 50400, 105700, 201775, 256225, 384350, Infinity]);
    expect(t("head_of_household")).toEqual([17700, 67450, 105700, 201750, 256200, 640600, Infinity]);
  });

  it("has the Social Security wage base for each year", () => {
    expect(SS_WAGE_BASE_BY_YEAR[2024]).toBe(168600);
    expect(SS_WAGE_BASE_BY_YEAR[2025]).toBe(176100);
    expect(SS_WAGE_BASE_BY_YEAR[2026]).toBe(184500);
  });

  it("has the QBI threshold amounts", () => {
    expect(QBI_THRESHOLD_BY_YEAR[2025].single).toBe(197300);
    expect(QBI_THRESHOLD_BY_YEAR[2025].married_jointly).toBe(394600);
    expect(QBI_THRESHOLD_BY_YEAR[2026].married_jointly).toBe(403500);
  });

  it("resolves the business standard mileage rate, including the 2026 mid-year split", () => {
    expect(businessMileageRate("2024-05-01")).toBeCloseTo(0.67, 5);
    expect(businessMileageRate("2025-06-15")).toBeCloseTo(0.70, 5);
    expect(businessMileageRate("2026-03-01")).toBeCloseTo(0.725, 5);
    expect(businessMileageRate("2026-07-01")).toBeCloseTo(0.76, 5);
  });

  it("gives a qualifying surviving spouse the married-filing-jointly tables", () => {
    for (const year of [2024, 2025, 2026]) {
      expect(BRACKETS_BY_YEAR[year].qualifying_surviving_spouse)
        .toEqual(BRACKETS_BY_YEAR[year].married_jointly);
      expect(STANDARD_DEDUCTION_BY_YEAR[year].qualifying_surviving_spouse)
        .toBe(STANDARD_DEDUCTION_BY_YEAR[year].married_jointly);
    }
  });

  it("covers every filing status in every year-indexed table", () => {
    for (const year of [2024, 2025, 2026]) {
      for (const status of FILING_STATUSES) {
        expect(BRACKETS_BY_YEAR[year][status], `brackets ${year} ${status}`).toBeDefined();
        expect(STANDARD_DEDUCTION_BY_YEAR[year][status], `std ded ${year} ${status}`).toBeDefined();
        expect(QBI_THRESHOLD_BY_YEAR[year][status], `qbi ${year} ${status}`).toBeDefined();
      }
    }
  });
});

// ─── D1: married filing separately ────────────────────────────────────────────

describe("filing status brackets (D1)", () => {
  it("taxes an MFS filer substantially more than an MFJ filer at the same taxable income", () => {
    // The old code routed MFS to the MFJ table, understating tax badly at the
    // upper end because MFJ bracket widths are roughly double MFS.
    const mfj = federalIncomeTax(500_000, "married_jointly", 2025).tax;
    const mfs = federalIncomeTax(500_000, "married_separately", 2025).tax;

    expect(mfj).toBeCloseTo(114_126, 2);
    expect(mfs).toBeCloseTo(147_031.25, 2);
    expect(mfs).toBeGreaterThan(mfj);
  });

  it("matches single for MFS below the point where the tables diverge", () => {
    // MFS and single share thresholds until the 35% band.
    expect(federalIncomeTax(200_000, "married_separately", 2025).tax)
      .toBeCloseTo(federalIncomeTax(200_000, "single", 2025).tax, 6);
  });

  it("reports the marginal rate actually reached", () => {
    expect(federalIncomeTax(50_000, "single", 2025).marginalRate).toBe(0.22);
    expect(federalIncomeTax(11_000, "single", 2025).marginalRate).toBe(0.10);
    expect(federalIncomeTax(0, "single", 2025).marginalRate).toBe(0.10);
  });

  it("returns zero tax on zero or negative taxable income", () => {
    expect(federalIncomeTax(0, "single", 2025).tax).toBe(0);
    expect(federalIncomeTax(-5000, "single", 2025).tax).toBe(0);
  });

  it("applies brackets progressively, not as a flat rate on the whole amount", () => {
    // 2025 single: 10% on the first 11,925, then 12% on the next 36,550.
    const { tax } = applyBrackets(20_000, BRACKETS_BY_YEAR[2025].single);
    expect(tax).toBeCloseTo(11_925 * 0.10 + (20_000 - 11_925) * 0.12, 6);
  });
});

// ─── D2: filing status validation ─────────────────────────────────────────────

describe("normalizeFilingStatus (D2)", () => {
  it("accepts both vocabularies the app has used", () => {
    expect(normalizeFilingStatus("married_jointly")).toBe("married_jointly");
    expect(normalizeFilingStatus("married_filing_jointly")).toBe("married_jointly");
    expect(normalizeFilingStatus("MFJ")).toBe("married_jointly");
    expect(normalizeFilingStatus("married filing separately")).toBe("married_separately");
    expect(normalizeFilingStatus("head-of-household")).toBe("head_of_household");
    expect(normalizeFilingStatus("qualifying_surviving_spouse")).toBe("qualifying_surviving_spouse");
  });

  it("rejects rather than silently defaulting to single", () => {
    // Silently defaulting is what produced confidently wrong numbers before.
    expect(normalizeFilingStatus("married")).toBeNull();
    expect(normalizeFilingStatus("")).toBeNull();
    expect(normalizeFilingStatus(undefined)).toBeNull();
    expect(normalizeFilingStatus(null)).toBeNull();
    expect(normalizeFilingStatus(42)).toBeNull();
  });
});

// ─── Self-employment tax ──────────────────────────────────────────────────────

describe("selfEmploymentTax", () => {
  it("computes SE tax on 92.35% of net profit at 15.3%", () => {
    const { seTax, deductiblePortion } = selfEmploymentTax(100_000, 2025);
    const netEarnings = 100_000 * 0.9235;
    expect(seTax).toBeCloseTo(netEarnings * 0.124 + netEarnings * 0.029, 6);
    expect(deductiblePortion).toBeCloseTo(seTax / 2, 6);
  });

  it("caps the Social Security portion at the wage base", () => {
    const { seTax } = selfEmploymentTax(300_000, 2025);
    const netEarnings = 300_000 * 0.9235;
    expect(seTax).toBeCloseTo(176_100 * 0.124 + netEarnings * 0.029, 6);
  });

  it("lets W-2 wages consume the wage base first", () => {
    // With W-2 wages already over the base, SE earnings owe Medicare only.
    const { seTax } = selfEmploymentTax(50_000, 2025, 200_000);
    expect(seTax).toBeCloseTo(50_000 * 0.9235 * 0.029, 6);
  });

  it("is zero on a loss", () => {
    expect(selfEmploymentTax(-10_000, 2025).seTax).toBe(0);
    expect(selfEmploymentTax(0, 2025).seTax).toBe(0);
  });
});

// ─── Quarterly estimated tax dates ────────────────────────────────────────────

describe("quarterlyDueDates", () => {
  it("shifts 2025 Q2 off the Sunday to June 16", () => {
    expect(quarterlyDueDates(2025).map((q) => q.dueDate)).toEqual([
      "2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15",
    ]);
  });

  it("leaves 2026 unshifted — every statutory date is a weekday", () => {
    expect(quarterlyDueDates(2026).map((q) => q.dueDate)).toEqual([
      "2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15",
    ]);
  });

  it("computes 2027 Q2 as June 15, not the hard-coded June 16 it used to be", () => {
    expect(quarterlyDueDates(2027)[1].dueDate).toBe("2027-06-15");
  });

  it("rolls past a Saturday AND the MLK holiday that follows it", () => {
    // Jan 15 2028 is a Saturday; Jan 17 is the third Monday (MLK Day).
    expect(quarterlyDueDates(2027)[3].dueDate).toBe("2028-01-18");
  });

  it("respects DC Emancipation Day when it lands on the April 15 deadline", () => {
    // Apr 16 2022 was a Saturday, so Emancipation Day was observed Friday
    // Apr 15 — pushing the deadline to Monday Apr 18, as the IRS announced.
    expect(quarterlyDueDates(2022)[0].dueDate).toBe("2022-04-18");
    // Apr 15 2023 was a Saturday and Emancipation Day was observed Monday
    // Apr 17, so the deadline was Tuesday Apr 18.
    expect(quarterlyDueDates(2023)[0].dueDate).toBe("2023-04-18");
  });

  it("keeps the unshifted statutory date alongside the adjusted one", () => {
    const q2 = quarterlyDueDates(2025)[1];
    expect(q2.statutoryDate).toBe("2025-06-15");
    expect(q2.dueDate).toBe("2025-06-16");
  });
});

describe("nextQuarterlyDueDate", () => {
  it("returns the next open deadline mid-year", () => {
    expect(nextQuarterlyDueDate(2025, "2025-05-01")?.label).toBe("Q2");
    expect(nextQuarterlyDueDate(2025, "2025-06-16")?.label).toBe("Q2");
    expect(nextQuarterlyDueDate(2025, "2025-06-17")?.label).toBe("Q3");
  });

  it("returns null for a completed year instead of pointing at a past deadline", () => {
    // Telling the user Q4 is "upcoming" when it closed months ago invites a
    // late payment.
    expect(nextQuarterlyDueDate(2025, "2026-08-01")).toBeNull();
  });
});

// ─── Year fallback ────────────────────────────────────────────────────────────

describe("effectiveTaxYear", () => {
  it("uses the requested year when tables exist for it", () => {
    expect(effectiveTaxYear(2025)).toBe(2025);
    expect(effectiveTaxYear(2024)).toBe(2024);
  });

  it("falls back to the most recent known year for unpublished years", () => {
    expect(effectiveTaxYear(2030)).toBe(2026);
  });

  it("falls back for years before the tables begin rather than crashing", () => {
    expect(effectiveTaxYear(2019)).toBe(2026);
  });
});
