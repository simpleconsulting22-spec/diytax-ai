import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { classifyAll, TxnInput } from "./classifyTransactionPipeline";

export interface PipelineReport {
  scanned:           number;
  reclassified:      number;
  pairedAsTransfer:  number;
  flaggedAsRefund:   number;
  flaggedNeedsReview: number;
  unchanged:         number;
}

/**
 * Core pipeline logic — callable from any auth context (HTTP callable or
 * server-internal trigger from fetchTransactionsForAccount).
 */
export async function runClassificationPipelineForUser(uid: string): Promise<PipelineReport> {
  const db = admin.firestore();

  // Pull account institution names so the pipeline can detect internal payments
  const acctsSnap = await db.collection("accounts").where("uid", "==", uid).get();
  const institutionByAccountId = new Map<string, string>();
  acctsSnap.docs.forEach((a) => {
    const inst = a.data().institutionName as string | undefined;
    if (inst) institutionByAccountId.set(a.id, inst);
  });

  const snap = await db.collection("transactions")
    .where("uid", "==", uid)
    .where("source", "==", "plaid")
    .get();

  const inputs: TxnInput[] = [];
  const docByPid = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  snap.docs.forEach((d) => {
    const data = d.data();
    const pid = data.plaidTransactionId as string | undefined;
    if (!pid) return;
    const signed = data.plaidSignedAmount as number | undefined;
    if (typeof signed !== "number") return;
    docByPid.set(pid, d);
    inputs.push({
      plaidTransactionId: pid,
      accountId:          data.accountId          as string,
      signedAmount:       signed,
      absAmount:          Math.abs(signed),
      date:               data.date               as string,
      description:        (data.description       as string) ?? "",
      merchantName:       data.merchantName       as string | undefined,
      status:             data.status             as string | undefined,
      institutionName:    institutionByAccountId.get(data.accountId as string),
    });
  });

  const results = classifyAll(inputs);

  const report: PipelineReport = {
    scanned:            inputs.length,
    reclassified:       0,
    pairedAsTransfer:   0,
    flaggedAsRefund:    0,
    flaggedNeedsReview: 0,
    unchanged:          0,
  };

  let batch = db.batch();
  let n = 0;
  for (const [pid, result] of results.entries()) {
    const doc = docByPid.get(pid);
    if (!doc) continue;
    const cur = doc.data();

    // Safety: never touch user-confirmed transactions (status="categorized")
    if (cur.status === "categorized") {
      report.unchanged++;
      continue;
    }

    const update: Record<string, unknown> = {};

    if (cur.type !== result.type) {
      update.type       = result.type;
      update.typeSource = `pipeline:${result.reason}`;
      report.reclassified++;
      if (result.type === "transfer") report.pairedAsTransfer++;
      if (result.type === "refund")   report.flaggedAsRefund++;
    }

    const newGid = result.transferGroupId ?? null;
    const curGid = (cur.transferGroupId as string | undefined) ?? null;
    if (newGid !== curGid) update.transferGroupId = newGid;

    // status — respect categorized; allow auto_resolved → needs_review and back
    if (result.status === "needs_review" && cur.status !== "needs_review") {
      update.status = "needs_review";
      report.flaggedNeedsReview++;
    } else if (result.status === "auto_resolved" && cur.status === "needs_review") {
      // P2P that previously sat in review but now has a pair / learned direction
      update.status = "auto_resolved";
    }

    if (cur.confidence !== result.confidence) update.confidence = result.confidence;
    const excludeNow = result.excludeFromReports ?? false;
    if ((cur.excludeFromReports ?? false) !== excludeNow) update.excludeFromReports = excludeNow;

    const newSuggested = result.suggestedDirection ?? null;
    const curSuggested = (cur.suggestedDirection as string | undefined) ?? null;
    if (newSuggested !== curSuggested) update.suggestedDirection = newSuggested;

    const newDupGid = result.duplicateGroupId ?? null;
    const curDupGid = (cur.duplicateGroupId as string | undefined) ?? null;
    if (newDupGid !== curDupGid) update.duplicateGroupId = newDupGid;

    if (Object.keys(update).length === 0) {
      report.unchanged++;
      continue;
    }

    batch.update(doc.ref, update);
    n++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n > 0) await batch.commit();

  console.log(`[PIPELINE] uid=${uid} report=${JSON.stringify(report)}`);
  return report;
}

/**
 * Run the full classification pipeline over every Plaid-sourced transaction
 * in the user's account. Idempotent: reruns produce the same result.
 *
 * Steps:
 *   1. Load every Plaid txn (uid, source=plaid)
 *   2. Build TxnInput[] using stored plaidSignedAmount (signed) for direction
 *   3. classifyAll(...) → ClassifyOutput per txn (amount sign + transfer pairing + refund detection + P2P flag)
 *   4. Diff against current type/transferGroupId/status, batch-update only changes
 *
 * User edits are not detected here — if you've manually overridden a type and
 * want the pipeline to respect that, mark the doc with userModifiedType=true
 * and we'll add a check.
 */
export const applyClassificationPipeline = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request): Promise<PipelineReport> => {
    const uid = await requireAuth(request);
    return runClassificationPipelineForUser(uid);
  },
);
