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
  const webhookUrl = process.env.PLAID_WEBHOOK_URL;

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
        ...(webhookUrl ? { webhook: webhookUrl } : {}),
      });
      return { linkToken: response.data.link_token };
    }

    // Normal mode — fresh institution connection
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: "DIYTax AI",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      ...(webhookUrl ? { webhook: webhookUrl } : {}),
    });

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
