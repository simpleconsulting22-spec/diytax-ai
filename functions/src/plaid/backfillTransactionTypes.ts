import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { classifyTransactionType } from "./classifyTransactionType";

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

// Re-runs the type classifier against existing Plaid-sourced transactions.
// For each linked account, re-fetches the transactions covering the date range
// of stored docs, then updates docs whose `type` would change under the new
// classifier.
export const backfillTransactionTypes = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540 },
  async (request) => {
    const uid = await requireAuth(request);
    const db = admin.firestore();

    const accountsSnap = await db.collection("accounts").where("uid", "==", uid).get();

    let updated = 0;
    let unchanged = 0;
    let skipped = 0;
    const errors: string[] = [];

    const plaidClient = getPlaidClient();

    for (const acctDoc of accountsSnap.docs) {
      const acct = acctDoc.data();
      const accessToken = acct.plaidAccessToken as string | undefined;
      const plaidAccountId = acct.plaidAccountId as string | undefined;
      if (!accessToken || !plaidAccountId) { skipped++; continue; }

      // Find the date range covered by existing Plaid transactions for this account
      const txnSnap = await db.collection("transactions")
        .where("uid", "==", uid)
        .where("accountId", "==", acctDoc.id)
        .where("source", "==", "plaid")
        .get();

      if (txnSnap.empty) continue;

      const dates = txnSnap.docs.map((d) => d.data().date as string).sort();
      const earliest = dates[0];
      const latest   = dates[dates.length - 1];

      // Index Firestore docs by plaidTransactionId for O(1) lookup
      const docsByPlaidId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      txnSnap.docs.forEach((d) => {
        const pid = d.data().plaidTransactionId as string | undefined;
        if (pid) docsByPlaidId.set(pid, d);
      });

      // Re-fetch from Plaid (paginated)
      const plaidTxns: Array<Awaited<ReturnType<typeof plaidClient.transactionsGet>>["data"]["transactions"][number]> = [];
      let offset = 0;
      let totalAvailable = Infinity;
      try {
        while (offset < totalAvailable) {
          const response = await plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: earliest,
            end_date: latest,
            options: { count: 500, offset, account_ids: [plaidAccountId] },
          });
          plaidTxns.push(...response.data.transactions);
          totalAvailable = response.data.total_transactions;
          if (response.data.transactions.length === 0) break;
          offset += response.data.transactions.length;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[BACKFILL] Plaid fetch error for account ${acctDoc.id}:`, msg);
        errors.push(`${acctDoc.id}: ${msg}`);
        continue;
      }

      console.log(`[BACKFILL] uid=${uid} acct=${acctDoc.id} stored=${txnSnap.size} fetched=${plaidTxns.length}`);

      // Re-classify and queue updates
      let batch = db.batch();
      let batchCount = 0;

      for (const txn of plaidTxns) {
        const doc = docsByPlaidId.get(txn.transaction_id);
        if (!doc) continue;

        const { type: newType, source: typeSource } = classifyTransactionType(txn);
        const currentType = doc.data().type as string;

        const needsTypeUpdate = newType !== currentType;
        const needsRawFields = doc.data().plaidSignedAmount === undefined;

        if (!needsTypeUpdate && !needsRawFields) {
          unchanged++;
          continue;
        }

        const update: Record<string, unknown> = {};
        if (needsTypeUpdate) {
          update.type = newType;
          update.typeSource = typeSource;
          updated++;
        } else {
          unchanged++;
        }
        if (needsRawFields) {
          update.plaidSignedAmount = txn.amount;
          update.plaidPfcPrimary = txn.personal_finance_category?.primary ?? null;
          update.plaidLegacyCategories = (txn.category ?? []) as string[];
        }

        batch.update(doc.ref, update);
        batchCount++;

        if (needsTypeUpdate) {
          console.log(`[BACKFILL_FIX] uid=${uid} txn=${doc.id} name="${txn.name}" amount=${txn.amount} ${currentType}→${newType} src=${typeSource}`);
        }

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      if (batchCount > 0) await batch.commit();
    }

    return { updated, unchanged, skippedAccounts: skipped, errors };
  }
);
