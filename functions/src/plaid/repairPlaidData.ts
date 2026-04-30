import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { classifyTransactionType, detectAmountSignConvention } from "./classifyTransactionType";

function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
  if (!clientId || !secret) {
    throw new HttpsError("internal", "Plaid credentials not configured.");
  }
  const cfg = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  });
  return new PlaidApi(cfg);
}

interface RepairReport {
  rerouted: number;       // transactions whose accountId was wrong, fixed
  reclassified: number;   // transactions whose income/expense type was wrong, fixed
  unchanged: number;      // already correct
  signConventionUpdated: number; // accounts that had their amountSignInverted flag set/changed
  accountsScanned: number;
  errors: string[];
}

/**
 * One-shot integrity repair across every Plaid-linked account for the user.
 *
 *   1. For each linked account, re-fetch from Plaid (paginated, account-scoped)
 *      to get the canonical Plaid data.
 *   2. Detect this account's amount-sign convention from that data.
 *   3. Iterate every Plaid transaction stored under THIS user (not just this
 *      account — we need to find mis-routed ones) whose plaidTransactionId
 *      matches a fetched txn. If the stored accountId disagrees with the doc
 *      that owns the transaction's plaidAccountId, re-route it.
 *   4. Re-classify type using the new sign convention; update if changed.
 *
 * Fully idempotent: running it twice produces the same result as running it once.
 */
export const repairPlaidData = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    const uid = await requireAuth(request);
    const db = admin.firestore();
    const plaid = getPlaidClient();

    const report: RepairReport = {
      rerouted: 0,
      reclassified: 0,
      unchanged: 0,
      signConventionUpdated: 0,
      accountsScanned: 0,
      errors: [],
    };

    // Build a map of plaidAccountId → our account doc id (for re-routing)
    const accountsSnap = await db.collection("accounts").where("uid", "==", uid).get();
    const plaidAcctIdToDocId = new Map<string, string>();
    accountsSnap.docs.forEach((d) => {
      const pid = d.data().plaidAccountId as string | undefined;
      if (pid) plaidAcctIdToDocId.set(pid, d.id);
    });

    // Index the user's Plaid transactions by plaidTransactionId for O(1) lookup
    const txnsSnap = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("source", "==", "plaid")
      .get();
    const txnsByPlaidId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    txnsSnap.docs.forEach((d) => {
      const pid = d.data().plaidTransactionId as string | undefined;
      if (pid) txnsByPlaidId.set(pid, d);
    });
    console.log(`[REPAIR] uid=${uid} accounts=${accountsSnap.size} txns=${txnsSnap.size}`);

    for (const acctDoc of accountsSnap.docs) {
      const acct = acctDoc.data();
      const accessToken = acct.plaidAccessToken as string | undefined;
      const plaidAccountId = acct.plaidAccountId as string | undefined;
      if (!accessToken || !plaidAccountId) continue;
      report.accountsScanned++;

      // Determine the date range covered by stored data for this account
      const earliestSnap = await db.collection("transactions")
        .where("uid", "==", uid)
        .where("plaidAccountId", "==", plaidAccountId)
        .orderBy("date", "asc")
        .limit(1)
        .get();
      const earliest = earliestSnap.empty
        ? new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
        : (earliestSnap.docs[0].data().date as string);
      const today = new Date().toISOString().split("T")[0];

      // Paginated re-fetch
      const plaidTxns: Awaited<ReturnType<typeof plaid.transactionsGet>>["data"]["transactions"] = [];
      let offset = 0;
      let total = Infinity;
      try {
        while (offset < total) {
          const resp = await plaid.transactionsGet({
            access_token: accessToken,
            start_date: earliest,
            end_date: today,
            options: { count: 500, offset, account_ids: [plaidAccountId] },
          });
          plaidTxns.push(...resp.data.transactions);
          total = resp.data.total_transactions;
          if (resp.data.transactions.length === 0) break;
          offset += resp.data.transactions.length;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[REPAIR] fetch failed for acct=${acctDoc.id}:`, msg);
        report.errors.push(`${acctDoc.id}: ${msg}`);
        continue;
      }

      // Detect / update sign convention
      const detected = detectAmountSignConvention(plaidTxns);
      const storedInverted   = acct.amountSignInverted as boolean | undefined;
      const storedIgnoreSign = acct.ignoreAmountSign   as boolean | undefined;
      let amountSignInverted: boolean;
      let ignoreAmountSign:   boolean;
      if (detected === "inverted")        { amountSignInverted = true;  ignoreAmountSign = false; }
      else if (detected === "standard")   { amountSignInverted = false; ignoreAmountSign = false; }
      else if (detected === "no-sign-info") { amountSignInverted = false; ignoreAmountSign = true; }
      else { amountSignInverted = storedInverted ?? false; ignoreAmountSign = storedIgnoreSign ?? false; }

      if (detected !== "unknown") {
        const acctUpdate: Record<string, unknown> = {};
        if (storedInverted !== amountSignInverted) acctUpdate.amountSignInverted = amountSignInverted;
        if (storedIgnoreSign !== ignoreAmountSign) acctUpdate.ignoreAmountSign  = ignoreAmountSign;
        if (Object.keys(acctUpdate).length > 0) {
          acctUpdate.amountSignDetectedAt       = admin.firestore.FieldValue.serverTimestamp();
          acctUpdate.amountSignDetectionMethod  = "auto-repair";
          await acctDoc.ref.update(acctUpdate);
          report.signConventionUpdated++;
          console.log(`[REPAIR] acct=${acctDoc.id} sign convention ${detected}`);
        }
      }

      // Walk every Plaid txn we just fetched — fix routing and classification
      let batch = db.batch();
      let batchCount = 0;
      for (const ptxn of plaidTxns) {
        const doc = txnsByPlaidId.get(ptxn.transaction_id);
        if (!doc) continue;

        const stored = doc.data();
        const update: Record<string, unknown> = {};

        // (a) routing — should belong to whichever account doc owns ptxn.account_id
        const correctDocId = plaidAcctIdToDocId.get(ptxn.account_id) ?? acctDoc.id;
        if (stored.accountId !== correctDocId) {
          update.accountId = correctDocId;
          update.plaidAccountId = ptxn.account_id;
          report.rerouted++;
          console.log(`[REPAIR_REROUTE] txn=${doc.id} ${stored.accountId}→${correctDocId} (plaidAcct=${ptxn.account_id})`);
        }

        // (b) classification — re-classify with this account's sign convention
        const correctAcctData = correctDocId === acctDoc.id
          ? acct
          : (await db.collection("accounts").doc(correctDocId).get()).data() ?? {};
        const correctInverted   = (correctAcctData.amountSignInverted as boolean | undefined) ?? amountSignInverted;
        const correctIgnoreSign = (correctAcctData.ignoreAmountSign   as boolean | undefined) ?? ignoreAmountSign;
        const { type: newType, source: typeSource } = classifyTransactionType(ptxn, {
          amountSignInverted: correctInverted,
          ignoreAmountSign:   correctIgnoreSign,
        });
        if (stored.type !== newType) {
          update.type = newType;
          update.typeSource = typeSource;
          report.reclassified++;
          console.log(`[REPAIR_RECLASSIFY] txn=${doc.id} ${stored.type}→${newType} src=${typeSource}`);
        }

        // (c) raw signal fields — store if missing for future repairs
        if (stored.plaidSignedAmount === undefined) {
          update.plaidSignedAmount = ptxn.amount;
          update.plaidPfcPrimary = ptxn.personal_finance_category?.primary ?? null;
          update.plaidLegacyCategories = (ptxn.category ?? []) as string[];
        }

        if (Object.keys(update).length === 0) {
          report.unchanged++;
          continue;
        }
        batch.update(doc.ref, update);
        batchCount++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();
    }

    console.log(`[REPAIR] uid=${uid} report=${JSON.stringify(report)}`);
    return report;
  },
);

/**
 * Per-account manual override: flips the amountSignInverted flag and
 * re-classifies every Plaid transaction on that account using the new sign.
 * Used as a safety net when auto-detection couldn't reach a confident verdict.
 */
export const setAccountSignConvention = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 300 },
  async (request) => {
    const uid = await requireAuth(request);
    const data = request.data as { accountId?: string; inverted?: boolean };
    if (!data.accountId || typeof data.inverted !== "boolean") {
      throw new HttpsError("invalid-argument", "accountId and inverted are required.");
    }

    const db = admin.firestore();
    const acctSnap = await db.collection("accounts").doc(data.accountId).get();
    if (!acctSnap.exists || acctSnap.data()?.uid !== uid) {
      throw new HttpsError("not-found", "Account not found.");
    }

    await acctSnap.ref.update({
      amountSignInverted: data.inverted,
      amountSignDetectedAt: admin.firestore.FieldValue.serverTimestamp(),
      amountSignDetectionMethod: "manual",
    });

    // Re-classify every Plaid txn on this account using stored raw signals
    const txnsSnap = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("accountId", "==", data.accountId)
      .where("source", "==", "plaid")
      .get();

    let updated = 0;
    let batch = db.batch();
    let batchCount = 0;
    for (const doc of txnsSnap.docs) {
      const t = doc.data();
      // Only rely on stored raw signals — never the absolute-value `amount`
      // field, which doesn't carry sign.
      if (t.plaidSignedAmount === undefined) continue;
      const txnLike = {
        name: t.description ?? null,
        amount: t.plaidSignedAmount as number,
        personal_finance_category: t.plaidPfcPrimary ? { primary: t.plaidPfcPrimary as string } : null,
        category: (t.plaidLegacyCategories as string[] | undefined) ?? null,
      };
      const { type: newType, source: typeSource } = classifyTransactionType(txnLike, { amountSignInverted: data.inverted });
      if (newType !== t.type) {
        batch.update(doc.ref, { type: newType, typeSource });
        updated++;
        batchCount++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
    if (batchCount > 0) await batch.commit();

    return { updated, totalScanned: txnsSnap.size };
  },
);
