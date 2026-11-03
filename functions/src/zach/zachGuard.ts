// Input and output guardrails for Zach. Everything here is deterministic and
// enforced in code; none of it relies on the model following instructions.

import { z } from "zod";
import { SOURCE_CATALOG, SourceId, isSourceId } from "./zachKnowledge";
import { ZACH_ROUTES, ZACH_ROUTE_IDS, ZachRouteId, isZachRouteId } from "./zachRoutes";

export const LIMITS = {
  messageChars: 1500,
  historyTurns: 6,
  /** User turns are kept whole (they are short); earlier assistant answers are
   *  compressed to their opening, which carries the gist. */
  historyUserChars: 1500,
  historyAssistantChars: 600,
  answerChars: 6000,
  actions: 3,
  sources: 5,
  missingInfo: 5,
};

// ─── Request validation ──────────────────────────────────────────────────────

const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const requestSchema = z.object({
  message: z.string().trim().min(1, "Ask Zach a question.").max(LIMITS.messageChars, "That message is too long."),
  taxYear: z.number().int(),
  page: z.string().max(200).optional(),
  mode: z.enum(["chat", "review"]).optional(),
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Invalid conversation.").optional(),
  history: z.array(turnSchema).max(40).optional(),
});

export type ZachRequest = z.infer<typeof requestSchema>;
export type Turn = z.infer<typeof turnSchema>;

/** Years Zach will discuss: the app's selectable range plus next year. */
export function isSupportedTaxYear(year: number, now: Date = new Date()): boolean {
  const current = now.getUTCFullYear();
  return year >= 2020 && year <= current + 1;
}

// ─── Sensitive-data redaction ────────────────────────────────────────────────
// Applied to everything the user typed before it is sent to the AI provider.

const REDACTIONS: Array<[RegExp, string]> = [
  // SSN / ITIN with separators
  [/\b\d{3}[- ]\d{2}[- ]\d{4}\b/g, "[redacted ID]"],
  // EIN
  [/\b\d{2}-\d{7}\b/g, "[redacted ID]"],
  // Card numbers with spaces or dashes (13–19 digits)
  [/\b\d(?:[ -]?\d){12,18}\b/g, "[redacted number]"],
  // Any long bare digit run: SSN without dashes, account, routing, card numbers
  [/\b\d{9,19}\b/g, "[redacted number]"],
  // Email addresses
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]"],
];

export function redactSensitive(text: string): string {
  let out = text;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

/**
 * Client-supplied history is untrusted. Keep only well-formed turns, trim
 * them, drop anything that doesn't alternate user → assistant, and keep the
 * most recent turns. History is held by the browser, never stored server-side.
 */
export function sanitizeHistory(history: Turn[] | undefined, maxTurns: number = LIMITS.historyTurns): Turn[] {
  if (!history || history.length === 0) return [];
  const cleaned: Turn[] = [];
  for (const t of history) {
    const cap = t.role === "user" ? LIMITS.historyUserChars : LIMITS.historyAssistantChars;
    const content = redactSensitive(t.content.trim()).slice(0, cap);
    if (!content) continue;
    const expected = cleaned.length % 2 === 0 ? "user" : "assistant";
    if (t.role !== expected) continue;
    cleaned.push({ role: t.role, content });
  }
  // Must end on an assistant turn so the new user message follows it.
  if (cleaned.length % 2 === 1) cleaned.pop();
  const max = Math.max(0, maxTurns) * 2;
  return cleaned.length > max ? cleaned.slice(cleaned.length - max) : cleaned;
}

// ─── Structured output ───────────────────────────────────────────────────────

export const BASIS_VALUES = ["general_education", "your_data", "tax_engine", "mixed", "unsupported"] as const;

/** JSON schema sent as output_config.format. Ids are enums, so the model can
 *  only pick catalog sources and allowlisted routes. */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "basis", "sourceIds", "actions", "missingInfo", "seeProfessional", "followUpQuestion"],
  properties: {
    answer: { type: "string", description: "Plain-English answer. Short paragraphs; '- ' bullets allowed." },
    basis: { type: "string", enum: [...BASIS_VALUES] },
    sourceIds: { type: "array", items: { type: "string", enum: Object.keys(SOURCE_CATALOG) } },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["routeId"],
        properties: { routeId: { type: "string", enum: [...ZACH_ROUTE_IDS] } },
      },
    },
    missingInfo: { type: "array", items: { type: "string" } },
    seeProfessional: { type: "boolean" },
    followUpQuestion: { type: "string", description: "One clarifying question, or empty string." },
  },
} as const;

export interface ZachAnswer {
  answer: string;
  basis: (typeof BASIS_VALUES)[number];
  sources: Array<{ id: SourceId; title: string; url: string }>;
  actions: Array<{ routeId: ZachRouteId; path: string; label: string }>;
  missingInfo: string[];
  seeProfessional: boolean;
  followUpQuestion: string;
  /** True when the answer states a dollar figure Zach couldn't trace. */
  unverifiedFigures: boolean;
}

/**
 * Parse and validate the model's JSON. Unknown sources and routes are dropped
 * rather than trusted; lengths are clamped. Returns null if unusable.
 */
export function parseModelAnswer(raw: string): Omit<ZachAnswer, "unverifiedFigures"> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.answer !== "string" || !d.answer.trim()) return null;

  const basis = BASIS_VALUES.includes(d.basis as (typeof BASIS_VALUES)[number])
    ? (d.basis as ZachAnswer["basis"])
    : "general_education";

  const sourceIds = Array.isArray(d.sourceIds) ? d.sourceIds.filter(isSourceId) : [];
  const sources = [...new Set(sourceIds)].slice(0, LIMITS.sources).map((id) => ({
    id,
    ...SOURCE_CATALOG[id],
  }));

  const routeIds = Array.isArray(d.actions)
    ? d.actions
        .map((a) => (a && typeof a === "object" ? (a as Record<string, unknown>).routeId : undefined))
        .filter(isZachRouteId)
    : [];
  const actions = [...new Set(routeIds)].slice(0, LIMITS.actions).map((routeId) => ({
    routeId,
    ...ZACH_ROUTES[routeId],
  }));

  const missingInfo = Array.isArray(d.missingInfo)
    ? d.missingInfo.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
        .slice(0, LIMITS.missingInfo)
        .map((m) => m.slice(0, 200))
    : [];

  return {
    answer: d.answer.trim().slice(0, LIMITS.answerChars),
    basis,
    sources,
    actions,
    missingInfo,
    seeProfessional: d.seeProfessional === true,
    followUpQuestion: typeof d.followUpQuestion === "string" ? d.followUpQuestion.trim().slice(0, 300) : "",
  };
}

// ─── Figure check ────────────────────────────────────────────────────────────
// A deterministic backstop against invented amounts: every dollar figure in
// the answer must appear in the material Zach was given (taxpayer context,
// verified year facts, or the user's own words). Anything else is flagged
// to the user rather than silently shown as fact.

function collectNumbers(value: unknown, into: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    into.add(Math.round(Math.abs(value)));
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(n)) into.add(Math.round(n));
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, into);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectNumbers(v, into);
  }
}

export function dollarFigures(text: string): number[] {
  const out: number[] = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|K|thousand|million|m|M)?\b/g;
  for (const m of text.matchAll(re)) {
    let n = Number(m[1].replace(/,/g, ""));
    const unit = m[2]?.toLowerCase();
    if (unit === "k" || unit === "thousand") n *= 1000;
    if (unit === "m" || unit === "million") n *= 1_000_000;
    if (Number.isFinite(n)) out.push(Math.round(n));
  }
  return out;
}

/** True if every dollar figure in `answer` is traceable to `grounding`. */
export function figuresAreGrounded(answer: string, grounding: unknown[]): boolean {
  const known = new Set<number>();
  for (const g of grounding) collectNumbers(g, known);
  const near = (n: number) => known.has(n) || known.has(n - 1) || known.has(n + 1);
  return dollarFigures(answer).every((n) => n === 0 || near(n));
}

export const UNVERIFIED_FIGURES_NOTE =
  "Note: this answer mentions an amount that doesn't come from your DIYTax AI data or Zach's verified IRS tables. Treat it as approximate and check it against the cited source.";
