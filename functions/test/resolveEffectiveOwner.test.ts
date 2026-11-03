import { describe, it, expect, vi, beforeEach } from "vitest";

// users/{uid} docs keyed by uid; a missing key means the doc doesn't exist.
const { docs } = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }));

vi.mock("firebase-admin", () => ({
  firestore: () => ({
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      }),
    }),
  }),
}));

import { resolveEffectiveOwner } from "../src/middleware/auth";

const req = (uid: string) => ({ auth: { uid }, data: {} }) as never;

describe("resolveEffectiveOwner", () => {
  beforeEach(() => {
    docs.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("treats a user with no ownerUid as the owner of their own data", async () => {
    docs.set("me", { email: "me@example.com" });
    expect(await resolveEffectiveOwner(req("me"))).toEqual({
      callerUid: "me",
      effectiveOwnerUid: "me",
      role: "owner",
    });
  });

  it("grants a shared user access when the owner's doc confirms them", async () => {
    docs.set("spouse", { ownerUid: "owner", role: "spouse" });
    docs.set("owner", { sharedUids: ["spouse"], sharedRoles: { spouse: "spouse" } });
    expect(await resolveEffectiveOwner(req("spouse"))).toEqual({
      callerUid: "spouse",
      effectiveOwnerUid: "owner",
      role: "spouse",
    });
  });

  it("takes the role from the owner's doc, not the caller's", async () => {
    // Caller claims spouse (full write); owner granted accountant (limited).
    docs.set("acct", { ownerUid: "owner", role: "spouse" });
    docs.set("owner", { sharedUids: ["acct"], sharedRoles: { acct: "accountant" } });
    const r = await resolveEffectiveOwner(req("acct"));
    expect(r.role).toBe("accountant");
    expect(r.effectiveOwnerUid).toBe("owner");
  });

  it("rejects a forged ownerUid the owner never granted", async () => {
    docs.set("stranger", { ownerUid: "victim", role: "spouse" });
    docs.set("victim", { sharedUids: ["someone-else"], sharedRoles: { "someone-else": "spouse" } });
    expect(await resolveEffectiveOwner(req("stranger"))).toEqual({
      callerUid: "stranger",
      effectiveOwnerUid: "stranger",
      role: "owner",
    });
  });

  it("rejects when the owner lists the uid but has no valid role for it", async () => {
    docs.set("x", { ownerUid: "owner" });
    docs.set("owner", { sharedUids: ["x"], sharedRoles: { x: "admin" } });
    expect((await resolveEffectiveOwner(req("x"))).effectiveOwnerUid).toBe("x");
  });

  it("rejects when the owner doc doesn't exist", async () => {
    docs.set("x", { ownerUid: "ghost" });
    expect((await resolveEffectiveOwner(req("x"))).effectiveOwnerUid).toBe("x");
  });

  it("ignores an ownerUid pointing at the caller", async () => {
    docs.set("me", { ownerUid: "me", sharedUids: ["me"], sharedRoles: { me: "spouse" } });
    expect(await resolveEffectiveOwner(req("me"))).toEqual({
      callerUid: "me",
      effectiveOwnerUid: "me",
      role: "owner",
    });
  });

  it("requires a signed-in caller", async () => {
    await expect(resolveEffectiveOwner({ auth: undefined, data: {} } as never)).rejects.toThrow(
      /logged in/
    );
  });
});
