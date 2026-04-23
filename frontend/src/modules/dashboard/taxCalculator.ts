// Pure tax estimation functions — no React, no Firestore, fully testable.
// All numbers are 2024 IRS figures.

export type FilingStatus =
  | "single"
  | "married_jointly"
  | "married_separately"
  | "head_of_household";

export interface TaxableTransaction {
  amount: number;
  type: "income" | "expense" | "refund";
  taxSchedule: string | null;
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

const BRACKETS_2024: Record<FilingStatus, Bracket[]> = {
  single: [
    { max: 11600, rate: 0.10 },
    { max: 47150, rate: 0.12 },
    { max: 100525, rate: 0.22 },
    { max: 191950, rate: 0.24 },
    { max: 243725, rate: 0.32 },
    { max: 609350, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  married_jointly: [
    { max: 23200, rate: 0.10 },
    { max: 94300, rate: 0.12 },
    { max: 201050, rate: 0.22 },
    { max: 383900, rate: 0.24 },
    { max: 487450, rate: 0.32 },
    { max: 731200, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  married_separately: [
    { max: 11600, rate: 0.10 },
    { max: 47150, rate: 0.12 },
    { max: 100525, rate: 0.22 },
    { max: 191950, rate: 0.24 },
    { max: 243725, rate: 0.32 },
    { max: 609350, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { max: 16550, rate: 0.10 },
    { max: 63100, rate: 0.12 },
    { max: 100500, rate: 0.22 },
    { max: 191950, rate: 0.24 },
    { max: 243700, rate: 0.32 },
    { max: 609350, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
};

const STANDARD_DEDUCTIONS_2024: Record<FilingStatus, number> = {
  single: 14600,
  married_jointly: 29200,
  married_separately: 14600,
  head_of_household: 21900,
};

const QBI_AGI_THRESHOLDS_2024: Record<FilingStatus, number> = {
  single: 182050,
  married_jointly: 364200,
  married_separately: 91025,
  head_of_household: 182050,
};

const SS_WAGE_BASE_2024 = 168600;

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
  const { transactions, scheduleAManualDeductions, filingStatus, w2Income, iraContributions } = input;

  // Aggregate from transactions (skip needs_review and transfers)
  let scheduleCIncome = 0;
  let scheduleCExpenses = 0;
  let scheduleAFromTxns = 0;
  let totalTxnIncome = 0;

  for (const txn of transactions) {
    if (txn.status === "needs_review" || txn.status === "transfer") continue;
    const abs = Math.abs(txn.amount);

    if (txn.type === "income") {
      totalTxnIncome += txn.amount > 0 ? txn.amount : abs;
    }
    if (txn.taxSchedule === "Schedule C") {
      if (txn.type === "income") scheduleCIncome += txn.amount > 0 ? txn.amount : abs;
      else if (txn.type === "expense") scheduleCExpenses += abs;
    }
    if (txn.taxSchedule === "Schedule A" && txn.type === "expense") {
      scheduleAFromTxns += abs;
    }
  }

  const scheduleCNet = scheduleCIncome - scheduleCExpenses;
  const grossIncome = totalTxnIncome + w2Income;
  const itemizedDeduction = round2(scheduleAFromTxns + scheduleAManualDeductions);

  // SE Tax — only on profit
  let seTax = 0;
  let seDeduction = 0;
  if (scheduleCNet > 0) {
    const netSE = scheduleCNet * 0.9235;
    const ssTax = Math.min(netSE, SS_WAGE_BASE_2024) * 0.124;
    const medicareTax = netSE * 0.029;
    seTax = round2(ssTax + medicareTax);
    seDeduction = round2(seTax * 0.5);
  }

  // AGI — Schedule C loss offsets W-2 income, floored at 0
  const agi = Math.max(0, round2(w2Income + scheduleCNet - seDeduction - iraContributions));

  // Deduction used
  const standardDeduction = STANDARD_DEDUCTIONS_2024[filingStatus];
  const deductionUsed = Math.max(standardDeduction, itemizedDeduction);
  const usingItemized = itemizedDeduction > standardDeduction;

  // QBI deduction (Sec. 199A) — 20% of positive Schedule C net, if AGI under threshold
  let qbiDeduction = 0;
  if (scheduleCNet > 0 && agi <= QBI_AGI_THRESHOLDS_2024[filingStatus]) {
    const tentativeTaxable = Math.max(0, agi - deductionUsed);
    qbiDeduction = round2(Math.min(scheduleCNet * 0.2, tentativeTaxable * 0.2));
  }

  // Taxable income
  const taxableIncome = Math.max(0, round2(agi - qbiDeduction - deductionUsed));

  // Federal income tax
  const brackets = BRACKETS_2024[filingStatus];
  const { tax: federalTax, marginalRate } = applyBrackets(taxableIncome, brackets);

  const totalTax = round2(federalTax + seTax);
  const effectiveRate = grossIncome > 0 ? round1((totalTax / grossIncome) * 100) : 0;

  return {
    grossIncome: round2(grossIncome),
    scheduleCNet: round2(scheduleCNet),
    scheduleCIncome: round2(scheduleCIncome),
    scheduleCExpenses: round2(scheduleCExpenses),
    w2Income,
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
    breakdown: {
      federal: round2(federalTax),
      selfEmployment: seTax,
      state: 0,
    },
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
function round1(n: number) { return Math.round(n * 10) / 10; }
