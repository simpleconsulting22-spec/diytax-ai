import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { addMock, getProfileMock, existingGetMock, sendEmailMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  getProfileMock: vi.fn(),
  existingGetMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock("firebase-admin", () => {
  const firestore = () => ({
    collection: (name: string) => {
      if (name === "invites") {
        const chain = {
          where: () => chain,
          limit: () => chain,
          get: existingGetMock,
        };
        return { ...chain, add: addMock };
      }
      return { doc: () => ({ get: getProfileMock }) };
    },
  });
  // `admin.firestore` is used both as a factory and as a namespace.
  firestore.FieldValue = { serverTimestamp: () => "TS" };
  return { firestore };
});

vi.mock("../src/services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/emailService")>();
  return { ...actual, sendEmail: sendEmailMock };
});

import { sendInvite, INVITE_TTL_MS } from "../src/invite/sendInvite";
import { EmailDeliveryError } from "../src/services/emailService";

const REQUEST = {
  auth: { uid: "owner-1" },
  data: { email: "Spouse@Example.com", role: "spouse" },
} as never;

function run(request: unknown = REQUEST) {
  return (sendInvite as unknown as { run: (r: unknown) => Promise<{
    inviteId: string;
    alreadyPending: boolean;
    emailSent: boolean;
  }> }).run(request);
}

describe("sendInvite", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addMock.mockReset().mockResolvedValue({ id: "invite-1" });
    getProfileMock.mockReset().mockResolvedValue({ data: () => ({ ownerName: "Debo" }) });
    existingGetMock.mockReset().mockResolvedValue({ empty: true, docs: [] });
    sendEmailMock.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the invite and reports emailSent on successful delivery", async () => {
    sendEmailMock.mockResolvedValue({ id: "msg_1" });

    const result = await run();

    expect(result).toEqual({ inviteId: "invite-1", alreadyPending: false, emailSent: true });
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock.mock.calls[0][0]).toMatchObject({
      email: "spouse@example.com", // normalized
      role: "spouse",
      ownerUid: "owner-1",
      status: "pending",
    });

    const message = sendEmailMock.mock.calls[0][0];
    expect(message.subject).toBe("Debo invited you to DIYTax AI");
    expect(message.html).toContain("https://diytaxai.com/accept-invite/invite-1");
  });

  it("preserves the invite document and reports emailSent: false when delivery fails", async () => {
    sendEmailMock.mockRejectedValue(
      new EmailDeliveryError("quota_exceeded", {
        providerName: "ses",
        providerErrorName: "LimitExceededException",
        requestId: "req-9",
      })
    );

    const result = await run();

    // No throw: the owner can still share the link manually.
    expect(result).toEqual({ inviteId: "invite-1", alreadyPending: false, emailSent: false });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("does not return provider errors or any extra fields to the client", async () => {
    sendEmailMock.mockRejectedValue(
      new EmailDeliveryError("quota_exceeded", {
        providerName: "ses",
        providerErrorName: "LimitExceededException",
        requestId: "req-9",
      })
    );

    const result = await run();

    expect(Object.keys(result).sort()).toEqual(["alreadyPending", "emailSent", "inviteId"]);
    expect(JSON.stringify(result)).not.toContain("quota_exceeded");
    expect(JSON.stringify(result)).not.toContain("LimitExceededException");
  });

  it("logs the safe category, provider error name and invocation context", async () => {
    sendEmailMock.mockRejectedValue(
      new EmailDeliveryError("sandbox_restriction", {
        providerName: "ses",
        providerErrorName: "MessageRejected",
        requestId: "req-7",
      })
    );

    await run();

    expect(errorSpy).toHaveBeenCalledWith(
      "[sendInvite] delivery failed",
      expect.objectContaining({
        operation: "sendInvite",
        category: "sandbox_restriction",
        providerErrorName: "MessageRejected",
        requestId: "req-7",
        inviteId: "invite-1",
        ownerUid: "owner-1",
      })
    );
  });

  it("reuses a pending invite instead of creating a duplicate", async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    existingGetMock.mockResolvedValue({
      empty: false,
      docs: [{ id: "existing-1", ref: { update: updateMock } }],
    });
    sendEmailMock.mockResolvedValue({ id: "msg_1" });

    const result = await run();

    expect(result).toEqual({ inviteId: "existing-1", alreadyPending: true, emailSent: true });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("stamps an expiry matching the 7 days the email promises", async () => {
    sendEmailMock.mockResolvedValue({ id: "msg_1" });
    const before = Date.now();

    await run();

    const written = addMock.mock.calls[0][0] as { expiresAt: number };
    const after = Date.now();

    expect(written.expiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
    expect(written.expiresAt).toBeLessThanOrEqual(after + INVITE_TTL_MS);
    // The claim in the body is only true because of the field above.
    expect(sendEmailMock.mock.calls[0][0].html).toContain("expires in 7 days");
  });

  it("extends the expiry when an existing invite is resent", async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    existingGetMock.mockResolvedValue({
      empty: false,
      docs: [{ id: "existing-1", ref: { update: updateMock } }],
    });
    sendEmailMock.mockResolvedValue({ id: "msg_1" });
    const before = Date.now();

    await run();

    expect(updateMock).toHaveBeenCalledTimes(1);
    const { expiresAt } = updateMock.mock.calls[0][0] as { expiresAt: number };
    expect(expiresAt).toBeGreaterThanOrEqual(before + INVITE_TTL_MS);
  });

  it("masks the recipient address in logs and redacts provider secrets", async () => {
    sendEmailMock.mockRejectedValue(
      new Error("AKIAIOSFODNN7EXAMPLE rejected for spouse@example.com")
    );

    await run();

    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
      .join(" ");

    expect(logged).not.toContain("spouse@example.com");
    expect(logged).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(logged).toContain("s***@example.com");
  });

  it("rejects an invalid role before touching Firestore or email", async () => {
    await expect(
      run({ auth: { uid: "owner-1" }, data: { email: "a@b.com", role: "admin" } })
    ).rejects.toThrow(/role must be/);
    expect(addMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
