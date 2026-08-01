// Pure tax estimation functions — no React, no Firestore, fully testable.
//
// The IRS/SSA figures live in shared/taxConstants.ts, which is mirrored into
// functions/ so the dashboard and the Cloud Functions compute from ONE set of
// year-indexed tables. They used to be duplicated here, which let the meter and
// the backend show different numbers for the same user.

import { getTaxBucket, isW2WageCategory } from "../../shared/taxMap";
import {
  ESTIMATE_EXCLUSIONS,
  computeFederalEstimate,
  effectiveTaxYear,
  type FilingStatus as SharedFilingStatus,
  type QbiStatus,
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
  /** Schedule E net rental income/loss. Never subject to SE tax. */
  scheduleENet: number;
  w2Income: number;
  w2FromTxns: number;
  /** Interest, dividends and other ordinary income — not W-2, not SE. */
  otherOrdinaryIncome: number;
  seTax: number;
  /** Exactly what SE tax was charged on — Schedule C net profit only. */
  seTaxBase: number;
  seDeduction: number;
  agi: number;
  qbiDeduction: number;
  /** Whether QBI was actually computed, or skipped as uncomputable. */
  qbiStatus: QbiStatus;
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
  /** What this estimate does not account for — display alongside the number. */
  exclusions: string[];
  breakdown: {
    federal: number;
    selfEmployment: number;
    state: number;
  };
}


/**
 * Split the transaction list into tax lanes, then hand the maths to the shared
 * estimator. Lanes are kept apart on purpose: self-employment tax applies only
 * to Schedule C net profit (IRC § 1402(a)), never to wages, interest,
 * dividends or rental income, and Schedule A/E deductions never reduce
 * Schedule C profit.
 */
export function calculateTaxEstimate(input: TaxEstimateInput): TaxEstimate {
  const { transactions, scheduleAManualDeductions, filingStatus, w2Income, iraContributions, taxYear } = input;

  let scheduleCIncome = 0;
  let scheduleCExpenses = 0;
  let scheduleEIncome = 0;
  let scheduleEExpenses = 0;
  let scheduleAFromTxns = 0;
  let totalTxnIncome = 0;
  let w2FromTxns = 0;              // W-2 wages only — consumes the OASDI base
  let otherOrdinaryFromTxns = 0;   // interest, dividends, other — does not

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
      if (bucket === "se_income") {
        scheduleCIncome += amt;
      } else if (bucket === "rental_income") {
        scheduleEIncome += amt;
      } else if (isW2WageCategory(txn.category ?? txn.taxCategory)) {
        w2FromTxns += amt;
      } else {
        otherOrdinaryFromTxns += amt;
      }
    } else if (txn.type === "expense") {
      if (bucket === "se_expense") scheduleCExpenses += abs;
      else if (bucket === "rental_expense") scheduleEExpenses += abs;
      else if (bucket === "itemized_deduction") scheduleAFromTxns += abs;
      // personal has no impact — it must never reduce Schedule C profit.
    } else if (txn.type === "refund") {
      // A refund nets against the expense lane it came from.
      if (bucket === "se_expense") scheduleCExpenses -= abs;
      else if (bucket === "rental_expense") scheduleEExpenses -= abs;
      else if (bucket === "itemized_deduction") scheduleAFromTxns -= abs;
    }
  }

  const scheduleCNet = round2(scheduleCIncome - scheduleCExpenses);
  const scheduleENet = round2(scheduleEIncome - scheduleEExpenses);
  // `w2Income` is the figure entered during onboarding. Use it only when the
  // transactions contain no wage rows, so the two sources can't be summed.
  const w2Wages = w2FromTxns > 0 ? w2FromTxns : w2Income;
  const itemizedDeduction = round2(scheduleAFromTxns + scheduleAManualDeductions);

  const e = computeFederalEstimate({
    scheduleCNet,
    scheduleENet,
    w2Wages,
    otherOrdinaryIncome: otherOrdinaryFromTxns,
    itemizedDeductions: itemizedDeduction,
    iraContributions,
    filingStatus,
    taxYear,
  });

  return {
    grossIncome: round2(totalTxnIncome + (w2FromTxns > 0 ? 0 : w2Income)),
    scheduleCNet,
    scheduleCIncome: round2(scheduleCIncome),
    scheduleCExpenses: round2(scheduleCExpenses),
    scheduleENet,
    w2Income: round2(w2Wages),
    w2FromTxns: round2(w2FromTxns),
    otherOrdinaryIncome: round2(otherOrdinaryFromTxns),
    seTax: e.seTax,
    seTaxBase: e.seTaxBase,
    seDeduction: e.seDeduction,
    agi: e.agi,
    qbiDeduction: e.qbiDeduction,
    qbiStatus: e.qbiStatus,
    standardDeduction: e.standardDeduction,
    itemizedDeduction: e.itemizedDeduction,
    deductionUsed: e.deductionUsed,
    usingItemized: e.usingItemized,
    taxableIncome: e.taxableIncome,
    federalTax: e.federalTax,
    totalTax: e.totalTax,
    effectiveRate: e.effectiveRate,
    marginalRate: Math.round(e.marginalRate * 100),
    taxYear: e.taxYear,
    ssWageBase: e.ssWageBase,
    exclusions: ESTIMATE_EXCLUSIONS,
    breakdown: {
      federal: e.federalTax,
      selfEmployment: e.seTax,
      state: 0,
    },
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
