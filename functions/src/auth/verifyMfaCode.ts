import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import { requireAuth } from "../middleware/auth";
import twilio from "twilio";

dotenv.config();

/**
 * Verifies a code submitted by the user via Twilio Verify.
 *
 * Required environment variables (functions/.env):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_VERIFY_SERVICE_SID   — starts with "VA"
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

  const phone: string | undefined = securitySnap.data()?.mfaPhone;
  if (!phone) {
    throw new HttpsError("not-found", "No phone number on record. Please request a new code.");
  }

  const accountSid       = process.env.TWILIO_ACCOUNT_SID;
  const authToken        = process.env.TWILIO_AUTH_TOKEN;
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !verifyServiceSid) {
    console.error("Missing Twilio environment variables");
    throw new HttpsError("internal", "SMS service is not configured.");
  }

  const client = twilio(accountSid, authToken);

  let status: string;
  try {
    const check = await client.verify.v2
      .services(verifyServiceSid)
      .verificationChecks.create({ to: phone, code: data.code.trim() });
    status = check.status;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Twilio Verify check error:", msg);
    throw new HttpsError("internal", "Failed to verify code.");
  }

  if (status !== "approved") {
    throw new HttpsError("invalid-argument", "Invalid or expired code. Please try again.");
  }

  await db.collection("userSecurity").doc(uid).update({ mfaVerified: true });
  await db.collection("users").doc(uid).update({ mfaEnabled: true });

  return { verified: true };
});
