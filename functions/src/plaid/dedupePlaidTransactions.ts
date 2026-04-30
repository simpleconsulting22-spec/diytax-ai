import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

interface DedupeReport {
  scanned:        number;
  duplicateGroups: number;
  duplicatesDeleted: number;
}

/**
 * One-shot dedup: find every Plaid transaction with multiple Firestore docs
 * sharing the same plaidTransactionId (race-condition leftovers from before
 * the deterministic doc-ID fix), keep one copy, delete the rest.
 *
 * Idempotent.
 */
export const dedupePlaidTransactions = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request): Promise<DedupeReport> => {
    const uid = await requireAuth(request);
    const db  = admin.firestore();

    const snap = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("source", "==", "plaid")
      .get();

    // Group by plaidTransactionId
    const groups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    snap.docs.forEach((d) => {
      const pid = d.data().plaidTransactionId as string | undefined;
      if (!pid) return;
      if (!groups.has(pid)) groups.set(pid, []);
      groups.get(pid)!.push(d);
    });

    const report: DedupeReport = {
      scanned: snap.size,
      duplicateGroups: 0,
      duplicatesDeleted: 0,
    };

    let batch = db.batch();
    let batchCount = 0;
    for (const [pid, docs] of groups.entries()) {
      if (docs.length < 2) continue;
      report.duplicateGroups++;

      // Keep the doc with the most "filled in" categorization. Rank by:
      //  1. has a category? (preserves user's manual category edits)
      //  2. status === "categorized" beats "needs_review"
      //  3. fallback: oldest createdAt (assume original insert)
      const ranked = [...docs].sort((a, b) => {
        const ad = a.data();
        const bd = b.data();
        const aHasCat = ad.category ? 1 : 0;
        const bHasCat = bd.category ? 1 : 0;
        if (aHasCat !== bHasCat) return bHasCat - aHasCat;
        const aDone = ad.status === "categorized" ? 1 : 0;
        const bDone = bd.status === "categorized" ? 1 : 0;
        if (aDone !== bDone) return bDone - aDone;
        const aT = (ad.createdAt?.toMillis?.() ?? 0) as number;
        const bT = (bd.createdAt?.toMillis?.() ?? 0) as number;
        return aT - bT; // older first (keeper)
      });
      const keeper = ranked[0];
      const losers = ranked.slice(1);
      console.log(`[DEDUPE_TXN] uid=${uid} pid=${pid} keep=${keeper.id} delete=${losers.map((l) => l.id).join(",")}`);

      for (const loser of losers) {
        batch.delete(loser.ref);
        report.duplicatesDeleted++;
        batchCount++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
    if (batchCount > 0) await batch.commit();

    console.log(`[DEDUPE_TXN] uid=${uid} report=${JSON.stringify(report)}`);
    return report;
  },
);
