import { describe, it, expect } from "vitest";
import { summarizeTransactions, SummarizableTransaction } from "../src/tax/summarizeTransactions";
import { TAX_MAP } from "../src/shared/taxMap";

function income(category: string, amount: number, extra: Partial<SummarizableTransaction> = {}) {
  return { category, amount, type: "income", status: "categorized", ...extra };
}
function expense(category: string, amount: number, extra: Partial<SummarizableTransaction> = {}) {
  return { category, amount, type: "expense", status: "categorized", ...extra };
}

// ─── D3: income detected by bucket, not by the literal string "Income" ────────

describe("income detection (D3)", () => {
  it("counts EVERY income category, not just the literal category \"Income\"", () => {
    // This is the regression. The old code was `if (cat === "Income")`, so all
    // of these landed in totalExpenses and vanished from totalIncome.
    const txns = [
      income("Business Income", 50_000),
      income("Wages & Salaries", 30_000),
      income("Interest Income", 500),
      income("Dividend Income", 1_200),
      income("Investment Income", 2_000),
      income("Other Income", 300),
      income("Rental Income", 18_000),
    ];

    const s = summarizeTransactions(txns);

    expect(s.totalIncome).toBe(102_000);
    expect(s.totalExpenses).toBe(0);
    expect(s.netProfit).toBe(102_000);
  });

  it("treats every category the tax map groups as Income as income", () => {
    // Guards against a new income category being added to TAX_MAP without the
    // summary learning about it.
    const incomeCategories = TAX_MAP.filter((m) => m.group === "Income").map((m) => m.category);
    expect(incomeCategories.length).toBeGreaterThan(1);

    for (const category of incomeCategories) {
      const s = summarizeTransactions([income(category, 1_000)]);
      expect(s.totalIncome, `${category} should count as income`).toBe(1_000);
      expect(s.totalExpenses, `${category} should not count as expense`).toBe(0);
    }
  });

  it("splits income into Schedule C, Schedule E and ordinary buckets", () => {
    const s = summarizeTransactions([
      income("Business Income", 50_000),
      income("Rental Income", 18_000),
      income("Wages & Salaries", 30_000),
      income("Interest Income", 500),
    ]);

    expect(s.scheduleCIncome).toBe(50_000);
    expect(s.scheduleEIncome).toBe(18_000);
    expect(s.ordinaryIncome).toBe(30_500);
    expect(s.totalIncome).toBe(98_500);
  });
});

// ─── Expense routing ──────────────────────────────────────────────────────────

describe("expense routing", () => {
  it("keeps personal spending out of deductible expenses", () => {
    const s = summarizeTransactions([
      income("Business Income", 10_000),
      expense("Office Supplies", 400),
      expense("Groceries", 900),
      expense("Dining & Restaurants", 250),
    ]);

    expect(s.totalExpenses).toBe(400);
    expect(s.personalSpending).toBe(1_150);
    expect(s.netProfit).toBe(9_600);
  });

  it("separates Schedule C, Schedule E and Schedule A deductions", () => {
    const s = summarizeTransactions([
      expense("Office Supplies", 400),
      expense("Rental Insurance", 1_200),
      expense("Charitable Contribution", 500),
    ]);

    expect(s.scheduleCExpenses).toBe(400);
    expect(s.scheduleEExpenses).toBe(1_200);
    expect(s.scheduleADeductions).toBe(500);
    expect(s.totalExpenses).toBe(2_100);
  });

  it("computes Schedule C and Schedule E net separately", () => {
    const s = summarizeTransactions([
      income("Business Income", 80_000),
      expense("Office Supplies", 5_000),
      income("Rental Income", 24_000),
      expense("Rental Repairs & Maintenance", 30_000),
    ]);

    expect(s.scheduleCNet).toBe(75_000);
    expect(s.scheduleENet).toBe(-6_000);
  });

  it("nets refunds against the expense category instead of counting them as income", () => {
    const s = summarizeTransactions([
      expense("Office Supplies", 500),
      { category: "Office Supplies", amount: 200, type: "refund", status: "categorized" },
    ]);

    expect(s.totalExpenses).toBe(300);
    expect(s.totalIncome).toBe(0);
    expect(s.byCategory).toEqual([{ category: "Office Supplies", total: 300 }]);
  });

  it("routes expenses by assigned entity — a rental-tagged Sch A expense becomes Sch E", () => {
    const s = summarizeTransactions([
      expense("Mortgage Interest", 9_000, { entityType: "rental" }),
    ]);

    expect(s.scheduleEExpenses).toBe(9_000);
    expect(s.scheduleADeductions).toBe(0);
  });
});

// ─── Phase 4: what gets excluded, and saying so ───────────────────────────────

describe("exclusions", () => {
  it("excludes transfers from both income and expenses", () => {
    const s = summarizeTransactions([
      income("Business Income", 5_000),
      { category: "Business Income", amount: 2_000, type: "transfer", status: "categorized" },
      { category: "Office Supplies", amount: 2_000, type: "transfer", status: "auto_resolved" },
    ]);

    expect(s.totalIncome).toBe(5_000);
    expect(s.totalExpenses).toBe(0);
    expect(s.excluded.transfers).toBe(2);
  });

  it("excludes unreviewed rows so unconfirmed guesses stay out of filing figures", () => {
    const s = summarizeTransactions([
      income("Business Income", 5_000),
      income("Business Income", 9_999, { status: "needs_review" }),
    ]);

    expect(s.totalIncome).toBe(5_000);
    expect(s.excluded.needsReview).toBe(1);
  });

  it("counts uncategorized rows rather than dropping them silently", () => {
    const s = summarizeTransactions([
      { amount: 100, type: "expense", status: "categorized" },
      { category: "", amount: 100, type: "expense", status: "categorized" },
    ]);

    expect(s.excluded.uncategorized).toBe(2);
    expect(s.totalExpenses).toBe(0);
  });

  it("reports the full transaction count including excluded rows", () => {
    const s = summarizeTransactions([
      income("Business Income", 5_000),
      income("Business Income", 1_000, { status: "needs_review" }),
      { category: "X", amount: 1, type: "transfer" },
    ]);

    expect(s.transactionCount).toBe(3);
  });

  it("returns zeroes for an empty year instead of throwing", () => {
    const s = summarizeTransactions([]);
    expect(s.totalIncome).toBe(0);
    expect(s.netProfit).toBe(0);
    expect(s.byCategory).toEqual([]);
  });
});
