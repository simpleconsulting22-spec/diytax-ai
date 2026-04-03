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
exports.generateTaxSummary = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
exports.generateTaxSummary = (0, https_1.onCall)({ cors: true }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    const data = request.data;
    const taxYear = data.taxYear ?? 2025;
    const db = admin.firestore();
    // Load all transactions for this user in the given year
    const startDate = `${taxYear}-01-01`;
    const endDate = `${taxYear}-12-31`;
    const txnsSnap = await db
        .collection("transactions")
        .where("uid", "==", uid)
        .where("date", ">=", startDate)
        .where("date", "<=", endDate)
        .get();
    // Load tax session
    const sessionId = `${uid}_${taxYear}`;
    const sessionSnap = await db.collection("taxSessions").doc(sessionId).get();
    const answers = sessionSnap.exists ? (sessionSnap.data()?.answers ?? {}) : {};
    // Group by category
    const categoryTotals = {};
    let totalIncome = 0;
    let totalExpenses = 0;
    txnsSnap.forEach((doc) => {
        const txn = doc.data();
        if (!txn.category)
            return;
        const amount = Math.abs(txn.amount);
        const cat = txn.category;
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amount;
        if (cat === "Income") {
            totalIncome += amount;
        }
        else {
            totalExpenses += amount;
        }
    });
    const byCategory = Object.entries(categoryTotals).map(([category, total]) => ({
        category,
        total: Math.round(total * 100) / 100,
    }));
    byCategory.sort((a, b) => b.total - a.total);
    return {
        totalIncome: Math.round(totalIncome * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netProfit: Math.round((totalIncome - totalExpenses) * 100) / 100,
        byCategory,
        answers,
    };
});
//# sourceMappingURL=generateTaxSummary.js.map