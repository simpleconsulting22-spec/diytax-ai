import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { requireAuth } from "../middleware/auth";

/**
 * sendInvite — Owner invites a spouse or accountant by email.
 *
 * Creates an invite doc in /invites and sends an email via the Firebase
 * Email Extension (mail collection). Requires the Trigger Email from
 * Firestore extension to be installed and configured.
 */
export const sendInvite = onCall(
  { cors: true, invoker: "public", secrets: ["SENDGRID_API_KEY"] },
  async (request) => {
    const ownerUid = await requireAuth(request);
    const { email, role } = request.data as { email?: string; role?: string };
    console.log("[sendInvite] called", { email, role, ownerUid });

    if (!email || typeof email !== "string") {
      throw new HttpsError("invalid-argument", "A valid email is required.");
    }
    if (role !== "spouse" && role !== "accountant") {
      throw new HttpsError("invalid-argument", 'role must be "spouse" or "accountant".');
    }

    const normalizedEmail = email.toLowerCase().trim();
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

    if (!existing.empty) {
      // Reuse the existing invite doc and resend the email.
      inviteId = existing.docs[0].id;
      alreadyPending = true;
      console.log("[sendInvite] resending to existing invite", inviteId);
    } else {
      const inviteRef = await db.collection("invites").add({
        email: normalizedEmail,
        role,
        ownerUid,
        ownerName,
        status: "pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      inviteId = inviteRef.id;
      alreadyPending = false;
      console.log("[sendInvite] invite doc created:", inviteId);
    }

    // Send invite email via SendGrid.
    try {
      const sgApiKey = process.env.SENDGRID_API_KEY;
      const fromEmail = "noreply@diytaxai.com";
      const appUrl = "https://diytaxai.com";
      if (!sgApiKey) {
        console.warn("[sendInvite] SENDGRID_API_KEY not set — skipping email send.");
      } else {
        sgMail.setApiKey(sgApiKey);
        await sgMail.send({
          to: normalizedEmail,
          from: fromEmail,
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
        console.log("[sendInvite] email sent to", normalizedEmail);
      }
    } catch (err) {
      // Non-fatal: invite doc exists; owner can share the link manually.
      console.warn("[sendInvite] email send failed:", err);
    }

    return { inviteId, alreadyPending };
  }
);
