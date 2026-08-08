import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { inviteGetMock, getUserMock, commitMock, updateMock, setMock } = vi.hoisted(() => ({
  inviteGetMock: vi.fn(),
  getUserMock: vi.fn(),
  commitMock: vi.fn(),
  updateMock: vi.fn(),
  setMock: vi.fn(),
}));

vi.mock("firebase-admin", () => {
  const firestore = () => ({
    collection: () => ({ doc: () => ({ get: inviteGetMock }) }),
    batch: () => ({ update: updateMock, set: setMock, commit: commitMock }),
  });
  // `admin.firestore` is used both as a factory and as a namespace.
  firestore.FieldValue = {
    serverTimestamp: () => "TS",
    arrayUnion: (v: unknown) => ({ arrayUnion: v }),
  };
  return { firestore, auth: () => ({ getUser: getUserMock }) };
});

import { acceptInvite } from "../src/invite/acceptInvite";

const DAY_MS = 24 * 60 * 60 * 1000;

const REQUEST = { auth: { uid: "invitee-1" }, data: { inviteId: "invite-1" } } as never;

function run(request: unknown = REQUEST) {
  return (
    acceptInvite as unknown as {
      run: (r: unknown) => Promise<{ success: boolean; ownerUid: string; role: string }>;
    }
  ).run(request);
}

/** A pending invite that is valid in every respect unless overridden. */
function invite(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      email: "spouse@example.com",
      role: "spouse",
      ownerUid: "owner-1",
      status: "pending",
      expiresAt: Date.now() + 3 * DAY_MS,
      ...overrides,
    }),
  };
}

describe("acceptInvite", () => {
  beforeEach(() => {
    inviteGetMock.mockReset().mockResolvedValue(invite());
    getUserMock
      .mockReset()
      .mockResolvedValue({ email: "spouse@example.com", emailVerified: true });
    commitMock.mockReset().mockResolvedValue(undefined);
    updateMock.mockReset();
    setMock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("links the invited user when the invite is pending, unexpired and verified", async () => {
    const result = await run();

    expect(result).toEqual({ success: true, ownerUid: "owner-1", role: "spouse" });
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  // ── The takeover chain ────────────────────────────────────────────────────
  //
  // Matching the invited address is not the same as controlling it: Firebase
  // does not verify an address at password signup, so anyone who learned an
  // invited address could register it and redeem the invite.

  it("rejects a caller whose email is not verified", async () => {
    getUserMock.mockResolvedValue({ email: "spouse@example.com", emailVerified: false });

    await expect(run()).rejects.toThrow(/verify your email/i);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("rejects a caller whose verified email does not match the invite", async () => {
    getUserMock.mockResolvedValue({ email: "attacker@example.com", emailVerified: true });

    await expect(run()).rejects.toThrow(/does not match/i);
    expect(commitMock).not.toHaveBeenCalled();
  });

  // ── Expiry ────────────────────────────────────────────────────────────────

  it("rejects an invite past its expiresAt", async () => {
    inviteGetMock.mockResolvedValue(invite({ expiresAt: Date.now() - 1000 }));

    await expect(run()).rejects.toThrow(/expired/i);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("ages a legacy invite off createdAt when expiresAt was never written", async () => {
    const stale = Date.now() - 8 * DAY_MS;
    inviteGetMock.mockResolvedValue(
      invite({ expiresAt: undefined, createdAt: { toMillis: () => stale } })
    );

    await expect(run()).rejects.toThrow(/expired/i);
  });

  it("still accepts a legacy invite inside the fallback window", async () => {
    const recent = Date.now() - 1 * DAY_MS;
    inviteGetMock.mockResolvedValue(
      invite({ expiresAt: undefined, createdAt: { toMillis: () => recent } })
    );

    await expect(run()).resolves.toMatchObject({ success: true });
  });

  it("treats an invite with no usable timestamp as expired rather than immortal", async () => {
    inviteGetMock.mockResolvedValue(invite({ expiresAt: undefined, createdAt: undefined }));

    await expect(run()).rejects.toThrow(/expired/i);
    expect(commitMock).not.toHaveBeenCalled();
  });

  // ── Pre-existing guards ───────────────────────────────────────────────────

  it("rejects an unauthenticated caller", async () => {
    await expect(run({ data: { inviteId: "invite-1" } })).rejects.toThrow(/logged in/i);
  });

  it("rejects an already-accepted invite", async () => {
    inviteGetMock.mockResolvedValue(invite({ status: "accepted" }));

    await expect(run()).rejects.toThrow(/already been used/i);
  });

  it("rejects a missing invite", async () => {
    inviteGetMock.mockResolvedValue({ exists: false });

    await expect(run()).rejects.toThrow(/not found/i);
  });

  it("rejects an owner accepting their own invite", async () => {
    inviteGetMock.mockResolvedValue(invite({ ownerUid: "invitee-1" }));

    await expect(run()).rejects.toThrow(/your own invite/i);
    expect(commitMock).not.toHaveBeenCalled();
  });
});
