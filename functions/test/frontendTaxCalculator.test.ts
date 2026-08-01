import { describe, it, expect } from "vitest";
// The frontend has no test runner of its own. The dashboard meter is
// user-facing tax code, so it is exercised here through a relative import.
// (`tsconfig.test.json` only includes src/ and test/, so this stays out of the
// deployed build — vitest resolves it at run time.)
import {
  calculateTaxEstimate,
  type TaxableTransaction,
} from "../../frontend/src/modules/dashboard/taxCalculator";
import { computeFederalEstimate } from "../src/shared/taxConstants";

const base = {
  transactions: [] as TaxableTransaction[],
  scheduleAManualDeductions: 0,
  filingStatus: "single" as const,
  w2Income: 0,
  iraContributions: 0,
  taxYear: 2025,
};

const txn = (
  category: string,
  amount: number,
  type: TaxableTransaction["type"],
  over: Partial<TaxableTransaction> = {}
): TaxableTransaction => ({
  category,
  amount,
  type,
  taxSchedule: null,
  status: "categorized",
  ...over,
});

describe("dashboard meter — lane separation", () => {
  it("charges SE tax on Schedule C net only", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Business Income", 90_000, "income"),
        txn("Office Supplies", 10_000, "expense"),
        txn("Wages & Salaries", 60_000, "income"),
        txn("Interest Income", 2_000, "income"),
        txn("Dividend Income", 3_000, "income"),
        txn("Rental Income", 24_000, "income"),
        txn("Rental Repairs & Maintenance", 4_000, "expense"),
        txn("Groceries", 5_000, "expense"),
      ],
    });

    expect(e.scheduleCNet).toBe(80_000);
    expect(e.scheduleENet).toBe(20_000);
    expect(e.w2Income).toBe(60_000);
    expect(e.otherOrdinaryIncome).toBe(5_000);

    // The assertion under audit.
    expect(e.seTaxBase).toBe(80_000);
    expect(e.seTax).toBe(Math.round(80_000 * 0.9235 * 0.153 * 100) / 100);
  });

  it("does not let interest and dividends consume the Social Security wage base", () => {
    const withInterest = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Business Income", 50_000, "income"),
        txn("Interest Income", 200_000, "income"),
      ],
    });
    const withWages = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Business Income", 50_000, "income"),
        txn("Wages & Salaries", 200_000, "income"),
      ],
    });

    expect(withInterest.seTax).toBeGreaterThan(withWages.seTax);
    expect(withWages.seTax).toBe(Math.round(50_000 * 0.9235 * 0.029 * 100) / 100);
  });

  it("keeps personal and non-deductible rows out of Schedule C", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Business Income", 50_000, "income"),
        txn("Owner Draw / Distribution", 9_000, "expense"),
        txn("Loan Principal Payment", 4_000, "expense"),
        txn("Groceries", 2_000, "expense"),
      ],
    });
    expect(e.scheduleCNet).toBe(50_000);
    expect(e.scheduleCExpenses).toBe(0);
  });

  it("excludes transfers and unreviewed rows", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Business Income", 50_000, "income"),
        txn("Business Income", 99_999, "income", { status: "needs_review" }),
        txn("Business Income", 20_000, "transfer"),
      ],
    });
    expect(e.scheduleCNet).toBe(50_000);
  });

  it("nets a refund against the Schedule C expense it reverses", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Business Income", 50_000, "income"),
        txn("Office Supplies", 5_000, "expense"),
        txn("Office Supplies", 2_000, "refund"),
      ],
    });
    expect(e.scheduleCExpenses).toBe(3_000);
    expect(e.scheduleCNet).toBe(47_000);
  });

  it("routes a rental-tagged Schedule A expense to Schedule E", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [
        txn("Rental Income", 20_000, "income"),
        txn("Mortgage Interest", 8_000, "expense", { entityType: "rental" }),
      ],
    });
    expect(e.scheduleENet).toBe(12_000);
    expect(e.itemizedDeduction).toBe(0);
  });

  it("uses the 2025 OBBBA standard deduction and reports QBI status", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [txn("Business Income", 100_000, "income")],
    });
    expect(e.standardDeduction).toBe(15_750);
    expect(e.qbiStatus).toBe("calculated");
    expect(e.exclusions.length).toBeGreaterThan(5);
  });

  it("does not present a QBI benefit above the threshold", () => {
    const e = calculateTaxEstimate({
      ...base,
      transactions: [txn("Business Income", 400_000, "income")],
    });
    expect(e.qbiStatus).toBe("not_calculated_above_threshold");
    expect(e.qbiDeduction).toBe(0);
  });

  it("agrees with the backend estimator on the same lane inputs", () => {
    // D5 was the frontend and backend disagreeing. Prove they now match.
    const txns = [
      txn("Business Income", 120_000, "income"),
      txn("Office Supplies", 15_000, "expense"),
      txn("Wages & Salaries", 65_000, "income"),
      txn("Interest Income", 3_500, "income"),
    ];
    const front = calculateTaxEstimate({ ...base, transactions: txns });

    // Same lanes, straight through the shared pipeline.
    const backend = computeFederalEstimate({
      scheduleCNet: 105_000,
      scheduleENet: 0,
      w2Wages: 65_000,
      otherOrdinaryIncome: 3_500,
      itemizedDeductions: 0,
      iraContributions: 0,
      filingStatus: "single",
      taxYear: 2025,
    });

    expect(front.totalTax).toBe(backend.totalTax);
    expect(front.seTax).toBe(backend.seTax);
    expect(front.agi).toBe(backend.agi);
    expect(front.taxableIncome).toBe(backend.taxableIncome);
  });
});
