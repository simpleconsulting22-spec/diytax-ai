// ─── Year-indexed federal tax constants ───────────────────────────────────────
//
// MIRRORED FILE. `frontend/src/shared/taxConstants.ts` and
// `functions/src/shared/taxConstants.ts` must stay byte-for-byte identical.
// Firebase Functions cannot import from `frontend/`, so the file is duplicated;
// `functions/test/taxConstantsSync.test.ts` fails if the two copies drift.
//
// EVERY NUMBER BELOW WAS VERIFIED AGAINST THE OFFICIAL SOURCE CITED NEXT TO IT.
// Do not change a figure without re-checking that source. Sources used:
//
//   2024 brackets/deductions ... Rev. Proc. 2023-34
//   2025 brackets ............... Rev. Proc. 2024-40, as published at
//                                 irs.gov/filing/federal-income-tax-rates-and-brackets
//   2025 standard deduction ..... One Big Beautiful Bill Act (OBBBA) § 70102, per
//                                 irs.gov/newsroom/one-big-beautiful-bill-provisions-individuals-and-workers
//                                 NOTE: OBBBA SUPERSEDES the $15,000 / $30,000 /
//                                 $22,500 figures in Rev. Proc. 2024-40.
//   2026 brackets/deductions .... Rev. Proc. 2025-32 (I.R.B. 2025-45)
//   SS wage base ................ 2025 Instructions for Schedule SE ($176,100);
//                                 IRS Topic no. 751 ($184,500 for 2026)
//   QBI thresholds .............. 2025 Instructions for Form 8995; Rev. Proc. 2025-32
//   Standard mileage ............ irs.gov/tax-professionals/standard-mileage-rates
//
// Scope note: these tables model the ordinary federal individual calculation.
// They deliberately do NOT model the additional standard deduction for age 65+
// or blindness, the OBBBA senior / tips / overtime / car-loan-interest
// deductions, the SALT cap, capital-gain preferential rates, AMT, or credits.

export type FilingStatus =
  | "single"
  | "married_jointly"
  | "married_separately"
  | "head_of_household"
  | "qualifying_surviving_spouse";

export const FILING_STATUSES: FilingStatus[] = [
  "single",
  "married_jointly",
  "married_separately",
  "head_of_household",
  "qualifying_surviving_spouse",
];

export interface Bracket {
  /** Upper bound of this bracket, in taxable income. Infinity for the top. */
  max: number;
  rate: number;
}

/**
 * Accepted spellings for each canonical status. The app has historically used
 * two vocabularies — profiles store `married_jointly` (onboarding) while the
 * forecast pages sent `married_filing_jointly` — so both must resolve. Anything
 * not listed here is rejected rather than silently defaulted to `single`.
 */
const FILING_STATUS_ALIASES: Record<string, FilingStatus> = {
  single: "single",
  s: "single",
  unmarried: "single",
  married_jointly: "married_jointly",
  married_filing_jointly: "married_jointly",
  marriedfilingjointly: "married_jointly",
  mfj: "married_jointly",
  joint: "married_jointly",
  married_separately: "married_separately",
  married_filing_separately: "married_separately",
  marriedfilingseparately: "married_separately",
  mfs: "married_separately",
  separate: "married_separately",
  head_of_household: "head_of_household",
  headofhousehold: "head_of_household",
  hoh: "head_of_household",
  qualifying_surviving_spouse: "qualifying_surviving_spouse",
  qualifying_widow: "qualifying_surviving_spouse",
  qualifying_widower: "qualifying_surviving_spouse",
  surviving_spouse: "qualifying_surviving_spouse",
  qss: "qualifying_surviving_spouse",
};

/**
 * Resolve an arbitrary stored/incoming string to a canonical FilingStatus.
 * Returns null for anything unrecognized — callers must reject rather than
 * guess, because guessing produces a confidently wrong tax number.
 */
export function normalizeFilingStatus(input: unknown): FilingStatus | null {
  if (typeof input !== "string") return null;
  const key = input.toLowerCase().replace(/[\s-]+/g, "_").trim();
  return FILING_STATUS_ALIASES[key] ?? null;
}

/** Human-readable label, for UI and error messages. */
export const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  single: "Single",
  married_jointly: "Married Filing Jointly",
  married_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_surviving_spouse: "Qualifying Surviving Spouse",
};

// ─── Tax rate tables ──────────────────────────────────────────────────────────
// A qualifying surviving spouse uses the married-filing-jointly rate schedule
// and standard deduction (IRC § 1(j)(2)(A)), so those rows are identical.

export const BRACKETS_BY_YEAR: Record<number, Record<FilingStatus, Bracket[]>> = {
  // 2024 — Rev. Proc. 2023-34
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
    qualifying_surviving_spouse: [
      { max: 23200, rate: 0.10 }, { max: 94300, rate: 0.12 },
      { max: 201050, rate: 0.22 }, { max: 383900, rate: 0.24 },
      { max: 487450, rate: 0.32 }, { max: 731200, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
  },
  // 2025 — Rev. Proc. 2024-40. OBBBA did not change the 2025 rate thresholds;
  // it changed the standard deduction (see below) and made the rates permanent.
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
    qualifying_surviving_spouse: [
      { max: 23850, rate: 0.10 }, { max: 96950, rate: 0.12 },
      { max: 206700, rate: 0.22 }, { max: 394600, rate: 0.24 },
      { max: 501050, rate: 0.32 }, { max: 751600, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
  },
  // 2026 — Rev. Proc. 2025-32 (I.R.B. 2025-45), which incorporates the OBBBA
  // amendments including the extra inflation adjustment to the 10%/12% bands.
  2026: {
    single: [
      { max: 12400, rate: 0.10 }, { max: 50400, rate: 0.12 },
      { max: 105700, rate: 0.22 }, { max: 201775, rate: 0.24 },
      { max: 256225, rate: 0.32 }, { max: 640600, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_jointly: [
      { max: 24800, rate: 0.10 }, { max: 100800, rate: 0.12 },
      { max: 211400, rate: 0.22 }, { max: 403550, rate: 0.24 },
      { max: 512450, rate: 0.32 }, { max: 768700, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    married_separately: [
      { max: 12400, rate: 0.10 }, { max: 50400, rate: 0.12 },
      { max: 105700, rate: 0.22 }, { max: 201775, rate: 0.24 },
      { max: 256225, rate: 0.32 }, { max: 384350, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { max: 17700, rate: 0.10 }, { max: 67450, rate: 0.12 },
      { max: 105700, rate: 0.22 }, { max: 201750, rate: 0.24 },
      { max: 256200, rate: 0.32 }, { max: 640600, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
    qualifying_surviving_spouse: [
      { max: 24800, rate: 0.10 }, { max: 100800, rate: 0.12 },
      { max: 211400, rate: 0.22 }, { max: 403550, rate: 0.24 },
      { max: 512450, rate: 0.32 }, { max: 768700, rate: 0.35 },
      { max: Infinity, rate: 0.37 },
    ],
  },
};

/**
 * Basic standard deduction. 2025 uses the OBBBA § 70102 amounts, NOT the
 * $15,000 / $30,000 / $22,500 originally published in Rev. Proc. 2024-40 —
 * OBBBA raised them retroactively for tax year 2025.
 */
export const STANDARD_DEDUCTION_BY_YEAR: Record<number, Record<FilingStatus, number>> = {
  2024: {
    single: 14600, married_jointly: 29200, married_separately: 14600,
    head_of_household: 21900, qualifying_surviving_spouse: 29200,
  },
  2025: {
    single: 15750, married_jointly: 31500, married_separately: 15750,
    head_of_household: 23625, qualifying_surviving_spouse: 31500,
  },
  2026: {
    single: 16100, married_jointly: 32200, married_separately: 16100,
    head_of_household: 24150, qualifying_surviving_spouse: 32200,
  },
};

/** § 199A(e)(2) threshold amount — start of the QBI phase-in. */
export const QBI_THRESHOLD_BY_YEAR: Record<number, Record<FilingStatus, number>> = {
  2024: {
    single: 191950, married_jointly: 383900, married_separately: 191950,
    head_of_household: 191950, qualifying_surviving_spouse: 383900,
  },
  2025: {
    single: 197300, married_jointly: 394600, married_separately: 197300,
    head_of_household: 197300, qualifying_surviving_spouse: 394600,
  },
  2026: {
    single: 201750, married_jointly: 403500, married_separately: 201750,
    head_of_household: 201750, qualifying_surviving_spouse: 403500,
  },
};

/** Social Security contribution and benefit base (OASDI taxable maximum). */
export const SS_WAGE_BASE_BY_YEAR: Record<number, number> = {
  2024: 168600,
  2025: 176100,
  2026: 184500,
};

// ─── Self-employment tax ──────────────────────────────────────────────────────
// IRC § 1402(a)(12) / § 1401. Unchanged for all years modeled here.

/** Portion of net profit subject to SE tax (Schedule SE line 4a). */
export const SE_NET_EARNINGS_FACTOR = 0.9235;
/** Combined employer+employee OASDI rate on SE earnings. */
export const SE_SOCIAL_SECURITY_RATE = 0.124;
/** Combined employer+employee Medicare rate on SE earnings (no wage cap). */
export const SE_MEDICARE_RATE = 0.029;
/** Half of SE tax is deductible above the line (IRC § 164(f)). */
export const SE_DEDUCTIBLE_SHARE = 0.5;

// ─── Standard mileage ─────────────────────────────────────────────────────────
// Business-use rate in cents per mile. 2026 is split mid-year, so the rate is
// resolved per transaction date rather than per year.

export interface MileagePeriod {
  /** Inclusive ISO start date. */
  from: string;
  /** Inclusive ISO end date. */
  to: string;
  centsPerMile: number;
}

export const BUSINESS_MILEAGE_BY_YEAR: Record<number, MileagePeriod[]> = {
  2024: [{ from: "2024-01-01", to: "2024-12-31", centsPerMile: 67 }],
  2025: [{ from: "2025-01-01", to: "2025-12-31", centsPerMile: 70 }],
  2026: [
    { from: "2026-01-01", to: "2026-06-30", centsPerMile: 72.5 },
    { from: "2026-07-01", to: "2026-12-31", centsPerMile: 76 },
  ],
};

/**
 * Business standard mileage rate in DOLLARS per mile for an ISO date
 * (`YYYY-MM-DD`). Falls back to the most recent known year's last period.
 */
export function businessMileageRate(dateISO: string): number {
  const year = Number(dateISO.slice(0, 4));
  const periods = pickYear(year, BUSINESS_MILEAGE_BY_YEAR);
  const hit = periods.find((p) => dateISO >= p.from && dateISO <= p.to);
  return (hit ?? periods[periods.length - 1]).centsPerMile / 100;
}

// ─── Year resolution ──────────────────────────────────────────────────────────

/** Years for which a complete verified table set exists, newest first. */
export const KNOWN_TAX_YEARS: number[] = Object.keys(BRACKETS_BY_YEAR)
  .map(Number)
  .sort((a, b) => b - a);

/**
 * Pick the table for `year`, falling back to the most recent known year so an
 * estimate for a year the IRS hasn't published yet uses the latest figures
 * instead of crashing.
 */
export function pickYear<T>(year: number, table: Record<number, T>): T {
  const exact = table[year];
  if (exact !== undefined) return exact;
  const known = Object.keys(table).map(Number).sort((a, b) => b - a);
  return table[known[0]];
}

/** The year whose tables will actually be used for `year`. */
export function effectiveTaxYear(year: number): number {
  return BRACKETS_BY_YEAR[year] ? year : KNOWN_TAX_YEARS[0];
}

/** True when `year` has its own verified tables (no fallback needed). */
export function isKnownTaxYear(year: number): boolean {
  return BRACKETS_BY_YEAR[year] !== undefined;
}

// ─── Bracket application ──────────────────────────────────────────────────────

/**
 * Progressive tax on `taxableIncome`. Returns both the tax and the marginal
 * rate actually reached. One implementation, used by every caller, so the
 * dashboard and the Cloud Functions can never disagree on the arithmetic.
 */
export function applyBrackets(
  taxableIncome: number,
  brackets: Bracket[]
): { tax: number; marginalRate: number } {
  if (taxableIncome <= 0) return { tax: 0, marginalRate: brackets[0].rate };
  let tax = 0;
  let prev = 0;
  let marginalRate = brackets[0].rate;
  for (const bracket of brackets) {
    if (taxableIncome <= prev) break;
    tax += (Math.min(taxableIncome, bracket.max) - prev) * bracket.rate;
    marginalRate = bracket.rate;
    prev = bracket.max;
    if (taxableIncome <= bracket.max) break;
  }
  return { tax, marginalRate };
}

/** Federal income tax for a year + status, resolving the tables internally. */
export function federalIncomeTax(
  taxableIncome: number,
  filingStatus: FilingStatus,
  taxYear: number
): { tax: number; marginalRate: number } {
  return applyBrackets(taxableIncome, pickYear(taxYear, BRACKETS_BY_YEAR)[filingStatus]);
}

/**
 * Self-employment tax on Schedule C net profit. `otherSSWages` (W-2 social
 * security wages) consume the OASDI base first, so SE earnings above the
 * remaining headroom are only subject to Medicare.
 */
export function selfEmploymentTax(
  netProfit: number,
  taxYear: number,
  otherSSWages = 0
): { seTax: number; deductiblePortion: number } {
  if (netProfit <= 0) return { seTax: 0, deductiblePortion: 0 };
  const wageBase = pickYear(taxYear, SS_WAGE_BASE_BY_YEAR);
  const netEarnings = netProfit * SE_NET_EARNINGS_FACTOR;
  const ssHeadroom = Math.max(0, wageBase - Math.max(0, otherSSWages));
  const ssTax = Math.min(netEarnings, ssHeadroom) * SE_SOCIAL_SECURITY_RATE;
  const medicareTax = netEarnings * SE_MEDICARE_RATE;
  const seTax = ssTax + medicareTax;
  return { seTax, deductiblePortion: seTax * SE_DEDUCTIBLE_SHARE };
}

// ─── Quarterly estimated tax due dates ────────────────────────────────────────
// Statutory dates are Apr 15 / Jun 15 / Sep 15 of the tax year and Jan 15 of
// the following year (IRC § 6654(c)(2)). When one falls on a Saturday, Sunday,
// or legal holiday it moves to the next business day (IRC § 7503) — which is
// why, e.g., 2025 Q2 was due June 16, 2025. Computing this beats hard-coding
// one year's shifted dates and applying them to every year.

export interface QuarterlyDueDate {
  quarter: 1 | 2 | 3 | 4;
  label: string;
  /** ISO date, already shifted off weekends and holidays. */
  dueDate: string;
  /** The unshifted statutory date, for explaining the shift in the UI. */
  statutoryDate: string;
}

function toISO(y: number, m: number, d: number): string {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Day of week in UTC (0 = Sunday) for an ISO date. */
function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** ISO date of the nth given weekday of a month (e.g. 3rd Monday of January). */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): string {
  const first = toISO(year, month, 1);
  const shift = (weekday - dayOfWeek(first) + 7) % 7;
  return addDays(first, shift + (n - 1) * 7);
}

/** A fixed-date holiday observed Friday if it lands Saturday, Monday if Sunday. */
function observed(iso: string): string {
  const dow = dayOfWeek(iso);
  if (dow === 6) return addDays(iso, -1);
  if (dow === 0) return addDays(iso, 1);
  return iso;
}

/**
 * Legal holidays that can push an estimated-tax deadline. Only January, April,
 * June and September matter, so the set is limited to those months:
 * New Year's Day, Martin Luther King Jr. Day, DC Emancipation Day (a legal
 * holiday for filing purposes under § 7503), Juneteenth, and Labor Day.
 */
function deadlineHolidays(year: number): Set<string> {
  return new Set([
    observed(toISO(year, 1, 1)),
    nthWeekdayOfMonth(year, 1, 1, 3),
    observed(toISO(year, 4, 16)),
    observed(toISO(year, 6, 19)),
    nthWeekdayOfMonth(year, 9, 1, 1),
  ]);
}

/** Roll forward past weekends and legal holidays. */
export function nextBusinessDay(iso: string): string {
  let cursor = iso;
  let holidays = deadlineHolidays(Number(cursor.slice(0, 4)));
  for (let guard = 0; guard < 10; guard++) {
    const dow = dayOfWeek(cursor);
    if (dow !== 0 && dow !== 6 && !holidays.has(cursor)) return cursor;
    cursor = addDays(cursor, 1);
    holidays = deadlineHolidays(Number(cursor.slice(0, 4)));
  }
  return cursor;
}

/** The four estimated-tax due dates for `taxYear`, weekend/holiday adjusted. */
export function quarterlyDueDates(taxYear: number): QuarterlyDueDate[] {
  const statutory: Array<{ quarter: 1 | 2 | 3 | 4; date: string }> = [
    { quarter: 1, date: toISO(taxYear, 4, 15) },
    { quarter: 2, date: toISO(taxYear, 6, 15) },
    { quarter: 3, date: toISO(taxYear, 9, 15) },
    { quarter: 4, date: toISO(taxYear + 1, 1, 15) },
  ];
  return statutory.map((q) => ({
    quarter: q.quarter,
    label: `Q${q.quarter}`,
    dueDate: nextBusinessDay(q.date),
    statutoryDate: q.date,
  }));
}

/**
 * The next estimated-tax deadline still open as of `todayISO`, or null when
 * every deadline for the year has passed. Returning null matters: a completed
 * year has no "next" deadline, and pretending Q4 is still upcoming tells the
 * user to make a payment that is already late.
 */
export function nextQuarterlyDueDate(
  taxYear: number,
  todayISO: string
): QuarterlyDueDate | null {
  return quarterlyDueDates(taxYear).find((q) => q.dueDate >= todayISO) ?? null;
}
