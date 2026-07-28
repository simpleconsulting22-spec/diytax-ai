import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * Provider-independent transactional email service.
 *
 * Call sites depend only on {@link sendEmail}, {@link EmailConfigError} and
 * {@link EmailDeliveryError}, so swapping providers means replacing
 * {@link AmazonSesProvider} and nothing else.
 *
 * Required configuration:
 *   AWS_SES_ACCESS_KEY_ID      (Firebase Secret Manager)
 *   AWS_SES_SECRET_ACCESS_KEY  (Firebase Secret Manager)
 *   AWS_SES_REGION             (non-secret, functions/.env)
 *
 * Functions that send mail must declare:
 *   secrets: ["AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY"]
 */

/** Verified SES sending identity. Inbound mail for this domain is unaffected. */
export const FROM_ADDRESS = "noreply@diytaxai.com";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text alternative. */
  text?: string;
}

export interface EmailSendResult {
  /** Provider-assigned id. Only set once the provider accepted the message. */
  id: string;
}

/**
 * Safe internal failure categories. These are the only failure descriptors that
 * may be logged or branched on; raw provider messages never leave this module.
 */
export type EmailErrorCategory =
  | "configuration_missing"
  | "authentication_failed"
  | "sandbox_restriction"
  | "sender_not_verified"
  | "recipient_rejected"
  | "throttled"
  | "quota_exceeded"
  | "provider_unavailable";

/** Required email configuration is missing or blank. */
export class EmailConfigError extends Error {
  readonly category: EmailErrorCategory = "configuration_missing";
  /** Name of the missing setting. Never contains its value. */
  readonly settingName: string;

  constructor(settingName: string) {
    super(`Email configuration missing: ${settingName}`);
    this.name = "EmailConfigError";
    this.settingName = settingName;
  }
}

/**
 * The provider rejected the message, or acceptance could not be confirmed.
 *
 * Deliberately carries no provider message text. `providerErrorName` is an
 * AWS exception type name (e.g. `MessageRejected`), not response content.
 */
export class EmailDeliveryError extends Error {
  readonly category: EmailErrorCategory;
  readonly providerName: string;
  readonly providerErrorName?: string;
  readonly requestId?: string;

  constructor(
    category: EmailErrorCategory,
    options: { providerName: string; providerErrorName?: string; requestId?: string } = {
      providerName: "ses",
    }
  ) {
    super(`Email delivery failed (${category}).`);
    this.name = "EmailDeliveryError";
    this.category = category;
    this.providerName = options.providerName;
    this.providerErrorName = options.providerErrorName;
    this.requestId = options.requestId;
  }
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

const AWS_KEY_PATTERN = /\b(?:AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_LOG_LENGTH = 500;

/**
 * Masks an email for display and logging: `debo@gmail.com` -> `d***@gmail.com`.
 * Locals of two characters or fewer collapse entirely so short addresses are
 * not effectively revealed.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "****";
  const masked = local.length <= 2 ? "**" : `${local[0]}***`;
  return `${masked}@${domain}`;
}

/**
 * Renders an arbitrary value into a bounded, log-safe string with AWS access
 * key ids redacted and email addresses masked.
 *
 * Used only for unexpected non-AWS failures (e.g. network errors). Classified
 * SES failures are logged by category and never routed through here.
 */
export function sanitizeForLog(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = `${value.name}: ${value.message}`;
  } else if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = "[unserializable]";
    }
  }
  return text
    .replace(AWS_KEY_PATTERN, "[REDACTED_AWS_KEY]")
    .replace(EMAIL_PATTERN, (match) => maskEmail(match))
    .slice(0, MAX_LOG_LENGTH);
}

interface AwsErrorShape {
  name?: string;
  message?: string;
  $metadata?: { requestId?: string; httpStatusCode?: number };
}

/**
 * Maps an SES exception onto a safe category.
 *
 * The AWS exception *name* is a fixed type token and is safe to retain; the
 * `message` is inspected here only to disambiguate `MessageRejected`, and is
 * never propagated.
 */
export function classifySesError(err: unknown): EmailErrorCategory {
  const aws = (err ?? {}) as AwsErrorShape;
  const name = aws.name ?? "";
  const message = aws.message ?? "";
  const status = aws.$metadata?.httpStatusCode ?? 0;

  switch (name) {
    case "UnrecognizedClientException":
    case "InvalidClientTokenId":
    case "SignatureDoesNotMatch":
    case "IncompleteSignature":
    case "MissingAuthenticationToken":
    case "InvalidSignatureException":
    case "AccessDeniedException":
    case "AccessDenied":
      return "authentication_failed";

    case "MailFromDomainNotVerifiedException":
      return "sender_not_verified";

    case "TooManyRequestsException":
    case "ThrottlingException":
    case "Throttling":
      return "throttled";

    case "LimitExceededException":
    case "SendingPausedException":
    case "AccountSuspendedException":
      return "quota_exceeded";

    case "MessageRejected": {
      // In sandbox, SES rejects unverified *recipients* with this phrasing.
      if (/identities failed the check/i.test(message)) {
        // If the rejected identity is our own sender, the sender is unverified.
        return message.includes(FROM_ADDRESS) ? "sender_not_verified" : "sandbox_restriction";
      }
      if (/suppress/i.test(message)) return "recipient_rejected";
      if (/not verified/i.test(message)) return "sandbox_restriction";
      return "recipient_rejected";
    }

    case "BadRequestException":
      return "recipient_rejected";
  }

  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "throttled";
  return "provider_unavailable";
}

class AmazonSesProvider implements EmailProvider {
  readonly name = "ses";
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(config: { region: string; accessKeyId: string; secretAccessKey: string }) {
    this.region = config.region;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    // Constructed per send: secrets are only bound at invocation time.
    const client = new SESv2Client({
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      // The SDK retries throttling and 5xx by default. Retrying a quota,
      // throttle, auth, sandbox or rejected-recipient failure only multiplies
      // cost and pressure, so retries are disabled at this layer.
      maxAttempts: 1,
    });

    const command = new SendEmailCommand({
      FromEmailAddress: FROM_ADDRESS,
      Destination: { ToAddresses: [message.to] },
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: message.html, Charset: "UTF-8" },
            ...(message.text
              ? { Text: { Data: message.text, Charset: "UTF-8" } }
              : {}),
          },
        },
      },
    });

    let response: { MessageId?: string };
    try {
      response = await client.send(command);
    } catch (err) {
      const aws = (err ?? {}) as AwsErrorShape;
      throw new EmailDeliveryError(classifySesError(err), {
        providerName: this.name,
        providerErrorName: aws.name,
        requestId: aws.$metadata?.requestId,
      });
    }

    // Acceptance is only proven by a MessageId.
    if (!response?.MessageId) {
      throw new EmailDeliveryError("provider_unavailable", {
        providerName: this.name,
        providerErrorName: "MissingMessageId",
      });
    }
    return { id: response.MessageId };
  }
}

/**
 * Resolves the configured provider.
 *
 * @throws {EmailConfigError} when any required setting is absent or blank.
 */
export function getEmailProvider(): EmailProvider {
  const region = process.env.AWS_SES_REGION;
  const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY;

  if (!region || !region.trim()) throw new EmailConfigError("AWS_SES_REGION");
  if (!accessKeyId || !accessKeyId.trim()) throw new EmailConfigError("AWS_SES_ACCESS_KEY_ID");
  if (!secretAccessKey || !secretAccessKey.trim()) {
    throw new EmailConfigError("AWS_SES_SECRET_ACCESS_KEY");
  }

  return new AmazonSesProvider({
    region: region.trim(),
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
  });
}

/**
 * Sends a message and resolves only once SES returned a MessageId.
 *
 * @throws {EmailConfigError} configuration missing.
 * @throws {EmailDeliveryError} provider rejected the message.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  return getEmailProvider().send(message);
}

/**
 * Builds a log-safe diagnostic record for a failed send. Contains no message
 * body, recipient address, credential or raw provider text.
 */
export function describeEmailFailure(
  operation: string,
  err: unknown
): Record<string, unknown> {
  if (err instanceof EmailConfigError) {
    return { operation, category: err.category, setting: err.settingName };
  }
  if (err instanceof EmailDeliveryError) {
    return {
      operation,
      category: err.category,
      provider: err.providerName,
      providerErrorName: err.providerErrorName,
      requestId: err.requestId,
    };
  }
  return { operation, category: "provider_unavailable", detail: sanitizeForLog(err) };
}
