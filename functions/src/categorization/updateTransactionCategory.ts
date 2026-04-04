import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { extractVendorName } from "../services/vendorExtraction";

export const updateTransactionCategory = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as {
    transactionId?: string;
    category?: string;
    taxCategory?: string;
    taxSchedule?: string;
    entityId?: string;
    entityType?: string;
    entityName?: string;
  };

  if (!data.transactionId || !data.category) {
    throw new HttpsError("invalid-argument", "transactionId and category are required.");
  }

  const db = admin.firestore();

  const txnSnap = await db.collection("transactions").doc(data.transactionId).get();
  if (!txnSnap.exists) throw new HttpsError("not-found", "Transaction not found.");

  const txn = txnSnap.data()!;
  if (txn.uid !== uid) throw new HttpsError("permission-denied", "Access denied.");

  // ── 1. Update the transaction ──────────────────────────────────────────────
  const txnUpdate: Record<string, unknown> = {
    category:                  data.category,
    categorizationSource:      "user_rule",
    categorizationExplanation: `Manually set to "${data.category}" by user`,
    isUserModified:            true,
    status:                    "categorized",
    updatedAt:                 admin.firestore.FieldValue.serverTimestamp(),
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

  if (!vendorName) return { updated: true };

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
    updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
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
      usageCount: admin.firestore.FieldValue.increment(1),
    });
  } else {
    await db.collection("categoryRules").add({
      ...rulePayload,
      usageCount:  1,
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return { updated: true };
});
