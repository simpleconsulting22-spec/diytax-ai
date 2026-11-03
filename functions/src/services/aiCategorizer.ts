// AI provider for transaction categorization.
//
// Anthropic (Claude Haiku 5.5, the configured "fast" model) is used when an
// ANTHROPIC_API_KEY is configured; the legacy OpenAI path remains only as a
// fallback for environments that still set OPENAI_API_KEY. With neither key,
// AI is skipped and rows stay in Needs review.
//
// Cost control: every call reserves its worst-case cost against the same
// monthly limit as Zach (config/zach), settles actual cost afterwards, and is
// skipped (not failed) when the limit would be exceeded. The categorization
// decision itself stays in decisionPolicy.ts: an AI suggestion never confirms
// a deductible expense.

import Anthropic from "@anthropic-ai/sdk";
import * as admin from "firebase-admin";
import OpenAI from "openai";
import { TAX_MAP } from "../shared/taxMap";
import { loadZachConfig, worstCaseCost } from "../zach/zachConfig";
import { releaseReservation, reserveBudget, settleCategorizationUsage } from "../zach/zachUsage";

export interface AIBatchItem {
  index: number;
  category: string;
  taxCategory?: string;
  taxSchedule?: string;
  type?: string;
  assignment?: string;
  confidence?: number;
  explanation?: string;
}

const CATEGORY_NAMES = [...new Set(TAX_MAP.map((m) => m.category))];

export const AI_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "category", "type", "assignment", "confidence", "explanation"],
        properties: {
          index: { type: "integer" },
          category: { type: "string", enum: CATEGORY_NAMES },
          type: { type: "string", enum: ["income", "expense", "transfer", "refund"] },
          assignment: { type: "string" },
          confidence: { type: "number" },
          explanation: { type: "string" },
        },
      },
    },
  },
} as const;

/** Mask long digit runs (card, account, reference numbers) before sending. */
export function maskDigits(s: string): string {
  return s.replace(/\d{6,}/g, "#");
}

export type AIProvider = "anthropic" | "openai" | "none";

export function aiProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  if (env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (env.OPENAI_API_KEY?.trim()) return "openai";
  return "none";
}

/**
 * Ask the AI to classify one batch. Returns null when AI is unavailable or
 * the monthly limit would be exceeded (the caller leaves rows for review).
 */
export async function requestAIItems(prompt: string, count: number): Promise<AIBatchItem[] | null> {
  const provider = aiProvider();
  if (provider === "none") {
    console.warn("[aiCategorizer] no AI key configured — skipping AI.");
    return null;
  }

  if (provider === "openai") {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300 * count,
      temperature: 0,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const jsonText = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(jsonText) as AIBatchItem[];
  }

  const db = admin.firestore();
  const now = new Date();
  const cfg = await loadZachConfig(db, now.getTime());
  if (!cfg.enabled) return null;
  const model = { ...cfg.models.fast, maxOutputTokens: Math.min(8000, 120 * count + 300) };

  let reservation;
  try {
    reservation = await reserveBudget(db, now, cfg, worstCaseCost(model, prompt.length + 4000));
  } catch {
    console.warn("[aiCategorizer] monthly AI limit reached — skipping AI for this batch.");
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 60_000 });
    const res = await client.messages.create({
      model: model.id,
      max_tokens: model.maxOutputTokens,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: AI_RESPONSE_SCHEMA as unknown as Record<string, unknown> },
      },
    });
    const u = res.usage;
    inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    outputTokens = u.output_tokens ?? 0;
    const text = res.content.find((b) => b.type === "text");
    if (res.stop_reason === "refusal" || !text || text.type !== "text") return null;
    const parsed = JSON.parse(text.text) as { results?: AIBatchItem[] };
    return Array.isArray(parsed.results) ? parsed.results : null;
  } finally {
    if (inputTokens || outputTokens) {
      await settleCategorizationUsage(db, now, cfg, reservation, inputTokens, outputTokens).catch((e) =>
        console.warn("[aiCategorizer] usage settle failed", e instanceof Error ? e.message : e)
      );
    } else {
      await releaseReservation(db, reservation, true).catch(() => undefined);
    }
  }
}
