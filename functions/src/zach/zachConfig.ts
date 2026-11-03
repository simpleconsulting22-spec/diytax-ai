// Zach's runtime settings. Defaults live here; an administrator can override
// them in Firestore `config/zach` (closed to clients by firestore.rules) through
// setZachConfig, without a redeploy. Nothing about models, limits or spending
// thresholds is hard-coded elsewhere.

import * as admin from "firebase-admin";
import { normalizeReplyDomain } from "./replyTokens";

export type ModelTier = "fast" | "deep";

export interface ModelSettings {
  id: string;
  /** USD per million input tokens. */
  inPerMTok: number;
  /** USD per million output tokens. */
  outPerMTok: number;
  maxOutputTokens: number;
}

export interface ZachConfig {
  enabled: boolean;
  /** Answering round emails by reply (and attaching receipts). Off until the reply. MX and webhook are set up. */
  inboundEmail: boolean;
  /** Domain replies are received on (reply.diytaxai.com or a Resend <id>.resend.app address). */
  replyDomain: string;
  /** Above this month-to-date spend, every request uses the fast model. */
  monthlyTargetUsd: number;
  /** Crossing this sends the administrator an alert email. */
  monthlyAlertUsd: number;
  /** New billable requests stop when spend + in-flight reservations would pass this. */
  monthlyLimitUsd: number;
  dailyMessagesPerUser: number;
  dailyDeepPerUser: number;
  perMinutePerUser: number;
  dailyFindingsPerUser: number;
  /** Seconds within which an identical question is treated as a repeat. */
  repeatWindowSeconds: number;
  historyTurns: number;
  models: Record<ModelTier, ModelSettings>;
}

export const DEFAULT_CONFIG: ZachConfig = {
  enabled: true,
  inboundEmail: false,
  replyDomain: "reply.diytaxai.com",
  monthlyTargetUsd: 25,
  monthlyAlertUsd: 50,
  monthlyLimitUsd: 50,
  dailyMessagesPerUser: 30,
  dailyDeepPerUser: 8,
  perMinutePerUser: 6,
  dailyFindingsPerUser: 120,
  repeatWindowSeconds: 60,
  historyTurns: 6,
  models: {
    // Claude API list prices for prompts ≤ 100K tokens.
    fast: { id: "claude-haiku-5-5", inPerMTok: 0.1, outPerMTok: 0.5, maxOutputTokens: 2000 },
    deep: { id: "claude-sonnet-5-5", inPerMTok: 2, outPerMTok: 10, maxOutputTokens: 4000 },
  },
};

/** Bounds an administrator can set. Keeps a typo from removing the brakes. */
export const CONFIG_BOUNDS = {
  monthlyUsd: { min: 0, max: 1000 },
  dailyMessagesPerUser: { min: 0, max: 500 },
  dailyDeepPerUser: { min: 0, max: 200 },
  perMinutePerUser: { min: 1, max: 60 },
  historyTurns: { min: 0, max: 12 },
};

const ALLOWED_MODEL_IDS = new Set([
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
]);

function clamp(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.min(hi, Math.max(lo, n));
}

function mergeModel(base: ModelSettings, o: unknown): ModelSettings {
  if (!o || typeof o !== "object") return base;
  const m = o as Record<string, unknown>;
  return {
    id: typeof m.id === "string" && ALLOWED_MODEL_IDS.has(m.id) ? m.id : base.id,
    inPerMTok: clamp(m.inPerMTok, 0, 100, base.inPerMTok),
    outPerMTok: clamp(m.outPerMTok, 0, 500, base.outPerMTok),
    maxOutputTokens: clamp(m.maxOutputTokens, 256, 8000, base.maxOutputTokens),
  };
}

/** Merge stored overrides over defaults, enforcing bounds on every field. */
export function mergeConfig(stored: unknown, env: NodeJS.ProcessEnv = process.env): ZachConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const d = DEFAULT_CONFIG;
  const usd = CONFIG_BOUNDS.monthlyUsd;
  const limit = clamp(s.monthlyLimitUsd, usd.min, usd.max, d.monthlyLimitUsd);
  const cfg: ZachConfig = {
    enabled: env.ZACH_ENABLED === "false" ? false : s.enabled === false ? false : true,
    inboundEmail: s.inboundEmail === true,
    replyDomain: normalizeReplyDomain(s.replyDomain),
    monthlyLimitUsd: limit,
    monthlyTargetUsd: Math.min(limit, clamp(s.monthlyTargetUsd, usd.min, usd.max, d.monthlyTargetUsd)),
    monthlyAlertUsd: clamp(s.monthlyAlertUsd, usd.min, usd.max, d.monthlyAlertUsd),
    dailyMessagesPerUser: clamp(s.dailyMessagesPerUser, 0, CONFIG_BOUNDS.dailyMessagesPerUser.max, d.dailyMessagesPerUser),
    dailyDeepPerUser: clamp(s.dailyDeepPerUser, 0, CONFIG_BOUNDS.dailyDeepPerUser.max, d.dailyDeepPerUser),
    perMinutePerUser: clamp(s.perMinutePerUser, 1, CONFIG_BOUNDS.perMinutePerUser.max, d.perMinutePerUser),
    dailyFindingsPerUser: clamp(s.dailyFindingsPerUser, 1, 1000, d.dailyFindingsPerUser),
    repeatWindowSeconds: clamp(s.repeatWindowSeconds, 0, 3600, d.repeatWindowSeconds),
    historyTurns: clamp(s.historyTurns, 0, CONFIG_BOUNDS.historyTurns.max, d.historyTurns),
    models: {
      fast: mergeModel(d.models.fast, (s.models as Record<string, unknown> | undefined)?.fast),
      deep: mergeModel(d.models.deep, (s.models as Record<string, unknown> | undefined)?.deep),
    },
  };
  return cfg;
}

let cached: { at: number; cfg: ZachConfig } | null = null;
const CACHE_MS = 30_000;

export async function loadZachConfig(
  db: admin.firestore.Firestore,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): Promise<ZachConfig> {
  if (cached && now - cached.at < CACHE_MS) return cached.cfg;
  let stored: unknown = null;
  try {
    const snap = await db.collection("config").doc("zach").get();
    stored = snap.exists ? snap.data() : null;
  } catch (err) {
    console.warn("[zachConfig] read failed, using defaults", err instanceof Error ? err.message : err);
  }
  const cfg = mergeConfig(stored, env);
  cached = { at: now, cfg };
  return cfg;
}

export function clearZachConfigCache(): void {
  cached = null;
}

export function costUsd(m: ModelSettings, inputTokens: number, outputTokens: number): number {
  return (inputTokens * m.inPerMTok + outputTokens * m.outPerMTok) / 1_000_000;
}

/** Rough token count for budgeting before the call (deliberately generous). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

/** Worst-case cost of one request: the whole prompt plus every output token. */
export function worstCaseCost(m: ModelSettings, promptChars: number): number {
  return costUsd(m, estimateTokens(promptChars), m.maxOutputTokens);
}
