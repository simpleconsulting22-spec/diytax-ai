// Wellness insights — what the user is doing well. Always positive copy.
// Wellness items are NOT actionable recommendations: they live in their own
// section only. They keep monthlyImpact populated when applicable so the UI
// can quote dollars saved, but the decision engine treats them separately.

import type { Insight, CategoryRollup, InsightDriver, TrustMeta } from "../types";
import { fmtUsd, fmtPct } from "./format";

export function spendingDownInsight(
  current:  number,
  previous: number,
  rollups:  CategoryRollup[],
  baseTrust: TrustMeta,
): Insight | null {
  if (previous <= 0) return null;
  if (current >= previous * 0.95) return null;   // need ≥ 5% drop

  const reductionUsd = Math.round(previous - current);
  const reductionPct = (current - previous) / previous;

  const drivers: InsightDriver[] = [...rollups]
    .filter((r) => r.current < r.previous)
    .sort((a, b) => (b.previous - b.current) - (a.previous - a.current))
    .slice(0, 2)
    .map((r) => ({ kind: "category", label: r.category, amount: r.current }));

  return {
    id:    `wellness:spending-down`,
    kind:  "wellness",
    fact:  `Spending is down ${fmtUsd(reductionUsd)} (${fmtPct(reductionPct * 100)}) vs the prior period.`,
    why:   drivers.length > 0
             ? `Biggest drops: ${drivers.map((d) => d.label).join(", ")}.`
             : `Across-the-board reduction.`,
    action: `Keep the streak — at this pace you'd save about ${fmtUsd(reductionUsd * 12)} this year.`,
    monthlyImpact: reductionUsd,
    effort: "low",
    urgency: 5,
    trust: { ...baseTrust, drivers },
  };
}

export function savingsRateInsight(
  income:   number,
  expenses: number,
  baseTrust: TrustMeta,
): Insight | null {
  if (income <= 0) return null;
  const saved = income - expenses;
  if (saved <= 0) return null;
  const rate = saved / income;
  if (rate < 0.10) return null;        // need ≥ 10% savings rate to congratulate

  return {
    id:    `wellness:savings-rate`,
    kind:  "wellness",
    fact:  `You saved ${fmtUsd(saved)} this period — a ${Math.round(rate * 100)}% savings rate.`,
    why:   `Income: ${fmtUsd(income)}; expenses: ${fmtUsd(expenses)}.`,
    action: rate >= 0.20
             ? `That's well above the 20% rule of thumb. Consider parking the surplus in a high-yield account.`
             : `Solid pace. A 20% rate would save another ${fmtUsd(income * 0.20 - saved)} per period.`,
    monthlyImpact: saved,
    effort: "low",
    urgency: 5,
    trust: baseTrust,
  };
}
