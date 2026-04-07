import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

/**
 * sendInvite — Owner invites a spouse or accountant by email.
 *
 * Creates an invite doc in /invites and sends an email via the Firebase
 * Email Extension (mail collection). Requires the Trigger Email from
 * Firestore extension to be installed and configured.
 */
export const sendInvite = onCall(
  { cors: true, invoker: "public" },
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
    const db = admin.firestore();

    // Prevent duplicate pending invites for the same email+owner.
    const existing = await db.collection("invites")
      .where("ownerUid", "==", ownerUid)
      .where("email", "==", normalizedEmail)
      .where("status", "==", "pending")
      .limit(1)
      .get();

    if (!existing.empty) {
      // Return the existing invite id so the caller can re-send if needed.
      return { inviteId: existing.docs[0].id, alreadyPending: true };
    }

    // Fetch owner's display name for the email body.
    const ownerDoc = await db.collection("users").doc(ownerUid).get();
    const ownerName: string = (ownerDoc.data()?.displayName as string) ?? "Your account owner";
    const appUrl = process.env.APP_URL ?? "https://diytax.ai";

    const inviteRef = await db.collection("invites").add({
      email: normalizedEmail,
      role,
      ownerUid,
      ownerName,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Send invite email via Firebase Email Extension (writes to /mail collection).
    // If the extension is not installed the write is a no-op for the user experience
    // (invite doc still exists and can be accepted via direct link).
    try {
      await db.collection("mail").add({
        to: normalizedEmail,
        message: {
          subject: `${ownerName} invited you to DIYTax AI`,
          html: `
            <p>Hi,</p>
            <p><strong>${ownerName}</strong> has invited you to access their DIYTax AI account as a <strong>${role}</strong>.</p>
            <p>
              <a href="${appUrl}/accept-invite/${inviteRef.id}"
                 style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">
                Accept Invitation
              </a>
            </p>
            <p>If you don't have an account yet, you'll be prompted to create one first.</p>
            <p style="color:#6b7280;font-size:12px">This link expires in 7 days.</p>
          `,
        },
      });
    } catch (err) {
      // Non-fatal: invite doc exists; owner can share the link manually.
      console.warn("[sendInvite] mail write failed:", err);
    }

    return { inviteId: inviteRef.id, alreadyPending: false };
  }
);
