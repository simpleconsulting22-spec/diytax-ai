import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export async function requireAuth(request: CallableRequest): Promise<string> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  return request.auth.uid;
}

export interface EffectiveOwnerResult {
  /** The uid of the actual logged-in user (used for updatedBy audit fields). */
  callerUid: string;
  /**
   * The uid whose Firestore data should be read/written.
   * - Owners:       same as callerUid
   * - Shared users: the owner's uid stored in users/{callerUid}.ownerUid
   */
  effectiveOwnerUid: string;
  role: "owner" | "spouse" | "accountant";
}

/**
 * Resolves the effective owner UID for shared-access scenarios.
 * Shared users (spouse/accountant) have `ownerUid` written to their
 * users/{uid} doc when they accept an invite.
 */
export async function resolveEffectiveOwner(
  request: CallableRequest
): Promise<EffectiveOwnerResult> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }

  const callerUid = request.auth.uid;
  const db = admin.firestore();

  try {
    const userDoc = await db.collection("users").doc(callerUid).get();
    if (userDoc.exists) {
      const data = userDoc.data()!;
      if (typeof data.ownerUid === "string" && data.ownerUid) {
        const role = (data.role as "spouse" | "accountant") ?? "spouse";
        return { callerUid, effectiveOwnerUid: data.ownerUid, role };
      }
    }
  } catch (err) {
    console.warn("[resolveEffectiveOwner] Failed to look up user doc:", err);
    // Fall through — treat as owner.
  }

  return { callerUid, effectiveOwnerUid: callerUid, role: "owner" };
}
