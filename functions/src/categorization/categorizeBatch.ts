import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { categorizeTransaction } from "../services/categorizationService";

const BATCH_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchResult {
  total: number;
  ruleMatched: number;
  aiMatched: number;
  skipped: number;
}

// ─── Core batch logic ─────────────────────────────────────────────────────────

/**
 * Queries all uncategorized needs_review transactions for a user and
 * categorizes them, writing results back to Firestore.
 *
 * Safety guarantees:
 *  - Skips transactions where isUserModified === true
 *  - Skips transactions that already have a non-empty category
 *  - Does NOT overwrite an existing entityId if the user already set one
 */
export async function categorizeUserTransactions(userId: string): Promise<BatchResult> {
  const db = admin.firestore();

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

    const results = await Promise.allSettled(
      chunk.map(async (docSnap) => {
        total++;
        const txn = docSnap.data();

        if (txn.isUserModified === true) { skipped++; return; }
        if (txn.category !== null && txn.category !== undefined && String(txn.category).trim() !== "") {
          skipped++; return;
        }

        const result = await categorizeTransaction(userId, {
          description:           (txn.description as string) ?? "",
          normalizedDescription: txn.normalizedDescription as string | undefined,
          vendor:                (txn.vendor as string) ?? "",
          amount:                (txn.amount as number) ?? 0,
          type:                  (txn.type as string) ?? "expense",
        });

        if (!result.category) { skipped++; return; }

        if (result.source === "rule" || result.source === "user_rule") {
          ruleMatched++;
        } else {
          aiMatched++;
        }

        const newStatus = result.confidence >= 0.8 ? "categorized" : "needs_review";

        // Build the update payload
        const update: Record<string, unknown> = {
          category:                    result.category,
          taxCategory:                 result.taxCategory,
          taxSchedule:                 result.taxSchedule,
          categorizationConfidence:    result.confidence,
          categorizationSource:        result.source,
          categorizationExplanation:   result.categorizationExplanation,
          categorizedAt:               admin.firestore.FieldValue.serverTimestamp(),
          status:                      newStatus,
        };

        // Entity prediction — only set if the transaction has no entity yet
        if (!txn.entityId && result.entityId) {
          update.entityId          = result.entityId;
          update.entityName        = result.entityName ?? null;
          update.entityType        = result.entityType ?? "business";
          update.entityAutoAssigned = true; // flag so UI can highlight it
        }

        await db.collection("transactions").doc(docSnap.id).update(update);
      })
    );

    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(`[CategorizeBatch] Failed doc ${chunk[idx]?.id ?? "?"}:`, r.reason);
      }
    });
  }

  console.log(
    `[CategorizeBatch] uid=${userId} total=${total} rule=${ruleMatched} ai=${aiMatched} skipped=${skipped}`
  );

  return { total, ruleMatched, aiMatched, skipped };
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const categorizeBatch = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  return categorizeUserTransactions(uid);
});
