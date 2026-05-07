// Pure tax estimation functions — no React, no Firestore, fully testable.
// IRS figures keyed by tax year; the calculator picks the right table based
// on input.taxYear and falls back to the most recent known year for unknown
// future years (so a 2027 estimate before the IRS publishes 2027 numbers
// uses the latest available figures rather than crashing).

import { getTaxBucket } from "../../shared/taxMap";

export type FilingStatus =
  | "single"
  | "married_jointly"
  | "married_separately"
  | "head_of_household";

export interface TaxableTransaction {
  amount: number;
  type: "income" | "expense" | "refund" | "transfer";
  taxSchedule: string | null;
  taxCategory?: string | null;
  category?: string | null;
  /** Entity assignment drives whether business/rental categories actually
   *  flow into Schedule C / Sch E or get demoted to personal. See taxMap.ts. */
  entityType?: "business" | "rental" | "personal" | null;
  status: string;
  taxYear?: number | null;
  date?: string;
}

export interface TaxEstimateInput {
  transactions: TaxableTransaction[];
  scheduleAManualDeductions: number;
  filingStatus: FilingStatus;
  w2Income: number;
  iraContributions: number;
  taxYear: number;
}

export interface TaxEstimate {
  grossIncome: number;
  scheduleCNet: number;
  scheduleCIncome: number;
  scheduleCExpenses: number;
  w2Income: number;
  w2FromTxns: number;
  seTax: number;
  seDeduction: number;
  agi: number;
  qbiDeduction: number;
  standardDeduction: number;
  itemizedDeduction: number;
  deductionUsed: number;
  usingItemized: boolean;
  taxableIncome: number;
  federalTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  /** Year whose IRS tables were actually used (input year if known, else most recent). */
  taxYear: number;
  /** Social Security wage base for the year (used in the SE tax explainer). */
  ssWageBase: number;
  breakdown: {
    federal: number;
    selfEmployment: number;
    state: number;
  };
}

interface Bracket {
  max: number;
  rate: number;
}

// ─── Year-keyed IRS tables ────────────────────────────────────────────────────
// 2024: Rev. Proc. 2023-34
// 2025: Rev. Proc. 2024-40
// 2026: Rev. Proc. 2025-32
// Falls back to the most recent known year for years not yet in this table.

const BRACKETS_BY_YEAR: Record<number, Record<FilingStatus, Bracket[]>> = {
  2024: {
    single: [
      { max: 11600, rate: 0.10 }, { max: 47150, rate: 0.12 },
      { max: 100525, rate: 0.22 }, { max: 191950, rate: 0.24 },
      { max: 243725, rate: 0.32 }, { max: 609350, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_jointly: [
      { max: 23200, rate: 0.10 }, { max: 94300, rate: 0.12 },
      { max: 201050, rate: 0.22 }, { max: 383900, rate: 0.24 },
      { max: 487450, rate: 0.32 }, { max: 731200, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_separately: [
      { max: 11600, rate: 0.10 }, { max: 47150, rate: 0.12 },
      { max: 100525, rate: 0.22 }, { max: 191950, rate: 0.24 },
      { max: 243725, rate: 0.32 }, { max: 365600, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { max: 16550, rate: 0.10 }, { max: 63100, rate: 0.12 },
      { max: 100500, rate: 0.22 }, { max: 191950, rate: 0.24 },
      { max: 243700, rate: 0.32 }, { max: 609350, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
  },
  2025: {
    single: [
      { max: 11925, rate: 0.10 }, { max: 48475, rate: 0.12 },
      { max: 103350, rate: 0.22 }, { max: 197300, rate: 0.24 },
      { max: 250525, rate: 0.32 }, { max: 626350, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_jointly: [
      { max: 23850, rate: 0.10 }, { max: 96950, rate: 0.12 },
      { max: 206700, rate: 0.22 }, { max: 394600, rate: 0.24 },
      { max: 501050, rate: 0.32 }, { max: 751600, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_separately: [
      { max: 11925, rate: 0.10 }, { max: 48475, rate: 0.12 },
      { max: 103350, rate: 0.22 }, { max: 197300, rate: 0.24 },
      { max: 250525, rate: 0.32 }, { max: 375800, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { max: 17000, rate: 0.10 }, { max: 64850, rate: 0.12 },
      { max: 103350, rate: 0.22 }, { max: 197300, rate: 0.24 },
      { max: 250500, rate: 0.32 }, { max: 626350, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
  },
  2026: {
    single: [
      { max: 12275, rate: 0.10 }, { max: 49950, rate: 0.12 },
      { max: 106400, rate: 0.22 }, { max: 203200, rate: 0.24 },
      { max: 258000, rate: 0.32 }, { max: 645250, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_jointly: [
      { max: 24550, rate: 0.10 }, { max: 99900, rate: 0.12 },
      { max: 212800, rate: 0.22 }, { max: 406400, rate: 0.24 },
      { max: 516050, rate: 0.32 }, { max: 774300, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_separately: [
      { max: 12275, rate: 0.10 }, { max: 49950, rate: 0.12 },
      { max: 106400, rate: 0.22 }, { max: 203200, rate: 0.24 },
      { max: 258000, rate: 0.32 }, { max: 387150, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { max: 17500, rate: 0.10 }, { max: 66800, rate: 0.12 },
      { max: 106400, rate: 0.22 }, { max: 203200, rate: 0.24 },
      { max: 258000, rate: 0.32 }, { max: 645250, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
  },
};

const STANDARD_DEDUCTIONS_BY_YEAR: Record<number, Record<FilingStatus, number>> = {
  2024: { single: 14600, married_jointly: 29200, married_separately: 14600, head_of_household: 21900 },
  2025: { single: 15000, married_jointly: 30000, married_separately: 15000, head_of_household: 22500 },
  2026: { single: 16100, married_jointly: 32200, married_separately: 16100, head_of_household: 24150 },
};

// QBI Section 199A taxable-income phase-in thresholds (start of phase-in).
const QBI_THRESHOLDS_BY_YEAR: Record<number, Record<FilingStatus, number>> = {
  2024: { single: 191950, married_jointly: 383900, married_separately: 191950, head_of_household: 191950 },
  2025: { single: 197300, married_jointly: 394600, married_separately: 197300, head_of_household: 197300 },
  2026: { single: 211250, married_jointly: 422500, married_separately: 211250, head_of_household: 211250 },
};

const SS_WAGE_BASE_BY_YEAR: Record<number, number> = {
  2024: 168600,
  2025: 176100,
  2026: 184500,
};

/** Picks the table for `year`, falling back to the most recent known year. */
function pickYear<T>(year: number, table: Record<number, T>): T {
  if (table[year]) return table[year];
  const known = Object.keys(table).map(Number).sort((a, b) => b - a);
  return table[known[0]];
}

/** Public — used by the meter UI to label "How is this calculated (YYYY rules)". */
export function effectiveTaxYear(year: number): number {
  if (BRACKETS_BY_YEAR[year]) return year;
  const known = Object.keys(BRACKETS_BY_YEAR).map(Number).sort((a, b) => b - a);
  return known[0];
}

function applyBrackets(
  income: number,
  brackets: Bracket[]
): { tax: number; marginalRate: number } {
  if (income <= 0) return { tax: 0, marginalRate: brackets[0].rate };
  let tax = 0;
  let prev = 0;
  let marginalRate = brackets[0].rate;
  for (const bracket of brackets) {
    if (income <= prev) break;
    const taxable = Math.min(income, bracket.max) - prev;
    tax += taxable * bracket.rate;
    marginalRate = bracket.rate;
    prev = bracket.max;
    if (income <= bracket.max) break;
  }
  return { tax, marginalRate };
}

export function calculateTaxEstimate(input: TaxEstimateInput): TaxEstimate {
  const { transactions, scheduleAManualDeductions, filingStatus, w2Income, iraContributions, taxYear } = input;
  const ssWageBase     = pickYear(taxYear, SS_WAGE_BASE_BY_YEAR);
  const standardDeduction = pickYear(taxYear, STANDARD_DEDUCTIONS_BY_YEAR)[filingStatus];
  const qbiThreshold   = pickYear(taxYear, QBI_THRESHOLDS_BY_YEAR)[filingStatus];
  const brackets       = pickYear(taxYear, BRACKETS_BY_YEAR)[filingStatus];

  // Aggregate from transactions (skip needs_review and transfers)
  let scheduleCIncome = 0;
  let scheduleCExpenses = 0;
  let scheduleAFromTxns = 0;
  let totalTxnIncome = 0;
  let w2FromTxns = 0; // Ordinary (non-SE, non-rental) income: W-2 wages, interest, dividends, etc.

  for (const txn of transactions) {
    // Skip transfers (filter on `type`, not legacy `status === "transfer"` —
    // unified ingest writes status="needs_review"/"auto_resolved" with
    // type="transfer", so the legacy status check missed every new transfer
    // and they leaked into the tax estimate).
    if (txn.type === "transfer") continue;
    if (txn.status === "needs_review") continue;
    const abs = Math.abs(txn.amount);
    const amt = txn.amount > 0 ? txn.amount : abs;
    const bucket = getTaxBucket(txn);

    if (txn.type === "income") {
      totalTxnIncome += amt;
      // Route income by canonical bucket. Anything that isn't self-employment
      // or rental flows into AGI as ordinary income (W-2 wages, interest,
      // dividends, "Other Income", etc.).
      if (bucket === "se_income") {
        scheduleCIncome += amt;
      } else if (bucket !== "rental_income") {
        w2FromTxns += amt;
      }
      // rental_income is dropped — Schedule E isn't folded into the meter yet.
    } else if (txn.type === "expense") {
      if (bucket === "se_expense") scheduleCExpenses += abs;
      else if (bucket === "itemized_deduction") scheduleAFromTxns += abs;
      // rental_expense and personal have no impact on the meter.
    }
  }

  const scheduleCNet = scheduleCIncome - scheduleCExpenses;
  const totalW2 = w2Income + w2FromTxns;
  const grossIncome = totalTxnIncome + w2Income;
  const itemizedDeduction = round2(scheduleAFromTxns + scheduleAManualDeductions);

  // SE Tax — only on profit
  let seTax = 0;
  let seDeduction = 0;
  if (scheduleCNet > 0) {
    const netSE = scheduleCNet * 0.9235;
    const ssTax = Math.min(netSE, ssWageBase) * 0.124;
    const medicareTax = netSE * 0.029;
    seTax = round2(ssTax + medicareTax);
    seDeduction = round2(seTax * 0.5);
  }

  // AGI — Schedule C loss offsets W-2 income, floored at 0
  const agi = Math.max(0, round2(totalW2 + scheduleCNet - seDeduction - iraContributions));

  // Deduction used (year-aware standard, itemized stays as-is)
  const deductionUsed = Math.max(standardDeduction, itemizedDeduction);
  const usingItemized = itemizedDeduction > standardDeduction;

  // QBI deduction (Sec. 199A) — 20% of positive Schedule C net, if AGI under threshold
  let qbiDeduction = 0;
  if (scheduleCNet > 0 && agi <= qbiThreshold) {
    const tentativeTaxable = Math.max(0, agi - deductionUsed);
    qbiDeduction = round2(Math.min(scheduleCNet * 0.2, tentativeTaxable * 0.2));
  }

  // Taxable income
  const taxableIncome = Math.max(0, round2(agi - qbiDeduction - deductionUsed));

  // Federal income tax (year-aware brackets resolved at the top)
  const { tax: federalTax, marginalRate } = applyBrackets(taxableIncome, brackets);

  const totalTax = round2(federalTax + seTax);
  const effectiveRate = grossIncome > 0 ? round1((totalTax / grossIncome) * 100) : 0;

  return {
    grossIncome: round2(grossIncome),
    scheduleCNet: round2(scheduleCNet),
    scheduleCIncome: round2(scheduleCIncome),
    scheduleCExpenses: round2(scheduleCExpenses),
    w2Income: round2(totalW2),
    w2FromTxns: round2(w2FromTxns),
    seTax,
    seDeduction,
    agi,
    qbiDeduction,
    standardDeduction,
    itemizedDeduction,
    deductionUsed,
    usingItemized,
    taxableIncome,
    federalTax: round2(federalTax),
    totalTax,
    effectiveRate,
    marginalRate: Math.round(marginalRate * 100),
    taxYear: effectiveTaxYear(taxYear),
    ssWageBase,
    breakdown: {
      federal: round2(federalTax),
      selfEmployment: seTax,
      state: 0,
    },
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round1(n: number) { return Math.round(n * 10) / 10; }
