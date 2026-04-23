import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import { resolveEffectiveOwner } from "../middleware/auth";
import { extractVendorName } from "../services/vendorExtraction";

export const suggestCategory = onCall(
  { cors: true, invoker: "public" },
  async (request) => {
    const { effectiveOwnerUid } = await resolveEffectiveOwner(request);
    const { description, amount } = request.data as {
      description?: string;
      amount?: number;
    };

    if (!description?.trim()) {
      return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
    }

    const db = admin.firestore();
    const vendor =
      extractVendorName(description, description.toUpperCase().trim()) ||
      description.trim();

    // Check user's learned category rules first
    const rulesSnap = await db
      .collection("categoryRules")
      .where("uid", "==", effectiveOwnerUid)
      .where("vendorName", "==", vendor)
      .limit(1)
      .get();

    if (!rulesSnap.empty) {
      const rule = rulesSnap.docs[0].data();
      return {
        category: rule.category ?? "",
        taxCategory: rule.taxCategory ?? rule.category ?? "",
        taxSchedule: rule.taxSchedule ?? "",
        confidence: 1.0,
        source: "user_rule",
      };
    }

    // Fall back to GPT-4o-mini
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
    }

    const prompt = `Categorize this financial transaction for US tax purposes.
Vendor/Description: "${description}"
${amount !== undefined ? `Amount: $${amount}` : ""}

Choose the single best category from this list:
Business Income, Rental Income, Investment Income, Interest Income, Dividend Income, Other Income,
Advertising & Marketing, Auto & Vehicle, Bank Fees & Charges, Business Insurance, Business Meals, Business Travel, Computer & Software, Contract Labor, Education & Training, Equipment & Machinery, Home Office, Legal & Professional, Licenses & Permits, Office Supplies, Phone & Internet, Postage & Shipping, Printing & Publishing, Rent & Lease, Repairs & Maintenance, Taxes & Licenses, Utilities, Wages & Salaries, Other Business Expense,
Charitable Contribution, Medical Expense, Dental Expense, State & Local Taxes, Mortgage Interest, Investment Expense, Casualty Loss,
Mortgage Interest (Rental), Property Management, Property Taxes, Rental Insurance, Rental Repairs & Maintenance, Rental Supplies, Rental Utilities,
Groceries, Dining & Restaurants, Entertainment, Personal Care, Clothing & Apparel, Healthcare, Personal Transportation, Personal Subscriptions, Other Personal

Return ONLY valid JSON (no markdown, no code fences):
{"category":"string","taxCategory":"string","taxSchedule":"Schedule C|Schedule A|Schedule E|Personal","confidence":0.0}`;

    try {
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0,
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(clean) as {
        category?: string;
        taxCategory?: string;
        taxSchedule?: string;
        confidence?: number;
      };

      return {
        category: parsed.category ?? "",
        taxCategory: parsed.taxCategory ?? parsed.category ?? "",
        taxSchedule: parsed.taxSchedule ?? "",
        confidence: parsed.confidence ?? 0.75,
        source: "ai",
      };
    } catch (err) {
      console.error("[suggestCategory] error:", err);
      return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
    }
  }
);
