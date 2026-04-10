import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

/**
 * Verifies the 6-digit OTP stored in userSecurity for the current user.
 */
export const verifyMfaCode = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { code?: string };
  if (!data.code || data.code.trim().length < 6) {
    throw new HttpsError("invalid-argument", "A 6-digit code is required.");
  }

  const db = admin.firestore();
  const securitySnap = await db.collection("userSecurity").doc(uid).get();

  if (!securitySnap.exists) {
    throw new HttpsError("not-found", "No MFA session found. Please request a new code.");
  }

  const securityData = securitySnap.data()!;
  const storedCode: string | undefined = securityData.mfaCode;
  const expiry: number | undefined = securityData.mfaCodeExpiry;

  if (!storedCode || !expiry) {
    throw new HttpsError("not-found", "No code on record. Please request a new code.");
  }

  if (Date.now() > expiry) {
    throw new HttpsError("deadline-exceeded", "Code has expired. Please request a new code.");
  }

  if (data.code.trim() !== storedCode) {
    throw new HttpsError("invalid-argument", "Invalid code. Please try again.");
  }

  await db.collection("userSecurity").doc(uid).update({
    mfaVerified: true,
    mfaCode: admin.firestore.FieldValue.delete(),
    mfaCodeExpiry: admin.firestore.FieldValue.delete(),
  });
  await db.collection("users").doc(uid).update({ mfaEnabled: true });

  return { verified: true };
});
