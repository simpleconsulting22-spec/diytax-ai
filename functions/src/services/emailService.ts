/**
 * Provider-independent transactional email service.
 *
 * Call sites depend only on {@link sendEmail}, {@link EmailConfigError} and
 * {@link EmailDeliveryError}, so swapping providers means replacing
 * {@link ResendProvider} and nothing else.
 *
 * Required configuration:
 *   RESEND_API_KEY  (Firebase Secret Manager)
 *
 * Functions that send mail must declare:
 *   secrets: ["RESEND_API_KEY"]
 *
 * Resend is called over its REST API with the runtime's built-in fetch rather
 * than the `resend` SDK. The SDK reports failures as a returned `{ error }`
 * object instead of throwing, which would quietly bypass the delivery-failure
 * path every call site depends on; going direct also keeps the classification
 * below authoritative and drops a dependency from the MFA cold-start path.
 */

/** Verified Resend sending identity. Inbound mail for this domain is unaffected. */
export const FROM_ADDRESS = "noreply@diytaxai.com";

/** Display name shown to recipients. */
export const FROM_NAME = "DIYTax AI";

/** RFC 5322 From header value. */
export const FROM_HEADER = `${FROM_NAME} <${FROM_ADDRESS}>`;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Ceiling on a single send. Cloud Functions bill for wall-clock time and the
 * MFA path is user-facing, so a hung provider connection must fail fast rather
 * than hold the invocation open to its own timeout.
 */
const REQUEST_TIMEOUT_MS = 10_000;

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
 * Deliberately carries no provider message text. `providerErrorName` is a
 * Resend error type token (e.g. `validation_error`), not response content.
 */
export class EmailDeliveryError extends Error {
  readonly category: EmailErrorCategory;
  readonly providerName: string;
  readonly providerErrorName?: string;
  readonly requestId?: string;

  constructor(
    category: EmailErrorCategory,
    options: { providerName: string; providerErrorName?: string; requestId?: string } = {
      providerName: "resend",
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

/**
 * Provider API-key shapes. Resend keys are `re_`-prefixed; the AWS pattern is
 * retained because SES keys may still sit in the environment of a not-yet
 * redeployed revision, and a stale credential in a log is still a leak.
 */
const RESEND_KEY_PATTERN = /\bre_[A-Za-z0-9_-]{8,}\b/g;
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
 * Renders an arbitrary value into a bounded, log-safe string with provider API
 * keys redacted and email addresses masked.
 *
 * Used only for unexpected failures (e.g. network errors). Classified provider
 * failures are logged by category and never routed through here.
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
    .replace(RESEND_KEY_PATTERN, "[REDACTED_API_KEY]")
    .replace(AWS_KEY_PATTERN, "[REDACTED_API_KEY]")
    .replace(EMAIL_PATTERN, (match) => maskEmail(match))
    .slice(0, MAX_LOG_LENGTH);
}

/** Error body Resend returns on a non-2xx response. */
interface ResendErrorShape {
  name?: string;
  message?: string;
  statusCode?: number;
}

/**
 * Maps a Resend API error onto a safe category.
 *
 * The error `name` is a fixed type token and is safe to retain; `message` is
 * inspected here only to disambiguate the overloaded `validation_error` and
 * `not_found` tokens, and is never propagated.
 */
export function classifyResendError(err: unknown, httpStatus = 0): EmailErrorCategory {
  const body = (err ?? {}) as ResendErrorShape;
  const name = body.name ?? "";
  const message = body.message ?? "";
  const status = httpStatus || body.statusCode || 0;

  switch (name) {
    case "missing_api_key":
    case "invalid_api_key":
    case "restricted_api_key":
      return "authentication_failed";

    case "invalid_from_address":
      return "sender_not_verified";

    case "invalid_to_address":
      return "recipient_rejected";

    case "rate_limit_exceeded":
      return "throttled";

    case "daily_quota_exceeded":
      return "quota_exceeded";

    case "internal_server_error":
    case "application_error":
      return "provider_unavailable";

    // Both tokens are overloaded across unrelated conditions, so the message is
    // the only signal that separates an unverified sender from a rejected
    // recipient. Checked in order of operational significance.
    case "validation_error":
    case "not_found": {
      // Until the sending domain is verified, Resend accepts mail only to the
      // account owner's own address — the analogue of the SES sandbox.
      if (/only send testing emails|own email address/i.test(message)) {
        return "sandbox_restriction";
      }
      if (/domain is not verified|not verified|domain.*not found/i.test(message)) {
        return "sender_not_verified";
      }
      if (/suppress|bounce|complaint/i.test(message)) return "recipient_rejected";
      return "recipient_rejected";
    }
  }

  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "throttled";
  return "provider_unavailable";
}

class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private readonly apiKey: string;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;
    try {
      // Exactly one attempt. Retrying a quota, throttle, auth, unverified-sender
      // or rejected-recipient failure only multiplies cost and provider
      // pressure, so no retry is layered on here.
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_HEADER,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          ...(message.text ? { text: message.text } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Network failure or timeout — the request never produced a status, so
      // nothing about acceptance is known.
      throw new EmailDeliveryError("provider_unavailable", {
        providerName: this.name,
        providerErrorName: err instanceof Error ? err.name : "FetchFailed",
      });
    }

    // Resend echoes a request id header on both success and failure paths; it
    // is an opaque correlation token, safe to log and the only handle support
    // can act on.
    const requestId = response.headers.get("x-request-id") ?? undefined;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const shape = (body ?? {}) as ResendErrorShape;
      throw new EmailDeliveryError(classifyResendError(shape, response.status), {
        providerName: this.name,
        providerErrorName: shape.name,
        requestId,
      });
    }

    // Acceptance is only proven by an id.
    const id = (body as { id?: string } | undefined)?.id;
    if (!id) {
      throw new EmailDeliveryError("provider_unavailable", {
        providerName: this.name,
        providerErrorName: "MissingMessageId",
        requestId,
      });
    }
    return { id };
  }
}

/**
 * Resolves the configured provider.
 *
 * @throws {EmailConfigError} when any required setting is absent or blank.
 */
export function getEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !apiKey.trim()) throw new EmailConfigError("RESEND_API_KEY");

  return new ResendProvider({ apiKey: apiKey.trim() });
}

/**
 * Sends a message and resolves only once the provider returned a message id.
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
