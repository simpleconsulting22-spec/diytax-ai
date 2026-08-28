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

/**
 * Maximum wrong guesses against a single issued code before it is burned.
 *
 * Issuance limits alone do not bound guessing. A six-digit code is one of
 * 10^6, and with unlimited attempts inside its 10-minute validity window a
 * caller can simply enumerate: Cloud Functions scale out, so the attacker's
 * throughput — not the code space — was the only limit. Five attempts caps the
 * chance of hitting a given code at 5-in-a-million.
 */
export const MAX_VERIFY_ATTEMPTS = 5;

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
        // A fresh code starts with a fresh guess budget. Issuance is itself
        // rate limited above, so this cannot be used to buy unlimited guesses.
        mfaVerifyFailures: 0,
      },
      { merge: true }
    );
  });
}

/** Outcome of consuming one verification attempt. */
export type VerifyOutcome = "ok" | "locked" | "wrong";

/**
 * Consumes one guess against the stored code, transactionally.
 *
 * Read-compare-write has to be atomic: concurrent requests each reading the
 * same failure count would every one of them see a count below the limit and
 * write back count+1, so N parallel guesses would cost a single attempt. That
 * is precisely the shape an attacker uses, so the check runs inside the
 * transaction that records it.
 *
 * A correct code clears the stored code, so it cannot be replayed.
 * Exhausting the budget clears it too — the code is burned, not merely
 * rejected, and the caller must request a new one.
 */
export async function consumeVerifyAttempt(
  uid: string,
  submittedCode: string,
  now: number = Date.now()
): Promise<VerifyOutcome> {
  const db = admin.firestore();
  const ref = db.collection("userSecurity").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() ?? {} : {};

    const storedCode = data.mfaCode as string | undefined;
    const expiry = data.mfaCodeExpiry as number | undefined;
    if (!storedCode || !expiry || now > expiry) return "locked";

    const failures =
      typeof data.mfaVerifyFailures === "number" && Number.isFinite(data.mfaVerifyFailures)
        ? data.mfaVerifyFailures
        : 0;
    if (failures >= MAX_VERIFY_ATTEMPTS) return "locked";

    if (submittedCode !== storedCode) {
      const next = failures + 1;
      const burned = next >= MAX_VERIFY_ATTEMPTS;
      tx.set(
        ref,
        burned
          ? {
              mfaVerifyFailures: next,
              mfaCode: admin.firestore.FieldValue.delete(),
              mfaCodeExpiry: admin.firestore.FieldValue.delete(),
            }
          : { mfaVerifyFailures: next },
        { merge: true }
      );
      return burned ? "locked" : "wrong";
    }

    tx.set(
      ref,
      {
        mfaVerified: true,
        mfaVerifiedAt: now,
        mfaVerifyFailures: 0,
        mfaCode: admin.firestore.FieldValue.delete(),
        mfaCodeExpiry: admin.firestore.FieldValue.delete(),
      },
      { merge: true }
    );
    return "ok";
  });
}
