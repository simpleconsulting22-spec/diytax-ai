import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The AWS SDK is never loaded for real; no network call can occur.
const { sendMock, clientConfigs, commandInputs } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  clientConfigs: [] as Record<string, unknown>[],
  commandInputs: [] as Record<string, unknown>[],
}));

vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: class {
    send = sendMock;
    constructor(config: Record<string, unknown>) {
      clientConfigs.push(config);
    }
  },
  SendEmailCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      commandInputs.push(input);
    }
  },
}));

import { rejection } from "./helpers";
import {
  sendEmail,
  getEmailProvider,
  maskEmail,
  sanitizeForLog,
  classifySesError,
  describeEmailFailure,
  EmailConfigError,
  EmailDeliveryError,
  FROM_ADDRESS,
} from "../src/services/emailService";

const MESSAGE = {
  to: "recipient@example.com",
  subject: "Subject line",
  html: "<p>body</p>",
};

/** Builds an object shaped like an AWS SDK v3 service exception. */
function awsError(name: string, message = "", httpStatusCode = 400, requestId = "req-abc") {
  const err = new Error(message) as Error & { $metadata: unknown };
  err.name = name;
  err.$metadata = { requestId, httpStatusCode };
  return err;
}

function setValidConfig() {
  process.env.AWS_SES_REGION = "us-east-1";
  process.env.AWS_SES_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
  process.env.AWS_SES_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
}

describe("emailService (Amazon SES)", () => {
  beforeEach(() => {
    sendMock.mockReset();
    clientConfigs.length = 0;
    commandInputs.length = 0;
    setValidConfig();
  });

  afterEach(() => {
    delete process.env.AWS_SES_REGION;
    delete process.env.AWS_SES_ACCESS_KEY_ID;
    delete process.env.AWS_SES_SECRET_ACCESS_KEY;
  });

  describe("configuration", () => {
    it("throws configuration_missing when the region is absent", async () => {
      delete process.env.AWS_SES_REGION;
      const err = await rejection<EmailConfigError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailConfigError);
      expect(err.category).toBe("configuration_missing");
      expect(err.settingName).toBe("AWS_SES_REGION");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("throws configuration_missing when the access key id is absent", async () => {
      delete process.env.AWS_SES_ACCESS_KEY_ID;
      const err = await rejection<EmailConfigError>(sendEmail(MESSAGE));
      expect(err.settingName).toBe("AWS_SES_ACCESS_KEY_ID");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("throws configuration_missing when the secret access key is absent", async () => {
      delete process.env.AWS_SES_SECRET_ACCESS_KEY;
      const err = await rejection<EmailConfigError>(sendEmail(MESSAGE));
      expect(err.settingName).toBe("AWS_SES_SECRET_ACCESS_KEY");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("treats blank settings as missing", async () => {
      process.env.AWS_SES_REGION = "   ";
      await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(EmailConfigError);
    });

    it("never puts a credential value in the configuration error", async () => {
      delete process.env.AWS_SES_SECRET_ACCESS_KEY;
      const err = await rejection<EmailConfigError>(sendEmail(MESSAGE));
      expect(err.message).toBe("Email configuration missing: AWS_SES_SECRET_ACCESS_KEY");
      expect(err.message).not.toContain("EXAMPLEKEY");
    });

    it("passes region and credentials to the client without retries", async () => {
      sendMock.mockResolvedValue({ MessageId: "0100abc" });
      await sendEmail(MESSAGE);

      expect(clientConfigs[0]).toMatchObject({
        region: "us-east-1",
        credentials: {
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
          secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        },
        // Requirement: no application-layer retry of quota/throttle/auth failures.
        maxAttempts: 1,
      });
    });
  });

  describe("successful delivery", () => {
    it("resolves with the SES MessageId and sends from the verified identity", async () => {
      sendMock.mockResolvedValue({ MessageId: "0100018f-msgid" });

      const result = await sendEmail(MESSAGE);

      expect(result).toEqual({ id: "0100018f-msgid" });
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(commandInputs[0]).toMatchObject({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [MESSAGE.to] },
      });
      const content = commandInputs[0].Content as {
        Simple: { Subject: { Data: string }; Body: { Html: { Data: string } } };
      };
      expect(content.Simple.Subject.Data).toBe(MESSAGE.subject);
      expect(content.Simple.Body.Html.Data).toBe(MESSAGE.html);
    });

    it("omits the Text part when no plain-text alternative is supplied", async () => {
      sendMock.mockResolvedValue({ MessageId: "id" });
      await sendEmail(MESSAGE);
      const body = (commandInputs[0].Content as { Simple: { Body: Record<string, unknown> } })
        .Simple.Body;
      expect(body).not.toHaveProperty("Text");
    });
  });

  describe("failed delivery", () => {
    it("does not report success when SES returns no MessageId", async () => {
      // Acceptance is unproven, so this must not resolve.
      sendMock.mockResolvedValue({});

      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err.category).toBe("provider_unavailable");
      expect(err.providerErrorName).toBe("MissingMessageId");
    });

    it("surfaces a rejection as a categorised delivery error carrying the request id", async () => {
      sendMock.mockRejectedValue(
        awsError("MessageRejected", "Email address is not verified.", 400, "req-xyz")
      );

      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err).toBeInstanceOf(EmailDeliveryError);
      expect(err.providerErrorName).toBe("MessageRejected");
      expect(err.requestId).toBe("req-xyz");
    });

    it("classifies a sandbox rejection of an unverified recipient", async () => {
      sendMock.mockRejectedValue(
        awsError(
          "MessageRejected",
          "Email address is not verified. The following identities failed the check in region US-EAST-1: recipient@example.com"
        )
      );
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("sandbox_restriction");
    });

    it("classifies throttling", async () => {
      sendMock.mockRejectedValue(awsError("TooManyRequestsException", "Maximum sending rate exceeded", 429));
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("throttled");
    });

    it("classifies quota exhaustion", async () => {
      sendMock.mockRejectedValue(awsError("LimitExceededException", "Daily sending quota exceeded"));
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.category).toBe("quota_exceeded");
    });

    it("never carries the raw AWS message on the error", async () => {
      sendMock.mockRejectedValue(
        awsError("MessageRejected", "rejected for recipient@example.com with key AKIAIOSFODNN7EXAMPLE")
      );
      const err = await rejection<EmailDeliveryError>(sendEmail(MESSAGE));
      expect(err.message).toBe("Email delivery failed (recipient_rejected).");
      expect(err.message).not.toContain("recipient@example.com");
      expect(err.message).not.toContain("AKIA");
    });

    it("makes exactly one send attempt on a throttling failure", async () => {
      sendMock.mockRejectedValue(awsError("ThrottlingException", "slow down", 429));
      await rejection(sendEmail(MESSAGE));
      expect(sendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("classifySesError", () => {
    const cases: Array<[string, string, string]> = [
      ["UnrecognizedClientException", "", "authentication_failed"],
      ["SignatureDoesNotMatch", "", "authentication_failed"],
      ["AccessDeniedException", "", "authentication_failed"],
      ["MailFromDomainNotVerifiedException", "", "sender_not_verified"],
      ["ThrottlingException", "", "throttled"],
      ["TooManyRequestsException", "", "throttled"],
      ["LimitExceededException", "", "quota_exceeded"],
      ["SendingPausedException", "", "quota_exceeded"],
      ["AccountSuspendedException", "", "quota_exceeded"],
      ["BadRequestException", "", "recipient_rejected"],
      ["MessageRejected", "Address is suppressed for this account", "recipient_rejected"],
      ["MessageRejected", "Email address is not verified", "sandbox_restriction"],
      ["InternalServiceErrorException", "", "provider_unavailable"],
    ];

    it.each(cases)("maps %s to %s", (name, message, expected) => {
      expect(classifySesError(awsError(name, message))).toBe(expected);
    });

    it("treats a sender-identity rejection as sender_not_verified", () => {
      const err = awsError(
        "MessageRejected",
        `Email address is not verified. The following identities failed the check in region US-EAST-1: ${FROM_ADDRESS}`
      );
      expect(classifySesError(err)).toBe("sender_not_verified");
    });

    it("falls back to provider_unavailable for an unknown shape", () => {
      expect(classifySesError(undefined)).toBe("provider_unavailable");
      expect(classifySesError({})).toBe("provider_unavailable");
    });
  });

  describe("describeEmailFailure", () => {
    it("reports the missing setting name for a configuration failure", () => {
      const record = describeEmailFailure("sendMfaCode", new EmailConfigError("AWS_SES_REGION"));
      expect(record).toEqual({
        operation: "sendMfaCode",
        category: "configuration_missing",
        setting: "AWS_SES_REGION",
      });
    });

    it("reports category, provider error name and request id for a delivery failure", () => {
      const record = describeEmailFailure(
        "sendInvite",
        new EmailDeliveryError("throttled", {
          providerName: "ses",
          providerErrorName: "ThrottlingException",
          requestId: "req-1",
        })
      );
      expect(record).toEqual({
        operation: "sendInvite",
        category: "throttled",
        provider: "ses",
        providerErrorName: "ThrottlingException",
        requestId: "req-1",
      });
    });

    it("sanitizes an unexpected non-AWS failure", () => {
      const record = describeEmailFailure(
        "sendMfaCode",
        new Error("socket failure contacting debo@gmail.com with AKIAIOSFODNN7EXAMPLE")
      );
      expect(record.category).toBe("provider_unavailable");
      expect(String(record.detail)).not.toContain("debo@gmail.com");
      expect(String(record.detail)).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(String(record.detail)).toContain("[REDACTED_AWS_KEY]");
    });
  });

  describe("sanitizeForLog", () => {
    it("redacts AWS access key ids", () => {
      expect(sanitizeForLog("key AKIAIOSFODNN7EXAMPLE used")).toBe(
        "key [REDACTED_AWS_KEY] used"
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
    it("identifies as the ses provider", () => {
      expect(getEmailProvider().name).toBe("ses");
    });
  });
});
