import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import { requireAuth } from "../middleware/auth";

export const extractReceiptData = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 60 },
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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "AI not configured.");
    }

    const base64 = buffer.toString("base64");
    const mimeType = storagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

    try {
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
              {
                type: "text",
                text: 'Extract from this receipt: merchant name, total amount paid by the customer, transaction date. Return ONLY valid JSON (no markdown): {"merchant":"string","amount":0.00,"date":"YYYY-MM-DD"}. Use empty string for merchant/date and 0 for amount if a field cannot be determined.',
              },
            ],
          },
        ],
        max_tokens: 150,
        temperature: 0,
      });

      const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(clean) as {
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
      console.error("[extractReceiptData] Vision API error:", err);
      // Return empty rather than throwing — frontend falls back to manual entry
      return { merchant: "", amount: 0, date: "" };
    }
  }
);
