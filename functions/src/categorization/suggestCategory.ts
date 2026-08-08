import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  CANONICAL_CATEGORIES,
  CATEGORIZATION_MODEL,
  describeAnthropicError,
  firstText,
  getAnthropic,
} from "../services/anthropicClient";
import { resolveEffectiveOwner } from "../middleware/auth";
import { extractVendorName } from "../services/vendorExtraction";
import {
  buildAIPromptCategoryList,
  fallbackCategoryForType,
  getMappingFuzzy,
  isValidCategory,
  scheduleForCategory,
} from "../shared/taxMap";

/**
 * taxSchedule is not requested from the model — it is derived from TAX_MAP by
 * scheduleForCategory() below, so asking for it would create a second source
 * of truth that can disagree with the tax engine.
 */
const SUGGEST_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: CANONICAL_CATEGORIES },
    taxCategory: { type: "string", description: "Human-readable tax label" },
    confidence: { type: "number", description: "0.0-1.0" },
  },
  required: ["category", "taxCategory", "confidence"],
  additionalProperties: false,
};

export const suggestCategory = onCall(
  { secrets: ["ANTHROPIC_API_KEY"], cors: true, invoker: "public" },
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

    // Fall back to Claude
    const anthropic = getAnthropic();
    if (!anthropic) {
      return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
    }

    const prompt = `Categorize this financial transaction for US tax purposes.
Vendor/Description: "${description}"
${amount !== undefined ? `Amount: $${amount}` : ""}

Choose the single best category from the list below.

${buildAIPromptCategoryList()}

Set confidence below 0.8 if you are genuinely unsure.`;

    try {
      const message = await anthropic.messages.create({
        model: CATEGORIZATION_MODEL,
        max_tokens: 300,
        temperature: 0,
        output_config: { format: { type: "json_schema", schema: SUGGEST_SCHEMA } },
        messages: [{ role: "user", content: prompt }],
      });

      const parsed = JSON.parse(firstText(message) || "{}") as {
        category?: string;
        taxCategory?: string;
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
      console.error("[suggestCategory] error:", describeAnthropicError(err));
      return { category: "", taxCategory: "", taxSchedule: "", confidence: 0, source: "none" };
    }
  }
);
