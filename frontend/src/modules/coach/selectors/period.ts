// Period range selector for the coach page.
//
// Reuses calendar-aligned ranges — current month is "the calendar month
// containing `now`", previous month is the prior calendar month, etc.
// All inputs are explicit dates so unit tests can fix time.

import type { PeriodType } from "../types";

export interface DateRange {
  /** Inclusive ISO date YYYY-MM-DD */
  start: string;
  /** Inclusive ISO date YYYY-MM-DD */
  end:   string;
  /** Human-readable label, e.g. "May 2026" or "Apr 27 – May 3, 2026" */
  label: string;
  /** Number of days in the range (end − start + 1) */
  days:  number;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / 86_400_000) + 1;
}

export function periodRange(now: Date, type: PeriodType): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();

  if (type === "weekly") {
    // Sunday-start weeks; tweak if you prefer Monday-start.
    const dow = now.getUTCDay();    // 0..6
    const start = new Date(Date.UTC(y, m, d - dow));
    const end   = new Date(Date.UTC(y, m, d - dow + 6));
    return {
      start: iso(start), end: iso(end),
      label: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      days:  7,
    };
  }
  if (type === "monthly") {
    const start = new Date(Date.UTC(y, m, 1));
    const end   = new Date(Date.UTC(y, m + 1, 0));
    return {
      start: iso(start), end: iso(end),
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      days:  daysBetween(iso(start), iso(end)),
    };
  }
  if (type === "quarterly") {
    const q = Math.floor(m / 3);
    const start = new Date(Date.UTC(y, q * 3, 1));
    const end   = new Date(Date.UTC(y, q * 3 + 3, 0));
    return {
      start: iso(start), end: iso(end),
      label: `Q${q + 1} ${y}`,
      days:  daysBetween(iso(start), iso(end)),
    };
  }
  // annual
  const start = new Date(Date.UTC(y, 0, 1));
  const end   = new Date(Date.UTC(y, 11, 31));
  return {
    start: iso(start), end: iso(end),
    label: String(y),
    days:  daysBetween(iso(start), iso(end)),
  };
}

/** Previous period of the same shape. */
export function previousPeriodRange(now: Date, type: PeriodType): DateRange {
  if (type === "weekly")    return periodRange(new Date(now.getTime() - 7  * 86_400_000), type);
  if (type === "monthly")   return periodRange(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), type);
  if (type === "quarterly") return periodRange(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)), type);
  return periodRange(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1)), type);
}
