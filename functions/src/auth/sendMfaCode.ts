import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import { requireAuth } from "../middleware/auth";
import twilio from "twilio";

dotenv.config();

/**
 * Sends a verification code via Twilio Verify (purpose-built OTP service —
 * faster and more reliable than the generic Messages API).
 *
 * Required environment variables (functions/.env):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_VERIFY_SERVICE_SID   — starts with "VA", from Twilio Console → Verify → Services
 */
export const sendMfaCode = onCall(
  { cors: true, invoker: "public" },
  async (request) => {
    const uid = await requireAuth(request);

    const data = request.data as { phoneNumber?: string };
    if (!data.phoneNumber) {
      throw new HttpsError("invalid-argument", "Phone number is required.");
    }

    const phone = data.phoneNumber.trim();

    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      throw new HttpsError(
        "invalid-argument",
        "Phone number must be in E.164 format (e.g. +15551234567)."
      );
    }

    const accountSid      = process.env.TWILIO_ACCOUNT_SID;
    const authToken       = process.env.TWILIO_AUTH_TOKEN;
    const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

    if (!accountSid || !authToken || !verifyServiceSid) {
      console.error("Missing Twilio environment variables");
      throw new HttpsError("internal", "SMS service is not configured.");
    }

    // Store the phone on userSecurity so verifyMfaCode can use it
    const db = admin.firestore();
    await db.collection("userSecurity").doc(uid).set(
      { mfaPhone: phone, mfaVerified: false },
      { merge: true }
    );

    const client = twilio(accountSid, authToken);

    try {
      await client.verify.v2
        .services(verifyServiceSid)
        .verifications.create({ to: phone, channel: "sms" });

      console.log(`Verify SMS dispatched to ${phone.slice(0, 6)}****`);
      return { sent: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("Twilio Verify error:", msg);
      throw new HttpsError("internal", "Failed to send SMS verification code.");
    }
  }
);
