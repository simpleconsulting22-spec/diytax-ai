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
exports.updateTransactionCategory = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.transactionId || !data.category) {
        throw new https_1.HttpsError("invalid-argument", "transactionId and category are required.");
    }
    const db = admin.firestore();
    const txnSnap = await db.collection("transactions").doc(data.transactionId).get();
    if (!txnSnap.exists) {
        throw new https_1.HttpsError("not-found", "Transaction not found.");
    }
    const txn = txnSnap.data();
    if (txn.uid !== uid) {
        throw new https_1.HttpsError("permission-denied", "Access denied.");
    }
    await db.collection("transactions").doc(data.transactionId).update({
        category: data.category,
        status: "categorized",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        }
        else {
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
//# sourceMappingURL=updateTransactionCategory.js.map