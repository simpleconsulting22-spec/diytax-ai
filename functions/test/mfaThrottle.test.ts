import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * In-memory stand-in for the one `userSecurity/{uid}` document.
 *
 * `runTransaction` serializes callbacks against a shared chain, which is the
 * observable guarantee Firestore gives for transactions that touch the same
 * document. That makes the concurrency assertion below meaningful rather than
 * a test of the mock.
 */
const { store, runTransactionMock, docRefs } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  const docRefs = new Map<string, { path: string }>();
  let chain: Promise<unknown> = Promise.resolve();

  const runTransactionMock = vi.fn(
    <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (ref: { path: string }) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
        }),
        set: (
          ref: { path: string },
          value: Record<string, unknown>,
          options?: { merge?: boolean }
        ) => {
          const prev = options?.merge ? store.get(ref.path) ?? {} : {};
          store.set(ref.path, { ...prev, ...value });
        },
      };
      const result = chain.then(() => fn(tx));
      chain = result.catch(() => undefined);
      return result;
    }
  );

  return { store, runTransactionMock, docRefs };
});

vi.mock("firebase-admin", () => ({
  firestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => {
        const path = `${name}/${id}`;
        if (!docRefs.has(path)) docRefs.set(path, { path });
        return docRefs.get(path);
      },
    }),
    runTransaction: runTransactionMock,
  }),
}));

import { rejection } from "./helpers";
import {
  reserveMfaAttempt,
  MfaThrottleError,
  COOLDOWN_MS,
  WINDOW_MS,
  MAX_PER_WINDOW,
  MAX_PER_DAY,
  DAY_MS,
} from "../src/auth/mfaThrottle";

const UID = "user-1";
const PATH = `userSecurity/${UID}`;
const NOW = 1_800_000_000_000;
const PAYLOAD = { mfaCode: "123456", mfaCodeExpiry: NOW + 600_000 };

function seedAttempts(attempts: number[], extra: Record<string, unknown> = {}) {
  store.set(PATH, { mfaAttempts: attempts, ...extra });
}

describe("reserveMfaAttempt", () => {
  beforeEach(() => {
    store.clear();
    runTransactionMock.mockClear();
  });

  it("allows the first request and records the attempt", async () => {
    await reserveMfaAttempt(UID, PAYLOAD, NOW);

    const doc = store.get(PATH)!;
    expect(doc.mfaAttempts).toEqual([NOW]);
    expect(doc.mfaCode).toBe("123456");
    expect(doc.mfaVerified).toBe(false);
  });

  it("rejects a second request inside the 60 second cooldown", async () => {
    seedAttempts([NOW - (COOLDOWN_MS - 1_000)]);

    const err = await rejection<MfaThrottleError>(reserveMfaAttempt(UID, PAYLOAD, NOW));
    expect(err).toBeInstanceOf(MfaThrottleError);
    expect(err.reason).toBe("cooldown");
    // Nothing was reserved.
    expect(store.get(PATH)!.mfaAttempts).toHaveLength(1);
  });

  it("allows a request once the cooldown has elapsed", async () => {
    seedAttempts([NOW - (COOLDOWN_MS + 1_000)]);
    await reserveMfaAttempt(UID, PAYLOAD, NOW);
    expect(store.get(PATH)!.mfaAttempts).toHaveLength(2);
  });

  it("rejects the sixth request inside the 15 minute window", async () => {
    // Five attempts inside the window, the most recent past the cooldown.
    seedAttempts([
      NOW - 90_000,
      NOW - 200_000,
      NOW - 300_000,
      NOW - 400_000,
      NOW - 500_000,
    ]);

    const err = await rejection<MfaThrottleError>(reserveMfaAttempt(UID, PAYLOAD, NOW));
    expect(err.reason).toBe("window");
    expect(store.get(PATH)!.mfaAttempts).toHaveLength(MAX_PER_WINDOW);
  });

  it("allows a request once the 15 minute window has rolled past", async () => {
    // Same five attempts, all now older than the window.
    seedAttempts([
      NOW - (WINDOW_MS + 1_000),
      NOW - (WINDOW_MS + 2_000),
      NOW - (WINDOW_MS + 3_000),
      NOW - (WINDOW_MS + 4_000),
      NOW - (WINDOW_MS + 5_000),
    ]);

    await reserveMfaAttempt(UID, PAYLOAD, NOW);
    expect(store.get(PATH)!.mfaAttempts).toHaveLength(6);
  });

  it("rejects the twenty-first request inside 24 hours", async () => {
    // 20 attempts spaced an hour apart: outside the window, inside the day.
    const attempts = Array.from({ length: MAX_PER_DAY }, (_, i) => NOW - (i + 1) * 3_600_000);
    seedAttempts(attempts);

    const err = await rejection<MfaThrottleError>(reserveMfaAttempt(UID, PAYLOAD, NOW));
    expect(err.reason).toBe("daily");
  });

  it("allows a request once entries age out of the 24 hour window", async () => {
    const attempts = Array.from(
      { length: MAX_PER_DAY },
      (_, i) => NOW - DAY_MS - (i + 1) * 1_000
    );
    seedAttempts(attempts);

    await reserveMfaAttempt(UID, PAYLOAD, NOW);
    // All stale entries pruned, only the new attempt remains.
    expect(store.get(PATH)!.mfaAttempts).toEqual([NOW]);
  });

  it("prevents two concurrent requests from both passing", async () => {
    const results = await Promise.allSettled([
      reserveMfaAttempt(UID, PAYLOAD, NOW),
      reserveMfaAttempt(UID, PAYLOAD, NOW),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(MfaThrottleError);
    // Exactly one attempt was consumed.
    expect(store.get(PATH)!.mfaAttempts).toEqual([NOW]);
  });

  it("replaces the previous code rather than accumulating codes", async () => {
    seedAttempts([NOW - (COOLDOWN_MS + 1_000)], {
      mfaCode: "000000",
      mfaCodeExpiry: NOW - 1,
      mfaVerified: true,
    });

    await reserveMfaAttempt(UID, { mfaCode: "654321", mfaCodeExpiry: NOW + 600_000 }, NOW);

    const doc = store.get(PATH)!;
    expect(doc.mfaCode).toBe("654321");
    expect(doc.mfaCodeExpiry).toBe(NOW + 600_000);
    expect(doc.mfaVerified).toBe(false);
  });

  it("keeps the attempt history bounded and prunes stale entries", async () => {
    const stale = Array.from({ length: 50 }, (_, i) => NOW - DAY_MS - i * 1_000);
    const fresh = Array.from({ length: 10 }, (_, i) => NOW - (i + 2) * 3_600_000);
    seedAttempts([...stale, ...fresh]);

    await reserveMfaAttempt(UID, PAYLOAD, NOW);

    const stored = store.get(PATH)!.mfaAttempts as number[];
    expect(stored.length).toBeLessThanOrEqual(MAX_PER_DAY);
    expect(stored.every((t) => NOW - t < DAY_MS)).toBe(true);
    expect(stored).toContain(NOW);
  });

  it("ignores malformed and future-dated entries", async () => {
    seedAttempts([
      "not-a-number",
      null,
      NaN,
      NOW + 60_000, // clock skew / tampering
    ] as unknown as number[]);

    await reserveMfaAttempt(UID, PAYLOAD, NOW);
    expect(store.get(PATH)!.mfaAttempts).toEqual([NOW]);
  });

  it("treats a document with no attempt history as a first request", async () => {
    store.set(PATH, { mfaVerified: true });
    await reserveMfaAttempt(UID, PAYLOAD, NOW);
    expect(store.get(PATH)!.mfaAttempts).toEqual([NOW]);
  });

  it("scopes limits per uid", async () => {
    seedAttempts([NOW - 1_000]);
    // A different user is unaffected by user-1's cooldown.
    await reserveMfaAttempt("user-2", PAYLOAD, NOW);
    expect(store.get("userSecurity/user-2")!.mfaAttempts).toEqual([NOW]);
  });
});
