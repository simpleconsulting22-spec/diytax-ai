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
exports.fetchTransactions = void 0;
exports.fetchTransactionsForAccount = fetchTransactionsForAccount;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const plaid_1 = require("plaid");
const auth_1 = require("../middleware/auth");
const categorizeTransaction_1 = require("../categorization/categorizeTransaction");
function getPlaidClient() {
    const clientId = process.env.PLAID_CLIENT_ID;
    const secret = process.env.PLAID_SECRET;
    const plaidEnv = process.env.PLAID_ENV ?? "sandbox";
    if (!clientId || !secret) {
        throw new https_1.HttpsError("internal", "Plaid credentials not configured.");
    }
    const configuration = new plaid_1.Configuration({
        basePath: plaid_1.PlaidEnvironments[plaidEnv] ?? plaid_1.PlaidEnvironments.sandbox,
        baseOptions: {
            headers: {
                "PLAID-CLIENT-ID": clientId,
                "PLAID-SECRET": secret,
            },
        },
    });
    return new plaid_1.PlaidApi(configuration);
}
async function fetchTransactionsForAccount(uid, accountId, accessToken) {
    const plaidClient = getPlaidClient();
    const db = admin.firestore();
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const response = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: { count: 500, offset: 0 },
    });
    const plaidTransactions = response.data.transactions;
    let imported = 0;
    for (const txn of plaidTransactions) {
        // Check if already exists
        const existing = await db
            .collection("transactions")
            .where("plaidTransactionId", "==", txn.transaction_id)
            .limit(1)
            .get();
        if (!existing.empty)
            continue;
        const transactionId = db.collection("transactions").doc().id;
        const merchantName = txn.merchant_name ?? txn.name ?? "";
        const description = txn.name ?? "";
        const txnData = {
            transactionId,
            uid,
            accountId,
            plaidTransactionId: txn.transaction_id,
            amount: txn.amount,
            date: txn.date,
            description,
            merchantName,
            category: "",
            aiCategory: "",
            confidenceScore: 0,
            status: "needs_review",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection("transactions").doc(transactionId).set(txnData);
        // Categorize
        await (0, categorizeTransaction_1.categorizeTransactionLogic)(uid, transactionId, merchantName, description, txn.amount);
        imported++;
    }
    return imported;
}
exports.fetchTransactions = (0, https_1.onCall)({ cors: true }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.accountId) {
        throw new https_1.HttpsError("invalid-argument", "accountId is required.");
    }
    const db = admin.firestore();
    const accountSnap = await db.collection("accounts").doc(data.accountId).get();
    if (!accountSnap.exists) {
        throw new https_1.HttpsError("not-found", "Account not found.");
    }
    const account = accountSnap.data();
    if (account.uid !== uid) {
        throw new https_1.HttpsError("permission-denied", "Access denied.");
    }
    const imported = await fetchTransactionsForAccount(uid, data.accountId, account.plaidAccessToken);
    return { imported };
});
//# sourceMappingURL=fetchTransactions.js.map