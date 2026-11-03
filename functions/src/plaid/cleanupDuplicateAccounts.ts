import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

interface CleanupReport {
  duplicateAccountsFound: number;
  duplicateAccountsDeleted: number;
  txnsRerouted:           number;
  duplicateTxnsDeleted:   number;
  details: Array<{
    plaidAccountId: string;
    canonicalDocId: string;
    deletedDocIds:  string[];
    txnsRerouted:   number;
    txnsDeleted:    number;
  }>;
}

/**
 * Find every group of (uid, plaidAccountId) that has > 1 account doc, pick
 * one as canonical, re-route all transactions to it, dedupe transactions by
 * plaidTransactionId, and delete the duplicate account docs.
 *
 * Canonical selection: the doc with the most recent `relinkedAt`/`createdAt`
 * — that's the one whose access_token actually works for current Plaid items.
 *
 * Idempotent. Safe to run repeatedly.
 */
export const cleanupDuplicateAccountDocs = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request): Promise<CleanupReport> => {
    const uid = await requireAuth(request);
    const db  = admin.firestore();

    const acctsSnap = await db.collection("accounts").where("uid", "==", uid).get();

    // Group by plaidAccountId. Skip docs that don't have one (CSV/manual accounts).
    const groups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    acctsSnap.docs.forEach((d) => {
      const pid = d.data().plaidAccountId as string | undefined;
      if (!pid) return;
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid)!.push(d);
    });

    const report: CleanupReport = {
      duplicateAccountsFound:   0,
      duplicateAccountsDeleted: 0,
      txnsRerouted:             0,
      duplicateTxnsDeleted:     0,
      details: [],
    };

    for (const [plaidAccountId, docs] of groups.entries()) {
      if (docs.length < 2) continue; // not a duplicate

      // Pick canonical: latest relinkedAt, fall back to createdAt
      const ranked = [...docs].sort((a, b) => {
        const aT = (a.data().relinkedAt?.toMillis?.() ?? a.data().createdAt?.toMillis?.() ?? 0) as number;
        const bT = (b.data().relinkedAt?.toMillis?.() ?? b.data().createdAt?.toMillis?.() ?? 0) as number;
        return bT - aT; // newest first
      });
      const canonical = ranked[0];
      const losers    = ranked.slice(1);

      report.duplicateAccountsFound += losers.length;

      const detail: CleanupReport["details"][number] = {
        plaidAccountId,
        canonicalDocId: canonical.id,
        deletedDocIds:  losers.map((d) => d.id),
        txnsRerouted:   0,
        txnsDeleted:    0,
      };

      // Re-route transactions: pull every txn pointing at any loser docId, then
      // either re-point it at canonical or delete it as a duplicate (same
      // plaidTransactionId already exists under canonical).
      const canonicalTxnsSnap = await db.collection("transactions")
        .where("uid", "==", uid)
        .where("accountId", "==", canonical.id)
        .get();
      const canonicalPlaidIds = new Set<string>();
      canonicalTxnsSnap.docs.forEach((t) => {
        const pid = t.data().plaidTransactionId as string | undefined;
        if (pid) canonicalPlaidIds.add(pid);
      });

      for (const loser of losers) {
        const loserTxnsSnap = await db.collection("transactions")
          .where("uid", "==", uid)
          .where("accountId", "==", loser.id)
          .get();

        let batch = db.batch();
        let batchCount = 0;
        for (const txn of loserTxnsSnap.docs) {
          const pid = txn.data().plaidTransactionId as string | undefined;
          if (pid && canonicalPlaidIds.has(pid)) {
            // Same Plaid txn already exists under canonical → delete the duplicate
            batch.delete(txn.ref);
            detail.txnsDeleted++;
            report.duplicateTxnsDeleted++;
          } else {
            // Re-point this txn to canonical
            batch.update(txn.ref, { accountId: canonical.id });
            if (pid) canonicalPlaidIds.add(pid);
            detail.txnsRerouted++;
            report.txnsRerouted++;
          }
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        // Delete the loser account doc
        await loser.ref.delete();
        report.duplicateAccountsDeleted++;
        console.log(`[CLEANUP] uid=${uid} plaidAccountId=${plaidAccountId} merged loser=${loser.id} into canonical=${canonical.id}`);
      }

      report.details.push(detail);
    }

    console.log(`[CLEANUP] uid=${uid} report=${JSON.stringify(report)}`);
    return report;
  },
);
