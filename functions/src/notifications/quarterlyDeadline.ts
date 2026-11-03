import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";
import { quarterlyDueDates } from "../shared/taxConstants";

const ALERT_DAYS = [30, 14, 3];

function getDaysUntil(deadlineStr: string, today: Date): number {
  const d = new Date(deadlineStr + "T12:00:00Z");
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

// Runs 9:00 AM ET every day
export const quarterlyDeadline = onSchedule(
  { schedule: "0 9 * * *", timeZone: "America/New_York" },
  async () => {
    const db  = admin.firestore();
    const now = new Date();

    // Computed rather than hard-coded, so the weekend/holiday shift is always
    // right and the list never needs hand-extending into a new year.
    const year = now.getUTCFullYear();
    const allDeadlines = [year - 1, year, year + 1]
      .flatMap((y) => quarterlyDueDates(y))
      .map((q) => q.dueDate);
    const upcoming = allDeadlines
      .map((d) => ({ date: d, days: getDaysUntil(d, now) }))
      .filter(({ days }) => ALERT_DAYS.includes(days));

    if (upcoming.length === 0) return;

    const profilesSnap = await db
      .collection("userProfiles")
      .where("notificationSettings.enabled", "==", true)
      .get();

    const eligible = profilesSnap.docs.filter(
      (d) => d.data().notificationSettings?.quarterly !== false
    );

    await Promise.allSettled(
      eligible.map(async (profileDoc) => {
        const uid = profileDoc.id;
        for (const { date, days } of upcoming) {
          const displayDate = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "long", day: "numeric", year: "numeric",
          });
          const title = `Quarterly Tax Due in ${days} Day${days !== 1 ? "s" : ""}`;
          const body  = `Estimated tax payment due ${displayDate}. Pay via IRS Direct Pay to avoid penalties.`;
          await sendPush(uid, title, body, { link: "/tax-summary" });
          await writeHistory(uid, "quarterly_deadline", title, body);
        }
      })
    );
  }
);
