import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

export const verifyMfaCode = onCall({ cors: true }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { code?: string };
  if (!data.code) {
    throw new HttpsError("invalid-argument", "Code is required.");
  }

  const db = admin.firestore();
  const securitySnap = await db.collection("userSecurity").doc(uid).get();

  if (!securitySnap.exists) {
    throw new HttpsError("not-found", "No MFA code found. Please request a new code.");
  }

  const security = securitySnap.data()!;

  if (security.mfaCodeExpiry < Date.now()) {
    throw new HttpsError("deadline-exceeded", "Code has expired. Please request a new code.");
  }

  if (security.mfaCode !== data.code) {
    throw new HttpsError("invalid-argument", "Invalid code. Please try again.");
  }

  await db.collection("userSecurity").doc(uid).update({ mfaVerified: true });
  await db.collection("users").doc(uid).update({ mfaEnabled: true });

  return { verified: true };
});
