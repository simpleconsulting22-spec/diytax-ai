// Lightweight federal tax estimate for Cloud Functions (no React deps).
//
// All IRS/SSA figures and the tax maths come from shared/taxConstants.ts, which
// is year-indexed and mirrored with the frontend. This file previously carried
// its own 2024-only tables, so selecting 2025 in the UI changed nothing here.

import {
  FilingStatus,
  QbiStatus,
  computeFederalEstimate,
  effectiveTaxYear,
  normalizeFilingStatus,
} from "../shared/taxConstants";

export interface QuickTaxEstimate {
  selfEmploymentTax: number;
  federalTax:        number;
  totalTax:          number;
  effectiveRate:     number;
  /** Exactly what SE tax was charged on — Schedule C net profit only. */
  seTaxBase:         number;
  /** Schedule SE line 4a: 92.35% of seTaxBase. */
  seNetEarnings:     number;
  qbiStatus:         QbiStatus;
  /** Status actually used, after normalizing whatever the profile stored. */
  filingStatus:      FilingStatus;
  /** Year whose IRS tables were used (input year, or the latest known year). */
  taxYear:           number;
}

export interface QuickTaxEstimateInput {
  /** Schedule C net profit or loss. THE ONLY input to self-employment tax. */
  scheduleCNet: number;
  /** Schedule E net rental income or loss. Never subject to SE tax. */
  scheduleENet?: number;
  /** W-2 wages — ordinary income that also consumes the OASDI wage base. */
  w2Wages?: number;
  /** Interest, dividends, retirement, Social Security, other ordinary income. */
  otherOrdinaryIncome?: number;
  itemizedDeductions?: number;
  /**
   * Accepts either vocabulary the app has used (`married_jointly` from
   * onboarding, `married_filing_jointly` from the forecast pages). An
   * unrecognized value falls back to `single` — this is the notification path,
   * where a missing profile field must not throw and break the morning push
   * for every other user. Callable endpoints validate strictly and reject.
   */
  filingStatus: string;
  taxYear?: number;
}

/**
 * Estimate federal income + SE tax from already-separated tax lanes.
 *
 * Callers MUST pass Schedule C net profit in `scheduleCNet` and everything else
 * in its own field. Passing "all income minus all expenses" as scheduleCNet is
 * the bug this signature exists to prevent: it charges 15.3% self-employment
 * tax on wages, interest, dividends and rental income.
 */
export function quickTaxEstimate(input: QuickTaxEstimateInput): QuickTaxEstimate {
  const status = normalizeFilingStatus(input.filingStatus) ?? "single";
  const year = effectiveTaxYear(input.taxYear ?? new Date().getFullYear());

  const estimate = computeFederalEstimate({
    scheduleCNet: input.scheduleCNet,
    scheduleENet: input.scheduleENet ?? 0,
    w2Wages: input.w2Wages ?? 0,
    otherOrdinaryIncome: input.otherOrdinaryIncome ?? 0,
    itemizedDeductions: input.itemizedDeductions ?? 0,
    iraContributions: 0,
    filingStatus: status,
    taxYear: year,
  });

  return {
    selfEmploymentTax: estimate.seTax,
    federalTax: estimate.federalTax,
    totalTax: estimate.totalTax,
    effectiveRate: estimate.effectiveRate,
    seTaxBase: estimate.seTaxBase,
    seNetEarnings: estimate.seNetEarnings,
    qbiStatus: estimate.qbiStatus,
    filingStatus: status,
    taxYear: year,
  };
}
