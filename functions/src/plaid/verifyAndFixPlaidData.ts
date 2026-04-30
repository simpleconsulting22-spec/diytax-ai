import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { classifyTransactionType, detectAmountSignConvention } from "./classifyTransactionType";

function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
  if (!clientId || !secret) throw new HttpsError("internal", "Plaid credentials not configured.");
  const cfg = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } },
  });
  return new PlaidApi(cfg);
}

interface VerifyReport {
  // Phase 1: account doc cleanup
  duplicateAccountsFound:   number;
  duplicateAccountsDeleted: number;

  // Phase 2: transaction dedup
  duplicateTxnsDeleted: number;

  // Phase 3: re-classification
  txnsRerouted:           number;
  txnsReclassified:       number;
  signConventionUpdated:  number;

  // Final state
  finalAccountCount:    number;
  finalTxnCount:        number;

  errors: string[];
}

/**
 * One-shot end-to-end Plaid data integrity fix. Runs three phases in order
 * (each idempotent):
 *
 *   Phase 1 — Account doc cleanup
 *     Find every (uid, plaidAccountId) group with > 1 doc, pick the most
 *     recently relinked as canonical, re-route loser docs' transactions to
 *     the canonical, and delete the loser docs.
 *
 *   Phase 2 — Transaction dedup by plaidTransactionId
 *     Find every group of transactions sharing the same plaidTransactionId
 *     (race-condition leftovers from before the deterministic-doc-ID fix
 *     landed). Keep the one with the most user-applied data; delete the rest.
 *
 *   Phase 3 — Re-fetch + re-classify (live Plaid data)
 *     For each canonical account, re-fetch its full Plaid history, re-detect
 *     the amount-sign convention, and re-classify every stored transaction
 *     using the latest classifier (catches PAYROLL/PMT/CRCARDPMT/REVERSE/etc.).
 *
 * Returns a single report you can hand back to the user.
 */
export const verifyAndFixPlaidData = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request): Promise<VerifyReport> => {
    const uid = await requireAuth(request);
    const db  = admin.firestore();

    const report: VerifyReport = {
      duplicateAccountsFound:   0,
      duplicateAccountsDeleted: 0,
      duplicateTxnsDeleted:     0,
      txnsRerouted:             0,
      txnsReclassified:         0,
      signConventionUpdated:    0,
      finalAccountCount:        0,
      finalTxnCount:            0,
      errors:                   [],
    };

    // ──────────────── Phase 1: Account doc cleanup ────────────────────────
    const acctsSnap = await db.collection("accounts").where("uid", "==", uid).get();
    const acctGroups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    acctsSnap.docs.forEach((d) => {
      const pid = d.data().plaidAccountId as string | undefined;
      if (!pid) return;
      if (!acctGroups.has(pid)) acctGroups.set(pid, []);
      acctGroups.get(pid)!.push(d);
    });

    for (const [plaidAccountId, docs] of acctGroups.entries()) {
      if (docs.length < 2) continue;
      const ranked = [...docs].sort((a, b) => {
        const aT = (a.data().relinkedAt?.toMillis?.() ?? a.data().createdAt?.toMillis?.() ?? 0) as number;
        const bT = (b.data().relinkedAt?.toMillis?.() ?? b.data().createdAt?.toMillis?.() ?? 0) as number;
        return bT - aT;
      });
      const canonical = ranked[0];
      const losers    = ranked.slice(1);
      report.duplicateAccountsFound += losers.length;

      for (const loser of losers) {
        // Re-route loser's transactions to canonical.
        const loserTxns = await db.collection("transactions")
          .where("uid", "==", uid)
          .where("accountId", "==", loser.id)
          .get();
        let batch = db.batch();
        let n = 0;
        for (const t of loserTxns.docs) {
          batch.update(t.ref, { accountId: canonical.id });
          n++;
          if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
        }
        if (n > 0) await batch.commit();
        await loser.ref.delete();
        report.duplicateAccountsDeleted++;
        console.log(`[VERIFY] uid=${uid} merged loser=${loser.id} into canonical=${canonical.id} (plaidAccountId=${plaidAccountId})`);
      }
    }

    // ──────────────── Phase 2: Transaction dedup by plaidTransactionId ────
    const txnsSnap = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("source", "==", "plaid")
      .get();

    const txnGroups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    txnsSnap.docs.forEach((d) => {
      const pid = d.data().plaidTransactionId as string | undefined;
      if (!pid) return;
      if (!txnGroups.has(pid)) txnGroups.set(pid, []);
      txnGroups.get(pid)!.push(d);
    });

    let dbatch = db.batch();
    let dn = 0;
    for (const [, docs] of txnGroups.entries()) {
      if (docs.length < 2) continue;
      const ranked = [...docs].sort((a, b) => {
        const ad = a.data();
        const bd = b.data();
        const aHas = ad.category ? 1 : 0;
        const bHas = bd.category ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        const aDone = ad.status === "categorized" ? 1 : 0;
        const bDone = bd.status === "categorized" ? 1 : 0;
        if (aDone !== bDone) return bDone - aDone;
        const aT = (ad.createdAt?.toMillis?.() ?? 0) as number;
        const bT = (bd.createdAt?.toMillis?.() ?? 0) as number;
        return aT - bT;
      });
      const losers = ranked.slice(1);
      for (const loser of losers) {
        dbatch.delete(loser.ref);
        report.duplicateTxnsDeleted++;
        dn++;
        if (dn >= 400) { await dbatch.commit(); dbatch = db.batch(); dn = 0; }
      }
    }
    if (dn > 0) await dbatch.commit();

    // ──────────────── Phase 3: Re-fetch and re-classify each account ──────
    const plaid = getPlaidClient();
    const finalAcctsSnap = await db.collection("accounts").where("uid", "==", uid).get();

    // Index transactions by plaidTransactionId for fast lookup during reclassify
    const survivingTxnsSnap = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("source", "==", "plaid")
      .get();
    const txnByPlaidId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    survivingTxnsSnap.docs.forEach((t) => {
      const pid = t.data().plaidTransactionId as string | undefined;
      if (pid) txnByPlaidId.set(pid, t);
    });
    const acctIdByPlaidAcct = new Map<string, string>();
    finalAcctsSnap.docs.forEach((a) => {
      const pid = a.data().plaidAccountId as string | undefined;
      if (pid) acctIdByPlaidAcct.set(pid, a.id);
    });

    for (const acctDoc of finalAcctsSnap.docs) {
      const acct = acctDoc.data();
      const accessToken    = acct.plaidAccessToken as string | undefined;
      const plaidAccountId = acct.plaidAccountId   as string | undefined;
      if (!accessToken || !plaidAccountId) continue;

      // Earliest stored date for this plaidAccountId
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
      let total  = Infinity;
      try {
        while (offset < total) {
          const resp = await plaid.transactionsGet({
            access_token: accessToken,
            start_date:   earliest,
            end_date:     today,
            options:      { count: 500, offset, account_ids: [plaidAccountId] },
          });
          plaidTxns.push(...resp.data.transactions);
          total = resp.data.total_transactions;
          if (resp.data.transactions.length === 0) break;
          offset += resp.data.transactions.length;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        report.errors.push(`acct ${acctDoc.id}: ${msg}`);
        continue;
      }

      // Detect/update sign convention
      const detected = detectAmountSignConvention(plaidTxns);
      const stored          = acct.amountSignInverted as boolean | undefined;
      const storedIgnore    = acct.ignoreAmountSign   as boolean | undefined;
      let amountSignInverted: boolean;
      let ignoreAmountSign:   boolean;
      if (detected === "inverted")        { amountSignInverted = true;  ignoreAmountSign = false; }
      else if (detected === "standard")   { amountSignInverted = false; ignoreAmountSign = false; }
      else if (detected === "no-sign-info") { amountSignInverted = false; ignoreAmountSign = true; }
      else { amountSignInverted = stored ?? false; ignoreAmountSign = storedIgnore ?? false; }

      if (detected !== "unknown" && (stored !== amountSignInverted || storedIgnore !== ignoreAmountSign)) {
        await acctDoc.ref.update({
          amountSignInverted,
          ignoreAmountSign,
          amountSignDetectedAt:      admin.firestore.FieldValue.serverTimestamp(),
          amountSignDetectionMethod: "verify-fix",
        });
        report.signConventionUpdated++;
      }

      // Re-classify and re-route
      let cbatch = db.batch();
      let cn = 0;
      for (const ptxn of plaidTxns) {
        const doc = txnByPlaidId.get(ptxn.transaction_id);
        if (!doc) continue;
        const stored = doc.data();
        const update: Record<string, unknown> = {};

        // Routing — fix any wrong accountId
        const correctDocId = acctIdByPlaidAcct.get(ptxn.account_id) ?? acctDoc.id;
        if (stored.accountId !== correctDocId) {
          update.accountId      = correctDocId;
          update.plaidAccountId = ptxn.account_id;
          report.txnsRerouted++;
        }

        // Re-classification using the right account's sign convention
        const correctAcct       = correctDocId === acctDoc.id ? acct : (await db.collection("accounts").doc(correctDocId).get()).data() ?? {};
        const correctInverted   = (correctAcct.amountSignInverted as boolean | undefined) ?? amountSignInverted;
        const correctIgnoreSign = (correctAcct.ignoreAmountSign   as boolean | undefined) ?? ignoreAmountSign;
        const { type: newType, source: typeSource } = classifyTransactionType(ptxn, {
          amountSignInverted: correctInverted,
          ignoreAmountSign:   correctIgnoreSign,
        });
        if (stored.type !== newType) {
          update.type       = newType;
          update.typeSource = typeSource;
          report.txnsReclassified++;
        }

        // Backfill raw signal fields if missing
        if (stored.plaidSignedAmount === undefined) {
          update.plaidSignedAmount      = ptxn.amount;
          update.plaidPfcPrimary        = ptxn.personal_finance_category?.primary ?? null;
          update.plaidLegacyCategories  = (ptxn.category ?? []) as string[];
        }

        if (Object.keys(update).length === 0) continue;
        cbatch.update(doc.ref, update);
        cn++;
        if (cn >= 400) { await cbatch.commit(); cbatch = db.batch(); cn = 0; }
      }
      if (cn > 0) await cbatch.commit();
    }

    // Final counts
    const finalAccts = await db.collection("accounts").where("uid", "==", uid).get();
    const finalTxns  = await db.collection("transactions").where("uid", "==", uid).where("source", "==", "plaid").get();
    report.finalAccountCount = finalAccts.size;
    report.finalTxnCount     = finalTxns.size;

    console.log(`[VERIFY] uid=${uid} report=${JSON.stringify(report)}`);
    return report;
  },
);
