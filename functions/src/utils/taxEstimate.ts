// Lightweight 2024 IRS tax estimate — used in Cloud Functions (no React deps)

export interface QuickTaxEstimate {
  selfEmploymentTax: number;
  federalTax:        number;
  totalTax:          number;
  effectiveRate:     number;
}

const BRACKETS_SINGLE_2024 = [
  { limit: 11600,  rate: 0.10 },
  { limit: 47150,  rate: 0.12 },
  { limit: 100525, rate: 0.22 },
  { limit: 191950, rate: 0.24 },
  { limit: 243725, rate: 0.32 },
  { limit: 609350, rate: 0.35 },
  { limit: Infinity, rate: 0.37 },
];

const BRACKETS_MFJ_2024 = [
  { limit: 23200,  rate: 0.10 },
  { limit: 94300,  rate: 0.12 },
  { limit: 201050, rate: 0.22 },
  { limit: 383900, rate: 0.24 },
  { limit: 487450, rate: 0.32 },
  { limit: 731200, rate: 0.35 },
  { limit: Infinity, rate: 0.37 },
];

const STANDARD_DEDUCTION: Record<string, number> = {
  single:            14600,
  married_jointly:   29200,
  married_separately: 14600,
  head_of_household: 21900,
};

const SS_WAGE_BASE = 168600;

function applyBrackets(income: number, brackets: typeof BRACKETS_SINGLE_2024): number {
  let tax = 0;
  let prev = 0;
  for (const bracket of brackets) {
    if (income <= prev) break;
    const taxable = Math.min(income, bracket.limit) - prev;
    tax += taxable * bracket.rate;
    prev = bracket.limit;
  }
  return tax;
}

export function quickTaxEstimate(
  netProfit: number,
  w2Income: number,
  filingStatus: string
): QuickTaxEstimate {
  const seNet    = Math.max(0, netProfit) * 0.9235;
  const seSSTax  = Math.min(seNet, Math.max(0, SS_WAGE_BASE - w2Income)) * 0.124;
  const seMedTax = seNet * 0.029;
  const selfEmploymentTax = seSSTax + seMedTax;

  const seDeduction = selfEmploymentTax * 0.5;
  const agi         = netProfit + w2Income - seDeduction;
  const stdDed      = STANDARD_DEDUCTION[filingStatus] ?? 14600;
  const taxableIncome = Math.max(0, agi - stdDed);

  const brackets = (filingStatus === "married_jointly" || filingStatus === "married_separately")
    ? BRACKETS_MFJ_2024
    : BRACKETS_SINGLE_2024;

  const federalTax  = applyBrackets(taxableIncome, brackets);
  const totalTax    = selfEmploymentTax + federalTax;
  const grossIncome = netProfit + w2Income;
  const effectiveRate = grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0;

  return { selfEmploymentTax, federalTax, totalTax, effectiveRate };
}
