import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import {
  categorizeTransactionsBatch,
  loadUserRules,
  loadUserEntities,
  TransactionInput,
  CategorizationResult,
} from "../services/categorizationService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchResult {
  total: number;
  ruleMatched: number;
  aiMatched: number;
  skipped: number;
}

// ─── Core batch logic ─────────────────────────────────────────────────────────

interface TxnDoc {
  uid: string;
  description: string;
  normalizedDescription?: string;
  vendor?: string;
  amount: number;
  type: string;
  category?: string | null;
  isUserModified?: boolean;
  entityId?: string | null;
  entityName?: string | null;
  entityType?: string;
}

async function applyResultToDoc(
  docId: string,
  txn: TxnDoc,
  result: CategorizationResult,
  entityMap: Map<string, { id: string; name: string; type: string }>,
  counters: BatchResult
): Promise<void> {
  const db = admin.firestore();

  if (result.source === "rule" || result.source === "user_rule") {
    counters.ruleMatched++;
  } else if (result.source === "ai") {
    counters.aiMatched++;
  }

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
    ...(result.source === "ai" ? { aiSuggested: true, aiSource: "ai" } : {}),
    ...(isAITransfer ? { type: "transfer" } : {}),
  };

  // Entity assignment — only if not already user-set
  if (!txn.entityId) {
    if (result.entityId) {
      update.entityId               = result.entityId;
      update.entityName             = result.entityName ?? null;
      update.entityType             = result.entityType ?? "business";
      update.entityAutoAssigned     = true;
      update.entityAssignmentSource = "user_rule";
    } else if (result.aiAssignment && result.aiAssignment !== "Personal") {
      const entity = entityMap.get(result.aiAssignment);
      if (entity) {
        update.entityId               = entity.id;
        update.entityName             = entity.name;
        update.entityType             = entity.type;
        update.entityAutoAssigned     = true;
        update.entityAssignmentSource = "ai";
      }
    }
  }

  await db.collection("transactions").doc(docId).update(update);
}

// ─── Categorize all uncategorized transactions for a user ─────────────────────

export async function categorizeUserTransactions(userId: string): Promise<BatchResult> {
  const db = admin.firestore();
  const counters: BatchResult = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };

  const [snap, userRules, entities] = await Promise.all([
    db.collection("transactions")
      .where("uid", "==", userId)
      .where("category", "==", null)
      .where("status", "==", "needs_review")
      .get(),
    loadUserRules(userId),
    loadUserEntities(userId),
  ]);

  // Build entity name→id map for assignment
  const entityIdSnap = await db.collection("entities").where("userId", "==", userId).get();
  const entityMap = new Map<string, { id: string; name: string; type: string }>();
  entityIdSnap.docs.forEach((d) => {
    entityMap.set(d.data().name as string, {
      id: d.id,
      name: d.data().name as string,
      type: d.data().type as string,
    });
  });

  const docs = snap.docs;
  counters.total = docs.length;

  // Build input array, skip user-modified
  const toProcess: Array<{ idx: number; docId: string; txn: TxnDoc }> = [];
  for (let i = 0; i < docs.length; i++) {
    const txn = docs[i].data() as TxnDoc;
    if (txn.isUserModified === true) { counters.skipped++; continue; }
    toProcess.push({ idx: i, docId: docs[i].id, txn });
  }

  // Batch categorize
  const inputs = toProcess.map(({ idx, txn }) => ({
    idx,
    txn: {
      description:           txn.description ?? "",
      normalizedDescription: txn.normalizedDescription,
      vendor:                txn.vendor ?? "",
      amount:                txn.amount ?? 0,
      type:                  txn.type ?? "expense",
    } as TransactionInput,
  }));

  const results = await categorizeTransactionsBatch(inputs, userRules, entities);

  // Write results back
  const writes = toProcess.map(({ idx, docId, txn }) => {
    const result = results.get(idx);
    if (!result || !result.category) { counters.skipped++; return Promise.resolve(); }
    return applyResultToDoc(docId, txn, result, entityMap, counters);
  });

  await Promise.allSettled(writes);

  console.log(`[CategorizeBatch] uid=${userId} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`);
  return counters;
}

// ─── Categorize a specific list of transaction IDs ────────────────────────────

export async function categorizeSpecificTransactions(
  userId: string,
  transactionIds: string[]
): Promise<BatchResult> {
  const db = admin.firestore();
  const counters: BatchResult = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };

  // Load context ONCE for the whole batch
  const [userRules, entities] = await Promise.all([
    loadUserRules(userId),
    loadUserEntities(userId),
  ]);

  // Build entity name→id map
  const entityIdSnap = await db.collection("entities").where("userId", "==", userId).get();
  const entityMap = new Map<string, { id: string; name: string; type: string }>();
  entityIdSnap.docs.forEach((d) => {
    entityMap.set(d.data().name as string, {
      id: d.id,
      name: d.data().name as string,
      type: d.data().type as string,
    });
  });

  // Fetch all transaction docs in parallel
  const docSnaps = await Promise.all(
    transactionIds.map((id) => db.collection("transactions").doc(id).get())
  );

  const toProcess: Array<{ idx: number; docId: string; txn: TxnDoc }> = [];

  for (let i = 0; i < docSnaps.length; i++) {
    counters.total++;
    const snap = docSnaps[i];
    if (!snap.exists) { counters.skipped++; continue; }
    const txn = snap.data() as TxnDoc;
    // Security: verify ownership
    if (txn.uid !== userId) { counters.skipped++; continue; }
    // Respect explicit user edits
    if (txn.isUserModified === true) { counters.skipped++; continue; }
    toProcess.push({ idx: i, docId: snap.id, txn });
  }

  // Batch categorize all at once (keyword → user rule → AI in groups of 10)
  const inputs = toProcess.map(({ idx, txn }) => ({
    idx,
    txn: {
      description:           txn.description ?? "",
      normalizedDescription: txn.normalizedDescription,
      vendor:                txn.vendor ?? "",
      amount:                txn.amount ?? 0,
      type:                  txn.type ?? "expense",
    } as TransactionInput,
  }));

  const results = await categorizeTransactionsBatch(inputs, userRules, entities);

  // Write results back
  const writes = toProcess.map(({ idx, docId, txn }) => {
    const result = results.get(idx);
    if (!result || !result.category) { counters.skipped++; return Promise.resolve(); }
    return applyResultToDoc(docId, txn, result, entityMap, counters);
  });

  await Promise.allSettled(writes);

  console.log(`[CategorizeSelected] uid=${userId} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`);
  return counters;
}

// ─── Cloud Functions ──────────────────────────────────────────────────────────

export const categorizeBatch = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540 },
  async (request) => {
    const uid = await requireAuth(request);
    return categorizeUserTransactions(uid);
  }
);

export const categorizeSelected = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540 },
  async (request) => {
    const uid = await requireAuth(request);
    const { transactionIds } = request.data as { transactionIds?: string[] };
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };
    }
    const safeIds = transactionIds.slice(0, 200);
    return categorizeSpecificTransactions(uid, safeIds);
  }
);
