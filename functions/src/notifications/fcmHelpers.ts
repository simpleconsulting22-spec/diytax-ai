import * as admin from "firebase-admin";

export async function sendPush(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<void> {
  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  const fcmToken = userSnap.data()?.fcmToken as string | undefined;
  if (!fcmToken) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data,
      webpush: {
        notification: { icon: "/favicon.ico", badge: "/favicon.ico" },
        fcmOptions: { link: data.link ?? "/dashboard" },
      },
    });
  } catch (err: unknown) {
    const code = (err as { errorInfo?: { code?: string } }).errorInfo?.code ?? "";
    if (
      code === "messaging/invalid-registration-token" ||
      code === "messaging/registration-token-not-registered"
    ) {
      await db.collection("users").doc(uid).update({ fcmToken: admin.firestore.FieldValue.delete() });
    } else {
      throw err;
    }
  }
}

export async function writeHistory(
  uid: string,
  type: string,
  title: string,
  body: string
): Promise<void> {
  await admin.firestore().collection("notificationHistory").add({
    uid,
    type,
    title,
    body,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
