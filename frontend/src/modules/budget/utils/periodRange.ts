// ─── Period range engine ──────────────────────────────────────────────────────

export type PeriodType = "weekly" | "biweekly" | "monthly";

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  label: string; // Human-readable label
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;
}

/**
 * Returns the current period window for the given date and period type.
 * weekly   → Sunday–Saturday of the week containing `date`
 * biweekly → 14-day window ending on `date`
 * monthly  → calendar month containing `date`
 */
export function getPeriodRange(date: Date, periodType: PeriodType): DateRange {
  const d = new Date(date);

  if (periodType === "weekly") {
    const day = d.getDay(); // 0 = Sunday
    const sunday = new Date(d);
    sunday.setDate(d.getDate() - day);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { start: toISO(sunday), end: toISO(saturday), label: fmtLabel(sunday, saturday) };
  }

  if (periodType === "biweekly") {
    const end = new Date(d);
    const start = new Date(d);
    start.setDate(d.getDate() - 13);
    return { start: toISO(start), end: toISO(end), label: fmtLabel(start, end) };
  }

  // monthly
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: toISO(start), end: toISO(end), label: fmtLabel(start, end) };
}

/**
 * Returns the period window immediately preceding the current one.
 */
export function getPreviousPeriodRange(date: Date, periodType: PeriodType): DateRange {
  const current = getPeriodRange(date, periodType);
  const currentStart = new Date(current.start + "T00:00:00");

  if (periodType === "weekly") {
    const prevSunday = new Date(currentStart);
    prevSunday.setDate(currentStart.getDate() - 7);
    const prevSaturday = new Date(prevSunday);
    prevSaturday.setDate(prevSunday.getDate() + 6);
    return { start: toISO(prevSunday), end: toISO(prevSaturday), label: fmtLabel(prevSunday, prevSaturday) };
  }

  if (periodType === "biweekly") {
    const prevEnd = new Date(currentStart);
    prevEnd.setDate(currentStart.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevEnd.getDate() - 13);
    return { start: toISO(prevStart), end: toISO(prevEnd), label: fmtLabel(prevStart, prevEnd) };
  }

  // monthly — go back one calendar month
  const prevMonthEnd = new Date(currentStart);
  prevMonthEnd.setDate(0); // last day of previous month
  const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
  return { start: toISO(prevMonthStart), end: toISO(prevMonthEnd), label: fmtLabel(prevMonthStart, prevMonthEnd) };
}

/** Earliest date we need to fetch transactions from (prev period start). */
export function getEarliestFetchDate(date: Date, periodType: PeriodType): string {
  return getPreviousPeriodRange(date, periodType).start;
}
