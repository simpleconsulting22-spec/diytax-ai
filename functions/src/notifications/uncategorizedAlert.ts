import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";

// Runs 10:00 AM ET every Sunday
export const uncategorizedAlert = onSchedule(
  { schedule: "0 10 * * 0", timeZone: "America/New_York" },
  async () => {
    const db   = admin.firestore();
    const year = new Date().getFullYear().toString();

    const profilesSnap = await db
      .collection("userProfiles")
      .where("notificationSettings.enabled", "==", true)
      .get();

    const eligible = profilesSnap.docs.filter(
      (d) => d.data().notificationSettings?.uncategorized !== false
    );

    await Promise.allSettled(
      eligible.map(async (profileDoc) => {
        const uid = profileDoc.id;
        const snap = await db
          .collection("transactions")
          .where("uid", "==", uid)
          .where("taxYear", "==", year)
          .where("status", "==", "needs_review")
          .get();

        if (snap.empty) return;
        const count = snap.size;
        const title = "Uncategorized Transactions";
        const body  = `${count} transaction${count > 1 ? "s need" : " needs"} review. Categorize them to improve your tax estimate.`;
        await sendPush(uid, title, body, { link: "/review" });
        await writeHistory(uid, "uncategorized_alert", title, body);
      })
    );
  }
);
