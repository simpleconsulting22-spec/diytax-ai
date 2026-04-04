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
exports.categorizeBatch = void 0;
exports.categorizeUserTransactions = categorizeUserTransactions;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const categorizationService_1 = require("../services/categorizationService");
const BATCH_SIZE = 50;
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
async function categorizeUserTransactions(userId) {
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
        const results = await Promise.allSettled(chunk.map(async (docSnap) => {
            total++;
            const txn = docSnap.data();
            if (txn.isUserModified === true) {
                skipped++;
                return;
            }
            if (txn.category !== null && txn.category !== undefined && String(txn.category).trim() !== "") {
                skipped++;
                return;
            }
            const result = await (0, categorizationService_1.categorizeTransaction)(userId, {
                description: txn.description ?? "",
                normalizedDescription: txn.normalizedDescription,
                vendor: txn.vendor ?? "",
                amount: txn.amount ?? 0,
                type: txn.type ?? "expense",
            });
            if (!result.category) {
                skipped++;
                return;
            }
            if (result.source === "rule" || result.source === "user_rule") {
                ruleMatched++;
            }
            else {
                aiMatched++;
            }
            const newStatus = result.confidence >= 0.8 ? "categorized" : "needs_review";
            // Build the update payload
            const update = {
                category: result.category,
                taxCategory: result.taxCategory,
                taxSchedule: result.taxSchedule,
                categorizationConfidence: result.confidence,
                categorizationSource: result.source,
                categorizationExplanation: result.categorizationExplanation,
                categorizedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: newStatus,
            };
            // Entity prediction — only set if the transaction has no entity yet
            if (!txn.entityId && result.entityId) {
                update.entityId = result.entityId;
                update.entityName = result.entityName ?? null;
                update.entityType = result.entityType ?? "business";
                update.entityAutoAssigned = true; // flag so UI can highlight it
            }
            await db.collection("transactions").doc(docSnap.id).update(update);
        }));
        results.forEach((r, idx) => {
            if (r.status === "rejected") {
                console.error(`[CategorizeBatch] Failed doc ${chunk[idx]?.id ?? "?"}:`, r.reason);
            }
        });
    }
    console.log(`[CategorizeBatch] uid=${userId} total=${total} rule=${ruleMatched} ai=${aiMatched} skipped=${skipped}`);
    return { total, ruleMatched, aiMatched, skipped };
}
// ─── Cloud Function ───────────────────────────────────────────────────────────
exports.categorizeBatch = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    return categorizeUserTransactions(uid);
});
//# sourceMappingURL=categorizeBatch.js.map