import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";

// Runs 6:30 PM ET every day
export const eveningCapture = onSchedule(
  { schedule: "30 18 * * *", timeZone: "America/New_York" },
  async () => {
    const db = admin.firestore();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const profilesSnap = await db
      .collection("userProfiles")
      .where("notificationSettings.enabled", "==", true)
      .get();

    const eligible = profilesSnap.docs.filter(
      (d) => d.data().notificationSettings?.evening !== false
    );

    await Promise.allSettled(
      eligible.map(async (profileDoc) => {
        const uid = profileDoc.id;

        const txnsToday = await db
          .collection("transactions")
          .where("uid", "==", uid)
          .where("date", ">=", todayStr)
          .where("date", "<=", todayStr)
          .get();

        const count = txnsToday.docs.length;
        const title = "Evening Check-in";
        const body  =
          count === 0
            ? "No transactions logged today — tap to add expenses quickly."
            : `${count} transaction${count > 1 ? "s" : ""} logged today. Anything else to add?`;

        await sendPush(uid, title, body, { link: "/dashboard" });
        await writeHistory(uid, "evening_capture", title, body);
      })
    );
  }
);
