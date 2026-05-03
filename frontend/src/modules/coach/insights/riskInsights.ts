// Risk insights. Surface things the user must act on — bills due soon,
// available balance below upcoming bills, etc.
//
// Convention: urgency=1 means OVERDRAFT-LEVEL risk (action required now).
// urgency=2 is a heads-up.

import type { Insight, InsightDriver, TrustMeta } from "../types";
import type {
  CoachAccount, CoachRecurringItem,
} from "../selectors/runway";
import { dueWithinDays, totalAvailable } from "../selectors/runway";
import { fmtUsd } from "./format";

export function dueSoonRisk(
  recurring: CoachRecurringItem[],
  accounts:  CoachAccount[],
  today:     Date,
  baseTrust: TrustMeta,
): Insight | null {
  const { items, total } = dueWithinDays(recurring, today, 7);
  if (items.length === 0 || total === 0) return null;

  const available = totalAvailable(accounts);
  const overdraft = available > 0 && total > available;

  // Sort by amount; include EVERY due bill as a driver so the UI can list
  // them all when the user expands the card.
  const sorted = [...items].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const drivers: InsightDriver[] = sorted.map((i) => ({
    kind: "transaction",
    label: `${i.merchantName} (${i.nextExpectedDate})`,
    amount: Math.abs(i.amount),
  }));

  const fact = `${items.length} bill${items.length !== 1 ? "s" : ""} due in the next 7 days totaling ${fmtUsd(total)}.`;
  const why  = `Largest: ${sorted[0].merchantName} at ${fmtUsd(Math.abs(sorted[0].amount))} on ${sorted[0].nextExpectedDate}.`;
  const action = overdraft
    ? `Available balance (${fmtUsd(available)}) won't cover all bills. Move funds or pause discretionary spending.`
    : `You're covered. Confirm the largest charge is expected.`;

  return {
    id: `risk:due-soon:${today.toISOString().slice(0, 10)}`,
    kind: "risk",
    fact, why, action,
    monthlyImpact: null,
    effort: overdraft ? "medium" : "low",
    urgency: overdraft ? 1 : 2,
    trust: { ...baseTrust, drivers },
  };
}

export function lowBalanceRisk(
  accounts: CoachAccount[],
  avgDailyBurnUsd: number,
  baseTrust: TrustMeta,
): Insight | null {
  if (avgDailyBurnUsd <= 0) return null;
  const available = totalAvailable(accounts);
  if (available <= 0) return null;

  const runwayDays = available / avgDailyBurnUsd;
  if (runwayDays > 7) return null;     // only surface when ≤ 1 week

  return {
    id: `risk:low-balance`,
    kind: "risk",
    fact:  `Available balance (${fmtUsd(available)}) covers about ${Math.floor(runwayDays)} day${runwayDays === 1 ? "" : "s"} at your recent spending pace.`,
    why:   `Average daily spending: ${fmtUsd(avgDailyBurnUsd)} over the last 30 days.`,
    action: `Pause large discretionary purchases until the next deposit clears.`,
    monthlyImpact: null,
    effort: "medium",
    urgency: runwayDays <= 3 ? 1 : 2,
    trust: baseTrust,
  };
}
