import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import { resolveEffectiveOwner } from "../middleware/auth";
import { extractVendorName } from "../services/vendorExtraction";
import {
  buildAIPromptCategoryList,
  fallbackCategoryForType,
  getMappingFuzzy,
  isValidCategory,
  scheduleForCategory,
} from "../shared/taxMap";

export const suggestCategory = onCall(
  { secrets: ["OPENAI_API_KEY"], cors: true, invoker: "public" },
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

Choose the single best category from the list below. Use EXACT spelling
including ampersands. Do not invent variations.

${buildAIPromptCategoryList()}

Return ONLY valid JSON (no markdown, no code fences):
{"category":"string","taxCategory":"string","taxSchedule":"Schedule C|Schedule A|Schedule E|Form 1040|Personal","confidence":0.0}`;

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

      // Validate against TAX_MAP — same three-case logic as the batch path.
      let category: string;
      let taxSchedule: string;
      let confidence = parsed.confidence ?? 0.75;
      const txnType = amount !== undefined && amount > 0 ? "income" : "expense";

      if (parsed.category && isValidCategory(parsed.category)) {
        const sched = scheduleForCategory(parsed.category)!;
        category = parsed.category;
        taxSchedule = sched.taxSchedule;
      } else if (parsed.category && getMappingFuzzy(parsed.category)) {
        const m = getMappingFuzzy(parsed.category)!;
        category = m.category;
        taxSchedule = m.taxSchedule;
        confidence = Math.min(confidence, 0.7);
      } else {
        const fb = fallbackCategoryForType(txnType);
        category = fb.category;
        taxSchedule = fb.taxSchedule;
        confidence = 0.5;
      }

      return {
        category,
        taxCategory: parsed.taxCategory ?? category,
        taxSchedule,
        confidence,
        source: "ai",
      };
    } catch (err) {
      console.error("[suggestCategory] error:", err);
      return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
    }
  }
);
