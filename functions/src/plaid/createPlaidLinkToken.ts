import { onCall, HttpsError } from "firebase-functions/v2/https";
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

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: uid },
    client_name: "DIYTax AI",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  });

  return { linkToken: response.data.link_token };
});
