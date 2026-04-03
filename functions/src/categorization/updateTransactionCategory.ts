import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

export const updateTransactionCategory = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { transactionId?: string; category?: string };
  if (!data.transactionId || !data.category) {
    throw new HttpsError("invalid-argument", "transactionId and category are required.");
  }

  const db = admin.firestore();

  const txnSnap = await db.collection("transactions").doc(data.transactionId).get();
  if (!txnSnap.exists) {
    throw new HttpsError("not-found", "Transaction not found.");
  }

  const txn = txnSnap.data()!;
  if (txn.uid !== uid) {
    throw new HttpsError("permission-denied", "Access denied.");
  }

  await db.collection("transactions").doc(data.transactionId).update({
    category: data.category,
    status: "categorized",
  });

  // Upsert category rule
  const merchantName = txn.merchantName ?? "";
  if (merchantName) {
    const rulesSnap = await db
      .collection("categoryRules")
      .where("uid", "==", uid)
      .where("vendorName", "==", merchantName)
      .limit(1)
      .get();

    if (!rulesSnap.empty) {
      await rulesSnap.docs[0].ref.update({
        category: data.category,
        usageCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const ruleId = db.collection("categoryRules").doc().id;
      await db.collection("categoryRules").doc(ruleId).set({
        ruleId,
        uid,
        vendorName: merchantName,
        category: data.category,
        usageCount: 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  return { updated: true };
});
