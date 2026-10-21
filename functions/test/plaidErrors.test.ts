import { describe, it, expect } from "vitest";
import { PlaidApiError, toPlaidApiError } from "../src/plaid/plaidErrors";

/** Shape of the AxiosError the Plaid SDK throws, including the secret-bearing config. */
function plaidAxiosError(body: Record<string, unknown>) {
  const err = new Error("Request failed with status code 400") as Error & Record<string, unknown>;
  err.isAxiosError = true;
  err.config = { headers: { "PLAID-CLIENT-ID": "client-123", "PLAID-SECRET": "super-secret-value" } };
  err.response = { status: 400, data: body };
  return err;
}

describe("toPlaidApiError", () => {
  const loginRequired = plaidAxiosError({
    error_type: "ITEM_ERROR",
    error_code: "ITEM_LOGIN_REQUIRED",
    error_message: "the login details of this item have changed",
    request_id: "req-1",
  });

  it("keeps Plaid's error fields and gives a readable message", () => {
    const safe = toPlaidApiError(loginRequired);
    expect(safe).toBeInstanceOf(PlaidApiError);
    const p = safe as PlaidApiError;
    expect(p.code).toBe("ITEM_LOGIN_REQUIRED");
    expect(p.type).toBe("ITEM_ERROR");
    expect(p.requestId).toBe("req-1");
    expect(p.message).toMatch(/sign in again/);
  });

  it("drops the request config, so the secret cannot be logged", () => {
    const safe = toPlaidApiError(loginRequired);
    const dumped = JSON.stringify(safe, Object.getOwnPropertyNames(safe)) + String(safe.stack);
    expect(dumped).not.toContain("super-secret-value");
    expect(dumped).not.toContain("client-123");
    expect((safe as unknown as Record<string, unknown>).config).toBeUndefined();
  });

  it("falls back to Plaid's own message for unmapped codes", () => {
    const safe = toPlaidApiError(plaidAxiosError({ error_code: "SOME_NEW_CODE", error_message: "something odd" }));
    expect(safe.message).toBe("something odd");
  });

  it("returns a plain Error with only the message for non-Plaid errors", () => {
    const original = new Error("network down") as Error & Record<string, unknown>;
    original.config = { headers: { "PLAID-SECRET": "super-secret-value" } };
    const safe = toPlaidApiError(original);
    expect(safe).not.toBe(original);
    expect(safe).not.toBeInstanceOf(PlaidApiError);
    expect(safe.message).toBe("network down");
    expect((safe as unknown as Record<string, unknown>).config).toBeUndefined();
  });
});
