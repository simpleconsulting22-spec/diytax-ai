import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { requireAuth } from "../middleware/auth";

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "****";
  const masked = local.length <= 2 ? "**" : `${local[0]}***`;
  return `${masked}@${domain}`;
}

/**
 * Generates a 6-digit OTP and emails it to the user's registered address via SendGrid.
 *
 * Required environment variable (functions/.env):
 *   SENDGRID_API_KEY
 */
export const sendMfaCode = onCall(
  { cors: true, invoker: "public", secrets: ["SENDGRID_API_KEY"] },
  async (request) => {
    const uid = await requireAuth(request);

    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;
    if (!email) {
      throw new HttpsError("failed-precondition", "No email address on record.");
    }

    const code = generateCode();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    const db = admin.firestore();
    await db.collection("userSecurity").doc(uid).set(
      { mfaCode: code, mfaCodeExpiry: expiry, mfaVerified: false },
      { merge: true }
    );

    const sgApiKey = process.env.SENDGRID_API_KEY;
    if (!sgApiKey) {
      console.error("Missing SENDGRID_API_KEY");
      throw new HttpsError("internal", "Email service is not configured.");
    }

    sgMail.setApiKey(sgApiKey);
    try {
      await sgMail.send({
        to: email,
        from: "noreply@diytaxai.com",
        subject: "Your DIYTax AI verification code",
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#111827;margin-bottom:8px">Verification Code</h2>
            <p style="color:#6b7280;margin-bottom:24px">Use the code below to complete sign-in. It expires in 10 minutes.</p>
            <div style="font-size:36px;font-weight:700;letter-spacing:10px;font-family:monospace;color:#16A34A;background:#f0fdf4;border-radius:8px;padding:16px 24px;display:inline-block">${code}</div>
            <p style="color:#9ca3af;font-size:13px;margin-top:24px">If you didn't request this code, you can safely ignore this email.</p>
          </div>
        `,
      });
      console.log(`MFA code sent to ${maskEmail(email)}`);
      return { sent: true, maskedEmail: maskEmail(email) };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      console.error("SendGrid MFA error:", msg);
      throw new HttpsError("internal", "Failed to send verification email.");
    }
  }
);
