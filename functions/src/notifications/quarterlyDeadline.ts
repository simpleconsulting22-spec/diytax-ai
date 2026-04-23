import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";

// Quarterly estimated tax payment deadlines (year → [MM-DD])
const QUARTERLY_DATES: Record<number, string[]> = {
  2025: ["2025-04-15", "2025-06-16", "2025-09-15", "2026-01-15"],
  2026: ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"],
  2027: ["2027-04-15", "2027-06-16", "2027-09-15", "2028-01-15"],
};

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

    const allDeadlines = Object.values(QUARTERLY_DATES).flat();
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
