import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { rejection } from "./helpers";
import {
  sendEmail,
  getEmailProvider,
  maskEmail,
  sanitizeForLog,
  classifyResendError,
  describeEmailFailure,
  EmailConfigError,
  EmailDeliveryError,
  FROM_ADDRESS,
  FROM_HEADER,
} from "../src/services/emailService";

const MESSAGE = {
  to: "recipient@example.com",
  subject: "Subject line",
  html: "<p>body</p>",
};

/** No network call can occur: fetch is stubbed for every test in this file. */
const fetchMock = vi.fn();

/** Builds a Response-like object for a 2xx Resend reply. */
function accepted(body: unknown = { id: "msg_0100abc" }, requestId = "req-abc") {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "x-request-id": requestId }),
    json: async () => body,
  } as unknown as Response;
}

/** Builds a Response-like object for a Resend error reply. */
function rejected(
  status: number,
  name: string,
  message = "",
  requestId = "req-abc"
) {
  return {
    ok: false,
    status,
    headers: new Headers({ "x-request-id": requestId }),
    json: async () => ({ statusCode: status, name, message }),
  } as unknown as Response;
}

/** Reads the JSON body the provider posted on the nth call. */
function sentBody(call = 0): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

/** Reads the request init the provider posted on the nth call. */
function sentInit(call = 0): RequestInit & { headers: Record<string, string> } {
  return fetchMock.mock.calls[call][1];
}

function setValidConfig() {
  process.env.RESEND_API_KEY = "re_TestKey_0123456789abcdef";
}

describe("emailService (Resend)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setValidConfig();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
  });

  describe("configuration", () => {
    it("throws configuration_missing when the api key is absent", async () => {
      delete process.env.RESEND_API_KEY;
      const err = await rejection<EmailConfigError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailConfigError);
      expect(err.category).toBe("configuration_missing");
      expect(err.settingName).toBe("RESEND_API_KEY");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("treats a blank api key as missing", async () => {
      process.env.RESEND_API_KEY = "   ";
      await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(EmailConfigError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never puts a credential value in the configuration error", async () => {
      delete process.env.RESEND_API_KEY;
      const err = await rejection<EmailConfigError>(sendEmail(MESSAGE));
      expect(err.message).toBe("Email configuration missing: RESEND_API_KEY");
      expect(err.message).not.toContain("re_TestKey");
    });

    it("authorizes with the configured key and posts JSON", async () => {
      fetchMock.mockResolvedValue(accepted());
      await sendEmail(MESSAGE);

      expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails");
      const init = sentInit();
      expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer re_TestKey_0123456789abcdef");
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("bounds the request with an abort signal so a hung provider cannot stall the function", async () => {
      fetchMock.mockResolvedValue(accepted());
      await sendEmail(MESSAGE);
      expect(sentInit().signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("successful delivery", () => {
    it("resolves with the provider id and sends from the verified identity", async () => {
      fetchMock.mockResolvedValue(accepted({ id: "msg_0100018f" }));

      const result = await sendEmail(MESSAGE);

      expect(result).toEqual({ id: "msg_0100018f" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const body = sentBody();
      expect(body.from).toBe(FROM_HEADER);
      expect(body.from).toContain(FROM_ADDRESS);
      expect(body.to).toEqual([MESSAGE.to]);
      expect(body.subject).toBe(MESSAGE.subject);
      expect(body.html).toBe(MESSAGE.html);
    });

    it("omits the text part when no plain-text alternative is supplied", async () => {
      fetchMock.mockResolvedValue(accepted());
      await sendEmail(MESSAGE);
      expect(sentBody()).not.toHaveProperty("text");
    });

    it("includes the text part when supplied", async () => {
      fetchMock.mockResolvedValue(accepted());
      await sendEmail({ ...MESSAGE, text: "body" });
      expect(sentBody().text).toBe("body");
    });
  });

  describe("failed delivery", () => {
    it("does not report success when a 2xx carries no id", async () => {
      // Acceptance is unproven, so this must not resolve.
      fetchMock.mockResolvedValue(accepted({}));

      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err.category).toBe("provider_unavailable");
      expect(err.providerErrorName).toBe("MissingMessageId");
    });

    it("surfaces a rejection as a categorised delivery error carrying the request id", async () => {
      fetchMock.mockResolvedValue(
        rejected(403, "validation_error", "The diytaxai.com domain is not verified.", "req-xyz")
      );

      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err.providerName).toBe("resend");
      expect(err.providerErrorName).toBe("validation_error");
      expect(err.requestId).toBe("req-xyz");
      expect(err.category).toBe("sender_not_verified");
    });

    it("classifies the pre-verification restriction on unverified recipients", async () => {
      fetchMock.mockResolvedValue(
        rejected(
          403,
          "validation_error",
          "You can only send testing emails to your own email address (owner@example.com)."
        )
      );
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("sandbox_restriction");
    });

    it("classifies throttling", async () => {
      fetchMock.mockResolvedValue(rejected(429, "rate_limit_exceeded", "Too many requests"));
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("throttled");
    });

    it("classifies quota exhaustion", async () => {
      fetchMock.mockResolvedValue(
        rejected(429, "daily_quota_exceeded", "Daily sending quota exceeded")
      );
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("quota_exceeded");
    });

    it("classifies a bad api key", async () => {
      fetchMock.mockResolvedValue(rejected(401, "invalid_api_key", "API key is invalid"));
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("authentication_failed");
    });

    it("treats a network failure as provider_unavailable without claiming acceptance", async () => {
      fetchMock.mockRejectedValue(new Error("socket hang up"));
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err.category).toBe("provider_unavailable");
    });

    it("treats a request timeout as provider_unavailable", async () => {
      const abort = new Error("The operation was aborted due to timeout");
      abort.name = "TimeoutError";
      fetchMock.mockRejectedValue(abort);
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("provider_unavailable");
      expect(err.providerErrorName).toBe("TimeoutError");
    });

    it("does not fail when an error response carries no JSON body", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers(),
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response);

      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("provider_unavailable");
    });

    it("never carries the raw provider message on the error", async () => {
      fetchMock.mockResolvedValue(
        rejected(
          400,
          "validation_error",
          "rejected for recipient@example.com with key re_TestKey_0123456789abcdef"
        )
      );
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.message).toBe("Email delivery failed (recipient_rejected).");
      expect(err.message).not.toContain("recipient@example.com");
      expect(err.message).not.toContain("re_TestKey");
    });

    it("makes exactly one send attempt on a throttling failure", async () => {
      fetchMock.mockResolvedValue(rejected(429, "rate_limit_exceeded", "slow down"));
      await rejection(sendEmail(MESSAGE));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("classifyResendError", () => {
    const cases: Array<[string, string, number, string]> = [
      ["missing_api_key", "", 401, "authentication_failed"],
      ["invalid_api_key", "", 401, "authentication_failed"],
      ["restricted_api_key", "", 403, "authentication_failed"],
      ["invalid_from_address", "", 400, "sender_not_verified"],
      ["invalid_to_address", "", 400, "recipient_rejected"],
      ["rate_limit_exceeded", "", 429, "throttled"],
      ["daily_quota_exceeded", "", 429, "quota_exceeded"],
      ["internal_server_error", "", 500, "provider_unavailable"],
      ["application_error", "", 500, "provider_unavailable"],
      ["validation_error", "Address is suppressed for this account", 400, "recipient_rejected"],
      ["validation_error", "The domain is not verified", 403, "sender_not_verified"],
      ["not_found", "The domain was not found", 404, "sender_not_verified"],
    ];

    it.each(cases)("maps %s (%s) to %s", (name, message, status, expected) => {
      expect(classifyResendError({ name, message, statusCode: status }, status)).toBe(expected);
    });

    it("falls back to the http status for an unrecognised token", () => {
      expect(classifyResendError({ name: "brand_new_token" }, 403)).toBe("authentication_failed");
      expect(classifyResendError({ name: "brand_new_token" }, 429)).toBe("throttled");
      expect(classifyResendError({ name: "brand_new_token" }, 503)).toBe("provider_unavailable");
    });

    it("falls back to provider_unavailable for an unknown shape", () => {
      expect(classifyResendError(undefined)).toBe("provider_unavailable");
      expect(classifyResendError({})).toBe("provider_unavailable");
    });
  });

  describe("describeEmailFailure", () => {
    it("reports the missing setting name for a configuration failure", () => {
      const record = describeEmailFailure("sendMfaCode", new EmailConfigError("RESEND_API_KEY"));
      expect(record).toEqual({
        operation: "sendMfaCode",
        category: "configuration_missing",
        setting: "RESEND_API_KEY",
      });
    });

    it("reports category, provider error name and request id for a delivery failure", () => {
      const record = describeEmailFailure(
        "sendInvite",
        new EmailDeliveryError("throttled", {
          providerName: "resend",
          providerErrorName: "rate_limit_exceeded",
          requestId: "req-1",
        })
      );
      expect(record).toEqual({
        operation: "sendInvite",
        category: "throttled",
        provider: "resend",
        providerErrorName: "rate_limit_exceeded",
        requestId: "req-1",
      });
    });

    it("sanitizes an unexpected failure", () => {
      const record = describeEmailFailure(
        "sendMfaCode",
        new Error("socket failure contacting debo@gmail.com with re_TestKey_0123456789abcdef")
      );
      expect(record.category).toBe("provider_unavailable");
      expect(String(record.detail)).not.toContain("debo@gmail.com");
      expect(String(record.detail)).not.toContain("re_TestKey");
      expect(String(record.detail)).toContain("[REDACTED_API_KEY]");
    });
  });

  describe("sanitizeForLog", () => {
    it("redacts resend api keys", () => {
      expect(sanitizeForLog("key re_TestKey_0123456789abcdef used")).toBe(
        "key [REDACTED_API_KEY] used"
      );
    });

    it("still redacts a stale aws access key id", () => {
      // A not-yet-redeployed revision can carry SES credentials in its env.
      expect(sanitizeForLog("key AKIAIOSFODNN7EXAMPLE used")).toBe(
        "key [REDACTED_API_KEY] used"
      );
    });

    it("masks email addresses", () => {
      expect(sanitizeForLog("failed for debo@gmail.com")).toBe("failed for d***@gmail.com");
    });

    it("bounds the output length", () => {
      expect(sanitizeForLog("x".repeat(5000)).length).toBe(500);
    });

    it("handles non-Error, non-string values without throwing", () => {
      expect(sanitizeForLog({ statusCode: 429 })).toContain("429");
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(sanitizeForLog(circular)).toBe("[unserializable]");
    });
  });

  describe("maskEmail", () => {
    it("keeps only the first character of a long local part", () => {
      expect(maskEmail("debo@gmail.com")).toBe("d***@gmail.com");
    });

    it("collapses short local parts entirely", () => {
      expect(maskEmail("ab@gmail.com")).toBe("**@gmail.com");
    });

    it("returns a placeholder for malformed input", () => {
      expect(maskEmail("not-an-email")).toBe("****");
    });
  });

  describe("getEmailProvider", () => {
    it("identifies as the resend provider", () => {
      expect(getEmailProvider().name).toBe("resend");
    });
  });
});
