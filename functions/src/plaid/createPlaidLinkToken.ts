import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import { requireAuth } from "../middleware/auth";

export const createPlaidLinkToken = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";

  if (!clientId || !secret) {
    throw new HttpsError("internal", "Plaid credentials not configured.");
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  const plaidClient = new PlaidApi(configuration);
  const webhookUrl  = process.env.PLAID_WEBHOOK_URL;
  // Required for OAuth banks (Chase, Capital One, BofA, Wells Fargo, etc.).
  // MUST match a URL registered in Plaid Dashboard → API → OAuth → Allowed
  // redirect URIs exactly (protocol, host, path, trailing slash). Hardcoded
  // fallback so OAuth never silently breaks if the env var is missing.
  const redirectUri = process.env.PLAID_REDIRECT_URI || "https://diytaxai.com/bank-accounts";

  console.log(`[LINK_TOKEN_DIAG] env=${plaidEnv} redirect_uri=${redirectUri || "(unset)"} webhook=${webhookUrl || "(unset)"}`);

  const data = (request.data ?? {}) as { existingAccountId?: string };

  try {
    if (data.existingAccountId) {
      // Update mode — opens Plaid for an already-connected institution without re-login
      const db = admin.firestore();
      const accountSnap = await db.collection("accounts").doc(data.existingAccountId).get();
      if (!accountSnap.exists || accountSnap.data()?.uid !== uid) {
        throw new HttpsError("not-found", "Account not found.");
      }
      const accessToken = accountSnap.data()!.plaidAccessToken as string;
      const response = await plaidClient.linkTokenCreate({
        user: { client_user_id: uid },
        client_name: "DIYTax AI",
        // access_token triggers update mode — products are inherited from existing item
        access_token: accessToken,
        country_codes: [CountryCode.Us],
        language: "en",
        redirect_uri: redirectUri,
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
      });
      return { linkToken: response.data.link_token };
    }

    // Normal mode — fresh institution connection
    const linkTokenRequest = {
      user: { client_user_id: uid },
      client_name: "DIYTax AI",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: redirectUri,
      ...(webhookUrl ? { webhook: webhookUrl } : {}),
    };
    console.log(`[LINK_TOKEN_REQUEST] ${JSON.stringify({
      ...linkTokenRequest,
      user: { client_user_id: "<redacted>" },
    })}`);
    const response = await plaidClient.linkTokenCreate(linkTokenRequest);

    return { linkToken: response.data.link_token };
  } catch (err: unknown) {
    if (err instanceof HttpsError) throw err;
    // Extract Plaid API error detail when available
    const axiosBody = (err as { response?: { data?: unknown } })?.response?.data;
    const detail = axiosBody ? JSON.stringify(axiosBody) : String(err);
    console.error("createPlaidLinkToken Plaid error:", detail);
    throw new HttpsError("internal", `Plaid error: ${detail}`);
  }
});
