import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { rejection } from "./helpers";

const { getUserMock, reserveMock, sendEmailMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  reserveMock: vi.fn(),
  sendEmailMock: vi.fn(),
}));

vi.mock("firebase-admin", () => ({
  auth: () => ({ getUser: getUserMock }),
}));

// The throttle has its own suite (mfaThrottle.test.ts); here it is stubbed so
// these tests exercise the callable's wiring. MfaThrottleError stays real.
vi.mock("../src/auth/mfaThrottle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/mfaThrottle")>();
  return { ...actual, reserveMfaAttempt: reserveMock };
});

// maskEmail / describeEmailFailure stay real so their output is exercised here.
vi.mock("../src/services/emailService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/emailService")>();
  return { ...actual, sendEmail: sendEmailMock };
});

import { sendMfaCode } from "../src/auth/sendMfaCode";
import { EmailConfigError, EmailDeliveryError } from "../src/services/emailService";
import { MfaThrottleError } from "../src/auth/mfaThrottle";

const REQUEST = { auth: { uid: "user-1" }, data: {} } as never;

function run() {
  return (sendMfaCode as unknown as { run: (r: never) => Promise<unknown> }).run(REQUEST);
}

describe("sendMfaCode", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getUserMock.mockReset().mockResolvedValue({ email: "debo@gmail.com" });
    reserveMock.mockReset().mockResolvedValue(undefined);
    sendEmailMock.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a masked address and reserves the code on successful delivery", async () => {
    sendEmailMock.mockResolvedValue({ id: "msg_1" });

    const result = await run();

    expect(result).toEqual({ sent: true, maskedEmail: "d***@gmail.com" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // The attempt is reserved for this uid before the provider is contacted.
    expect(reserveMock).toHaveBeenCalledTimes(1);
    const [uid, payload] = reserveMock.mock.calls[0];
    expect(uid).toBe("user-1");
    expect(payload.mfaCode).toMatch(/^\d{6}$/);
    expect(payload.mfaCodeExpiry).toBeGreaterThan(Date.now());

    // The emailed code matches what was reserved, and the subject is unchanged.
    const message = sendEmailMock.mock.calls[0][0];
    expect(message.to).toBe("debo@gmail.com");
    expect(message.subject).toBe("Your DIYTax AI verification code");
    expect(message.html).toContain(payload.mfaCode);
  });

  it("reserves the attempt before contacting the provider", async () => {
    const order: string[] = [];
    reserveMock.mockImplementation(async () => {
      order.push("reserve");
    });
    sendEmailMock.mockImplementation(async () => {
      order.push("send");
      return { id: "msg_1" };
    });

    await run();
    expect(order).toEqual(["reserve", "send"]);
  });

  describe("throttling", () => {
    it("rejects with resource-exhausted and never contacts the provider", async () => {
      reserveMock.mockRejectedValue(new MfaThrottleError("cooldown"));

      const err = await rejection<HttpsError>(run());

      expect(err).toBeInstanceOf(HttpsError);
      expect(err.code).toBe("resource-exhausted");
      expect(err.message).toBe(
        "Too many verification requests. Please wait a few minutes and try again."
      );
      // The whole point: a throttled request costs nothing at the provider.
      expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it.each(["cooldown", "window", "daily"] as const)(
      "does not reveal which limit tripped (%s) or any counter",
      async (reason) => {
        reserveMock.mockRejectedValue(new MfaThrottleError(reason));

        const err = await rejection<HttpsError>(run());

        expect(err.message).not.toContain(reason);
        expect(err.message).not.toMatch(/\d/); // no counters, windows or timestamps
        expect(JSON.stringify(err.details ?? {})).not.toContain(reason);
      }
    );

    it("records the tripped limit server-side only", async () => {
      reserveMock.mockRejectedValue(new MfaThrottleError("window"));

      await run().catch(() => undefined);

      expect(warnSpy).toHaveBeenCalledWith("[sendMfaCode] throttled", {
        operation: "sendMfaCode",
        reason: "window",
        uid: "user-1",
      });
    });

    it("does not release the reserved attempt when the provider fails", async () => {
      sendEmailMock.mockRejectedValue(
        new EmailDeliveryError("throttled", { providerName: "ses" })
      );

      await run().catch(() => undefined);

      // Reserved once, and nothing rolls it back — a caller facing a persistent
      // provider error cannot retry past the limit.
      expect(reserveMock).toHaveBeenCalledTimes(1);
      const [, payload] = reserveMock.mock.calls[0];
      expect(payload.mfaCode).toMatch(/^\d{6}$/);
    });
  });

  it("throws a generic temporary-unavailable error and does not report success", async () => {
    sendEmailMock.mockRejectedValue(
      new EmailDeliveryError("sender_not_verified", {
        providerName: "ses",
        providerErrorName: "MailFromDomainNotVerifiedException",
        requestId: "req-1",
      })
    );

    const err = await rejection<HttpsError>(run());

    expect(err).toBeInstanceOf(HttpsError);
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe(
      "Verification email could not be sent right now. Please try again shortly."
    );
    // Nothing about SES state may be probed from the client.
    expect(err.message).not.toContain("sender_not_verified");
    expect(err.message).not.toContain("MailFromDomainNotVerified");
  });

  it("returns the same generic error for a configuration failure", async () => {
    sendEmailMock.mockRejectedValue(new EmailConfigError("AWS_SES_REGION"));

    const err = await rejection<HttpsError>(run());

    expect(err).toBeInstanceOf(HttpsError);
    expect(err.code).toBe("unavailable");
    expect(err.message).toBe(
      "Verification email could not be sent right now. Please try again shortly."
    );
    expect(err.message).not.toContain("AWS_SES_REGION");
  });

  it("logs the safe category, provider error name and request id", async () => {
    sendEmailMock.mockRejectedValue(
      new EmailDeliveryError("throttled", {
        providerName: "ses",
        providerErrorName: "TooManyRequestsException",
        requestId: "req-42",
      })
    );

    await run().catch(() => undefined);

    expect(errorSpy).toHaveBeenCalledWith(
      "[sendMfaCode] delivery failed",
      expect.objectContaining({
        operation: "sendMfaCode",
        category: "throttled",
        providerErrorName: "TooManyRequestsException",
        requestId: "req-42",
        uid: "user-1",
      })
    );
  });

  it("never logs the verification code, the address, or the message body", async () => {
    sendEmailMock.mockRejectedValue(
      new Error("AKIAIOSFODNN7EXAMPLE rejected for debo@gmail.com")
    );

    await run().catch(() => undefined);

    const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
      .join(" ");

    const code = reserveMock.mock.calls[0][1].mfaCode as string;
    expect(logged).not.toContain(code);
    expect(logged).not.toContain("debo@gmail.com");
    expect(logged).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(logged).not.toContain("<div");
  });
});
