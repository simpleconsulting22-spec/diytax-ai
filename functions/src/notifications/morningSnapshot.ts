import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";

// Runs 7:30 AM ET every day
export const morningSnapshot = onSchedule(
  { schedule: "30 7 * * *", timeZone: "America/New_York" },
  async () => {
    const db = admin.firestore();
    const year = new Date().getFullYear().toString();

    const profilesSnap = await db
      .collection("userProfiles")
      .where("notificationSettings.enabled", "==", true)
      .get();

    const eligible = profilesSnap.docs.filter(
      (d) => d.data().notificationSettings?.morning !== false
    );

    await Promise.allSettled(
      eligible.map(async (profileDoc) => {
        const uid = profileDoc.id;
        const txnsSnap = await db
          .collection("transactions")
          .where("uid", "==", uid)
          .where("taxYear", "==", year)
          .get();

        const total = txnsSnap.docs.length;
        const uncategorized = txnsSnap.docs.filter(
          (d) => d.data().status === "needs_review"
        ).length;

        const income  = txnsSnap.docs
          .filter((d) => d.data().type === "income")
          .reduce((s, d) => s + (d.data().amount ?? 0), 0);
        const expenses = txnsSnap.docs
          .filter((d) => d.data().type === "expense")
          .reduce((s, d) => s + (d.data().amount ?? 0), 0);

        const fmt = (n: number) =>
          new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

        const title = "Good morning — Tax Snapshot";
        const body  = `YTD: ${fmt(income)} income · ${fmt(expenses)} expenses · ${uncategorized > 0 ? `${uncategorized} need review` : `${total} transactions logged`}`;

        await sendPush(uid, title, body, { link: "/dashboard" });
        await writeHistory(uid, "morning_snapshot", title, body);
      })
    );
  }
);
