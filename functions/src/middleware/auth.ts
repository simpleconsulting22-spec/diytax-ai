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

/** Same window the Firestore rules use in hasFreshMfa(). */
export const MFA_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * The uid, provided the ID token carries a fresh `mfaVerifiedAt` claim.
 *
 * Callables run with the Admin SDK, so the MFA requirement that firestore.rules
 * enforces never reaches them on its own. A token minted before the 6-digit
 * code was entered (or a stolen one) would otherwise reach data the rules
 * deny. Mirrors hasFreshMfa() in firestore.rules.
 */
export function requireFreshMfa(request: CallableRequest, now: number = Date.now()): string {
  const uid = requireUid(request);
  const verifiedAt = (request.auth?.token as Record<string, unknown> | undefined)?.mfaVerifiedAt;
  if (
    typeof verifiedAt !== "number" ||
    now - verifiedAt >= MFA_FRESHNESS_MS ||
    verifiedAt > now + 60_000
  ) {
    throw new HttpsError("permission-denied", "Please verify your sign-in code again.");
  }
  return uid;
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

const SHARED_ROLES = new Set(["spouse", "accountant"]);

/**
 * Resolves the effective owner UID for shared-access scenarios.
 *
 * Shared users (spouse/accountant) have `ownerUid` written to their
 * users/{uid} doc when they accept an invite. That field is only a pointer:
 * the grant itself lives on the OWNER's doc (`sharedUids` + `sharedRoles`),
 * written by acceptInvite. Access is honoured only when the owner's doc
 * confirms the caller, and the role is taken from the owner's doc — never
 * from the caller's own doc, which the caller could once write freely.
 *
 * Anything that doesn't verify falls back to the caller's own data, so a
 * forged or stale pointer yields no access to anyone else's records.
 */
export async function resolveEffectiveOwner(
  request: CallableRequest
): Promise<EffectiveOwnerResult> {
  const callerUid = requireUid(request);
  const db = admin.firestore();

  try {
    const userDoc = await db.collection("users").doc(callerUid).get();
    const ownerUid = userDoc.exists ? userDoc.data()?.ownerUid : undefined;
    if (typeof ownerUid === "string" && ownerUid && ownerUid !== callerUid) {
      const ownerDoc = await db.collection("users").doc(ownerUid).get();
      const owner = ownerDoc.exists ? ownerDoc.data() : undefined;
      const sharedUids: unknown = owner?.sharedUids;
      const role: unknown = owner?.sharedRoles?.[callerUid];
      if (
        Array.isArray(sharedUids) &&
        sharedUids.includes(callerUid) &&
        typeof role === "string" &&
        SHARED_ROLES.has(role)
      ) {
        return { callerUid, effectiveOwnerUid: ownerUid, role: role as "spouse" | "accountant" };
      }
      console.warn(
        `[resolveEffectiveOwner] Unverified ownerUid on caller ${callerUid}: ` +
          `owner ${ownerUid} does not list the caller — using caller's own data.`
      );
    }
  } catch (err) {
    console.warn("[resolveEffectiveOwner] Failed to look up user doc:", err);
    // Fall through — treat as owner.
  }

  return { callerUid, effectiveOwnerUid: callerUid, role: "owner" };
}
