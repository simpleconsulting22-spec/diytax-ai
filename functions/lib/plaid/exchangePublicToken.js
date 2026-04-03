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
exports.exchangePublicToken = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const plaid_1 = require("plaid");
const auth_1 = require("../middleware/auth");
const fetchTransactions_1 = require("./fetchTransactions");
exports.exchangePublicToken = (0, https_1.onCall)({ cors: true }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    if (!data.publicToken) {
        throw new https_1.HttpsError("invalid-argument", "publicToken is required.");
    }
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
    const plaidClient = new plaid_1.PlaidApi(configuration);
    const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token: data.publicToken,
    });
    const accessToken = exchangeResponse.data.access_token;
    const accountId = admin.firestore().collection("accounts").doc().id;
    const db = admin.firestore();
    await db.collection("accounts").doc(accountId).set({
        accountId,
        uid,
        plaidAccessToken: accessToken,
        institutionName: data.institutionName ?? "Unknown Bank",
        accountName: data.accountName ?? "Account",
        mask: data.mask ?? "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Fetch transactions in background (don't await to avoid timeout)
    (0, fetchTransactions_1.fetchTransactionsForAccount)(uid, accountId, accessToken).catch((err) => console.error("fetchTransactionsForAccount error:", err));
    return { accountId };
});
//# sourceMappingURL=exchangePublicToken.js.map