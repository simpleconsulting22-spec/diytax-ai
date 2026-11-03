// Pure analysis for scripts/dry-run-streaming-schedule-c.js. No Firestore, no
// writes: it takes already-loaded rows and returns a report. Tested in
// test/streamingDryRun.test.ts.

export const STREAMING_PATTERN =
  /(netflix|spotify|hulu|disney plus|disney\+|hbo max|max\.com|peacock|paramount\+|youtube premium|youtubepremium|apple music|sirius)/i;

export interface DryRunRow {
  date?: unknown;
  description?: unknown;
  normalizedDescription?: unknown;
  amount?: unknown;
  type?: unknown;
  status?: unknown;
  category?: unknown;
  taxSchedule?: unknown;
  isUserModified?: unknown;
  categorizationSource?: unknown;
}

export interface DryRunLine {
  date: string;
  merchant: string;
  amount: number;
  category: string;
  schedule: string;
  status: string;
  setBy: "you" | "automatic";
  proposal: "move to Personal Subscriptions (needs your approval)" | "leave as is";
}

export interface DryRunReport {
  rowsScanned: number;
  scheduleCExpensesNow: number;
  streamingCharges: number;
  proposedMoves: number;
  proposedMoveTotal: number;
  scheduleCExpensesIfMoved: number;
  lines: DryRunLine[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Merchant text only: digit runs (card, account, reference numbers) masked. */
export function safeMerchant(description: string): string {
  return description.replace(/\d{4,}/g, "####").replace(/\s+/g, " ").trim().slice(0, 32);
}

const countsInScheduleC = (t: DryRunRow) =>
  str(t.taxSchedule) === "Schedule C" && str(t.type) === "expense" && str(t.status) !== "needs_review";

export function analyzeStreaming(rows: DryRunRow[]): DryRunReport {
  const round = (n: number) => Math.round(n * 100) / 100;
  const scheduleCNow = rows.filter(countsInScheduleC).reduce((s, t) => s + Math.abs(num(t.amount)), 0);
  const hits = rows.filter((t) => STREAMING_PATTERN.test(`${str(t.normalizedDescription)} ${str(t.description)}`));

  const lines: DryRunLine[] = hits
    .map((t) => {
      const byUser = t.isUserModified === true;
      const move = !byUser && str(t.taxSchedule) === "Schedule C";
      return {
        date: str(t.date),
        merchant: safeMerchant(str(t.description)),
        amount: round(Math.abs(num(t.amount))),
        category: str(t.category) || "(none)",
        schedule: str(t.taxSchedule) || "-",
        status: str(t.status) || "-",
        setBy: byUser ? ("you" as const) : ("automatic" as const),
        proposal: move ? ("move to Personal Subscriptions (needs your approval)" as const) : ("leave as is" as const),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const moving = hits.filter((t) => t.isUserModified !== true && str(t.taxSchedule) === "Schedule C");
  const moveTotal = moving.filter(countsInScheduleC).reduce((s, t) => s + Math.abs(num(t.amount)), 0);

  return {
    rowsScanned: rows.length,
    scheduleCExpensesNow: round(scheduleCNow),
    streamingCharges: hits.length,
    proposedMoves: moving.length,
    proposedMoveTotal: round(moveTotal),
    scheduleCExpensesIfMoved: round(scheduleCNow - moveTotal),
    lines,
  };
}
