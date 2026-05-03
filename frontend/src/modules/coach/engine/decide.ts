// Decision engine — ranks candidate insights, applies hard caps, and produces
// the deterministic DecisionResult the page renders.
//
// Ranking key (ascending = higher priority):
//   1. urgency (1..5; lower = more urgent)
//   2. -monthlyImpact (savings/avoidance dollars; bigger = sooner)
//   3. effort weight (low > medium > high)
//
// Caps: at most 1–2 risks shown, exactly 1 primary recommendation,
// at most 2 secondary recommendations.

import type {
  CoachSnapshot, DecisionResult, Insight, Recommendation, TrustMeta,
} from "../types";
import { isSuppressed } from "../insights/suppression";

const MAX_RISKS             = 2;
const MAX_SECONDARY_ACTIONS = 2;

function asRecommendation(i: Insight): Recommendation | null {
  if (i.monthlyImpact === null || i.effort === null) return null;
  return i as Recommendation;
}

const EFFORT_WEIGHT: Record<NonNullable<Insight["effort"]>, number> = {
  low: 0, medium: 1, high: 2,
};

function priorityKey(i: Insight): [number, number, number] {
  return [
    i.urgency,
    -(i.monthlyImpact ?? 0),
    i.effort ? EFFORT_WEIGHT[i.effort] : 3,
  ];
}

function compareInsights(a: Insight, b: Insight): number {
  const ka = priorityKey(a), kb = priorityKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2];
}

function notNull<T>(x: T | null | undefined): x is T {
  return x !== null && x !== undefined;
}

export function decide(snapshot: CoachSnapshot, now: Date = new Date()): DecisionResult {
  const suppressed: Array<{ id: string; reason: string }> = [];
  const nowMs = now.getTime();

  function survives(i: Insight, reason = "user-snoozed"): boolean {
    if (isSuppressed(i.id, nowMs)) {
      suppressed.push({ id: i.id, reason });
      return false;
    }
    return true;
  }

  // ── Risks: filter + sort + cap ────────────────────────────────────────
  const risks = [...snapshot.risks]
    .filter((r) => survives(r))
    .sort(compareInsights)
    .slice(0, MAX_RISKS);

  // ── Recommendation pool ───────────────────────────────────────────────
  // Risks-with-impact + savings opps are the candidate pool. Wellness items
  // are intentionally excluded — they're celebrations, not actions.
  const pool: Recommendation[] = [
    ...snapshot.risks.map(asRecommendation).filter(notNull),
    ...snapshot.savingsOpportunities
      .map((o) => asRecommendation(o.insight))
      .filter(notNull),
  ]
    .filter((r) => survives(r))
    // Don't double-count: skip insights already chosen as risks
    .filter((r) => !risks.find((x) => x.id === r.id))
    .sort(compareInsights);

  // ── Pick exactly 1 primary + ≤2 secondary ─────────────────────────────
  if (pool.length === 0) {
    return {
      risks,
      primaryAction:    placeholderRec(snapshot),
      secondaryActions: [],
      suppressed,
    };
  }
  const [primaryAction, ...rest] = pool;
  const secondaryActions = rest
    .filter((r) => r.id !== primaryAction.id)
    .slice(0, MAX_SECONDARY_ACTIONS);

  return { risks, primaryAction, secondaryActions, suppressed };
}

/** Synthesize a "no urgent action" recommendation when the pool is empty. */
function placeholderRec(snapshot: CoachSnapshot): Recommendation {
  const trust: TrustMeta = {
    windowLabel:   "Now",
    windowStart:   snapshot.generatedAt.slice(0, 10),
    windowEnd:     snapshot.generatedAt.slice(0, 10),
    baselineLabel: "n/a",
    drivers:       [],
    confidence:    snapshot.dataQuality.baseConfidence,
  };
  return {
    id:            "rec:no-urgent-action",
    kind:          "wellness",
    fact:          "No urgent issues detected.",
    why:           "Spending and bills look on track for this period.",
    action:        "Set or revisit your monthly savings goal.",
    monthlyImpact: 0,
    effort:        "low",
    urgency:       5,
    trust,
  };
}
