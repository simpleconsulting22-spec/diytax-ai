// Pure tax estimation functions — no React, no Firestore, fully testable.
//
// The IRS/SSA figures live in shared/taxConstants.ts, which is mirrored into
// functions/ so the dashboard and the Cloud Functions compute from ONE set of
// year-indexed tables. They used to be duplicated here, which let the meter and
// the backend show different numbers for the same user.

import { getTaxBucket } from "../../shared/taxMap";
import {
  BRACKETS_BY_YEAR,
  QBI_THRESHOLD_BY_YEAR,
  SS_WAGE_BASE_BY_YEAR,
  STANDARD_DEDUCTION_BY_YEAR,
  applyBrackets,
  effectiveTaxYear,
  pickYear,
  selfEmploymentTax,
  type FilingStatus as SharedFilingStatus,
} from "../../shared/taxConstants";

export type FilingStatus = SharedFilingStatus;

export { effectiveTaxYear };

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

export function calculateTaxEstimate(input: TaxEstimateInput): TaxEstimate {
  const { transactions, scheduleAManualDeductions, filingStatus, w2Income, iraContributions, taxYear } = input;
  const ssWageBase     = pickYear(taxYear, SS_WAGE_BASE_BY_YEAR);
  const standardDeduction = pickYear(taxYear, STANDARD_DEDUCTION_BY_YEAR)[filingStatus];
  const qbiThreshold   = pickYear(taxYear, QBI_THRESHOLD_BY_YEAR)[filingStatus];
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

  // SE Tax — only on profit. W-2 wages consume the Social Security wage base
  // first, so SE earnings above the remaining headroom owe Medicare only.
  const se = selfEmploymentTax(scheduleCNet, taxYear, totalW2);
  const seTax = round2(se.seTax);
  const seDeduction = round2(se.deductiblePortion);

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
