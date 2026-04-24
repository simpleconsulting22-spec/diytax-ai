import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { fetchTransactionsForAccount } from "./fetchTransactions";

export const exchangePublicToken = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as {
    publicToken?: string;
    institutionName?: string;
    accountName?: string;
    mask?: string;
  };

  if (!data.publicToken) {
    throw new HttpsError("invalid-argument", "publicToken is required.");
  }

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

  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: data.publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId      = exchangeResponse.data.item_id;

  const accountId = admin.firestore().collection("accounts").doc().id;
  const db = admin.firestore();

  await db.collection("accounts").doc(accountId).set({
    accountId,
    uid,
    plaidAccessToken: accessToken,
    plaidItemId: itemId,
    institutionName: data.institutionName ?? "Unknown Bank",
    accountName: data.accountName ?? "Account",
    mask: data.mask ?? "",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Fetch transactions in background (don't await to avoid timeout)
  fetchTransactionsForAccount(uid, accountId, accessToken).catch((err) =>
    console.error("fetchTransactionsForAccount error:", err)
  );

  return { accountId };
});
