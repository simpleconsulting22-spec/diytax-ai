import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  RECEIPT_MODEL,
  describeAnthropicError,
  firstText,
  getAnthropic,
} from "../services/anthropicClient";
import { requireAuth } from "../middleware/auth";

const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string", description: "Merchant name, or \"\" if unreadable" },
    amount: {
      type: "number",
      description: "Total actually paid by the customer, or 0 if unreadable",
    },
    date: { type: "string", description: "YYYY-MM-DD, or \"\" if unreadable" },
  },
  required: ["merchant", "amount", "date"],
  additionalProperties: false,
};

export const extractReceiptData = onCall(
  { secrets: ["ANTHROPIC_API_KEY"], cors: true, invoker: "public", timeoutSeconds: 60 },
  async (request) => {
    const uid = await requireAuth(request);
    const { storagePath } = request.data as { storagePath?: string };

    if (!storagePath?.trim()) {
      throw new HttpsError("invalid-argument", "storagePath is required.");
    }
    if (!storagePath.startsWith(`receipts/${uid}/`)) {
      throw new HttpsError("permission-denied", "Access denied.");
    }

    let buffer: Buffer;
    try {
      const [data] = await admin.storage().bucket().file(storagePath).download();
      buffer = data;
    } catch {
      throw new HttpsError("not-found", "Receipt file not found in storage.");
    }

    const anthropic = getAnthropic();
    if (!anthropic) {
      throw new HttpsError("failed-precondition", "AI not configured.");
    }

    const base64 = buffer.toString("base64");
    const mimeType: "image/png" | "image/jpeg" = storagePath.toLowerCase().endsWith(".png")
      ? "image/png"
      : "image/jpeg";

    try {
      // thinking is disabled explicitly: on Sonnet 5 it is ON by default, and
      // max_tokens caps thinking + response text together, so leaving it on
      // would let a long deliberation truncate the answer. No temperature —
      // Sonnet 5 rejects non-default sampling parameters.
      const message = await anthropic.messages.create({
        model: RECEIPT_MODEL,
        max_tokens: 1024,
        thinking: { type: "disabled" },
        output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mimeType, data: base64 },
              },
              {
                type: "text",
                text:
                  "Extract from this receipt: merchant name, the total amount actually " +
                  "paid by the customer, and the transaction date. If a field cannot be " +
                  "determined, use an empty string (or 0 for amount) rather than guessing.",
              },
            ],
          },
        ],
      });

      const parsed = JSON.parse(firstText(message) || "{}") as {
        merchant?: string;
        amount?: number;
        date?: string;
      };

      return {
        merchant: typeof parsed.merchant === "string" ? parsed.merchant : "",
        amount: typeof parsed.amount === "number" ? parsed.amount : 0,
        date: typeof parsed.date === "string" ? parsed.date : "",
      };
    } catch (err) {
      console.error("[extractReceiptData] Vision API error:", describeAnthropicError(err));
      // Return empty rather than throwing — frontend falls back to manual entry
      return { merchant: "", amount: 0, date: "" };
    }
  }
);
