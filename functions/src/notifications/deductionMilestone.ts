import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { sendPush, writeHistory } from "./fcmHelpers";

const MILESTONES = [500, 1_000, 2_500, 5_000, 10_000, 25_000];

export const deductionMilestone = onDocumentWritten("deductions/{docId}", async (event) => {
  const after = event.data?.after?.data();
  if (!after) return; // deletion — skip

  const uid  = after.userId as string | undefined;
  const year = after.taxYear as string | undefined;
  if (!uid || !year) return;

  const db = admin.firestore();

  const profileDoc = await db.collection("userProfiles").doc(uid).get();
  if (!profileDoc.exists) return;
  const settings = profileDoc.data()?.notificationSettings;
  if (!settings?.enabled || settings?.milestone === false) return;

  const deductionsSnap = await db
    .collection("deductions")
    .where("userId", "==", uid)
    .where("taxYear", "==", year)
    .get();

  const total = deductionsSnap.docs.reduce(
    (sum, d) => sum + (d.data().amount ?? 0), 0
  );

  const crossed = MILESTONES.filter((m) => total >= m);
  if (crossed.length === 0) return;
  const milestone = crossed[crossed.length - 1];

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  const historySnap = await db
    .collection("notificationHistory")
    .where("uid", "==", uid)
    .where("type", "==", "deduction_milestone")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (!historySnap.empty) {
    const lastBody = historySnap.docs[0].data().body as string;
    if (lastBody.includes(fmt(milestone))) return; // already sent for this milestone
  }

  const title = "Deduction Milestone Reached!";
  const body  = `You've logged ${fmt(total)} in deductions for ${year}. Keep it up!`;
  await sendPush(uid, title, body, { link: "/deductions" });
  await writeHistory(uid, "deduction_milestone", title, body);
});
