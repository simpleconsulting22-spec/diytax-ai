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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categorizeTransaction = void 0;
exports.categorizeTransactionLogic = categorizeTransactionLogic;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const openai_1 = __importDefault(require("openai"));
const auth_1 = require("../middleware/auth");
async function categorizeTransactionLogic(uid, transactionId, merchantName, description, amount) {
    const db = admin.firestore();
    // Check category rules first
    const rulesSnap = await db
        .collection("categoryRules")
        .where("uid", "==", uid)
        .where("vendorName", "==", merchantName)
        .limit(1)
        .get();
    if (!rulesSnap.empty) {
        const rule = rulesSnap.docs[0].data();
        await db.collection("transactions").doc(transactionId).update({
            category: rule.category,
            status: "categorized",
        });
        return { category: rule.category, status: "categorized" };
    }
    // Fall back to OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn("OPENAI_API_KEY not set, skipping AI categorization.");
        return { category: "", status: "needs_review" };
    }
    try {
        const openai = new openai_1.default({ apiKey });
        const prompt = `Categorize this transaction for US tax purposes:\nVendor: ${merchantName}\nDescription: ${description}\nAmount: ${amount}\n\nCategories: Income, Advertising, Meals & Entertainment, Travel, Office Supplies, Software & Subscriptions, Home Office, Vehicle & Mileage, Professional Services, Equipment, Other\n\nReturn ONLY valid JSON: {"category": "", "confidence": 0.0}`;
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 100,
            temperature: 0,
        });
        const text = completion.choices[0]?.message?.content?.trim() ?? "";
        const parsed = JSON.parse(text);
        const { category, confidence } = parsed;
        const status = confidence > 0.8 ? "categorized" : "needs_review";
        await db.collection("transactions").doc(transactionId).update({
            aiCategory: category,
            confidenceScore: confidence,
            category: confidence > 0.8 ? category : "",
            status,
        });
        return { category, status };
    }
    catch (err) {
        console.error("OpenAI categorization error:", err);
        return { category: "", status: "needs_review" };
    }
}
exports.categorizeTransaction = (0, https_1.onCall)({ cors: true }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.transactionId) {
        throw new https_1.HttpsError("invalid-argument", "transactionId is required.");
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
    const result = await categorizeTransactionLogic(uid, data.transactionId, txn.merchantName, txn.description, txn.amount);
    return result;
});
//# sourceMappingURL=categorizeTransaction.js.map