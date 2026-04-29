import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

// ── 2024/2025 tax constants ───────────────────────────────────────────────────

const SS_WAGE_BASE = 168600;

type FilingStatus = "single" | "married_filing_jointly";

const BRACKETS: Record<FilingStatus, Array<{ max: number; rate: number }>> = {
  single: [
    { max: 11600,  rate: 0.10 },
    { max: 47150,  rate: 0.12 },
    { max: 100525, rate: 0.22 },
    { max: 191950, rate: 0.24 },
    { max: 243725, rate: 0.32 },
    { max: 609350, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
  married_filing_jointly: [
    { max: 23200,  rate: 0.10 },
    { max: 94300,  rate: 0.12 },
    { max: 201050, rate: 0.22 },
    { max: 383900, rate: 0.24 },
    { max: 487450, rate: 0.32 },
    { max: 731200, rate: 0.35 },
    { max: Infinity, rate: 0.37 },
  ],
};

const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single:                  14600,
  married_filing_jointly:  29200,
};

// Quarterly due dates for a given tax year
function quarterlyDates(year: number) {
  return [
    { quarter: 1, label: "Q1", dueDate: `${year}-04-15` },
    { quarter: 2, label: "Q2", dueDate: `${year}-06-16` },
    { quarter: 3, label: "Q3", dueDate: `${year}-09-15` },
    { quarter: 4, label: "Q4", dueDate: `${year + 1}-01-15` },
  ];
}

function calcIncomeTax(taxable: number, status: FilingStatus): number {
  if (taxable <= 0) return 0;
  const brackets = BRACKETS[status];
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, b.max) - prev) * b.rate;
    prev = b.max;
  }
  return Math.round(tax);
}

function calcSETax(netProfit: number): number {
  if (netProfit <= 0) return 0;
  const seIncome = netProfit * 0.9235;
  const ssTax    = Math.min(seIncome, SS_WAGE_BASE) * 0.124;
  const medTax   = seIncome * 0.029;
  return Math.round(ssTax + medTax);
}

// ── Main export ───────────────────────────────────────────────────────────────

export const getTaxForecast = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  const db  = admin.firestore();

  const data = (request.data ?? {}) as { taxYear?: number; filingStatus?: string };
  const taxYear      = data.taxYear ?? new Date().getFullYear();
  const filingStatus = (
    data.filingStatus === "married_filing_jointly" ? "married_filing_jointly" : "single"
  ) as FilingStatus;

  // Load all transactions for this tax year
  const snap = await db
    .collection("transactions")
    .where("uid", "==", uid)
    .where("taxYear", "==", taxYear)
    .get();

  let ytdIncome      = 0;
  let ytdDeductible  = 0;
  let ytdPersonal    = 0;

  snap.docs.forEach((d) => {
    const t = d.data();
    const amt = Math.abs((t.amount as number) ?? 0); // amounts may be stored signed
    if (t.type === "income") {
      ytdIncome += amt;
    } else if (t.taxCategory && t.taxCategory !== "" && t.taxCategory !== "Personal") {
      ytdDeductible += amt;
    } else {
      ytdPersonal += amt;
    }
  });

  // Year-progress fraction (clamped to 1 for completed years)
  const now      = new Date();
  const yearStart = new Date(`${taxYear}-01-01T00:00:00`);
  const yearEnd   = new Date(`${taxYear + 1}-01-01T00:00:00`);
  const totalMs   = yearEnd.getTime() - yearStart.getTime();
  const elapsedMs = Math.min(totalMs, Math.max(86400000, now.getTime() - yearStart.getTime()));
  const progress  = elapsedMs / totalMs; // 0 → 1

  // Full-year projections
  const projIncome     = Math.round(ytdIncome     / progress);
  const projDeductible = Math.round(ytdDeductible / progress);
  const projNetProfit  = Math.max(0, projIncome - projDeductible);

  // Tax maths
  const seTax           = calcSETax(projNetProfit);
  const seDeduction     = Math.round(seTax * 0.5);
  const agi             = Math.max(0, projNetProfit - seDeduction);
  const stdDed          = STANDARD_DEDUCTION[filingStatus];
  const taxableIncome   = Math.max(0, agi - stdDed);
  const incomeTax       = calcIncomeTax(taxableIncome, filingStatus);
  const totalTax        = seTax + incomeTax;
  const effectiveRate   = projNetProfit > 0
    ? Math.round((totalTax / projNetProfit) * 1000) / 10
    : 0;

  // Next quarterly due date
  const today    = now.toISOString().split("T")[0];
  const quarters = quarterlyDates(taxYear);
  const nextQ    = quarters.find((q) => q.dueDate >= today) ?? quarters[3];

  // Quarters already passed — recommend amount still owed
  const passedCount  = quarters.filter((q) => q.dueDate < today).length;
  const remaining    = 4 - passedCount;
  const perQuarter   = Math.round(totalTax / 4);

  const forecast = {
    uid,
    taxYear,
    filingStatus,
    // YTD actuals
    ytdIncome:            Math.round(ytdIncome     * 100) / 100,
    ytdDeductible:        Math.round(ytdDeductible * 100) / 100,
    ytdPersonal:          Math.round(ytdPersonal   * 100) / 100,
    ytdNetProfit:         Math.round((ytdIncome - ytdDeductible) * 100) / 100,
    // Projections
    projectedAnnualIncome:        projIncome,
    projectedAnnualDeductible:    projDeductible,
    projectedNetProfit:   projNetProfit,
    // Tax breakdown
    projectedSETax:       seTax,
    projectedSEDeduction: seDeduction,
    projectedAGI:         agi,
    projectedTaxableIncome: taxableIncome,
    projectedIncomeTax:   incomeTax,
    projectedTotalTax:    totalTax,
    effectiveTaxRate:     effectiveRate,
    // Quarterly
    quarterlyPayment:     perQuarter,
    remainingQuarters:    remaining,
    nextQuarterlyDue:     nextQ.dueDate,
    nextQuarterLabel:     nextQ.label,
    // Meta
    progressPercent:      Math.round(progress * 100),
    transactionCount:     snap.size,
    computedAt:           admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("forecasts").doc(`${uid}_${taxYear}`).set(forecast);
  return forecast;
});
