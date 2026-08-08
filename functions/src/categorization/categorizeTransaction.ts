import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  CATEGORIZATION_MODEL,
  describeAnthropicError,
  firstText,
  getAnthropic,
} from "../services/anthropicClient";
import { requireAuth } from "../middleware/auth";

/**
 * NOTE: this list is this file's own, and is NOT the canonical TAX_MAP category
 * set used by suggestCategory and the batch path. Left as-is by the Claude port
 * so the port changes provider, not classification behavior — but it means this
 * path can write a category the tax engine does not route. Tracked separately.
 */
const LEGACY_CATEGORIES = [
  "Income",
  "Advertising",
  "Meals & Entertainment",
  "Travel",
  "Office Supplies",
  "Software & Subscriptions",
  "Home Office",
  "Vehicle & Mileage",
  "Professional Services",
  "Equipment",
  "Other",
];

const SINGLE_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: LEGACY_CATEGORIES },
    confidence: {
      type: "number",
      description: "0.0-1.0. Below 0.8 routes the row to needs_review.",
    },
  },
  required: ["category", "confidence"],
  additionalProperties: false,
};

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

  // Fall back to Claude
  const anthropic = getAnthropic();
  if (!anthropic) {
    console.warn("ANTHROPIC_API_KEY not set, skipping AI categorization.");
    return { category: "", status: "needs_review" };
  }

  try {
    const prompt =
      `Categorize this transaction for US tax purposes:\n` +
      `Vendor: ${merchantName}\n` +
      `Description: ${description}\n` +
      `Amount: ${amount}\n\n` +
      `Categories: ${LEGACY_CATEGORIES.join(", ")}\n\n` +
      `Set confidence below 0.8 if you are genuinely unsure — a low-confidence ` +
      `row is sent to the user for review rather than auto-applied.`;

    const message = await anthropic.messages.create({
      model: CATEGORIZATION_MODEL,
      max_tokens: 300,
      temperature: 0,
      output_config: { format: { type: "json_schema", schema: SINGLE_SCHEMA } },
      messages: [{ role: "user", content: prompt }],
    });

    const parsed = JSON.parse(firstText(message) || "{}") as {
      category?: string;
      confidence?: number;
    };
    const category = parsed.category ?? "";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

    const status = confidence > 0.8 ? "categorized" : "needs_review";

    await db.collection("transactions").doc(transactionId).update({
      aiCategory: category,
      confidenceScore: confidence,
      category: confidence > 0.8 ? category : "",
      status,
    });

    return { category, status };
  } catch (err) {
    console.error("Claude categorization error:", describeAnthropicError(err));
    return { category: "", status: "needs_review" };
  }
}

export const categorizeTransaction = onCall(
  { secrets: ["ANTHROPIC_API_KEY"], cors: true, invoker: "public" },
  async (request) => {
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

    return categorizeTransactionLogic(
      uid,
      data.transactionId,
      txn.merchantName,
      txn.description,
      txn.amount
    );
  }
);
