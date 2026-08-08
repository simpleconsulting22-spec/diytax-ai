import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { sendEmail, maskEmail, describeEmailFailure } from "../services/emailService";

/**
 * sendInvite — Owner invites a spouse or accountant by email.
 *
 * Creates an invite doc in /invites and sends the invitation via the shared
 * email service (see services/emailService).
 *
 * The invite doc is preserved even when delivery fails, so the owner can share
 * the accept link manually. Callers must check `emailSent` rather than assuming
 * a resolved promise means the email went out.
 *
 * Required secrets (Firebase Secret Manager):
 *   AWS_SES_ACCESS_KEY_ID
 *   AWS_SES_SECRET_ACCESS_KEY
 * Required non-secret config (functions/.env):
 *   AWS_SES_REGION
 */
/**
 * How long an invite link stays usable. Must match the "expires in 7 days"
 * line in the email body below — before this existed the email made that claim
 * and nothing enforced it, so every invite ever sent stayed redeemable.
 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const sendInvite = onCall(
  {
    cors: true,
    invoker: "public",
    secrets: ["AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY"],
  },
  async (request) => {
    const ownerUid = await requireAuth(request);
    const { email, role } = request.data as { email?: string; role?: string };

    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }
    if (role !== "spouse" && role !== "accountant") {
      throw new HttpsError("invalid-argument", 'role must be "spouse" or "accountant".');
    }

    const normalizedEmail = email.toLowerCase().trim();
    console.log("[sendInvite] called", { email: maskEmail(normalizedEmail), role, ownerUid });

    const db = admin.firestore();

    // Check for an existing pending invite for this email+owner.
    const existing = await db.collection("invites")
      .where("ownerUid", "==", ownerUid)
      .where("email", "==", normalizedEmail)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    console.log("[sendInvite] existing check done, empty:", existing.empty);

    // Fetch owner's display name for the email body.
    const ownerDoc = await db.collection("userProfiles").doc(ownerUid).get();
    const ownerName: string = (ownerDoc.data()?.ownerName as string) ?? "Your account owner";

    let inviteId: string;
    let alreadyPending: boolean;

    // Epoch milliseconds rather than a Timestamp, matching mfaCodeExpiry: the
    // value has to be readable back and compared inside acceptInvite, and a
    // serverTimestamp sentinel cannot be. Time comes from the server process,
    // never from the client.
    const expiresAt = Date.now() + INVITE_TTL_MS;

    if (!existing.empty) {
      // Reuse the existing invite doc and resend the email. The expiry is
      // extended to match the freshly sent link — the recipient is being told
      // "expires in 7 days" again, so the document has to agree.
      inviteId = existing.docs[0].id;
      alreadyPending = true;
      await existing.docs[0].ref.update({ expiresAt });
      console.log("[sendInvite] resending to existing invite", inviteId);
    } else {
      const inviteRef = await db.collection("invites").add({
        email: normalizedEmail,
        role,
        ownerUid,
        ownerName,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
      });
      inviteId = inviteRef.id;
      alreadyPending = false;
      console.log("[sendInvite] invite doc created:", inviteId);
    }

    const appUrl = "https://diytaxai.com";
    let emailSent = false;

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: `${ownerName} invited you to DIYTax AI`,
        html: `
            <p>Hi,</p>
            <p><strong>${ownerName}</strong> has invited you to access their DIYTax AI account as a <strong>${role}</strong>.</p>
            <p>
              <a href="${appUrl}/accept-invite/${inviteId}"
                 style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">
                Accept Invitation
              </a>
            </p>
            <p>If you don't have an account yet, you'll be prompted to create one first.</p>
            <p style="color:#6b7280;font-size:12px">This link expires in 7 days.</p>
          `,
      });
      emailSent = true;
      console.log("[sendInvite] email sent to", maskEmail(normalizedEmail));
    } catch (err: unknown) {
      // Non-fatal by design: the invite doc stands and the owner can share the
      // link manually. Surfaced to the caller via `emailSent: false` so the UI
      // stops reporting an unqualified success.
      console.error("[sendInvite] delivery failed", {
        ...describeEmailFailure("sendInvite", err),
        inviteId,
        ownerUid,
      });
    }

    // Provider errors stay server-side; the client sees only this shape.
    return { inviteId, alreadyPending, emailSent };
  }
);
