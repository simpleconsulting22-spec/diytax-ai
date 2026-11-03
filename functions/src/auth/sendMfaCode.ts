import { randomInt } from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import {
  sendEmail,
  maskEmail,
  describeEmailFailure,
} from "../services/emailService";
import { reserveMfaAttempt, MfaThrottleError } from "./mfaThrottle";

/**
 * Six digits from a CSPRNG. Math.random() is a seeded PRNG (xorshift128+ in
 * V8), not a cryptographic one: its output stream is predictable from enough
 * observed values, and an OTP is exactly the thing that must not be guessable.
 */
function generateCode(): string {
  return String(randomInt(100000, 1000000));
}

/**
 * Generates a 6-digit OTP and emails it to the user's registered address.
 *
 * Delivery is handled by the shared email service (see services/emailService).
 *
 * Issuance is rate limited server-side (see ./mfaThrottle): 60s between codes,
 * 5 per 15 minutes, 20 per 24 hours, all scoped to the authenticated uid and
 * enforced transactionally. The attempt is reserved before SES is contacted and
 * is not released if delivery fails.
 *
 * Required secrets (Firebase Secret Manager):
 *   RESEND_API_KEY
 */
export const sendMfaCode = onCall(
  {
    cors: true,
    invoker: "public",
    secrets: ["RESEND_API_KEY"],
  },
  async (request) => {
    const uid = await requireAuth(request);

    const userRecord = await admin.auth().getUser(uid);
    const email = userRecord.email;
    if (!email) {
      throw new HttpsError("failed-precondition", "No email address on record.");
    }

    const code = generateCode();
    const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Reserves the attempt and writes the new code atomically. Throws before
    // any provider contact if a limit is exceeded.
    try {
      await reserveMfaAttempt(uid, { mfaCode: code, mfaCodeExpiry: expiry });
    } catch (error: unknown) {
      if (error instanceof MfaThrottleError) {
        // `reason` is recorded server-side only — the client is told nothing
        // about which limit tripped, the counters, or the timestamps.
        console.warn("[sendMfaCode] throttled", {
          operation: "sendMfaCode",
          reason: error.reason,
          uid,
        });
        throw new HttpsError(
          "resource-exhausted",
          "Too many verification requests. Please wait a few minutes and try again."
        );
      }
      throw error;
    }

    try {
      // Resolves only once the provider accepted the message, so `sent: true`
      // below is never reported for a message that was rejected.
      await sendEmail({
        to: email,
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
    } catch (error: unknown) {
      // Structured, log-safe diagnostics: operation, safe category, AWS
      // exception name and request id. No code, body, address or credential.
      console.error("[sendMfaCode] delivery failed", {
        ...describeEmailFailure("sendMfaCode", error),
        uid,
      });
      // Every failure mode looks identical to the client, so nothing about the
      // account, the sending domain or SES state can be probed from outside.
      throw new HttpsError(
        "unavailable",
        "Verification email could not be sent right now. Please try again shortly."
      );
    }

    console.log(`MFA code sent to ${maskEmail(email)}`);
    return { sent: true, maskedEmail: maskEmail(email) };
  }
);
