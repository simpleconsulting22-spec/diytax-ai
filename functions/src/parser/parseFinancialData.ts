import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth";

function buildSystemPrompt(): string {
  const year = new Date().getFullYear();
  return `You are a financial data parser. Extract ALL individual transactions from the provided bank statement.

Return a JSON array where each item has:
- date: string in YYYY-MM-DD format
- description: string (clean merchant or payee name, max 60 chars, no account numbers)
- amount: number (always positive)
- type: "expense", "income", "refund", or "transfer"
  expense  = debit / charge / withdrawal / payment made to an external party
  income   = credit / deposit / payroll / dividend / interest earned (money genuinely earned)
  refund   = a previously-paid expense being returned (REFUND, REVERSAL, REIMBURSEMENT, CHARGEBACK).
             Refunds reduce the related expense category — they are NOT income.
  transfer = movement of money between the user's own accounts. Includes:
             credit-card payments (CRCARDPMT, AUTOPAY, "Payment Thank You"),
             account-to-account transfers (FUNDS TRANSFER, OVERDRAFT TRANSFER, "Transfer to Savings"),
             loan payments (LOANPMT, MORTGAGE PMT, AUTO LOAN PMT).
             These are not expenses or income — they net out across the user's accounts.
- direction: "outflow" | "inflow"  (REQUIRED ONLY when type === "transfer")
  outflow = money LEAVING the account this statement belongs to (e.g. checking account paying a credit card)
  inflow  = money ARRIVING in the account this statement belongs to (e.g. credit card receiving a payment)
  Tip: read the row's sign / direction column. If the source shows -$500 or "Dr" or parentheses → outflow.
       If the source shows +$500 or "Cr" → inflow.
  Omit the field for non-transfer rows.

CURRENT YEAR IS ${year}. Use ${year} for any date that has no year. Never use 2024 unless the source data explicitly says 2024.

Credit Karma / 3-line format (very common):
  Line 1: Merchant name (may have extra words after it — use only the clean merchant name)
  Line 2: Date • Running balance  (the balance AFTER the transaction — IGNORE this dollar amount)
  Line 3: -$XX.XX  (the actual transaction amount — use this, strip the minus sign)
  Example:
    Panera Bread P
    Apr 25 • $84.28
    -$4.75
  → date: ${year}-04-25, description: "Panera Bread", amount: 4.75, type: "expense"

General parsing rules:
- Handle any date format: MM/DD/YY, Jan 15 2024, 01-15-24, 15 Jan, Apr 25, etc.
- Strip currency symbols ($, £, €) and commas from amounts
- Parentheses around amounts mean expense: (45.00) → 45.00 expense
- "Dr" suffix or "-" prefix → expense; "Cr" suffix or "+" prefix → income
- Skip rows marked "Declined", "Pending", "error", or that are running balances / totals / headers
- If a row has no clear amount, skip it

Return ONLY a valid JSON array. No markdown fences, no explanation.`;
}

export interface ParsedTransaction {
  date:        string;
  description: string;
  amount:      number;
  type:        "expense" | "income" | "refund" | "transfer";
  // Only set when type === "transfer". Disambiguates which side of the
  // transfer this row represents so signedAmount can be assigned correctly
  // and the classifier's transfer-pairing logic can match the two halves.
  direction?:  "outflow" | "inflow";
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // Already clean JSON
  if (trimmed[0] === "[" || trimmed[0] === "{") return trimmed;
  // Extract content between ```...``` fences (handles text after the closing fence too)
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  // Last resort: grab the first [...] array anywhere in the response
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  return trimmed;
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

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new HttpsError("internal", "Anthropic API key not configured.");

    const anthropic = new Anthropic({ apiKey });
    const systemPrompt = buildSystemPrompt();
    let raw: string;

    try {
      if (data.type === "text") {
        const res = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: data.content! }],
        });
        raw = res.content[0]?.type === "text" ? res.content[0].text : "[]";
      } else {
        const mime = (data.mimeType ?? "image/jpeg") as
          "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        const res = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mime, data: data.imageBase64! },
                },
                { type: "text", text: "Extract all transactions from this bank statement." },
              ],
            },
          ],
        });
        raw = res.content[0]?.type === "text" ? res.content[0].text : "[]";
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[parseFinancialData] Anthropic error:", msg);
      if (msg.includes("401") || msg.includes("authentication")) {
        throw new HttpsError("internal", "Anthropic API key is invalid. Please check functions/.env.");
      }
      if (msg.includes("429") || msg.includes("quota") || msg.includes("credit")) {
        throw new HttpsError("resource-exhausted", "Anthropic quota exceeded. Please check billing at console.anthropic.com.");
      }
      throw new HttpsError("internal", `Claude request failed: ${msg}`);
    }

    const clean = extractJson(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      console.error("[parseFinancialData] raw output:", raw);
      throw new HttpsError("internal", `Could not parse AI response. Raw output: ${raw.slice(0, 300)}`);
    }

    if (!Array.isArray(parsed)) {
      throw new HttpsError("internal", `Unexpected response format: ${String(parsed).slice(0, 100)}`);
    }

    const REFUND_KEYWORDS = /\b(REFUND|REVERSAL|REIMBURSEMENT|REIMB|CHARGEBACK)\b/i;

    const transactions: ParsedTransaction[] = (
      parsed as Array<Record<string, unknown>>
    )
      .filter((t) => t.date && t.amount)
      .map((t) => {
        const desc = String(t.description ?? "");
        // Trust explicit "refund" / "transfer" types from the model. For
        // anything ambiguous, infer refund from description keywords so they
        // don't slip through as income/expense.
        let type: ParsedTransaction["type"];
        if (t.type === "refund" || REFUND_KEYWORDS.test(desc)) {
          type = "refund";
        } else if (t.type === "transfer") {
          type = "transfer";
        } else if (t.type === "income") {
          type = "income";
        } else {
          type = "expense";
        }

        // Direction only meaningful for transfers. Accept the model's value
        // when it's one of the expected literals; otherwise leave undefined
        // so the normalizer's fallback (needs_review) kicks in.
        let direction: ParsedTransaction["direction"];
        if (type === "transfer") {
          if (t.direction === "outflow" || t.direction === "inflow") {
            direction = t.direction;
          }
        }

        return {
          date:        String(t.date ?? ""),
          description: desc,
          amount:      Math.abs(Number(t.amount ?? 0)),
          type,
          ...(direction ? { direction } : {}),
        };
      });

    return { transactions };
  }
);
