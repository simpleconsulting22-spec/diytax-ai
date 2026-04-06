import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { categorizeTransaction } from "../services/categorizationService";

const BATCH_SIZE = 150;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchResult {
  total: number;
  ruleMatched: number;
  aiMatched: number;
  skipped: number;
}

// ─── Entity name → ID resolver ────────────────────────────────────────────────

async function loadEntityMap(
  userId: string
): Promise<Map<string, { id: string; name: string; type: string }>> {
  const db = admin.firestore();
  const snap = await db.collection("entities").where("userId", "==", userId).get();
  const map = new Map<string, { id: string; name: string; type: string }>();
  snap.docs.forEach((d) => {
    map.set(d.data().name as string, {
      id: d.id,
      name: d.data().name as string,
      type: d.data().type as string,
    });
  });
  return map;
}

// ─── Core batch logic ─────────────────────────────────────────────────────────

/**
 * Shared per-document categorization logic used by both "all" and "selected" batch flows.
 */
async function categorizeSingleDoc(
  docSnap: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
  userId: string,
  entityMap: Map<string, { id: string; name: string; type: string }>,
  counters: { total: number; ruleMatched: number; aiMatched: number; skipped: number }
): Promise<void> {
  const db = admin.firestore();
  counters.total++;
  const txn = docSnap.data();
  if (!txn) { counters.skipped++; return; }

  if (txn.isUserModified === true) { counters.skipped++; return; }
  if (txn.category !== null && txn.category !== undefined && String(txn.category).trim() !== "") {
    counters.skipped++; return;
  }

  const result = await categorizeTransaction(userId, {
    description:           (txn.description as string) ?? "",
    normalizedDescription: txn.normalizedDescription as string | undefined,
    vendor:                (txn.vendor as string) ?? "",
    amount:                (txn.amount as number) ?? 0,
    type:                  (txn.type as string) ?? "expense",
  });

  if (!result.category) { counters.skipped++; return; }

  if (result.source === "rule" || result.source === "user_rule") {
    counters.ruleMatched++;
  } else {
    counters.aiMatched++;
  }

  // If AI flagged this as a transfer, treat it as one
  const isAITransfer = result.aiType === "transfer";
  const newStatus = isAITransfer
    ? "transfer"
    : result.confidence >= 0.8 ? "categorized" : "needs_review";

  const update: Record<string, unknown> = {
    category:                  result.category,
    taxCategory:               result.taxCategory,
    taxSchedule:               result.taxSchedule,
    categorizationConfidence:  result.confidence,
    categorizationSource:      result.source,
    categorizationExplanation: result.categorizationExplanation,
    categorizedAt:             admin.firestore.FieldValue.serverTimestamp(),
    status:                    newStatus,
    // AI flags (Task 2E)
    ...(result.source === "ai" ? { aiSuggested: true, aiSource: "ai" } : {}),
    ...(isAITransfer ? { type: "transfer" } : {}),
  };

  // Entity assignment — priority: user rule entity > AI assignment by name > category frequency
  if (!txn.entityId) {
    if (result.entityId) {
      // From user rule
      update.entityId          = result.entityId;
      update.entityName        = result.entityName ?? null;
      update.entityType        = result.entityType ?? "business";
      update.entityAutoAssigned = true;
    } else if (result.aiAssignment && result.aiAssignment !== "Personal") {
      // From AI — resolve entity name to ID
      const entity = entityMap.get(result.aiAssignment);
      if (entity) {
        update.entityId          = entity.id;
        update.entityName        = entity.name;
        update.entityType        = entity.type;
        update.entityAutoAssigned = true;
      }
    }
  }

  await db.collection("transactions").doc(docSnap.id).update(update);
}

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

  const [snap, entityMap] = await Promise.all([
    db.collection("transactions")
      .where("uid", "==", userId)
      .where("category", "==", null)
      .where("status", "==", "needs_review")
      .get(),
    loadEntityMap(userId),
  ]);

  const docs = snap.docs;
  const counters = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map((docSnap) => categorizeSingleDoc(docSnap, userId, entityMap, counters))
    );
    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(`[CategorizeBatch] Failed doc ${chunk[idx]?.id ?? "?"}:`, r.reason);
      }
    });
  }

  console.log(
    `[CategorizeBatch] uid=${userId} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`
  );

  return counters;
}

/**
 * Categorize a specific list of transaction IDs (used for "categorize selected" and
 * client-side batching with progress tracking).
 */
export async function categorizeSpecificTransactions(
  userId: string,
  transactionIds: string[]
): Promise<BatchResult> {
  const db = admin.firestore();
  const entityMap = await loadEntityMap(userId);
  const counters = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };

  for (let i = 0; i < transactionIds.length; i += BATCH_SIZE) {
    const chunk = transactionIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map(async (docId) => {
        const docSnap = await db.collection("transactions").doc(docId).get();
        // Security: skip docs that don't belong to this user
        if (!docSnap.exists || (docSnap.data()?.uid as string) !== userId) {
          counters.skipped++; return;
        }
        await categorizeSingleDoc(docSnap, userId, entityMap, counters);
      })
    );
    results.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(`[CategorizeSelected] Failed doc ${chunk[idx] ?? "?"}:`, r.reason);
      }
    });
  }

  return counters;
}

// ─── Cloud Functions ──────────────────────────────────────────────────────────

export const categorizeBatch = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  return categorizeUserTransactions(uid);
});

/**
 * Categorize a specific list of transaction IDs.
 * Used by the frontend for "Auto Categorize Selected" and progress-tracked "Auto Categorize All"
 * (frontend splits IDs into chunks of ~150 and calls this per chunk).
 */
export const categorizeSelected = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  const { transactionIds } = request.data as { transactionIds?: string[] };
  if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
    return { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };
  }
  // Cap at 200 per call to stay within function timeout
  const safeIds = transactionIds.slice(0, 200);
  return categorizeSpecificTransactions(uid, safeIds);
});
