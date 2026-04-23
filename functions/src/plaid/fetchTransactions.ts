import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { categorizeTransactionLogic } from "../categorization/categorizeTransaction";

function getPlaidClient(): PlaidApi {
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

  return new PlaidApi(configuration);
}

export async function fetchTransactionsForAccount(
  uid: string,
  accountId: string,
  accessToken: string
): Promise<number> {
  const plaidClient = getPlaidClient();
  const db = admin.firestore();

  const endDate = new Date().toISOString().split("T")[0];
  const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const response = await plaidClient.transactionsGet({
    access_token: accessToken,
    start_date: startDate,
    end_date: endDate,
    options: { count: 500, offset: 0 },
  });

  const plaidTransactions = response.data.transactions;
  let imported = 0;

  for (const txn of plaidTransactions) {
    // Check if already exists
    const existing = await db
      .collection("transactions")
      .where("plaidTransactionId", "==", txn.transaction_id)
      .limit(1)
      .get();

    if (!existing.empty) continue;

    const transactionId = db.collection("transactions").doc().id;
    const merchantName = txn.merchant_name ?? txn.name ?? "";
    const description = txn.name ?? "";
    // Plaid: positive = debit (expense), negative = credit (income)
    const type = txn.amount >= 0 ? "expense" : "income";
    const amount = Math.abs(txn.amount);
    const taxYear = txn.date.split("-")[0];

    const txnData = {
      transactionId,
      uid,
      accountId,
      plaidTransactionId: txn.transaction_id,
      amount,
      type,
      taxYear,
      date: txn.date,
      description,
      merchantName,
      category: "",
      taxCategory: "",
      taxSchedule: "",
      aiCategory: "",
      confidenceScore: 0,
      status: "needs_review",
      source: "plaid",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("transactions").doc(transactionId).set(txnData);

    // Categorize
    await categorizeTransactionLogic(uid, transactionId, merchantName, description, amount);

    imported++;
  }

  return imported;
}

export const fetchTransactions = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { accountId?: string };
  if (!data.accountId) {
    throw new HttpsError("invalid-argument", "accountId is required.");
  }

  const db = admin.firestore();
  const accountSnap = await db.collection("accounts").doc(data.accountId).get();

  if (!accountSnap.exists) {
    throw new HttpsError("not-found", "Account not found.");
  }

  const account = accountSnap.data()!;
  if (account.uid !== uid) {
    throw new HttpsError("permission-denied", "Access denied.");
  }

  const imported = await fetchTransactionsForAccount(uid, data.accountId, account.plaidAccessToken);

  return { imported };
});
