import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { fetchTransactionsForAccount } from "./fetchTransactions";

// Plaid sends webhook events when new transactions are available.
// Verification: Plaid signs requests with a JWT in the Plaid-Verification header.
// For production, verify this JWT using plaidClient.webhookVerificationKeyGet().
// See: https://plaid.com/docs/api/webhooks/webhook-verification/

export const plaidWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const body = req.body as {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    new_transactions?: number;
    removed_transactions?: string[];
  };

  const { webhook_type, webhook_code, item_id } = body;

  // Only handle transaction webhooks
  if (webhook_type !== "TRANSACTIONS") {
    res.status(200).send("ok");
    return;
  }

  if (!item_id) {
    res.status(400).send("missing item_id");
    return;
  }

  // DEFAULT_UPDATE fires when new transactions are available after initial pull
  if (webhook_code === "DEFAULT_UPDATE" || webhook_code === "INITIAL_UPDATE" || webhook_code === "HISTORICAL_UPDATE") {
    try {
      const db = admin.firestore();
      // CRITICAL: fetch ALL accounts for this item — a Plaid item often owns
      // multiple accounts (Checking + Savings + Credit Card). The previous
      // implementation only fetched the first one and dumped EVERY account's
      // transactions into it, silently corrupting which account each txn belongs to.
      const snap = await db
        .collection("accounts")
        .where("plaidItemId", "==", item_id)
        .get();

      if (snap.empty) {
        console.warn(`[plaidWebhook] No accounts found for item_id: ${item_id}`);
        res.status(200).send("ok");
        return;
      }

      console.log(`[plaidWebhook] ${webhook_code} for item=${item_id} accounts=${snap.size}`);

      // Sync each account independently with its own plaidAccountId filter so
      // Plaid only returns transactions for that specific account.
      for (const doc of snap.docs) {
        const account = doc.data();
        const plaidAccountId = account.plaidAccountId as string | undefined;
        const accessToken    = account.plaidAccessToken as string | undefined;
        if (!plaidAccountId || !accessToken) {
          console.warn(`[plaidWebhook] account ${doc.id} missing plaidAccountId or accessToken — skipping`);
          continue;
        }

        const label = `${account.institutionName ?? "Bank"} – ${account.accountName ?? ""}`;
        fetchTransactionsForAccount(account.uid, doc.id, accessToken, label, undefined, plaidAccountId)
          .then((n) => console.log(`[plaidWebhook] imported ${n} for acct=${doc.id} (${plaidAccountId})`))
          .catch((err) => console.error(`[plaidWebhook] fetch error for acct=${doc.id}:`, err));
      }
    } catch (err) {
      console.error("[plaidWebhook] error:", err);
      res.status(500).send("error");
      return;
    }
  }

  res.status(200).send("ok");
});
