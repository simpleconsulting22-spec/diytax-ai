import { onCall, HttpsError } from "firebase-functions/v2/https";
import OpenAI from "openai";
import { requireAuth } from "../middleware/auth";

const SYSTEM_PROMPT = `You are a financial data parser. Extract ALL individual transactions from the provided bank statement.

Return a JSON array where each item has:
- date: string in YYYY-MM-DD format (infer year from context; default to current year if missing)
- description: string (clean merchant or payee name, max 60 chars, no account numbers)
- amount: number (always positive)
- type: "expense" or "income"
  expense = debit / charge / withdrawal / payment made
  income  = credit / deposit / payment received / refund

Parsing rules:
- Handle any date format: MM/DD/YY, Jan 15 2024, 01-15-24, 15 Jan, etc.
- Strip currency symbols ($, £, €) and commas from amounts
- Parentheses around amounts mean negative (expense): (45.00) → expense 45.00
- "Dr" suffix or "-" prefix → expense; "Cr" suffix or "+" prefix → income
- Skip rows that are running balances, totals, headers, or blank lines
- If a row has no clear amount, skip it

Return ONLY a valid JSON array with no markdown fences and no explanation.`;

export interface ParsedTransaction {
  date:        string;
  description: string;
  amount:      number;
  type:        "expense" | "income";
}

export const parseFinancialData = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 60 },
  async (request) => {
    await requireAuth(request);

    const data = request.data as {
      type:          "text" | "image";
      content?:      string;
      imageBase64?:  string;
      mimeType?:     string;
    };

    if (data.type === "text" && !data.content?.trim()) {
      throw new HttpsError("invalid-argument", "content is required.");
    }
    if (data.type === "image" && !data.imageBase64) {
      throw new HttpsError("invalid-argument", "imageBase64 is required.");
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new HttpsError("internal", "OpenAI not configured.");

    const openai = new OpenAI({ apiKey });
    let raw: string;

    if (data.type === "text") {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: data.content! },
        ],
        temperature: 0,
      });
      raw = res.choices[0]?.message?.content ?? "[]";
    } else {
      const mime = (data.mimeType ?? "image/jpeg") as
        "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      const res = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url:    `data:${mime};base64,${data.imageBase64}`,
                  detail: "high",
                },
              },
              { type: "text", text: "Extract all transactions from this bank statement." },
            ],
          },
        ],
        temperature: 0,
      });
      raw = res.choices[0]?.message?.content ?? "[]";
    }

    // Strip any markdown fences GPT might emit
    const clean = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      console.error("[parseFinancialData] raw GPT output:", raw);
      throw new HttpsError("internal", "Could not parse AI response as JSON.");
    }

    if (!Array.isArray(parsed)) {
      throw new HttpsError("internal", "Unexpected AI response format.");
    }

    const transactions: ParsedTransaction[] = (
      parsed as Array<Record<string, unknown>>
    )
      .filter((t) => t.date && t.amount)
      .map((t) => ({
        date:        String(t.date ?? ""),
        description: String(t.description ?? ""),
        amount:      Math.abs(Number(t.amount ?? 0)),
        type:        t.type === "income" ? "income" : "expense",
      }));

    return { transactions };
  }
);
