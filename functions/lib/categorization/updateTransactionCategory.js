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
exports.updateTransactionCategory = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
const vendorExtraction_1 = require("../services/vendorExtraction");
exports.updateTransactionCategory = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.transactionId || !data.category) {
        throw new https_1.HttpsError("invalid-argument", "transactionId and category are required.");
    }
    const db = admin.firestore();
    const txnSnap = await db.collection("transactions").doc(data.transactionId).get();
    if (!txnSnap.exists)
        throw new https_1.HttpsError("not-found", "Transaction not found.");
    const txn = txnSnap.data();
    if (txn.uid !== uid)
        throw new https_1.HttpsError("permission-denied", "Access denied.");
    // ── 1. Update the transaction ──────────────────────────────────────────────
    const txnUpdate = {
        category: data.category,
        categorizationSource: "user_rule",
        categorizationExplanation: `Manually set to "${data.category}" by user`,
        isUserModified: true,
        status: "categorized",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (data.taxCategory)
        txnUpdate.taxCategory = data.taxCategory;
    if (data.taxSchedule)
        txnUpdate.taxSchedule = data.taxSchedule;
    if (data.entityId)
        txnUpdate.entityId = data.entityId;
    if (data.entityType)
        txnUpdate.entityType = data.entityType;
    if (data.entityName)
        txnUpdate.entityName = data.entityName;
    await db.collection("transactions").doc(data.transactionId).update(txnUpdate);
    // ── 2. Derive vendor name ──────────────────────────────────────────────────
    // Prefer stored vendor field → extract from normalizedDescription → fall back to merchantName
    const vendorName = txn.vendor ||
        (0, vendorExtraction_1.extractVendorName)(txn.description ?? "", txn.normalizedDescription) ||
        txn.merchantName ||
        "";
    if (!vendorName)
        return { updated: true };
    // ── 3. Upsert categoryRule (learning loop) ─────────────────────────────────
    // Check for an existing rule keyed to this vendor for this user.
    const rulesSnap = await db
        .collection("categoryRules")
        .where("uid", "==", uid)
        .where("vendorName", "==", vendorName)
        .limit(1)
        .get();
    const rulePayload = {
        uid,
        vendorName,
        category: data.category,
        confidence: 1.0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (data.taxCategory)
        rulePayload.taxCategory = data.taxCategory ?? (txn.taxCategory ?? "");
    if (data.taxSchedule)
        rulePayload.taxSchedule = data.taxSchedule ?? (txn.taxSchedule ?? "");
    // Persist entity so the next transaction from this vendor gets auto-assigned
    if (data.entityId)
        rulePayload.entityId = data.entityId;
    if (data.entityType)
        rulePayload.entityType = data.entityType;
    if (data.entityName)
        rulePayload.entityName = data.entityName;
    if (!rulesSnap.empty) {
        await rulesSnap.docs[0].ref.update({
            ...rulePayload,
            usageCount: admin.firestore.FieldValue.increment(1),
        });
    }
    else {
        await db.collection("categoryRules").add({
            ...rulePayload,
            usageCount: 1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    return { updated: true };
});
//# sourceMappingURL=updateTransactionCategory.js.map