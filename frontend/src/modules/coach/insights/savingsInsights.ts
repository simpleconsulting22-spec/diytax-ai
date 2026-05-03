// Savings opportunity generators. Every output Insight MUST have a
// non-null monthlyImpact and effort — that's what makes it eligible to be
// promoted to a Recommendation by the decision engine.

import type {
  Insight, CategoryRollup, InsightDriver, SavingsOpp,
} from "../types";
import { fmtUsd, fmtPct } from "./format";

const MIN_INCREASE_PCT = 20;     // category up by ≥ 20%
const MIN_INCREASE_USD = 50;     // and ≥ $50 absolute

const DISCRETIONARY = new Set([
  "Meals & Entertainment",
  "Dining & Restaurants",
  "Entertainment",
  "Software & Subscriptions",
  "Travel",
]);

/** A single category increased materially → suggest scaling back. */
export function categoryIncreaseInsight(rollup: CategoryRollup): Insight | null {
  if (rollup.previous <= 0) return null;
  const increaseUsd = rollup.current - rollup.previous;
  if (increaseUsd < MIN_INCREASE_USD) return null;
  if (rollup.changePct < MIN_INCREASE_PCT) return null;

  const drivers: InsightDriver[] = rollup.topMerchants.slice(0, 2).map((m) => ({
    kind: "merchant", label: m.merchant, amount: m.amount,
  }));

  // Suggested target = midpoint between current and prior period (gradual)
  const suggestedTarget = Math.round((rollup.current + rollup.previous) / 2);
  const monthlyImpact   = Math.round(rollup.current - suggestedTarget);

  return {
    id:    `savings:cat-increase:${rollup.category}`,
    kind:  "savings",
    fact:  `${rollup.category} spending is up ${fmtPct(rollup.changePct)} (${fmtUsd(rollup.current)} vs ${fmtUsd(rollup.previous)}).`,
    why:   drivers.length > 0
             ? `Driven by ${drivers.map((d) => d.label).join(" + ")}.`
             : `Multiple merchants contributing.`,
    action: `Reduce ${rollup.category} to ${fmtUsd(suggestedTarget)} this period to save ${fmtUsd(monthlyImpact)}/mo.`,
    monthlyImpact,
    effort: monthlyImpact > 200 ? "medium" : "low",
    urgency: 3,
    trust: { ...rollup.trust, drivers },
  };
}

/** Aggregate discretionary increase. Returns one rolled-up suggestion. */
export function discretionaryOverspendInsight(
  rollups: CategoryRollup[]
): Insight | null {
  const disc = rollups.filter((r) => DISCRETIONARY.has(r.category));
  if (disc.length === 0) return null;

  const cur  = disc.reduce((s, r) => s + r.current, 0);
  const prev = disc.reduce((s, r) => s + r.previous, 0);
  if (prev <= 0) return null;
  if (cur < prev * 1.15) return null;     // <15% increase — skip

  const monthlyImpact = Math.round(cur - prev);
  const drivers: InsightDriver[] = disc
    .sort((a, b) => (b.current - b.previous) - (a.current - a.previous))
    .slice(0, 2)
    .map((r) => ({ kind: "category", label: r.category, amount: r.current }));

  return {
    id:    `savings:discretionary-up`,
    kind:  "savings",
    fact:  `Discretionary spending is up ${fmtUsd(monthlyImpact)} this period.`,
    why:   `${drivers.map((d) => d.label).join(" + ")} together account for most of the increase.`,
    action: `Trim discretionary categories back to last period's level to recover ${fmtUsd(monthlyImpact)}/mo.`,
    monthlyImpact,
    effort: "medium",
    urgency: 3,
    trust: {
      ...disc[0].trust,
      drivers,
    },
  };
}

/** Convert an Insight (with non-null monthlyImpact) to a SavingsOpp wrapper. */
export function asSavingsOpp(
  insight: Insight,
  trigger: SavingsOpp["trigger"],
  categoryOrMerchant: string,
): SavingsOpp | null {
  if (insight.monthlyImpact === null) return null;
  return { insight, categoryOrMerchant, trigger };
}
