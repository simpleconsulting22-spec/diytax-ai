// Trend series + simple anomaly callouts. v1 anomaly = a daily spending
// total ≥ 2× the rolling 30-day average. Real z-score detection is Phase 2+.

import type { TrendSeries, TrendPoint } from "../types";
import type { CoachTransaction } from "../selectors/transactions";
import { isReconciledExpense, isReconciledIncome } from "../selectors/transactions";

const ANOMALY_FACTOR = 2;

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/** Build a daily TrendPoint series for the past `days` days. */
function dailySeries(
  txns: CoachTransaction[],
  today: Date,
  days: number,
  pick: (t: CoachTransaction) => number,
): TrendPoint[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = iso(new Date(today.getTime() - i * 86_400_000));
    buckets.set(d, 0);
  }
  for (const t of txns) {
    if (!buckets.has(t.date)) continue;
    buckets.set(t.date, (buckets.get(t.date) ?? 0) + pick(t));
  }
  return Array.from(buckets.entries()).map(([date, value]) => ({ date, value: round2(value) }));
}

function changePct(points: TrendPoint[]): number {
  if (points.length < 4) return 0;
  const half  = Math.floor(points.length / 2);
  const prev  = points.slice(0, half).reduce((s, p) => s + p.value, 0);
  const curr  = points.slice(half).reduce((s, p) => s + p.value, 0);
  if (prev === 0) return 0;
  return Math.round(((curr - prev) / prev) * 100);
}

function findAnomalies(points: TrendPoint[]): TrendSeries["anomalies"] {
  if (points.length < 7) return [];
  const avg = points.reduce((s, p) => s + p.value, 0) / points.length;
  if (avg <= 0) return [];
  return points
    .filter((p) => p.value >= avg * ANOMALY_FACTOR && p.value > 50)
    .map((p) => ({ date: p.date, value: p.value, reason: `≥ ${ANOMALY_FACTOR}× the average daily total.` }));
}

export function buildTrends(
  txns: CoachTransaction[],
  today: Date,
  windowDays = 30,
): TrendSeries[] {
  const spending = dailySeries(txns, today, windowDays, (t) =>
    isReconciledExpense(t)
      ? (t.type === "expense" ? Math.abs(t.amount) : -Math.abs(t.amount))
      : 0,
  );
  const income = dailySeries(txns, today, windowDays, (t) =>
    isReconciledIncome(t) ? Math.abs(t.amount) : 0,
  );
  const savingsRate: TrendPoint[] = spending.map((s, i) => {
    const inc = income[i].value;
    return {
      date: s.date,
      value: inc > 0 ? round2((inc - s.value) / inc) : 0,
    };
  });

  return [
    { metric: "spending",     points: spending,    windowDays, changePct: changePct(spending),  anomalies: findAnomalies(spending) },
    { metric: "income",       points: income,      windowDays, changePct: changePct(income),    anomalies: [] },
    { metric: "savings_rate", points: savingsRate, windowDays, changePct: changePct(savingsRate), anomalies: [] },
  ];
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
