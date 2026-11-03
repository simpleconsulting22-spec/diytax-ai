import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
// Modular FieldValue: the namespace form breaks under the Functions emulator
// (see getTaxForecast.ts).
import { FieldValue } from "firebase-admin/firestore";
import { requireFreshMfa } from "../middleware/auth";
import { appendHistory, snapshotFields } from "./decisionPolicy";
import { extractVendorName } from "../services/vendorExtraction";

export const updateTransactionCategory = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = requireFreshMfa(request);

  const data = request.data as {
    transactionId?: string;
    category?: string;
    taxCategory?: string;
    taxSchedule?: string;
    entityId?: string;
    entityType?: string;
    entityName?: string;
    /** Only when true is a vendor rule created or updated ("Always do this"). */
    createRule?: boolean;
  };

  if (!data.transactionId || !data.category) {
    throw new HttpsError("invalid-argument", "transactionId and category are required.");
  }

  const db = admin.firestore();

  const txnSnap = await db.collection("transactions").doc(data.transactionId).get();
  if (!txnSnap.exists) throw new HttpsError("not-found", "Transaction not found.");

  const txn = txnSnap.data()!;
  if (txn.uid !== uid) throw new HttpsError("permission-denied", "Access denied.");

  // Defense in depth: transfers shouldn't have categories. If a stale client
  // (or future code path) tries to write one, refuse — categories on
  // transfers leak into the tax meter as junk and poison vendor rules.
  if (txn.type === "transfer") {
    console.warn(`[updateTransactionCategory] refusing category="${data.category}" on transfer txn=${data.transactionId}`);
    return { updated: false, skipped: "transfer" };
  }

  // ── 1. Update the transaction ──────────────────────────────────────────────
  // A person's choice is Sure, and the previous values are kept in history so
  // the change can be undone.
  const before = snapshotFields(txn);
  const after = {
    category:    data.category,
    taxCategory: data.taxCategory ?? before.taxCategory,
    taxSchedule: data.taxSchedule ?? before.taxSchedule,
    status:      "categorized",
  };
  const txnUpdate: Record<string, unknown> = {
    category:                  data.category,
    categorizationSource:      "user_rule",
    categorizationExplanation: `Manually set to "${data.category}" by user`,
    isUserModified:            true,
    status:                    "categorized",
    zachTier:                  "sure",
    reviewTriggers:            [],
    history:                   appendHistory(txn.history, { at: Date.now(), by: uid, source: "user", before, after }),
    updatedAt:                 FieldValue.serverTimestamp(),
  };
  if (data.taxCategory)  txnUpdate.taxCategory  = data.taxCategory;
  if (data.taxSchedule)  txnUpdate.taxSchedule  = data.taxSchedule;
  if (data.entityId)     txnUpdate.entityId     = data.entityId;
  if (data.entityType)   txnUpdate.entityType   = data.entityType;
  if (data.entityName)   txnUpdate.entityName   = data.entityName;

  await db.collection("transactions").doc(data.transactionId).update(txnUpdate);

  // ── 2. Derive vendor name ──────────────────────────────────────────────────
  // Prefer stored vendor field → extract from normalizedDescription → fall back to merchantName
  const vendorName =
    (txn.vendor as string | undefined) ||
    extractVendorName(
      txn.description as string ?? "",
      txn.normalizedDescription as string | undefined
    ) ||
    (txn.merchantName as string | undefined) ||
    "";

  // A single edit changes this transaction only. A vendor rule is written
  // only when the user explicitly asked for it ("Always do this"), so one odd
  // purchase can't silently reclassify every future charge from the vendor.
  if (data.createRule !== true || !vendorName) return { updated: true, ruleSaved: false };

  // ── 3. Upsert categoryRule (learning loop) ─────────────────────────────────
  // Check for an existing rule keyed to this vendor for this user.
  const rulesSnap = await db
    .collection("categoryRules")
    .where("uid", "==", uid)
    .where("vendorName", "==", vendorName)
    .limit(1)
    .get();

  const rulePayload: Record<string, unknown> = {
    uid,
    vendorName,
    category:   data.category,
    confidence: 1.0,
    updatedAt:  FieldValue.serverTimestamp(),
  };
  if (data.taxCategory)  rulePayload.taxCategory  = data.taxCategory  ?? (txn.taxCategory  ?? "");
  if (data.taxSchedule)  rulePayload.taxSchedule  = data.taxSchedule  ?? (txn.taxSchedule  ?? "");
  // Persist entity so the next transaction from this vendor gets auto-assigned
  if (data.entityId)     rulePayload.entityId     = data.entityId;
  if (data.entityType)   rulePayload.entityType   = data.entityType;
  if (data.entityName)   rulePayload.entityName   = data.entityName;

  if (!rulesSnap.empty) {
    await rulesSnap.docs[0].ref.update({
      ...rulePayload,
      usageCount: FieldValue.increment(1),
    });
  } else {
    await db.collection("categoryRules").add({
      ...rulePayload,
      usageCount:  1,
      createdAt:   FieldValue.serverTimestamp(),
    });
  }

  return { updated: true, ruleSaved: true };
});
