// Zach's verified tax knowledge.
//
// Two kinds of material, and nothing else, may carry a tax figure into a Zach
// answer:
//   1. Year-indexed figures from shared/taxConstants.ts — the same tables the
//      tax engine uses, each verified against the IRS source cited there.
//   2. The taxpayer's own numbers, computed by the tax engine (zachContext.ts).
//
// The source catalog below is the ONLY set of references Zach may cite. The
// model returns catalog ids, never URLs, so it cannot invent a link.

import {
  BRACKETS_BY_YEAR,
  BUSINESS_MILEAGE_BY_YEAR,
  ESTIMATE_EXCLUSIONS,
  FILING_STATUS_LABELS,
  FILING_STATUSES,
  FilingStatus,
  KNOWN_TAX_YEARS,
  QBI_THRESHOLD_BY_YEAR,
  SE_DEDUCTIBLE_SHARE,
  SE_MEDICARE_RATE,
  SE_NET_EARNINGS_FACTOR,
  SE_SOCIAL_SECURITY_RATE,
  SS_WAGE_BASE_BY_YEAR,
  STANDARD_DEDUCTION_BY_YEAR,
  effectiveTaxYear,
  quarterlyDueDates,
} from "../shared/taxConstants";

export interface TaxSource {
  title: string;
  url: string;
}

export const SOURCE_CATALOG = {
  i1040: { title: "Form 1040 instructions", url: "https://www.irs.gov/instructions/i1040gi" },
  pub17: { title: "IRS Publication 17, Your Federal Income Tax", url: "https://www.irs.gov/publications/p17" },
  pub501: { title: "IRS Publication 501, Dependents, Standard Deduction, and Filing Information", url: "https://www.irs.gov/publications/p501" },
  brackets: { title: "IRS: Federal income tax rates and brackets", url: "https://www.irs.gov/filing/federal-income-tax-rates-and-brackets" },
  obbba: { title: "IRS: One Big Beautiful Bill provisions for individuals", url: "https://www.irs.gov/newsroom/one-big-beautiful-bill-provisions-individuals-and-workers" },
  pub334: { title: "IRS Publication 334, Tax Guide for Small Business", url: "https://www.irs.gov/publications/p334" },
  schC: { title: "About Schedule C (Form 1040)", url: "https://www.irs.gov/forms-pubs/about-schedule-c-form-1040" },
  schSE: { title: "About Schedule SE (Form 1040)", url: "https://www.irs.gov/forms-pubs/about-schedule-se-form-1040" },
  f8995: { title: "About Form 8995, Qualified Business Income Deduction", url: "https://www.irs.gov/forms-pubs/about-form-8995" },
  pub463: { title: "IRS Publication 463, Travel, Gift, and Car Expenses", url: "https://www.irs.gov/publications/p463" },
  pub587: { title: "IRS Publication 587, Business Use of Your Home", url: "https://www.irs.gov/publications/p587" },
  pub946: { title: "IRS Publication 946, How To Depreciate Property", url: "https://www.irs.gov/publications/p946" },
  mileage: { title: "IRS: Standard mileage rates", url: "https://www.irs.gov/tax-professionals/standard-mileage-rates" },
  recordkeeping: { title: "IRS: Recordkeeping for small businesses", url: "https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping" },
  pub505: { title: "IRS Publication 505, Tax Withholding and Estimated Tax", url: "https://www.irs.gov/publications/p505" },
  estimated: { title: "IRS: Estimated taxes", url: "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes" },
  schA: { title: "About Schedule A (Form 1040), Itemized Deductions", url: "https://www.irs.gov/forms-pubs/about-schedule-a-form-1040" },
  pub526: { title: "IRS Publication 526, Charitable Contributions", url: "https://www.irs.gov/publications/p526" },
  pub502: { title: "IRS Publication 502, Medical and Dental Expenses", url: "https://www.irs.gov/publications/p502" },
  pub936: { title: "IRS Publication 936, Home Mortgage Interest Deduction", url: "https://www.irs.gov/publications/p936" },
  schE: { title: "About Schedule E (Form 1040)", url: "https://www.irs.gov/forms-pubs/about-schedule-e-form-1040" },
  pub527: { title: "IRS Publication 527, Residential Rental Property", url: "https://www.irs.gov/publications/p527" },
  pub550: { title: "IRS Publication 550, Investment Income and Expenses", url: "https://www.irs.gov/publications/p550" },
  pub575: { title: "IRS Publication 575, Pension and Annuity Income", url: "https://www.irs.gov/publications/p575" },
  pub915: { title: "IRS Publication 915, Social Security and Equivalent Railroad Retirement Benefits", url: "https://www.irs.gov/publications/p915" },
  sch8812: { title: "About Schedule 8812, Credits for Qualifying Children and Other Dependents", url: "https://www.irs.gov/forms-pubs/about-schedule-8812-form-1040" },
  pub596: { title: "IRS Publication 596, Earned Income Credit", url: "https://www.irs.gov/publications/p596" },
  pub970: { title: "IRS Publication 970, Tax Benefits for Education", url: "https://www.irs.gov/publications/p970" },
  pub503: { title: "IRS Publication 503, Child and Dependent Care Expenses", url: "https://www.irs.gov/publications/p503" },
  choosePro: { title: "IRS: Choosing a tax professional", url: "https://www.irs.gov/tax-professionals/choosing-a-tax-professional" },
} as const satisfies Record<string, TaxSource>;

export type SourceId = keyof typeof SOURCE_CATALOG;
export const SOURCE_IDS = Object.keys(SOURCE_CATALOG) as SourceId[];

export function isSourceId(id: unknown): id is SourceId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(SOURCE_CATALOG, id);
}

/** Topics the app does NOT calculate. Zach may explain them, never compute them. */
export const NOT_CALCULATED_BY_APP = [
  ...ESTIMATE_EXCLUSIONS,
  "Dependents and dependent qualification (the app does not collect dependent information)",
  "Tax withholding and payments already made",
  "Social Security (SSA-1099) and retirement (1099-R) entries are recorded but not included in the estimate",
  "Filing, signing or submitting a return (DIYTax AI does not e-file)",
];

export interface YearFacts {
  requestedYear: number;
  /** Year whose verified tables exist. Differs from requestedYear when the
   *  IRS figures for the requested year are not in the app yet. */
  tableYear: number;
  tablesAvailableForRequestedYear: boolean;
  knownYears: number[];
  standardDeduction: Record<string, number>;
  brackets: Record<string, Array<{ upTo: number | "and above"; rate: string }>>;
  socialSecurityWageBase: number;
  selfEmployment: {
    netEarningsFactor: number;
    socialSecurityRate: string;
    medicareRate: string;
    deductibleShare: string;
  };
  qbiThreshold: Record<string, number>;
  businessMileage: Array<{ from: string; to: string; centsPerMile: number }>;
  quarterlyEstimatedTaxDueDates: Array<{ quarter: number; dueDate: string }>;
  sourceNotes: string[];
}

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/**
 * Verified figures for one tax year, for every filing status (so Zach can
 * compare statuses), or just one when the taxpayer's status is known.
 */
export function yearFacts(requestedYear: number, status?: FilingStatus | null): YearFacts {
  const tableYear = effectiveTaxYear(requestedYear);
  const statuses = status ? [status] : FILING_STATUSES;
  const label = (s: FilingStatus) => FILING_STATUS_LABELS[s];

  const standardDeduction: Record<string, number> = {};
  const brackets: YearFacts["brackets"] = {};
  const qbiThreshold: Record<string, number> = {};
  for (const s of statuses) {
    standardDeduction[label(s)] = STANDARD_DEDUCTION_BY_YEAR[tableYear][s];
    qbiThreshold[label(s)] = QBI_THRESHOLD_BY_YEAR[tableYear][s];
    brackets[label(s)] = BRACKETS_BY_YEAR[tableYear][s].map((b) => ({
      upTo: Number.isFinite(b.max) ? b.max : "and above",
      rate: pct(b.rate),
    }));
  }

  return {
    requestedYear,
    tableYear,
    tablesAvailableForRequestedYear: tableYear === requestedYear,
    knownYears: [...KNOWN_TAX_YEARS],
    standardDeduction,
    brackets,
    socialSecurityWageBase: SS_WAGE_BASE_BY_YEAR[tableYear],
    selfEmployment: {
      netEarningsFactor: SE_NET_EARNINGS_FACTOR,
      socialSecurityRate: pct(SE_SOCIAL_SECURITY_RATE),
      medicareRate: pct(SE_MEDICARE_RATE),
      deductibleShare: pct(SE_DEDUCTIBLE_SHARE),
    },
    qbiThreshold,
    businessMileage: BUSINESS_MILEAGE_BY_YEAR[tableYear].map((p) => ({ ...p })),
    quarterlyEstimatedTaxDueDates: quarterlyDueDates(tableYear).map((q) => ({
      quarter: q.quarter,
      dueDate: q.dueDate,
    })),
    sourceNotes: [
      "2024 brackets and standard deduction: Rev. Proc. 2023-34",
      "2025 brackets: Rev. Proc. 2024-40; 2025 standard deduction: OBBBA section 70102",
      "2026 brackets and standard deduction: Rev. Proc. 2025-32",
      "Social Security wage base: Schedule SE instructions / IRS Topic 751",
      "Mileage: IRS standard mileage rates page",
    ],
  };
}
