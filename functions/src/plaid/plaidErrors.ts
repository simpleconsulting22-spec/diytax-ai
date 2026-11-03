/**
 * Plaid errors arrive as AxiosErrors whose `config.headers` carry
 * PLAID-CLIENT-ID and PLAID-SECRET. Logging or rethrowing one as-is writes the
 * secret into Cloud Logging (an uncaught error in an onCall handler is logged
 * whole by firebase-functions). Convert at the call site into a PlaidApiError
 * that holds only Plaid's response body fields.
 */

export class PlaidApiError extends Error {
  readonly code: string;
  readonly type: string;
  readonly plaidMessage: string;
  readonly requestId: string | null;

  constructor(code: string, type: string, plaidMessage: string, requestId: string | null) {
    super(friendlyPlaidMessage(code, plaidMessage));
    this.name = "PlaidApiError";
    this.code = code;
    this.type = type;
    this.plaidMessage = plaidMessage;
    this.requestId = requestId;
  }
}

/** User-facing text for the Plaid error codes people actually hit. */
export function friendlyPlaidMessage(code: string, plaidMessage: string): string {
  switch (code) {
    case "ITEM_LOGIN_REQUIRED":
      return "This bank needs you to sign in again. Click \"+ Add Accounts\" on this bank's card to reconnect.";
    case "PENDING_EXPIRATION":
    case "PENDING_DISCONNECT":
      return "This bank connection is about to expire. Click \"+ Add Accounts\" on this bank's card to renew it.";
    case "INVALID_ACCOUNT_ID":
      return "The bank no longer recognizes this account. It may have been closed or unshared — reconnect the bank or remove the account.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
    case "INSTITUTION_NO_LONGER_SUPPORTED":
      return "The bank isn't responding right now. Try again later.";
    case "RATE_LIMIT_EXCEEDED":
      return "Too many sync requests. Wait a few minutes and try again.";
    case "PRODUCT_NOT_READY":
      return "The bank is still preparing transactions. Try again in a few minutes.";
    default:
      return plaidMessage || "The bank sync failed.";
  }
}

/**
 * Returns a PlaidApiError for an Axios/Plaid error, or a plain Error carrying
 * only the message for anything else. Never returns the original object.
 */
export function toPlaidApiError(err: unknown): Error {
  const body = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (body && typeof body.error_code === "string") {
    return new PlaidApiError(
      body.error_code,
      typeof body.error_type === "string" ? body.error_type : "UNKNOWN",
      typeof body.error_message === "string" ? body.error_message : "",
      typeof body.request_id === "string" ? body.request_id : null,
    );
  }
  return new Error(err instanceof Error ? err.message : String(err));
}
