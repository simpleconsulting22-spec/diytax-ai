// Runway / safe-to-spend math.
//
// safeToSpend = available balance − bills due in next 7 days
// runwayDays  = available balance / avg daily burn (last 30 days), or null if
//               cash-flow-positive
// leftover    = income − expenses for the current period

import type { CoachTransaction } from "./transactions";
import type { DateRange } from "./period";
import { isReconciledExpense, isReconciledIncome } from "./transactions";

export interface CoachAccount {
  id:               string;
  name:             string;
  availableBalance: number | null;
  /** ISO timestamp of last successful Plaid sync; null = never synced */
  lastSyncedAt:     string | null;
  /** Whether the account is included in spendable totals (excludes loans, credit, etc.) */
  includeInSpendable?: boolean;
}

export interface CoachRecurringItem {
  id:               string;
  merchantName:     string;
  amount:           number;
  frequency:        "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
  intervalDays:     number;
  lastDate:         string;
  nextExpectedDate: string;
  category?:        string;
  type?:            string;
}

export interface RunwayMetrics {
  safeToSpend:    number;
  leftover:       number;
  runwayDays:     number | null;
  dueThisWeek:    number;
  /** Estimated dollars owed for bills whose nextExpectedDate is in the past
   *  with no matching payment recorded since lastDate. */
  overdueAmount:  number;
  weekStart:      string;
  weekEnd:        string;
}

export interface OverdueBill {
  item:         CoachRecurringItem;
  daysOverdue:  number;
  /** Approximate count of billing periods missed (≥ 1). */
  missedCycles: number;
  /** amount × missedCycles (positive dollars). */
  totalOwed:    number;
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/** Available balance summed across spendable (non-credit, non-loan) accounts. */
export function totalAvailable(accounts: CoachAccount[]): number {
  let total = 0;
  for (const a of accounts) {
    if (a.includeInSpendable === false) continue;
    if (typeof a.availableBalance === "number") total += a.availableBalance;
  }
  return round2(total);
}

/** Recurring items whose next-expected date is in the past — i.e. user hasn't
 *  recorded a payment for the most-recently-expected cycle. The system can't
 *  tell whether the user genuinely missed the payment or paid outside the app
 *  (cash/check), so the caller should phrase carefully. */
export function overdueBills(
  recurring: CoachRecurringItem[],
  today:     Date,
): { items: OverdueBill[]; total: number } {
  const todayIso = iso(today);
  const out: OverdueBill[] = [];
  let total = 0;
  for (const r of recurring) {
    if (!r.nextExpectedDate) continue;
    if (r.nextExpectedDate >= todayIso) continue;
    const nextMs  = Date.parse(`${r.nextExpectedDate}T00:00:00Z`);
    const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
    if (Number.isNaN(nextMs)) continue;
    const daysOverdue = Math.max(1, Math.floor((todayMs - nextMs) / 86_400_000));
    const interval    = r.intervalDays > 0 ? r.intervalDays : 30;
    // Include the missed nextExpected itself (+1) plus any further cycles
    // that have elapsed since.
    const missedCycles = Math.max(1, Math.floor(daysOverdue / interval) + 1);
    const amt          = Math.abs(r.amount);
    const owed         = amt * missedCycles;
    out.push({ item: r, daysOverdue, missedCycles, totalOwed: round2(owed) });
    total += owed;
  }
  // Largest debt first.
  out.sort((a, b) => b.totalOwed - a.totalOwed);
  return { items: out, total: round2(total) };
}

/** Sum of recurring items whose next-expected falls within [today, today+days]. */
export function dueWithinDays(
  recurring: CoachRecurringItem[],
  today:     Date,
  days = 7,
): { items: CoachRecurringItem[]; total: number } {
  const todayIso = iso(today);
  const endIso   = iso(new Date(today.getTime() + days * 86_400_000));
  const items: CoachRecurringItem[] = [];
  let total = 0;
  for (const r of recurring) {
    if (!r.nextExpectedDate) continue;
    if (r.nextExpectedDate < todayIso || r.nextExpectedDate > endIso) continue;
    items.push(r);
    total += Math.abs(r.amount);
  }
  return { items, total: round2(total) };
}

/** Average daily expense over the last 30 days. */
export function avgDailyBurn(
  txns: CoachTransaction[],
  today: Date,
  days = 30,
): number {
  const start = iso(new Date(today.getTime() - days * 86_400_000));
  const end   = iso(today);
  let total = 0;
  for (const t of txns) {
    if (!isReconciledExpense(t)) continue;
    if (t.date < start || t.date > end) continue;
    const abs = Math.abs(t.amount);
    if (t.type === "expense") total += abs;
    else if (t.type === "refund") total -= abs;
  }
  return total > 0 ? round2(total / days) : 0;
}

export function computeRunway(
  txns:      CoachTransaction[],
  accounts:  CoachAccount[],
  recurring: CoachRecurringItem[],
  current:   DateRange,
  today:     Date,
): RunwayMetrics {
  const available = totalAvailable(accounts);

  const week = dueWithinDays(recurring, today, 7);
  const weekStart = iso(today);
  const weekEnd   = iso(new Date(today.getTime() + 7 * 86_400_000));

  const overdue = overdueBills(recurring, today);

  // Subtract overdue too — those dollars are owed and shouldn't show as
  // available to spend. Floors at zero so users falling behind don't see
  // negative "safe to spend".
  const safeToSpend = round2(Math.max(0, available - week.total - overdue.total));

  // Leftover for the current period
  let income = 0, expenses = 0;
  for (const t of txns) {
    if (t.date < current.start || t.date > current.end) continue;
    if (isReconciledIncome(t))       income   += Math.abs(t.amount);
    else if (isReconciledExpense(t)) {
      const abs = Math.abs(t.amount);
      expenses += t.type === "expense" ? abs : -abs;
    }
  }
  const leftover = round2(income - expenses);

  const burn = avgDailyBurn(txns, today, 30);
  const runwayDays = burn > 0 && available > 0 ? Math.floor(available / burn) : null;

  return {
    safeToSpend,
    leftover,
    runwayDays,
    dueThisWeek:   week.total,
    overdueAmount: overdue.total,
    weekStart,
    weekEnd,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
