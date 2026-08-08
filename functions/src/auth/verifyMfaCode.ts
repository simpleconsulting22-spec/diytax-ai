import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { consumeVerifyAttempt } from "./mfaThrottle";

/**
 * How long one verification is good for. Matches the window the client used to
 * keep in localStorage, but is now carried in the ID token where the rules can
 * see it and the client cannot forge it.
 */
export const MFA_CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Verifies the 6-digit OTP for the current user and issues the `mfaVerifiedAt`
 * custom claim that Firestore rules gate owner data on.
 *
 * The claim is the point of this function. Previously it wrote
 * `mfaVerified: true` into userSecurity — a collection the rules deny to every
 * client, and which nothing else ever read. Nothing in the data layer knew
 * whether MFA had happened, so the only gate was React state restored from
 * localStorage: forgeable by editing one key, and irrelevant to anyone talking
 * to Firestore or the callables directly with a valid ID token. Moving the
 * signal into the token makes it unforgeable and puts it where the rules
 * evaluate.
 *
 * Guessing is bounded by consumeVerifyAttempt (see ./mfaThrottle): five wrong
 * guesses burn the code. Issuance was already rate limited; that did nothing
 * to stop enumeration of a live code, which is a separate budget.
 */
export const verifyMfaCode = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { code?: string };
  const code = data.code?.trim();
  if (!code || code.length !== 6) {
    throw new HttpsError("invalid-argument", "A 6-digit code is required.");
  }

  const outcome = await consumeVerifyAttempt(uid, code);

  if (outcome === "locked") {
    // Deliberately one message for "expired", "never issued" and "too many
    // wrong guesses". Distinguishing them tells a caller whether a code is
    // currently live for an account, which is a probe worth denying.
    console.warn("[verifyMfaCode] attempt rejected", { uid, outcome });
    throw new HttpsError(
      "failed-precondition",
      "That code is no longer valid. Please request a new one."
    );
  }

  if (outcome === "wrong") {
    throw new HttpsError("invalid-argument", "Invalid code. Please try again.");
  }

  const verifiedAt = Date.now();

  // Merge rather than replace: setCustomUserClaims overwrites the whole claims
  // object, so dropping existing claims here would silently revoke anything
  // else the account carries.
  const existing = (await admin.auth().getUser(uid)).customClaims ?? {};
  await admin.auth().setCustomUserClaims(uid, { ...existing, mfaVerifiedAt: verifiedAt });

  await admin.firestore().collection("users").doc(uid).update({ mfaEnabled: true });

  console.log("[verifyMfaCode] verified", { uid });

  // The claim only reaches the rules once the client refreshes its ID token,
  // which it must do explicitly — Firebase does not refresh on claim change.
  // Returned so the client knows what it should now be holding.
  return { verified: true, mfaVerifiedAt: verifiedAt, ttlMs: MFA_CLAIM_TTL_MS };
});
