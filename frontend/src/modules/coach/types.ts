// Public types for the Coach (Budget & Spending) page.
//
// Design principle: every number on the page comes from a deterministic
// computation. LLM rephrasing (Phase 2+) layers on top of these structures
// without changing them.

export type Confidence = "high" | "medium" | "low";
export type Effort     = "low" | "medium" | "high";

// ─── Trust layer (attached to every insight) ─────────────────────────────────

export interface InsightDriver {
  kind:   "category" | "merchant" | "transaction" | "account";
  label:  string;
  /** Signed dollars; convention: positive = expense */
  amount: number;
  ref?:   { id: string; type: "txn" | "category" | "account" };
}

export interface TrustMeta {
  /** Human-readable window: "Last 30 days", "May 1–May 3", etc. */
  windowLabel:    string;
  /** ISO range to compute baselines deterministically */
  windowStart:    string;
  windowEnd:      string;
  /** What the comparison was against */
  baselineLabel:  string;
  /** Rows / amounts / merchants that drove this insight */
  drivers:        InsightDriver[];
  confidence:     Confidence;
  /** Optional reasons confidence was reduced (stale data, low row count, etc.) */
  confidenceReasons?: string[];
}

// ─── Insight (generic structure used by all sections) ────────────────────────

export type InsightKind =
  | "runway" | "risk" | "savings" | "wellness" | "trend" | "due-soon";

export interface Insight {
  /** Stable hash for suppression + dedup. Must be deterministic across renders. */
  id:           string;
  kind:         InsightKind;
  /** What happened (deterministic, plain noun phrase). */
  fact:         string;
  /** Drivers narrative (deterministic from drivers list). */
  why:          string;
  /** Concrete action; NEVER advice without a $ impact for actionable kinds. */
  action:       string;
  /** Required for actionable insights; null only for pure-information items. */
  monthlyImpact: number | null;
  effort:       Effort | null;
  trust:        TrustMeta;
  /** 1 = most urgent. Decision engine ranks ascending. */
  urgency:      1 | 2 | 3 | 4 | 5;
  /** Optional UI hint */
  cta?: { label: string; href?: string };
}

/** Recommendations are insights with non-null impact + effort. */
export interface Recommendation extends Insight {
  monthlyImpact: number;
  effort:        Effort;
}

// ─── Headline metrics (Today's Brief) ────────────────────────────────────────

export interface BriefMetrics {
  safeToSpend:    number;            // available − upcoming bills − overdue
  leftover:       number;            // income − expenses (current period)
  runwayDays:     number | null;     // available / avg daily burn; null if cash flow positive
  dueThisWeek:    number;            // sum of recurring items in next 7d
  overdueAmount:  number;            // sum of overdue recurring items × missed cycles
  weekStart:      string;
  weekEnd:        string;
  /** Optional pointer to the most-relevant insight (decision engine output) */
  keyInsightId?:    string | null;
  /** Optional pointer to the primary recommendation */
  primaryActionId?: string | null;
}

// ─── Section payloads ────────────────────────────────────────────────────────

export interface CategoryRollup {
  category:      string;
  current:       number;             // dollars spent (absolute)
  previous:      number;
  changePct:     number;             // (current − previous) / previous, rounded
  shareOfTotal:  number;             // 0..1
  topMerchants:  Array<{ merchant: string; amount: number }>;
  trust:         TrustMeta;
}

export interface SavingsOpp {
  insight:            Insight;       // monthlyImpact required
  categoryOrMerchant: string;
  trigger:            "increase" | "discretionary" | "subscription" | "anomaly";
}

export interface TrendPoint {
  date:  string;     // YYYY-MM-DD
  value: number;
}

export interface TrendSeries {
  metric:     "spending" | "income" | "savings_rate";
  points:     TrendPoint[];
  windowDays: number;
  changePct:  number;
  /** Spike/anomaly callouts */
  anomalies:  Array<{ date: string; value: number; reason: string }>;
}

export interface DataQuality {
  totalAccounts:    number;
  syncedAccounts:   number;
  syncedPct:        number;          // 0..1
  staleAccounts:    Array<{ accountId: string; name: string; daysSinceSync: number }>;
  /** Aggregate confidence — mirrored into every insight via TrustMeta */
  baseConfidence:   Confidence;
  notes:            string[];
}

// ─── Decision engine I/O ─────────────────────────────────────────────────────

export interface CoachSnapshot {
  brief:                BriefMetrics;
  /** All risk candidates pre-rank, pre-cap. */
  risks:                Insight[];
  /** All savings candidates pre-rank. */
  savingsOpportunities: SavingsOpp[];
  /** Wellness ("doing well") items pre-rank. */
  wellness:             Insight[];
  trends:               TrendSeries[];
  categoryRollup:       CategoryRollup[];
  dataQuality:          DataQuality;
  /** ISO timestamp when this snapshot was computed. */
  generatedAt:          string;
}

export interface DecisionResult {
  /** Top alerts, max 1–2. Always rendered first. */
  risks:            Insight[];
  /** Exactly 1 (may be a synthesized "no urgent action" placeholder). */
  primaryAction:    Recommendation;
  /** Max 2. May be empty. */
  secondaryActions: Recommendation[];
  /** Insights deliberately hidden — surfaced for telemetry, not the UI. */
  suppressed:       Array<{ id: string; reason: string }>;
}

// ─── Page state ──────────────────────────────────────────────────────────────

export type PeriodType = "weekly" | "monthly" | "quarterly" | "annual";

export interface CoachPageState {
  loading:    boolean;
  error:      string | null;
  snapshot:   CoachSnapshot | null;
  decision:   DecisionResult | null;
  periodType: PeriodType;
}
