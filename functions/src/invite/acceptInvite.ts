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
/** Fallback TTL for invites written before `expiresAt` was recorded. */
const LEGACY_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Expiry instant for an invite, in epoch ms, or null when it cannot be
 * established (treated by the caller as expired).
 */
function resolveExpiry(invite: admin.firestore.DocumentData): number | null {
  if (typeof invite.expiresAt === "number" && Number.isFinite(invite.expiresAt)) {
    return invite.expiresAt;
  }
  // createdAt is a Timestamp; toMillis() is the only shape written here.
  const createdAt = invite.createdAt;
  if (createdAt && typeof createdAt.toMillis === "function") {
    return createdAt.toMillis() + LEGACY_INVITE_TTL_MS;
  }
  return null;
}

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

    // Reject an expired invite before doing anything else.
    //
    // Invites written before expiresAt existed are aged off their createdAt
    // instead. A legacy invite with neither field is treated as expired rather
    // than as immortal: these predate the read-rule fix on /invites, so any
    // still-pending one must be assumed to have been enumerable. The owner can
    // resend, which mints a fresh expiry.
    const expiresAt = resolveExpiry(invite);
    if (expiresAt === null || Date.now() > expiresAt) {
      throw new HttpsError(
        "failed-precondition",
        "This invite has expired. Ask the account owner to send a new one."
      );
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

    // The address must be *proven*, not merely claimed.
    //
    // Matching on email alone assumes the caller controls the address, and
    // nothing established that: anyone who learned an invited address could
    // register it with email/password and redeem the invite, because Firebase
    // does not verify an address at signup. Federated providers (Google) set
    // emailVerified themselves; password accounts get here via the
    // verification mail the client sends at signup.
    if (!authUser.emailVerified) {
      throw new HttpsError(
        "failed-precondition",
        "Please verify your email address before accepting this invite. " +
          "Check your inbox for the verification link, then try again."
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
