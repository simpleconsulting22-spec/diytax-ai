import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

export const generateTaxSummary = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { taxYear?: number };
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
  const categoryTotals: Record<string, number> = {};
  let totalIncome = 0;
  let totalExpenses = 0;

  txnsSnap.forEach((doc) => {
    const txn = doc.data();
    if (!txn.category) return;

    const amount = Math.abs(txn.amount as number);
    const cat = txn.category as string;

    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + amount;

    if (cat === "Income") {
      totalIncome += amount;
    } else {
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
