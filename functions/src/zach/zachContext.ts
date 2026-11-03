// Builds the taxpayer context Zach is allowed to see.
//
// Principles:
//   - Scoped: every query is keyed to the verified effective owner uid that
//     resolveEffectiveOwner() returned. Nothing here takes a uid from the
//     request.
//   - Minimized: no names, emails, payer names, merchant descriptions, account
//     identifiers or document ids leave this file. Only totals, counts and
//     category names.
//   - Deterministic: every dollar figure comes from summarizeTransactions()
//     and computeFederalEstimate() — the same engine the app's own pages use.
//     The model explains these numbers; it never produces them.

import * as admin from "firebase-admin";
import {
  FILING_STATUS_LABELS,
  FederalEstimate,
  FilingStatus,
  computeFederalEstimate,
  effectiveTaxYear,
  nextQuarterlyDueDate,
  normalizeFilingStatus,
} from "../shared/taxConstants";
import {
  SummarizableTransaction,
  TaxSummaryTotals,
  summarizeTransactions,
} from "../tax/summarizeTransactions";
import { ZachRouteId } from "./zachRoutes";

export interface ProfileInput {
  filingStatus?: unknown;
  w2Income?: unknown;
  iraContributions?: unknown;
  incomeSources?: unknown;
  enabledSchedules?: unknown;
}

export interface ContextInputs {
  taxYear: number;
  /** ISO date "today", injected for testability. */
  today: string;
  profile: ProfileInput | null;
  transactions: Array<SummarizableTransaction & { duplicateGroupId?: unknown }>;
  manualDeductions: Array<{ type?: unknown; amount?: unknown }>;
  ssaForms: Array<{ totalBenefits?: unknown }>;
  retirementForms: Array<{ totalDistribution?: unknown; taxableAmount?: unknown }>;
}

export type FindingSeverity = "action" | "check" | "info";

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  message: string;
  /** The specific numbers the finding rests on. */
  evidence: string;
  route?: ZachRouteId;
}

export interface ZachContext {
  taxYear: number;
  tableYear: number;
  filingStatus: string | null;
  incomeSourcesSelected: string[];
  schedulesEnabled: string[];
  dataBasis: string;
  totals: {
    scheduleCIncome: number;
    scheduleCExpenses: number;
    scheduleCNet: number;
    scheduleENet: number;
    w2Wages: number;
    w2WagesSource: "transactions" | "profile" | "none";
    otherOrdinaryIncome: number;
    itemizedFromTransactions: number;
    manualDeductions: number;
    iraContributions: number;
    personalSpending: number;
  };
  topCategories: Array<{ category: string; total: number }>;
  manualDeductionsByType: Record<string, number>;
  enteredButNotInEstimate: {
    socialSecurityBenefits: number;
    retirementTaxableAmount: number;
  };
  dataQuality: {
    transactionCount: number;
    needsReview: number;
    uncategorized: number;
    transfersExcluded: number;
    forceImported: number;
    possibleDuplicateGroups: number;
  };
  /** Null when the estimate can't be computed (no filing status). */
  estimate: (Omit<FederalEstimate, "taxYear"> & { filingStatusUsed: string }) | null;
  nextEstimatedPaymentDue: string | null;
  findings: ReviewFinding[];
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

function strList(v: unknown, max = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").slice(0, max).map((s) => s.slice(0, 60));
}

/** Pure: everything Zach knows about the taxpayer, from already-loaded rows. */
export function assembleContext(inputs: ContextInputs): ZachContext {
  const { taxYear, today, profile } = inputs;
  const tableYear = effectiveTaxYear(taxYear);
  const status: FilingStatus | null = normalizeFilingStatus(profile?.filingStatus);

  const ytd: TaxSummaryTotals = summarizeTransactions(inputs.transactions);

  const manualTotal = round2(
    inputs.manualDeductions.reduce((s, d) => s + Math.max(0, num(d.amount)), 0)
  );
  const manualByType: Record<string, number> = {};
  for (const d of inputs.manualDeductions) {
    const t = typeof d.type === "string" ? d.type.slice(0, 40) : "other";
    manualByType[t] = round2((manualByType[t] ?? 0) + Math.max(0, num(d.amount)));
  }

  const profileW2 = Math.max(0, num(profile?.w2Income));
  const ira = Math.max(0, num(profile?.iraContributions));
  // Same rule as the dashboard (frontend taxCalculator.ts): the onboarding W-2
  // figure is used only when no wage rows exist, so the two are never summed.
  const w2Wages = ytd.w2Wages > 0 ? ytd.w2Wages : profileW2;
  const w2WagesSource = ytd.w2Wages > 0 ? "transactions" : profileW2 > 0 ? "profile" : "none";
  const itemized = round2(ytd.scheduleADeductions + manualTotal);

  let estimate: ZachContext["estimate"] = null;
  if (status) {
    const e = computeFederalEstimate({
      scheduleCNet: ytd.scheduleCNet,
      scheduleENet: ytd.scheduleENet,
      w2Wages,
      otherOrdinaryIncome: ytd.otherOrdinaryIncome,
      itemizedDeductions: itemized,
      iraContributions: ira,
      filingStatus: status,
      taxYear,
    });
    const { taxYear: _ignored, ...rest } = e;
    void _ignored;
    estimate = { ...rest, filingStatusUsed: FILING_STATUS_LABELS[status] };
  }

  const duplicateGroups = new Set(
    inputs.transactions
      .map((t) => t.duplicateGroupId)
      .filter((g): g is string => typeof g === "string" && g.length > 0)
  ).size;

  const ssa = round2(inputs.ssaForms.reduce((s, f) => s + Math.max(0, num(f.totalBenefits)), 0));
  const retirementTaxable = round2(
    inputs.retirementForms.reduce((s, f) => s + Math.max(0, num(f.taxableAmount)), 0)
  );

  const currentYear = Number(today.slice(0, 4));
  const next = taxYear >= currentYear - 1 ? nextQuarterlyDueDate(taxYear, today) : null;

  const ctx: ZachContext = {
    taxYear,
    tableYear,
    filingStatus: status ? FILING_STATUS_LABELS[status] : null,
    incomeSourcesSelected: strList(profile?.incomeSources),
    schedulesEnabled: strList(profile?.enabledSchedules),
    dataBasis:
      taxYear >= currentYear
        ? `Transactions recorded so far in ${taxYear} (year to date, not projected)`
        : `Transactions recorded for ${taxYear}`,
    totals: {
      scheduleCIncome: ytd.scheduleCIncome,
      scheduleCExpenses: ytd.scheduleCExpenses,
      scheduleCNet: ytd.scheduleCNet,
      scheduleENet: ytd.scheduleENet,
      w2Wages: round2(w2Wages),
      w2WagesSource,
      otherOrdinaryIncome: ytd.otherOrdinaryIncome,
      itemizedFromTransactions: ytd.scheduleADeductions,
      manualDeductions: manualTotal,
      iraContributions: ira,
      personalSpending: ytd.personalSpending,
    },
    topCategories: [...ytd.byCategory]
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
      .slice(0, 10)
      .map((c) => ({ category: String(c.category).slice(0, 60), total: round2(c.total) })),
    manualDeductionsByType: manualByType,
    enteredButNotInEstimate: {
      socialSecurityBenefits: ssa,
      retirementTaxableAmount: retirementTaxable,
    },
    dataQuality: {
      transactionCount: ytd.transactionCount,
      needsReview: ytd.excluded.needsReview,
      uncategorized: ytd.excluded.uncategorized,
      transfersExcluded: ytd.excluded.transfers,
      forceImported: ytd.forceImported,
      possibleDuplicateGroups: duplicateGroups,
    },
    estimate,
    nextEstimatedPaymentDue: next ? `${next.label}: ${next.dueDate}` : null,
    findings: [],
  };
  ctx.findings = reviewFindings(ctx, profileW2, ytd.w2Wages);
  return ctx;
}

/**
 * Evidence-based review. Each finding cites the numbers it rests on and
 * suggests where to look. None of them changes anything.
 */
export function reviewFindings(
  ctx: ZachContext,
  profileW2: number,
  txnW2: number
): ReviewFinding[] {
  const f: ReviewFinding[] = [];
  const q = ctx.dataQuality;
  const t = ctx.totals;

  if (!ctx.filingStatus) {
    f.push({
      id: "missing_filing_status",
      severity: "action",
      message: "Your filing status isn't set, so no tax estimate can be calculated.",
      evidence: "No filing status on your tax profile.",
      route: "taxProfile",
    });
  }
  if (q.transactionCount === 0) {
    f.push({
      id: "no_transactions",
      severity: "action",
      message: `No transactions are recorded for ${ctx.taxYear}.`,
      evidence: `0 transactions in ${ctx.taxYear}.`,
      route: "bankAccounts",
    });
  }
  if (q.needsReview > 0) {
    f.push({
      id: "needs_review",
      severity: "action",
      message: `${q.needsReview} transaction(s) are waiting for review and are left out of your totals until confirmed.`,
      evidence: `${q.needsReview} of ${q.transactionCount} transactions have status "needs review".`,
      route: "review",
    });
  }
  if (q.uncategorized > 0) {
    f.push({
      id: "uncategorized",
      severity: "check",
      message: `${q.uncategorized} transaction(s) have no category.`,
      evidence: `${q.uncategorized} uncategorized transactions.`,
      route: "review",
    });
  }
  if (q.forceImported > 0) {
    f.push({
      id: "force_imported",
      severity: "check",
      message: `${q.forceImported} transaction(s) were imported past duplicate detection. Make sure none are counted twice.`,
      evidence: `${q.forceImported} force-imported rows.`,
      route: "transactions",
    });
  }
  if (q.possibleDuplicateGroups > 0) {
    f.push({
      id: "possible_duplicates",
      severity: "check",
      message: `${q.possibleDuplicateGroups} group(s) of possible duplicate transactions were flagged.`,
      evidence: `${q.possibleDuplicateGroups} duplicate groups.`,
      route: "transactions",
    });
  }
  if (profileW2 > 0 && txnW2 > 0 && Math.abs(profileW2 - txnW2) > 1) {
    f.push({
      id: "w2_two_sources",
      severity: "check",
      message:
        "Your profile has a W-2 wage figure and your transactions also contain wages. The estimate uses the transactions and ignores the profile figure.",
      evidence: `Profile W-2 ${money(profileW2)}; wage transactions ${money(txnW2)}.`,
      route: "taxProfile",
    });
  }
  if (t.scheduleCIncome > 0 && t.scheduleCExpenses === 0) {
    f.push({
      id: "sch_c_no_expenses",
      severity: "check",
      message: "You have business income but no business expenses recorded. If you had business costs, they may be missing or categorized as personal.",
      evidence: `Schedule C income ${money(t.scheduleCIncome)}, expenses $0.`,
      route: "scheduleC",
    });
  }
  if (t.scheduleCExpenses > 0 && t.scheduleCIncome === 0) {
    f.push({
      id: "sch_c_no_income",
      severity: "check",
      message: "You have business expenses but no business income recorded.",
      evidence: `Schedule C expenses ${money(t.scheduleCExpenses)}, income $0.`,
      route: "scheduleC",
    });
  }
  const e = ctx.estimate;
  if (e && e.itemizedDeduction > 0) {
    const gap = e.standardDeduction - e.itemizedDeduction;
    if (gap > 0 && gap <= e.standardDeduction * 0.15) {
      f.push({
        id: "itemize_close",
        severity: "info",
        message: "Your itemized deductions are close to the standard deduction. Missing deductible items could make itemizing worthwhile.",
        evidence: `Itemized ${money(e.itemizedDeduction)} vs standard ${money(e.standardDeduction)}.`,
        route: "scheduleA",
      });
    }
  }
  if (e && e.qbiStatus === "not_calculated_above_threshold") {
    f.push({
      id: "qbi_not_calculated",
      severity: "info",
      message: "Your income is above the QBI threshold, so the qualified business income deduction isn't calculated. The estimate may overstate your tax.",
      evidence: `AGI ${money(e.agi)} is above the threshold.`,
      route: "taxEstimate",
    });
  }
  if (ctx.enteredButNotInEstimate.socialSecurityBenefits > 0 || ctx.enteredButNotInEstimate.retirementTaxableAmount > 0) {
    f.push({
      id: "income_forms_not_in_estimate",
      severity: "info",
      message: "Social Security or retirement income you entered isn't included in the tax estimate yet.",
      evidence: `Social Security ${money(ctx.enteredButNotInEstimate.socialSecurityBenefits)}; taxable retirement ${money(ctx.enteredButNotInEstimate.retirementTaxableAmount)}.`,
      route: "retirementIncome",
    });
  }
  if (ctx.tableYear !== ctx.taxYear) {
    f.push({
      id: "tables_not_published",
      severity: "info",
      message: `DIYTax AI doesn't have verified IRS figures for ${ctx.taxYear} yet, so ${ctx.tableYear} figures are used.`,
      evidence: `Tables used: ${ctx.tableYear}.`,
    });
  }
  if (ctx.nextEstimatedPaymentDue && t.scheduleCNet > 0) {
    f.push({
      id: "estimated_payment_due",
      severity: "info",
      message: `You have self-employment profit. The next quarterly estimated payment date is ${ctx.nextEstimatedPaymentDue}.`,
      evidence: `Schedule C net ${money(t.scheduleCNet)}.`,
      route: "taxEstimate",
    });
  }
  return f;
}

/** Loads only the owner's rows for one tax year, then assembles. */
export async function loadZachContext(
  db: admin.firestore.Firestore,
  ownerUid: string,
  taxYear: number,
  today: string
): Promise<ZachContext> {
  const byYear = <T extends { taxYear?: unknown; date?: unknown }>(rows: T[]) =>
    rows.filter((r) => {
      const y = typeof r.taxYear === "number" ? r.taxYear : Number(String(r.date ?? "").slice(0, 4));
      return y === taxYear;
    });

  const [profileSnap, txnSnap, dedSnap, ssaSnap, retSnap] = await Promise.all([
    db.collection("userProfiles").doc(ownerUid).get(),
    db.collection("transactions").where("uid", "==", ownerUid).where("taxYear", "==", taxYear).get(),
    db.collection("deductions").where("userId", "==", ownerUid).get(),
    db.collection("ssaForms").where("userId", "==", ownerUid).get(),
    db.collection("retirementForms").where("userId", "==", ownerUid).get(),
  ]);

  return assembleContext({
    taxYear,
    today,
    profile: profileSnap.exists ? (profileSnap.data() as ProfileInput) : null,
    transactions: txnSnap.docs.map((d) => d.data() as SummarizableTransaction),
    manualDeductions: byYear(dedSnap.docs.map((d) => d.data())),
    ssaForms: byYear(ssaSnap.docs.map((d) => d.data())),
    retirementForms: byYear(retSnap.docs.map((d) => d.data())),
  });
}
