import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { resolveEffectiveOwner } from "../middleware/auth";
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
  counters: BatchResult,
  callerUid: string,
  callerRole: string
): Promise<void> {
  const db = admin.firestore();

  if (result.source === "rule" || result.source === "user_rule") {
    counters.ruleMatched++;
  } else if (result.source === "ai") {
    counters.aiMatched++;
  }

  const isAITransfer = result.aiType === "transfer";
  // If the user already set a category (isUserModified), keep it — only fill entity.
  const keepExistingCategory = txn.isUserModified === true && !!txn.category;

  const newStatus = isAITransfer
    ? "transfer"
    : result.confidence >= 0.8 ? "categorized" : "needs_review";

  const update: Record<string, unknown> = {
    categorizationConfidence:  result.confidence,
    categorizationSource:      result.source,
    categorizationExplanation: result.categorizationExplanation,
    categorizedAt:             admin.firestore.FieldValue.serverTimestamp(),
    updatedBy:                 callerUid,
    updatedByRole:             callerRole,
    updatedAt:                 admin.firestore.FieldValue.serverTimestamp(),
    ...(result.source === "ai" ? { aiSuggested: true, aiSource: "ai" } : {}),
    ...(isAITransfer ? { type: "transfer" } : {}),
    // Only overwrite category if user hasn't already explicitly set one
    ...(!keepExistingCategory ? {
      category:    result.category,
      taxCategory: result.taxCategory,
      taxSchedule: result.taxSchedule,
      status:      newStatus,
    } : {}),
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

export async function categorizeUserTransactions(
  userId: string,
  callerUid: string,
  callerRole: string
): Promise<BatchResult> {
  const db = admin.firestore();
  const counters: BatchResult = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };

  const [snap, userRules, entities] = await Promise.all([
    db.collection("transactions")
      .where("uid", "==", userId)
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

  // Build input array.
  // Skip only if the user has explicitly set BOTH category and entity — nothing left to do.
  // If category is set but entity is missing, still process so entity gets assigned.
  const toProcess: Array<{ idx: number; docId: string; txn: TxnDoc }> = [];
  for (let i = 0; i < docs.length; i++) {
    const txn = docs[i].data() as TxnDoc;
    if (txn.isUserModified === true && txn.entityId) { counters.skipped++; continue; }
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

  // Write results back. Allow through even if category is empty (entity-only fill).
  const writes = toProcess.map(({ idx, docId, txn }) => {
    const result = results.get(idx);
    if (!result) { counters.skipped++; return Promise.resolve(); }
    // If we have neither category nor entity assignment, nothing to do
    const hasCategory = !!result.category;
    const hasEntity   = !!result.entityId || (!!result.aiAssignment && result.aiAssignment !== "Personal");
    if (!hasCategory && !hasEntity) { counters.skipped++; return Promise.resolve(); }
    return applyResultToDoc(docId, txn, result, entityMap, counters, callerUid, callerRole);
  });

  await Promise.allSettled(writes);

  console.log(`[CategorizeBatch] uid=${userId} caller=${callerUid} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`);
  return counters;
}

// ─── Categorize a specific list of transaction IDs ────────────────────────────

export async function categorizeSpecificTransactions(
  userId: string,
  transactionIds: string[],
  callerUid: string,
  callerRole: string,
  options: { force?: boolean } = {}
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
    // Security: verify ownership (shared users operate on owner's transactions)
    if (txn.uid !== userId) { counters.skipped++; continue; }
    // Normally skip user-modified rows so AI doesn't undo manual classifications.
    // The `force` flag bypasses that guard — used when the user explicitly asks
    // to re-categorize a known-wrong batch (e.g. wrong category bulk-applied
    // across hundreds of rows). Caller is responsible for honoring user intent.
    if (!options.force && txn.isUserModified === true && txn.entityId) {
      counters.skipped++; continue;
    }
    toProcess.push({ idx: i, docId: snap.id, txn });
  }

  // FORCE mode: delete user vendor rules associated with the affected vendors
  // BEFORE re-categorizing. Otherwise the bad rules (learned during the wrong
  // bulk-apply) will just re-fire and produce the same wrong category. The
  // categorizationService also gets a bypassUserRules flag as a second layer
  // of defense in case any rules slip through.
  if (options.force) {
    const vendorsToWipe = new Set<string>();
    for (const { txn } of toProcess) {
      const v = (txn.vendor ?? "").trim();
      if (v) vendorsToWipe.add(v);
    }
    if (vendorsToWipe.size > 0) {
      const ruleSnap = await db
        .collection("categoryRules")
        .where("uid", "==", userId)
        .get();
      const toDelete = ruleSnap.docs.filter((d) => vendorsToWipe.has((d.data().vendorName as string) ?? ""));
      for (let i = 0; i < toDelete.length; i += 400) {
        const batch = db.batch();
        toDelete.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      console.log(`[forceRecategorize] deleted ${toDelete.length} vendor rule(s) across ${vendorsToWipe.size} vendor(s) for uid=${userId}`);
    }
  }

  // Batch categorize all at once (keyword → user rule → AI in groups of 10).
  // In force mode, skip the user-rule layer entirely — keyword + AI only.
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

  const results = await categorizeTransactionsBatch(
    inputs,
    options.force ? [] : userRules,
    entities,
    { bypassUserRules: !!options.force },
  );

  // Write results back. Allow through even if category is empty (entity-only fill).
  const writes = toProcess.map(({ idx, docId, txn }) => {
    const result = results.get(idx);
    if (!result) { counters.skipped++; return Promise.resolve(); }
    const hasCategory = !!result.category;
    const hasEntity   = !!result.entityId || (!!result.aiAssignment && result.aiAssignment !== "Personal");
    if (!hasCategory && !hasEntity) { counters.skipped++; return Promise.resolve(); }
    return applyResultToDoc(docId, txn, result, entityMap, counters, callerUid, callerRole);
  });

  await Promise.allSettled(writes);

  console.log(`[CategorizeSelected] uid=${userId} caller=${callerUid} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`);
  return counters;
}

// ─── Cloud Functions ──────────────────────────────────────────────────────────

export const categorizeBatch = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540 },
  async (request) => {
    const { callerUid, effectiveOwnerUid, role } = await resolveEffectiveOwner(request);
    return categorizeUserTransactions(effectiveOwnerUid, callerUid, role);
  }
);

export const categorizeSelected = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540 },
  async (request) => {
    const { callerUid, effectiveOwnerUid, role } = await resolveEffectiveOwner(request);
    const { transactionIds, force } = request.data as { transactionIds?: string[]; force?: boolean };
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };
    }
    const safeIds = transactionIds.slice(0, 200);
    return categorizeSpecificTransactions(effectiveOwnerUid, safeIds, callerUid, role, { force: !!force });
  }
);
