import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import * as dotenv from "dotenv";
import { requireAuth } from "../middleware/auth";

dotenv.config();

export const sendMfaCode = onCall(
  { cors: true, invoker: "public" },
  async (request) => {
    console.log("🚀 sendMfaCode triggered");

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

    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
      console.error("❌ Missing SendGrid environment variables");
      throw new HttpsError(
        "internal",
        "SendGrid environment variables not configured."
      );
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

    const msg = {
      to: data.email,
      from: process.env.SENDGRID_FROM_EMAIL as string,
      subject: "DIYTax AI - Your Verification Code",
      text: `Your DIYTax AI verification code is: ${code}

This code expires in 10 minutes.

If you did not request this code, please ignore this email.`,
    };

    console.log("📧 Sending email via SendGrid...");

    try {
      const response = await sgMail.send(msg);
      console.log("✅ SENDGRID RESPONSE:", response[0].statusCode);
      return { sent: true };
    } catch (error: any) {
      console.error("❌ SENDGRID ERROR:", error.response?.body || error.message);
      throw new HttpsError(
        "internal",
        "Failed to send verification email."
      );
    }
  }
);
