import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

/**
 * acceptInvite — Called by the invited user after clicking the invite link.
 *
 * Verifies the invite, links the user to the owner, and writes the
 * effectiveOwnerUid/role to the shared user's profile so AuthContext can
 * resolve it on login.
 *
 * Firestore writes:
 *   users/{ownerUid}.sharedAccess   → arrayUnion { uid, role, email }
 *   users/{ownerUid}.sharedUids     → arrayUnion uid          (for rules hasAny)
 *   users/{ownerUid}.sharedRoles    → { [uid]: role }         (for rules map lookup)
 *   users/{callerUid}.ownerUid      → ownerUid
 *   users/{callerUid}.role          → role
 *   invites/{inviteId}.status       → "accepted"
 */
export const acceptInvite = onCall(
  { cors: true, invoker: "public" },
  async (request) => {
    const callerUid = await requireAuth(request);
    const { inviteId } = request.data as { inviteId?: string };

    if (!inviteId || typeof inviteId !== "string") {
      throw new HttpsError("invalid-argument", "inviteId is required.");
    }

    const db = admin.firestore();
    const inviteDoc = await db.collection("invites").doc(inviteId).get();

    if (!inviteDoc.exists) {
      throw new HttpsError("not-found", "Invite not found.");
    }

    const invite = inviteDoc.data()!;

    if (invite.status !== "pending") {
      throw new HttpsError("failed-precondition", "This invite has already been used.");
    }

    // Verify the caller's email matches the invite.
    const authUser = await admin.auth().getUser(callerUid);
    const callerEmail = authUser.email?.toLowerCase() ?? "";
    if (callerEmail !== invite.email) {
      throw new HttpsError(
        "permission-denied",
        "Your account email does not match the invited email address."
      );
    }

    const ownerUid = invite.ownerUid as string;
    const role = invite.role as "spouse" | "accountant";

    // Prevent a user from linking to themselves.
    if (ownerUid === callerUid) {
      throw new HttpsError("invalid-argument", "Cannot accept your own invite.");
    }

    // ── Atomic batch write ─────────────────────────────────────────────────────
    const batch = db.batch();

    // 1. Update owner's user doc with shared access info.
    const ownerRef = db.collection("users").doc(ownerUid);
    batch.update(ownerRef, {
      sharedAccess: admin.firestore.FieldValue.arrayUnion({ uid: callerUid, role, email: callerEmail }),
      sharedUids:   admin.firestore.FieldValue.arrayUnion(callerUid),
      [`sharedRoles.${callerUid}`]: role,
    });

    // 2. Write effective owner info to shared user's profile.
    //    AuthContext reads this on login to resolve effectiveOwnerUid and role.
    const sharedUserRef = db.collection("users").doc(callerUid);
    batch.set(sharedUserRef, {
      ownerUid,
      role,
      email: callerEmail,
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 3. Mark invite as accepted.
    const inviteRef = db.collection("invites").doc(inviteId);
    batch.update(inviteRef, {
      status:         "accepted",
      acceptedAt:     admin.firestore.FieldValue.serverTimestamp(),
      acceptedByUid:  callerUid,
    });

    await batch.commit();

    console.log(`[acceptInvite] callerUid=${callerUid} linked to ownerUid=${ownerUid} as ${role}`);
    return { success: true, ownerUid, role };
  }
);
