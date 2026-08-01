import { CallableRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * The uid on a callable request, or an `unauthenticated` error.
 *
 * The uid is validated as a non-empty string, not just checked for a truthy
 * `request.auth`. A malformed or unverifiable bearer token can produce an auth
 * object with no usable uid; without this check that fell through to Firestore
 * as an empty document path and surfaced as an opaque 500 instead of a clean
 * 401. Confirmed against the Auth emulator with a junk token.
 */
function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (typeof uid !== "string" || uid.length === 0) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  return uid;
}

export async function requireAuth(request: CallableRequest): Promise<string> {
  return requireUid(request);
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
  const callerUid = requireUid(request);
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
