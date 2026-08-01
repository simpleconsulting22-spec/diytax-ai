import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
// Modular import rather than `admin.firestore.FieldValue`. Under the Functions
// emulator the firebase-admin namespace is substituted, and the `import * as`
// copy loses the statics hanging off `admin.firestore`, so the namespace form
// throws there. This entry point resolves correctly in both environments.
import { FieldValue } from "firebase-admin/firestore";
import { resolveEffectiveOwner } from "../middleware/auth";
import { summarizeTransactions, SummarizableTransaction } from "../tax/summarizeTransactions";
import {
  ESTIMATE_EXCLUSIONS,
  FILING_STATUS_LABELS,
  computeFederalEstimate,
  effectiveTaxYear,
  normalizeFilingStatus,
  nextQuarterlyDueDate,
  quarterlyDueDates,
} from "../shared/taxConstants";

/**
 * Forward-looking tax forecast for one year.
 *
 * Two classes of defect have been fixed here:
 *
 *  1. Filing status — this knew only "single" and "married_filing_jointly".
 *     Other statuses had no bracket or deduction entry, so the lookup yielded
 *     undefined and the maths produced NaN. Unrecognized input is now rejected.
 *
 *  2. Tax lanes — income was pooled into one bucket and expenses into another,
 *     then `income - expenses` was fed to selfEmploymentTax(). That charged
 *     15.3% SE tax on W-2 wages, interest, dividends and rental income, none
 *     of which are self-employment earnings (IRC § 1402(a), and § 1402(a)(1)
 *     excludes rental real estate). It also let Schedule A and Schedule E
 *     deductions reduce Schedule C profit. Aggregation now runs through
 *     summarizeTransactions() and the tax maths through computeFederalEstimate(),
 *     the same two functions every other surface uses.
 */
export const getTaxForecast = onCall({ cors: true, invoker: "public" }, async (request) => {
  // Shared users (spouse / accountant) forecast against the OWNER's data.
  const { effectiveOwnerUid } = await resolveEffectiveOwner(request);
  const db = admin.firestore();

  const data = (request.data ?? {}) as { taxYear?: number; filingStatus?: string };

  const requestedYear = data.taxYear ?? new Date().getFullYear();
  if (!Number.isInteger(requestedYear) || requestedYear < 2000 || requestedYear > 2100) {
    throw new HttpsError("invalid-argument", `Unsupported tax year: ${String(data.taxYear)}`);
  }
  const taxYear = requestedYear;
  const tableYear = effectiveTaxYear(taxYear);

  const filingStatus = normalizeFilingStatus(data.filingStatus ?? "single");
  if (!filingStatus) {
    throw new HttpsError(
      "invalid-argument",
      `Unsupported filing status: ${String(data.filingStatus)}. ` +
        `Expected one of: ${Object.keys(FILING_STATUS_LABELS).join(", ")}.`
    );
  }

  const snap = await db
    .collection("transactions")
    .where("uid", "==", effectiveOwnerUid)
    .where("taxYear", "==", taxYear)
    .get();

  const ytd = summarizeTransactions(
    snap.docs.map((d) => d.data() as SummarizableTransaction)
  );

  // Year-progress fraction. A completed year is fully elapsed (no
  // extrapolation); a future year has nothing to extrapolate from, so its
  // progress is 1 and the YTD figures pass through unscaled instead of being
  // divided by a near-zero fraction and exploding.
  const now = new Date();
  const yearStart = Date.UTC(taxYear, 0, 1);
  const yearEnd = Date.UTC(taxYear + 1, 0, 1);
  const totalMs = yearEnd - yearStart;
  const elapsedMs = now.getTime() - yearStart;
  const progress =
    elapsedMs >= totalMs ? 1
    : elapsedMs <= 0 ? 1
    : Math.max(elapsedMs / totalMs, 1 / 365);

  // Project each lane independently — they must not be pooled and re-split.
  const project = (n: number) => Math.round(n / progress);

  const projScheduleCIncome = project(ytd.scheduleCIncome);
  const projScheduleCExpenses = project(ytd.scheduleCExpenses);
  const projScheduleCNet = projScheduleCIncome - projScheduleCExpenses;
  const projScheduleENet = project(ytd.scheduleEIncome) - project(ytd.scheduleEExpenses);
  const projW2Wages = project(ytd.w2Wages);
  const projOtherOrdinary = project(ytd.otherOrdinaryIncome);
  const projItemized = project(ytd.scheduleADeductions);

  const estimate = computeFederalEstimate({
    scheduleCNet: projScheduleCNet,
    scheduleENet: projScheduleENet,
    w2Wages: projW2Wages,
    otherOrdinaryIncome: projOtherOrdinary,
    itemizedDeductions: projItemized,
    iraContributions: 0,
    filingStatus,
    taxYear: tableYear,
  });

  // Quarterly deadlines — computed with the weekend/holiday shift rather than
  // hard-coded, so every year is right and not just the one that was typed in.
  const today = now.toISOString().split("T")[0];
  const quarters = quarterlyDueDates(taxYear);
  const nextQ = nextQuarterlyDueDate(taxYear, today);

  const passedCount = quarters.filter((q) => q.dueDate < today).length;
  const remaining = 4 - passedCount;
  const perQuarter = Math.round(estimate.totalTax / 4);

  const forecast = {
    uid: effectiveOwnerUid,
    taxYear,
    /** Year whose IRS tables were used — differs from taxYear only if the IRS
     *  hasn't published that year yet. */
    tableYear,
    filingStatus,
    filingStatusLabel: FILING_STATUS_LABELS[filingStatus],

    // ── YTD actuals, by tax lane ──────────────────────────────────────────
    ytdScheduleCIncome: ytd.scheduleCIncome,
    ytdScheduleCExpenses: ytd.scheduleCExpenses,
    ytdScheduleCNet: ytd.scheduleCNet,
    ytdScheduleENet: ytd.scheduleENet,
    ytdW2Wages: ytd.w2Wages,
    ytdOtherOrdinaryIncome: ytd.otherOrdinaryIncome,
    ytdItemizedDeductions: ytd.scheduleADeductions,
    ytdPersonal: ytd.personalSpending,
    /** Every dollar in, across all lanes. NOT the SE tax base. */
    ytdIncome: ytd.totalIncome,
    /** Every deductible dollar out, across all lanes. */
    ytdDeductible: ytd.totalExpenses,
    /** Schedule C net — this, and only this, is what SE tax is charged on. */
    ytdNetProfit: ytd.scheduleCNet,

    // ── Projections ───────────────────────────────────────────────────────
    projectedAnnualIncome: project(ytd.totalIncome),
    projectedAnnualDeductible: project(ytd.totalExpenses),
    projectedScheduleCNet: projScheduleCNet,
    projectedScheduleENet: projScheduleENet,
    projectedW2Wages: projW2Wages,
    projectedOtherOrdinaryIncome: projOtherOrdinary,
    /** Schedule C net profit. Kept under the old key for API compatibility. */
    projectedNetProfit: Math.max(0, projScheduleCNet),

    // ── Tax breakdown ─────────────────────────────────────────────────────
    /** Audit trail: exactly what the 15.3% was applied to. */
    seTaxBase: estimate.seTaxBase,
    /** Schedule SE line 4a — seTaxBase × 92.35%, what both rates apply to. */
    seNetEarnings: estimate.seNetEarnings,
    /** OASDI room left after W-2 wages. The only thing W-2 income changes. */
    seSocialSecurityHeadroom: estimate.seSocialSecurityHeadroom,
    seSocialSecurityTax: estimate.seSocialSecurityTax,
    seMedicareTax: estimate.seMedicareTax,
    projectedSETax: Math.round(estimate.seTax),
    projectedSEDeduction: Math.round(estimate.seDeduction),
    projectedAGI: Math.round(estimate.agi),
    projectedTaxableIncome: Math.round(estimate.taxableIncome),
    standardDeduction: estimate.standardDeduction,
    itemizedDeduction: estimate.itemizedDeduction,
    usingItemized: estimate.usingItemized,
    qbiDeduction: estimate.qbiDeduction,
    qbiStatus: estimate.qbiStatus,
    projectedIncomeTax: Math.round(estimate.federalTax),
    projectedTotalTax: Math.round(estimate.totalTax),
    effectiveTaxRate: estimate.effectiveRate,
    marginalRate: Math.round(estimate.marginalRate * 100),

    // ── Quarterly — null once every deadline has passed ───────────────────
    quarterlyPayment: perQuarter,
    remainingQuarters: remaining,
    quarterlyDueDates: quarters,
    nextQuarterlyDue: nextQ ? nextQ.dueDate : null,
    nextQuarterLabel: nextQ ? nextQ.label : null,

    // ── Meta and honesty ──────────────────────────────────────────────────
    progressPercent: Math.round(progress * 100),
    transactionCount: snap.size,
    excluded: ytd.excluded,
    forceImportedCount: ytd.forceImported,
    /** This is an estimate, not a filing-ready liability. */
    isEstimate: true as const,
    exclusions: ESTIMATE_EXCLUSIONS,
    computedAt: FieldValue.serverTimestamp(),
  };

  await db.collection("forecasts").doc(`${effectiveOwnerUid}_${taxYear}`).set(forecast);
  return forecast;
});
