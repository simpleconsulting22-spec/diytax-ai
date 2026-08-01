import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { resolveEffectiveOwner } from "../middleware/auth";
import { getTaxBucket, isIncomeBucket } from "../shared/taxMap";
import {
  FILING_STATUS_LABELS,
  effectiveTaxYear,
  federalIncomeTax,
  normalizeFilingStatus,
  nextQuarterlyDueDate,
  pickYear,
  quarterlyDueDates,
  selfEmploymentTax,
  STANDARD_DEDUCTION_BY_YEAR,
} from "../shared/taxConstants";

/**
 * Forward-looking tax forecast for one year.
 *
 * Previously this file knew only "single" and "married_filing_jointly": head of
 * household, married filing separately and qualifying surviving spouse had no
 * bracket or deduction entry, so the lookup yielded undefined and the maths
 * produced NaN with no rejection path. Anything unrecognized is now rejected
 * outright — a wrong tax number shown confidently is worse than an error.
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

  // Load all transactions for this tax year
  const snap = await db
    .collection("transactions")
    .where("uid", "==", effectiveOwnerUid)
    .where("taxYear", "==", taxYear)
    .get();

  let ytdIncome = 0;
  let ytdDeductible = 0;
  let ytdPersonal = 0;
  let excludedTransfers = 0;
  let excludedNeedsReview = 0;

  snap.docs.forEach((d) => {
    const t = d.data();

    // Transfers move the user's own money; they are neither income nor expense.
    if (t.type === "transfer") {
      excludedTransfers++;
      return;
    }
    // Unreviewed rows are guesses — don't bake them into a payment figure.
    if (t.status === "needs_review") {
      excludedNeedsReview++;
      return;
    }

    const amt = Math.abs((t.amount as number) ?? 0); // amounts may be stored signed
    const bucket = getTaxBucket({
      category: t.category,
      taxCategory: t.taxCategory,
      taxSchedule: t.taxSchedule,
      type: t.type,
      entityType: t.entityType,
    });

    if (isIncomeBucket(bucket)) {
      ytdIncome += amt;
    } else if (bucket === "personal") {
      ytdPersonal += amt;
    } else {
      // Refunds reduce the expense they reverse rather than adding to it.
      ytdDeductible += t.type === "refund" ? -amt : amt;
    }
  });

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

  // Full-year projections
  const projIncome = Math.round(ytdIncome / progress);
  const projDeductible = Math.round(ytdDeductible / progress);
  const projNetProfit = Math.max(0, projIncome - projDeductible);

  // Tax maths — year-indexed tables, shared with the dashboard calculator.
  const { seTax, deductiblePortion } = selfEmploymentTax(projNetProfit, tableYear);
  const seTaxRounded = Math.round(seTax);
  const seDeduction = Math.round(deductiblePortion);
  const agi = Math.max(0, projNetProfit - seDeduction);
  const stdDed = pickYear(tableYear, STANDARD_DEDUCTION_BY_YEAR)[filingStatus];
  const taxableIncome = Math.max(0, agi - stdDed);
  const { tax: incomeTaxRaw, marginalRate } = federalIncomeTax(taxableIncome, filingStatus, tableYear);
  const incomeTax = Math.round(incomeTaxRaw);
  const totalTax = seTaxRounded + incomeTax;
  const effectiveRate =
    projNetProfit > 0 ? Math.round((totalTax / projNetProfit) * 1000) / 10 : 0;

  // Quarterly deadlines — computed with the weekend/holiday shift rather than
  // hard-coded, so every year is right and not just the one that was typed in.
  const today = now.toISOString().split("T")[0];
  const quarters = quarterlyDueDates(taxYear);
  const nextQ = nextQuarterlyDueDate(taxYear, today);

  const passedCount = quarters.filter((q) => q.dueDate < today).length;
  const remaining = 4 - passedCount;
  const perQuarter = Math.round(totalTax / 4);

  const forecast = {
    uid: effectiveOwnerUid,
    taxYear,
    /** Year whose IRS tables were used — differs from taxYear only if the IRS
     *  hasn't published that year yet. */
    tableYear,
    filingStatus,
    filingStatusLabel: FILING_STATUS_LABELS[filingStatus],
    // YTD actuals
    ytdIncome: round2(ytdIncome),
    ytdDeductible: round2(ytdDeductible),
    ytdPersonal: round2(ytdPersonal),
    ytdNetProfit: round2(ytdIncome - ytdDeductible),
    // Projections
    projectedAnnualIncome: projIncome,
    projectedAnnualDeductible: projDeductible,
    projectedNetProfit: projNetProfit,
    // Tax breakdown
    projectedSETax: seTaxRounded,
    projectedSEDeduction: seDeduction,
    projectedAGI: agi,
    projectedTaxableIncome: taxableIncome,
    standardDeduction: stdDed,
    projectedIncomeTax: incomeTax,
    projectedTotalTax: totalTax,
    effectiveTaxRate: effectiveRate,
    marginalRate: Math.round(marginalRate * 100),
    // Quarterly — nextQuarterlyDue is null once every deadline has passed.
    quarterlyPayment: perQuarter,
    remainingQuarters: remaining,
    quarterlyDueDates: quarters,
    nextQuarterlyDue: nextQ ? nextQ.dueDate : null,
    nextQuarterLabel: nextQ ? nextQ.label : null,
    // Meta
    progressPercent: Math.round(progress * 100),
    transactionCount: snap.size,
    excluded: {
      transfers: excludedTransfers,
      needsReview: excludedNeedsReview,
    },
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("forecasts").doc(`${effectiveOwnerUid}_${taxYear}`).set(forecast);
  return forecast;
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
