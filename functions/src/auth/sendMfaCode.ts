import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

export const sendMfaCode = onCall({ cors: true }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { email?: string };
  if (!data.email) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes

  const db = admin.firestore();

  await db.collection("userSecurity").doc(uid).set({
    mfaCode: code,
    mfaCodeExpiry: expiry,
    mfaVerified: false,
  });

  await db.collection("mail").add({
    to: data.email,
    message: {
      subject: "DIYTax AI Verification Code",
      text: `Your DIYTax AI verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, please ignore this email.`,
    },
  });

  return { sent: true };
});
