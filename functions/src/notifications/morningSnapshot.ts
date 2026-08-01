import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";
import { quickTaxEstimate } from "../utils/taxEstimate";
import { quarterlyDueDates } from "../shared/taxConstants";

/**
 * Next estimated-tax deadline, computed from the statutory dates with the
 * weekend/holiday shift applied. Replaces a hard-coded list that had to be
 * hand-extended every year (and had 2027 Q2 wrong).
 */
function nextDeadline(now: Date): { label: string; daysUntil: number } | null {
  const year = now.getUTCFullYear();
  const upcoming = [
    ...quarterlyDueDates(year - 1),
    ...quarterlyDueDates(year),
    ...quarterlyDueDates(year + 1),
  ];
  for (const q of upcoming) {
    const date = new Date(q.dueDate + "T12:00:00Z");
    const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
    if (days >= 0) {
      const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      return { label, daysUntil: days };
    }
  }
  return null;
}

// Runs 7:30 AM ET every day
export const morningSnapshot = onSchedule(
  { schedule: "30 7 * * *", timeZone: "America/New_York" },
  async () => {
    const db  = admin.firestore();
    const now = new Date();
    const year = now.getFullYear().toString();
    const deadline = nextDeadline(now);

    const profilesSnap = await db
      .collection("userProfiles")
      .where("notificationSettings.enabled", "==", true)
      .get();

    const eligible = profilesSnap.docs.filter(
      (d) => d.data().notificationSettings?.morning !== false
    );

    await Promise.allSettled(
      eligible.map(async (profileDoc) => {
        const uid     = profileDoc.id;
        const profile = profileDoc.data();

        const txnsSnap = await db
          .collection("transactions")
          .where("uid", "==", uid)
          .where("taxYear", "==", year)
          .get();

        const uncategorized = txnsSnap.docs.filter(
          (d) => d.data().status === "needs_review"
        ).length;

        // Refunds (type=expense, isRefund=true) reduce the expense total —
        // they're never counted as income.
        const income = txnsSnap.docs.reduce((s, d) => {
          const t = d.data();
          return t.type === "income" ? s + (t.amount ?? 0) : s;
        }, 0);
        const expenses = txnsSnap.docs.reduce((s, d) => {
          const t = d.data();
          if (t.type !== "expense") return s;
          const amt = t.amount ?? 0;
          return s + (t.isRefund ? -amt : amt);
        }, 0);
        const netProfit = income - expenses;

        const w2Income    = (profile.w2Income as number) ?? 0;
        const filingStatus = (profile.filingStatus as string) ?? "single";
        const estimate    = quickTaxEstimate(netProfit, w2Income, filingStatus, Number(year));

        const fmt = (n: number) =>
          new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

        const parts: string[] = [
          `Est. tax owed: ${fmt(estimate.totalTax)}`,
          `Net profit: ${fmt(netProfit)}`,
        ];
        if (deadline) {
          parts.push(`Q est. due ${deadline.label} (${deadline.daysUntil}d)`);
        }
        if (uncategorized > 0) {
          parts.push(`${uncategorized} need review`);
        }

        const title = `Good morning — ${year} Tax Snapshot`;
        const body  = parts.join(" · ");

        await sendPush(uid, title, body, { link: "/dashboard" });
        await writeHistory(uid, "morning_snapshot", title, body);
      })
    );
  }
);
