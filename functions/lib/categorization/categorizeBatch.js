"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeSelected = exports.categorizeBatch = void 0;
exports.categorizeUserTransactions = categorizeUserTransactions;
exports.categorizeSpecificTransactions = categorizeSpecificTransactions;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const categorizationService_1 = require("../services/categorizationService");
async function applyResultToDoc(docId, txn, result, entityMap, counters, callerUid, callerRole) {
    const db = admin.firestore();
    if (result.source === "rule" || result.source === "user_rule") {
        counters.ruleMatched++;
    }
    else if (result.source === "ai") {
        counters.aiMatched++;
    }
    const isAITransfer = result.aiType === "transfer";
    const newStatus = isAITransfer
        ? "transfer"
        : result.confidence >= 0.8 ? "categorized" : "needs_review";
    const update = {
        category: result.category,
        taxCategory: result.taxCategory,
        taxSchedule: result.taxSchedule,
        categorizationConfidence: result.confidence,
        categorizationSource: result.source,
        categorizationExplanation: result.categorizationExplanation,
        categorizedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: newStatus,
        // Audit fields — updatedBy is the logged-in user (not ownerUid)
        updatedBy: callerUid,
        updatedByRole: callerRole,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(result.source === "ai" ? { aiSuggested: true, aiSource: "ai" } : {}),
        ...(isAITransfer ? { type: "transfer" } : {}),
    };
    // Entity assignment — only if not already user-set
    if (!txn.entityId) {
        if (result.entityId) {
            update.entityId = result.entityId;
            update.entityName = result.entityName ?? null;
            update.entityType = result.entityType ?? "business";
            update.entityAutoAssigned = true;
            update.entityAssignmentSource = "user_rule";
        }
        else if (result.aiAssignment && result.aiAssignment !== "Personal") {
            const entity = entityMap.get(result.aiAssignment);
            if (entity) {
                update.entityId = entity.id;
                update.entityName = entity.name;
                update.entityType = entity.type;
                update.entityAutoAssigned = true;
                update.entityAssignmentSource = "ai";
            }
        }
    }
    await db.collection("transactions").doc(docId).update(update);
}
// ─── Categorize all uncategorized transactions for a user ─────────────────────
async function categorizeUserTransactions(userId, callerUid, callerRole) {
    const db = admin.firestore();
    const counters = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };
    const [snap, userRules, entities] = await Promise.all([
        db.collection("transactions")
            .where("uid", "==", userId)
            .where("category", "==", null)
            .where("status", "==", "needs_review")
            .get(),
        (0, categorizationService_1.loadUserRules)(userId),
        (0, categorizationService_1.loadUserEntities)(userId),
    ]);
    // Build entity name→id map for assignment
    const entityIdSnap = await db.collection("entities").where("userId", "==", userId).get();
    const entityMap = new Map();
    entityIdSnap.docs.forEach((d) => {
        entityMap.set(d.data().name, {
            id: d.id,
            name: d.data().name,
            type: d.data().type,
        });
    });
    const docs = snap.docs;
    counters.total = docs.length;
    // Build input array, skip user-modified
    const toProcess = [];
    for (let i = 0; i < docs.length; i++) {
        const txn = docs[i].data();
        if (txn.isUserModified === true) {
            counters.skipped++;
            continue;
        }
        toProcess.push({ idx: i, docId: docs[i].id, txn });
    }
    // Batch categorize
    const inputs = toProcess.map(({ idx, txn }) => ({
        idx,
        txn: {
            description: txn.description ?? "",
            normalizedDescription: txn.normalizedDescription,
            vendor: txn.vendor ?? "",
            amount: txn.amount ?? 0,
            type: txn.type ?? "expense",
        },
    }));
    const results = await (0, categorizationService_1.categorizeTransactionsBatch)(inputs, userRules, entities);
    // Write results back
    const writes = toProcess.map(({ idx, docId, txn }) => {
        const result = results.get(idx);
        if (!result || !result.category) {
            counters.skipped++;
            return Promise.resolve();
        }
        return applyResultToDoc(docId, txn, result, entityMap, counters, callerUid, callerRole);
    });
    await Promise.allSettled(writes);
    console.log(`[CategorizeBatch] uid=${userId} caller=${callerUid} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`);
    return counters;
}
// ─── Categorize a specific list of transaction IDs ────────────────────────────
async function categorizeSpecificTransactions(userId, transactionIds, callerUid, callerRole) {
    const db = admin.firestore();
    const counters = { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };
    // Load context ONCE for the whole batch
    const [userRules, entities] = await Promise.all([
        (0, categorizationService_1.loadUserRules)(userId),
        (0, categorizationService_1.loadUserEntities)(userId),
    ]);
    // Build entity name→id map
    const entityIdSnap = await db.collection("entities").where("userId", "==", userId).get();
    const entityMap = new Map();
    entityIdSnap.docs.forEach((d) => {
        entityMap.set(d.data().name, {
            id: d.id,
            name: d.data().name,
            type: d.data().type,
        });
    });
    // Fetch all transaction docs in parallel
    const docSnaps = await Promise.all(transactionIds.map((id) => db.collection("transactions").doc(id).get()));
    const toProcess = [];
    for (let i = 0; i < docSnaps.length; i++) {
        counters.total++;
        const snap = docSnaps[i];
        if (!snap.exists) {
            counters.skipped++;
            continue;
        }
        const txn = snap.data();
        // Security: verify ownership (shared users operate on owner's transactions)
        if (txn.uid !== userId) {
            counters.skipped++;
            continue;
        }
        // Respect explicit user edits
        if (txn.isUserModified === true) {
            counters.skipped++;
            continue;
        }
        toProcess.push({ idx: i, docId: snap.id, txn });
    }
    // Batch categorize all at once (keyword → user rule → AI in groups of 10)
    const inputs = toProcess.map(({ idx, txn }) => ({
        idx,
        txn: {
            description: txn.description ?? "",
            normalizedDescription: txn.normalizedDescription,
            vendor: txn.vendor ?? "",
            amount: txn.amount ?? 0,
            type: txn.type ?? "expense",
        },
    }));
    const results = await (0, categorizationService_1.categorizeTransactionsBatch)(inputs, userRules, entities);
    // Write results back
    const writes = toProcess.map(({ idx, docId, txn }) => {
        const result = results.get(idx);
        if (!result || !result.category) {
            counters.skipped++;
            return Promise.resolve();
        }
        return applyResultToDoc(docId, txn, result, entityMap, counters, callerUid, callerRole);
    });
    await Promise.allSettled(writes);
    console.log(`[CategorizeSelected] uid=${userId} caller=${callerUid} total=${counters.total} rule=${counters.ruleMatched} ai=${counters.aiMatched} skipped=${counters.skipped}`);
    return counters;
}
// ─── Cloud Functions ──────────────────────────────────────────────────────────
exports.categorizeBatch = (0, https_1.onCall)({ cors: true, invoker: "public", timeoutSeconds: 540 }, async (request) => {
    const { callerUid, effectiveOwnerUid, role } = await (0, auth_1.resolveEffectiveOwner)(request);
    return categorizeUserTransactions(effectiveOwnerUid, callerUid, role);
});
exports.categorizeSelected = (0, https_1.onCall)({ cors: true, invoker: "public", timeoutSeconds: 540 }, async (request) => {
    const { callerUid, effectiveOwnerUid, role } = await (0, auth_1.resolveEffectiveOwner)(request);
    const { transactionIds } = request.data;
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
        return { total: 0, ruleMatched: 0, aiMatched: 0, skipped: 0 };
    }
    const safeIds = transactionIds.slice(0, 200);
    return categorizeSpecificTransactions(effectiveOwnerUid, safeIds, callerUid, role);
});
//# sourceMappingURL=categorizeBatch.js.map