// Lightweight federal tax estimate for Cloud Functions (no React deps).
//
// All IRS/SSA figures come from shared/taxConstants.ts, which is year-indexed
// and mirrored with the frontend. This file previously carried its own 2024-only
// copy of the brackets and deductions, so selecting 2025 in the UI changed
// nothing here and the dashboard and Cloud Functions could disagree.

import {
  FilingStatus,
  federalIncomeTax,
  normalizeFilingStatus,
  pickYear,
  selfEmploymentTax,
  STANDARD_DEDUCTION_BY_YEAR,
  effectiveTaxYear,
} from "../shared/taxConstants";

export interface QuickTaxEstimate {
  selfEmploymentTax: number;
  federalTax:        number;
  totalTax:          number;
  effectiveRate:     number;
  /** Status actually used, after normalizing whatever the profile stored. */
  filingStatus:      FilingStatus;
  /** Year whose IRS tables were used (input year, or the latest known year). */
  taxYear:           number;
}

/**
 * Estimate federal income + SE tax.
 *
 * `filingStatus` accepts either vocabulary the app has used (`married_jointly`
 * from onboarding, `married_filing_jointly` from the forecast pages). An
 * unrecognized value falls back to `single` — this is the notification path,
 * where a missing profile field must not throw; callable endpoints validate
 * strictly instead and reject.
 */
export function quickTaxEstimate(
  netProfit: number,
  w2Income: number,
  filingStatus: string,
  taxYear: number = new Date().getFullYear()
): QuickTaxEstimate {
  const status = normalizeFilingStatus(filingStatus) ?? "single";
  const year = effectiveTaxYear(taxYear);

  // W-2 wages consume the Social Security wage base before SE earnings do.
  const { seTax, deductiblePortion } = selfEmploymentTax(netProfit, year, w2Income);

  const agi = netProfit + w2Income - deductiblePortion;
  const stdDed = pickYear(year, STANDARD_DEDUCTION_BY_YEAR)[status];
  const taxableIncome = Math.max(0, agi - stdDed);

  const { tax: federalTax } = federalIncomeTax(taxableIncome, status, year);

  const totalTax = seTax + federalTax;
  const grossIncome = netProfit + w2Income;
  const effectiveRate = grossIncome > 0 ? (totalTax / grossIncome) * 100 : 0;

  return {
    selfEmploymentTax: seTax,
    federalTax,
    totalTax,
    effectiveRate,
    filingStatus: status,
    taxYear: year,
  };
}
