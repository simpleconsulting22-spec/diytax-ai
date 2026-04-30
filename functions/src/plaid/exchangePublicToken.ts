import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { fetchTransactionsForAccount } from "./fetchTransactions";

export const exchangePublicToken = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as {
    publicToken?: string;
    institutionName?: string;
    accounts?: Array<{ plaidAccountId: string; name: string; mask: string }>;
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
  const db = admin.firestore();

  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: data.publicToken,
  });

  const accessToken = exchangeResponse.data.access_token;
  const itemId      = exchangeResponse.data.item_id;
  const institution = data.institutionName ?? "Unknown Bank";

  const accounts = data.accounts ?? [];

  for (const acct of accounts) {
    // Find every existing doc for this (uid, plaidAccountId). If multiple
    // exist (from prior buggy links), pick one as canonical and merge metadata
    // into it. The cleanupDuplicateAccountDocs callable handles transaction
    // re-routing and orphan cleanup; here we just make sure the LATEST link
    // refreshes the access_token / item_id on the canonical doc.
    const existingSnap = await db
      .collection("accounts")
      .where("uid", "==", uid)
      .where("plaidAccountId", "==", acct.plaidAccountId)
      .get();

    let docId: string;
    if (!existingSnap.empty) {
      // Refresh the canonical doc with the new access_token + item_id.
      // (Old access_tokens from prior links are invalid after re-link anyway.)
      const canonical = existingSnap.docs[0];
      docId = canonical.id;
      await canonical.ref.update({
        plaidAccessToken: accessToken,
        plaidItemId: itemId,
        institutionName: institution,
        accountName: acct.name,
        mask: acct.mask,
        relinkedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[EXCHANGE] uid=${uid} plaidAccountId=${acct.plaidAccountId} → reused existing doc=${docId} (${existingSnap.size} doc${existingSnap.size !== 1 ? "s" : ""} found)`);
    } else {
      docId = db.collection("accounts").doc().id;
      await db.collection("accounts").doc(docId).set({
        uid,
        plaidAccessToken: accessToken,
        plaidItemId: itemId,
        institutionName: institution,
        accountName: acct.name,
        mask: acct.mask,
        plaidAccountId: acct.plaidAccountId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[EXCHANGE] uid=${uid} plaidAccountId=${acct.plaidAccountId} → created new doc=${docId}`);
    }

    const label = `${institution} – ${acct.name}${acct.mask ? ` ····${acct.mask}` : ""}`;
    // Fetch transactions for this specific account in background
    fetchTransactionsForAccount(uid, docId, accessToken, label, undefined, acct.plaidAccountId).catch(
      (err) => console.error("fetchTransactionsForAccount error:", err)
    );
  }

  return { ok: true };
  }
);
