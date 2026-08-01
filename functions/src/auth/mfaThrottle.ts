import * as admin from "firebase-admin";

/**
 * Server-enforced rate limiting for MFA code issuance.
 *
 * The client-side resend button is a usability affordance, not a control —
 * anything enforced in the browser can be bypassed by calling the callable
 * directly. All limits here are enforced inside a Firestore transaction so that
 * concurrent invocations cannot race past them.
 */

/** Minimum gap between two code requests. */
export const COOLDOWN_MS = 60 * 1000;
/** Rolling short window. */
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_WINDOW = 5;
/** Rolling long window. */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_PER_DAY = 20;

/** Which limit tripped. Logged server-side; never returned to the client. */
export type ThrottleReason = "cooldown" | "window" | "daily";

export class MfaThrottleError extends Error {
  readonly reason: ThrottleReason;

  constructor(reason: ThrottleReason) {
    super(`MFA request throttled (${reason}).`);
    this.name = "MfaThrottleError";
    this.reason = reason;
  }
}

export interface MfaCodePayload {
  mfaCode: string;
  mfaCodeExpiry: number;
}

/**
 * Atomically checks the throttle, reserves the attempt, and writes the new
 * code — all in one transaction, so a caller either gets a fresh code and a
 * consumed attempt slot, or nothing at all.
 *
 * Reserving *before* the provider call is deliberate: two parallel invocations
 * cannot both reach SES. The transaction that loses the race re-reads the
 * committed attempt and trips the cooldown.
 *
 * A reserved attempt is **not** released when the provider later fails. If it
 * were, a caller facing a persistent SES error could retry without limit and
 * hammer the provider (and, on SES, incur per-send cost). The cost of this
 * choice is that a user who hits a genuine outage waits out the cooldown; that
 * is the safer trade.
 *
 * Writing the code inside the same transaction preserves the existing
 * invariant that issuing a new code replaces the previous one.
 *
 * Time comes from the server process (`Date.now()`), never from the client.
 * `serverTimestamp()` is unusable here because a sentinel cannot be read back
 * for comparison within the transaction that writes it.
 *
 * Attempt history is bounded by construction: at most MAX_PER_DAY entries are
 * ever retained, and entries older than 24h are pruned on every write.
 *
 * @throws {MfaThrottleError} when any limit is exceeded.
 */
export async function reserveMfaAttempt(
  uid: string,
  payload: MfaCodePayload,
  now: number = Date.now()
): Promise<void> {
  const db = admin.firestore();
  const ref = db.collection("userSecurity").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const raw = snap.exists ? (snap.data()?.mfaAttempts as unknown) : undefined;

    // Prune to the 24h window and discard anything malformed or future-dated.
    const attempts: number[] = (Array.isArray(raw) ? raw : [])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .filter((n) => n <= now && now - n < DAY_MS)
      .sort((a, b) => a - b);

    const last = attempts.length > 0 ? attempts[attempts.length - 1] : undefined;
    if (last !== undefined && now - last < COOLDOWN_MS) {
      throw new MfaThrottleError("cooldown");
    }
    if (attempts.filter((n) => now - n < WINDOW_MS).length >= MAX_PER_WINDOW) {
      throw new MfaThrottleError("window");
    }
    if (attempts.length >= MAX_PER_DAY) {
      throw new MfaThrottleError("daily");
    }

    tx.set(
      ref,
      {
        mfaCode: payload.mfaCode,
        mfaCodeExpiry: payload.mfaCodeExpiry,
        mfaVerified: false,
        mfaAttempts: [...attempts, now].slice(-MAX_PER_DAY),
      },
      { merge: true }
    );
  });
}
