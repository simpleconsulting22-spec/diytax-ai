import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { categorizeTransaction } from "../services/categorizationService";

const BATCH_SIZE = 50;

// ─── Core batch logic ─────────────────────────────────────────────────────────

export interface BatchResult {
  total: number;
  ruleMatched: number;
  aiMatched: number;
  skipped: number;
}

/**
 * Queries all uncategorized needs_review transactions for a user and
 * categorizes them, writing results back to Firestore.
 *
 * Safety guarantees:
 *  - Skips transactions where isUserModified === true
 *  - Skips transactions that already have a non-empty category
 */
export async function categorizeUserTransactions(userId: string): Promise<BatchResult> {
  const db = admin.firestore();

  // Firestore: category == null matches docs where field is null OR absent.
  // CSV-imported transactions have no category field, so they match.
  const snap = await db
    .collection("transactions")
    .where("uid", "==", userId)
    .where("category", "==", null)
    .where("status", "==", "needs_review")
    .get();

  const docs = snap.docs;

  let total = 0;
  let ruleMatched = 0;
  let aiMatched = 0;
  let skipped = 0;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);

    // Process each chunk concurrently; failures in one doc don't block others.
    const results = await Promise.allSettled(
      chunk.map(async (docSnap) => {
        total++;
        const txn = docSnap.data();

        // Safety: do not overwrite user-modified transactions
        if (txn.isUserModified === true) {
          skipped++;
          return;
        }

        // Safety: do not overwrite an existing category
        if (txn.category !== null && txn.category !== undefined && String(txn.category).trim() !== "") {
          skipped++;
          return;
        }

        const result = await categorizeTransaction(userId, {
          description: (txn.description as string) ?? "",
          normalizedDescription: txn.normalizedDescription as string | undefined,
          amount: (txn.amount as number) ?? 0,
          type: (txn.type as string) ?? "expense",
        });

        // Nothing to write if categorization returned no result
        if (!result.category) {
          skipped++;
          return;
        }

        if (result.source === "rule" || result.source === "user_rule") {
          ruleMatched++;
        } else {
          aiMatched++;
        }

        const newStatus = result.confidence >= 0.8 ? "categorized" : "needs_review";

        await db.collection("transactions").doc(docSnap.id).update({
          category: result.category,
          taxCategory: result.taxCategory,
          taxSchedule: result.taxSchedule,
          categorizationConfidence: result.confidence,
          categorizationSource: result.source,
          categorizedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: newStatus,
        });
      })
    );

    // Log any unexpected failures at the doc level
    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        const docId = chunk[idx]?.id ?? "unknown";
        console.error(`[CategorizeBatch] Failed to categorize doc ${docId}:`, r.reason);
      }
    });
  }

  console.log(
    `[CategorizeBatch] uid=${userId} | total=${total} | rule=${ruleMatched} | ai=${aiMatched} | skipped=${skipped}`
  );

  return { total, ruleMatched, aiMatched, skipped };
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const categorizeBatch = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  return categorizeUserTransactions(uid);
});
