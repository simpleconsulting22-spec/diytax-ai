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
      const snap = await db
        .collection("accounts")
        .where("plaidItemId", "==", item_id)
        .limit(1)
        .get();

      if (snap.empty) {
        console.warn(`[plaidWebhook] No account found for item_id: ${item_id}`);
        res.status(200).send("ok");
        return;
      }

      const account = snap.docs[0].data();
      console.log(`[plaidWebhook] ${webhook_code} for ${account.institutionName} — fetching transactions`);

      fetchTransactionsForAccount(account.uid, snap.docs[0].id, account.plaidAccessToken)
        .then((n) => console.log(`[plaidWebhook] imported ${n} transactions`))
        .catch((err) => console.error("[plaidWebhook] fetch error:", err));

    } catch (err) {
      console.error("[plaidWebhook] error:", err);
      res.status(500).send("error");
      return;
    }
  }

  res.status(200).send("ok");
});
