import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import { requireAuth } from "../middleware/auth";

export async function categorizeTransactionLogic(
  uid: string,
  transactionId: string,
  merchantName: string,
  description: string,
  amount: number
): Promise<{ category: string; status: string }> {
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
    const openai = new OpenAI({ apiKey });

    const prompt = `Categorize this transaction for US tax purposes:\nVendor: ${merchantName}\nDescription: ${description}\nAmount: ${amount}\n\nCategories: Income, Advertising, Meals & Entertainment, Travel, Office Supplies, Software & Subscriptions, Home Office, Vehicle & Mileage, Professional Services, Equipment, Other\n\nReturn ONLY valid JSON: {"category": "", "confidence": 0.0}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0,
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(text) as { category: string; confidence: number };
    const { category, confidence } = parsed;

    const status = confidence > 0.8 ? "categorized" : "needs_review";

    await db.collection("transactions").doc(transactionId).update({
      aiCategory: category,
      confidenceScore: confidence,
      category: confidence > 0.8 ? category : "",
      status,
    });

    return { category, status };
  } catch (err) {
    console.error("OpenAI categorization error:", err);
    return { category: "", status: "needs_review" };
  }
}

export const categorizeTransaction = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { transactionId?: string };
  if (!data.transactionId) {
    throw new HttpsError("invalid-argument", "transactionId is required.");
  }

  const db = admin.firestore();
  const txnSnap = await db.collection("transactions").doc(data.transactionId).get();
  if (!txnSnap.exists) {
    throw new HttpsError("not-found", "Transaction not found.");
  }

  const txn = txnSnap.data()!;
  if (txn.uid !== uid) {
    throw new HttpsError("permission-denied", "Access denied.");
  }

  const result = await categorizeTransactionLogic(
    uid,
    data.transactionId,
    txn.merchantName,
    txn.description,
    txn.amount
  );

  return result;
});
