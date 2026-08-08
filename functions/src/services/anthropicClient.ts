import Anthropic from "@anthropic-ai/sdk";
import { TAX_MAP } from "../shared/taxMap";

/**
 * Shared Anthropic access for the categorization + receipt paths.
 *
 * These call sites ran on OpenAI until the key was removed from functions/.env
 * after 2026-04-08, at which point every one of them silently degraded to
 * "warn and skip". They now run on Claude, using the ANTHROPIC_API_KEY that
 * parser/parseFinancialData.ts has been consuming successfully all along.
 */

/**
 * Text classification. High volume — one call per batch of 10 transactions,
 * and a full re-categorize can be hundreds of calls. Picking from a fixed
 * category list is well within Haiku's range.
 */
export const CATEGORIZATION_MODEL = "claude-haiku-4-5";

/**
 * Receipt OCR. Low volume (one call per receipt the user uploads) and
 * accuracy-critical: a misread total becomes a wrong deduction. This replaces
 * gpt-4o, so it is deliberately matched at a comparable capability tier rather
 * than downgraded to Haiku to save a fraction of a cent per receipt.
 */
export const RECEIPT_MODEL = "claude-sonnet-5";

/**
 * Returns null rather than throwing when the key is absent, so callers keep
 * their existing "degrade, don't crash" behavior.
 */
export function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/**
 * Every category TAX_MAP recognizes, deduplicated. Used as a JSON-schema
 * `enum` so structured outputs make an off-list category structurally
 * impossible rather than something the fuzzy-matcher has to clean up after.
 */
export const CANONICAL_CATEGORIES: string[] = Array.from(
  new Set(TAX_MAP.map((m) => m.category))
);

/**
 * First text block of a response. With output_config.format set, that block is
 * guaranteed to be JSON matching the schema — no code fences, no preamble.
 */
export function firstText(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === "text") return block.text;
  }
  return "";
}

/** Maps an Anthropic SDK error onto the log line the old OpenAI paths used. */
export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.status ?? "no-status"} ${err.name}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
