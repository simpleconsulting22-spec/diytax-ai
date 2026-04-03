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
/**
 * Queries all uncategorized needs_review transactions for a user and
 * categorizes them, writing results back to Firestore.
 *
 * Safety guarantees:
 *  - Skips transactions where isUserModified === true
 *  - Skips transactions that already have a non-empty category
 */
async function categorizeUserTransactions(userId) {
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
        const results = await Promise.allSettled(chunk.map(async (docSnap) => {
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
            const result = await (0, categorizationService_1.categorizeTransaction)(userId, {
                description: txn.description ?? "",
                normalizedDescription: txn.normalizedDescription,
                amount: txn.amount ?? 0,
                type: txn.type ?? "expense",
            });
            // Nothing to write if categorization returned no result
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
            await db.collection("transactions").doc(docSnap.id).update({
                category: result.category,
                taxCategory: result.taxCategory,
                taxSchedule: result.taxSchedule,
                categorizationConfidence: result.confidence,
                categorizationSource: result.source,
                categorizedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: newStatus,
            });
        }));
        // Log any unexpected failures at the doc level
        results.forEach((r, idx) => {
            if (r.status === "rejected") {
                const docId = chunk[idx]?.id ?? "unknown";
                console.error(`[CategorizeBatch] Failed to categorize doc ${docId}:`, r.reason);
            }
        });
    }
    console.log(`[CategorizeBatch] uid=${userId} | total=${total} | rule=${ruleMatched} | ai=${aiMatched} | skipped=${skipped}`);
    return { total, ruleMatched, aiMatched, skipped };
}
// ─── Cloud Function ───────────────────────────────────────────────────────────
exports.categorizeBatch = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    return categorizeUserTransactions(uid);
});
//# sourceMappingURL=categorizeBatch.js.map