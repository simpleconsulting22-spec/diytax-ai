import { onCall, HttpsError } from "firebase-functions/v2/https";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../middleware/auth";

function buildSystemPrompt(): string {
  const year = new Date().getFullYear();
  return `You are a financial transaction classification engine. Parse every transaction
from the provided statement and return structured JSON for each row.

═══════════════════════════════════════════════════════════════
OUTPUT SCHEMA  (one object per row, no markdown fences)
═══════════════════════════════════════════════════════════════
{
  "date":        "YYYY-MM-DD",
  "description": "<clean merchant or payee, max 60 chars, no account numbers>",
  "amount":      <positive number — strip currency symbols and signs>,
  "type":        "income" | "expense" | "transfer" | "refund",
  "direction":   "outflow" | "inflow",   // REQUIRED only when type === "transfer"
  "confidence":  "high" | "medium" | "low",
  "reasoning":   "<one short sentence, max 140 chars>"
}

═══════════════════════════════════════════════════════════════
CLASSIFICATION RULES  (apply in this exact priority order)
═══════════════════════════════════════════════════════════════

1. SIGN-BASED DEFAULT
   amount > 0  →  income
   amount < 0  →  expense
   This is the baseline before any of the rules below override it.

2. REFUND DETECTION  (HIGHEST PRIORITY — overrides every other rule)
   Mark as "refund" if EITHER:
     • description contains: REFUND, REVERSAL, RETURNED, REIMBURSEMENT,
       CHARGEBACK, "credit back"
     • the row clearly reverses a prior transaction (same merchant, same
       amount, opposite sign, within a few days)
   Refunds are NOT income — they reduce the original expense category.

3. TRANSFER DETECTION  (overrides income/expense, but not refund)
   Mark as "transfer" if ANY:
     • description contains: TRANSFER, ACH TRANSFER, INTERNAL TRANSFER,
       "payment to card", "payment from account"
     • clearly movement between the user's own accounts
     • credit-card payment (CRCARDPMT, AUTOPAY, "Payment Thank You")
     • loan payment (LOANPMT, MORTGAGE PMT, AUTO LOAN PMT)
   When type === "transfer", set direction:
     outflow = money LEAVING the account this statement belongs to
     inflow  = money ARRIVING in the account this statement belongs to
     Tip: -$500 or parentheses or "Dr" → outflow; +$500 or "Cr" → inflow

4. P2P DIRECTION LOGIC  (Zelle, Venmo, Cash App, PayPal)
   When the description contains a P2P brand, the WORDING tells you direction
   and TAKES PRECEDENCE OVER AMOUNT SIGN:
     OUTFLOW  →  expense:
       "sent to", "payment to", "paid to", "sent", "to <name>"
       e.g. "Zelle Sent to Gregory", "Venmo Payment to Acme",
            "Cash App Sent to Pat", "PayPal Instant Transfer to Foo"
     INFLOW  →  income:
       "from", "received from", "deposit", "cashout", "payment from"
       e.g. "Zelle From Pearl", "Venmo Cashout", "Cash App From Jordan",
            "PayPal Transfer from Bar"
   If the P2P wording is ambiguous (no clear "to/from"), fall back to
   amount sign and lower confidence to "low".

5. DO NOT FORCE TRANSFER FOR P2P
   P2P rows default to income/expense based on rule 4. Only mark a P2P row
   as "transfer" when it's CLEARLY internal (e.g., the user's own name on
   both sides, explicit "transfer between my accounts" wording, etc.).

═══════════════════════════════════════════════════════════════
CONFIDENCE LEVELS
═══════════════════════════════════════════════════════════════
high    — explicit keyword match (REFUND, TRANSFER, "Sent to", "From"),
          or unambiguous direction
medium  — reasonable inference from merchant patterns or partial wording
low     — ambiguous description; you fell back to amount sign

═══════════════════════════════════════════════════════════════
REASONING
═══════════════════════════════════════════════════════════════
ONE short sentence. State the trigger that drove the decision.
Examples:
  "Description contains 'REFUND'."
  "Zelle wording 'Sent to Gregory' → expense."
  "No direction wording, falling back to negative sign."
  "AUTOPAY pattern → credit-card payment transfer."

═══════════════════════════════════════════════════════════════
PARSING DETAILS
═══════════════════════════════════════════════════════════════
CURRENT YEAR IS ${year}. Use ${year} for any date with no year. Never use
2024 unless the source data explicitly says 2024.

Credit Karma / 3-line format:
  Line 1: Merchant name
  Line 2: Date • Running balance  (IGNORE this dollar amount — it's the balance)
  Line 3: -$XX.XX  (the actual transaction amount — use this)

Date formats accepted: MM/DD/YY, Jan 15 2024, 01-15-24, 15 Jan, Apr 25, etc.
Strip currency symbols ($, £, €) and thousands commas from amounts.
Parentheses around an amount → expense: (45.00) → amount=45.00, type=expense.
"Dr" suffix or "-" prefix → expense; "Cr" suffix or "+" prefix → income.

SKIP rows marked Declined, Pending, error, or that are running balances /
totals / headers. SKIP rows with no clear amount.

Be CONSISTENT across similar rows. Do NOT invent data. Prefer conservative
classification when uncertain (low confidence is fine — better than guessing).

Return ONLY a valid JSON array. No markdown fences. No prose.`;
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
  // AI's self-assessed confidence + one-line reasoning. Stored on the saved
  // doc as aiConfidence / aiReasoning (separate from the backend classifier's
  // own `confidence` / `typeSource`).
  confidence:  "high" | "medium" | "low";
  reasoning:   string;
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

    // P2P direction heuristics — used as a guard rail in case the model
    // mis-tagged a Zelle/Venmo/Cash App/PayPal row. Description wording is
    // a strong direction signal.
    const P2P_BRAND      = /\b(zelle|venmo|cash\s*app|cashapp|paypal)\b/i;
    const P2P_SENT       = /\b(sent|payment(?:\s+to)?|to\b|paid\s+to)\b/i;
    const P2P_RECEIVED   = /\b(from|received|deposit|cashout|payment\s+from)\b/i;

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

        // Self-assessed confidence + reasoning from the model. Validate
        // confidence to one of the three literals, default to "medium" when
        // missing/garbage. Cap reasoning length so a verbose model can't
        // dominate Firestore doc size.
        const rawConf = String(t.confidence ?? "").toLowerCase().trim();
        let confidence: ParsedTransaction["confidence"] =
          rawConf === "high" || rawConf === "medium" || rawConf === "low"
            ? (rawConf as ParsedTransaction["confidence"])
            : "medium";
        let reasoning = String(t.reasoning ?? "").trim().slice(0, 200);
        if (!reasoning) reasoning = "(no reasoning provided)";

        // Defensive override for P2P (Zelle / Venmo / Cash App / PayPal):
        // direction in the description wins over whatever the model picked
        // for income/expense. Doesn't touch refund or transfer.
        if (P2P_BRAND.test(desc) && (type === "expense" || type === "income")) {
          let overridden = false;
          if (P2P_RECEIVED.test(desc) && !P2P_SENT.test(desc)) {
            if (type !== "income")  { type = "income";  overridden = true; }
          } else if (P2P_SENT.test(desc) && !P2P_RECEIVED.test(desc)) {
            if (type !== "expense") { type = "expense"; overridden = true; }
          }
          if (overridden) {
            confidence = confidence === "high" ? "medium" : confidence;
            reasoning  = `${reasoning} (post-parse override)`.slice(0, 200);
          }
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
          confidence,
          reasoning,
          ...(direction ? { direction } : {}),
        };
      });

    return { transactions };
  }
);
