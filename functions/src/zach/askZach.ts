// askZach — the Zach tax assistant callable, and getZachFindings, its free
// (no-AI) proactive checklist.
//
// askZach request path, each step enforced in code:
//   settings / kill switch → signed in + fresh MFA → input validation →
//   verified household owner → per-user limits and repeat check →
//   owner-scoped, minimized context from the tax engine → worst-case cost
//   reserved against the monthly limit → model call (cheap model unless the
//   question needs reasoning and budget allows) → output validation
//   (allowlisted sources and routes, figure check) → actual cost settled,
//   alerts sent once per threshold.
//
// Zach has no tools and no write access. He answers and suggests allowlisted
// pages to open; the user makes every change.

import Anthropic from "@anthropic-ai/sdk";
import * as admin from "firebase-admin";
import { randomUUID } from "crypto";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { requireFreshMfa, resolveEffectiveOwner } from "../middleware/auth";
import { normalizeFilingStatus } from "../shared/taxConstants";
import { sendBudgetAlert } from "./zachAdmin";
import { ModelSettings, ModelTier, ZachConfig, loadZachConfig, worstCaseCost } from "./zachConfig";
import { ZachContext, loadZachContext } from "./zachContext";
import {
  RESPONSE_JSON_SCHEMA,
  UNVERIFIED_FIGURES_NOTE,
  ZachAnswer,
  figuresAreGrounded,
  isSupportedTaxYear,
  parseModelAnswer,
  redactSensitive,
  requestSchema,
  sanitizeHistory,
} from "./zachGuard";
import { NOT_CALCULATED_BY_APP, yearFacts } from "./zachKnowledge";
import { ZACH_SYSTEM_PROMPT, buildUserTurn, chooseModelTier } from "./zachPrompt";
import { ZACH_ROUTES, sectionForPath } from "./zachRoutes";
import {
  checkFindingsLimit,
  checkUserLimits,
  questionHash,
  releaseReservation,
  reserveBudget,
  settleUsage,
} from "./zachUsage";

export interface ModelCallResult {
  text: string | null;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export type ModelCaller = (args: {
  model: ModelSettings;
  tier: ModelTier;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) => Promise<ModelCallResult>;

export interface ZachDeps {
  db: admin.firestore.Firestore;
  callModel: ModelCaller;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** Injected so tests don't send email. */
  alert?: (crossed: Array<"target" | "alert" | "limit">, spendUsd: number, cfg: ZachConfig) => Promise<void>;
}

export type FindingOut = ZachContext["findings"][number] & { path?: string };

export interface ZachResponse extends ZachAnswer {
  taxYear: number;
  tableYear: number;
  model: ModelTier;
  conversationId: string;
  findings?: FindingOut[];
}

/** Production model caller (Anthropic Messages API, structured output). */
export function anthropicCaller(apiKey: string): ModelCaller {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  return async ({ model, tier, system, messages }) => {
    const res = await client.messages.create({
      model: model.id,
      max_tokens: model.maxOutputTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: {
        effort: tier === "deep" ? "medium" : "low",
        format: { type: "json_schema", schema: RESPONSE_JSON_SCHEMA as unknown as Record<string, unknown> },
      },
    });
    const textBlock = res.content.find((b) => b.type === "text");
    const u = res.usage;
    return {
      text: textBlock && textBlock.type === "text" ? textBlock.text : null,
      stopReason: res.stop_reason ?? null,
      inputTokens:
        (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    };
  };
}

function withPaths(findings: ZachContext["findings"]): FindingOut[] {
  return findings.map((f) => ({ ...f, path: f.route ? ZACH_ROUTES[f.route].path : undefined }));
}

function statusFromLabel(label: string | null) {
  return label ? normalizeFilingStatus(label.toLowerCase().replace(/ /g, "_")) : null;
}

export async function handleAskZach(deps: ZachDeps, request: CallableRequest): Promise<ZachResponse> {
  const now = deps.now();
  const cfg = await loadZachConfig(deps.db, now.getTime(), deps.env);
  if (!cfg.enabled) {
    throw new HttpsError("failed-precondition", "Zach is turned off right now. The rest of DIYTax AI works as usual.");
  }
  const callerUid = requireFreshMfa(request, now.getTime());

  const parsed = requestSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const req = parsed.data;
  if (!isSupportedTaxYear(req.taxYear, now)) {
    throw new HttpsError("invalid-argument", `Zach can't help with tax year ${req.taxYear}.`);
  }
  const conversationId = req.conversationId ?? randomUUID().replace(/-/g, "");
  const mode = req.mode ?? "chat";
  const message = redactSensitive(req.message);

  // Household scope comes only from the verified link, never from the request.
  const { effectiveOwnerUid } = await resolveEffectiveOwner(request);

  const gate = await checkUserLimits(
    deps.db,
    callerUid,
    questionHash(callerUid, req.taxYear, mode === "review" ? `review:${req.page ?? ""}` : message),
    now,
    cfg
  );

  const today = now.toISOString().slice(0, 10);
  const context = await loadZachContext(deps.db, effectiveOwnerUid, req.taxYear, today);
  const facts = yearFacts(req.taxYear, statusFromLabel(context.filingStatus));
  const history = sanitizeHistory(req.history, cfg.historyTurns);

  const userTurn = buildUserTurn({
    message,
    section: sectionForPath(req.page),
    mode,
    yearFacts: facts,
    taxpayerContext: context,
    notCalculated: NOT_CALCULATED_BY_APP,
  });
  const promptChars =
    ZACH_SYSTEM_PROMPT.length + userTurn.length + history.reduce((n, h) => n + h.content.length, 0);

  // Pick the tier, then reserve its worst case. If the strong model doesn't
  // fit the remaining budget, fall back to the fast one before refusing.
  let tier = chooseModelTier(message, mode, gate.deepAllowedForUser);
  let reservation;
  try {
    reservation = await reserveBudget(deps.db, now, cfg, worstCaseCost(cfg.models[tier], promptChars));
  } catch (err) {
    if (tier !== "deep") throw err;
    tier = "fast";
    reservation = await reserveBudget(deps.db, now, cfg, worstCaseCost(cfg.models.fast, promptChars));
  }
  if (reservation.throttled && tier === "deep") tier = "fast";

  const started = Date.now();
  let result: ModelCallResult;
  try {
    result = await deps.callModel({
      model: cfg.models[tier],
      tier,
      system: ZACH_SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: userTurn }],
    });
  } catch (err) {
    await releaseReservation(deps.db, reservation, true).catch(() => undefined);
    console.error("[askZach] model call failed", {
      callerUid,
      tier,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    throw new HttpsError("unavailable", "Zach is having trouble answering right now. Please try again in a moment.");
  }

  const answer = result.stopReason === "refusal" || !result.text ? null : parseModelAnswer(result.text);

  try {
    const settled = await settleUsage(deps.db, now, cfg, reservation, {
      uid: callerUid,
      conversationId,
      taxYear: req.taxYear,
      tier,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ok: answer !== null,
    });
    if (settled.crossed.length) {
      await (deps.alert ?? sendBudgetAlert)(settled.crossed, settled.monthSpendUsd, cfg);
    }
  } catch (err) {
    console.warn("[askZach] usage settle failed", err instanceof Error ? err.message : err);
  }

  if (result.stopReason === "refusal") {
    throw new HttpsError("failed-precondition", "Zach can't help with that request. Try asking about your taxes another way.");
  }
  if (!answer) {
    console.error("[askZach] unusable model output", { callerUid, tier, stopReason: result.stopReason });
    throw new HttpsError("unavailable", "Zach couldn't put together an answer. Please try rephrasing your question.");
  }

  const grounded = figuresAreGrounded(answer.answer, [context, facts, message, history.map((h) => h.content)]);
  const response: ZachResponse = {
    ...answer,
    answer: grounded ? answer.answer : `${answer.answer}\n\n${UNVERIFIED_FIGURES_NOTE}`,
    unverifiedFigures: !grounded,
    taxYear: req.taxYear,
    tableYear: context.tableYear,
    model: tier,
    conversationId,
  };
  if (mode === "review") response.findings = withPaths(context.findings);

  // Operational log: no question text, no answer text, no taxpayer figures.
  console.log(
    JSON.stringify({
      event: "zach_answer",
      callerUid,
      sharedAccess: effectiveOwnerUid !== callerUid,
      taxYear: req.taxYear,
      mode,
      tier,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ms: Date.now() - started,
      basis: answer.basis,
      unverifiedFigures: !grounded,
    })
  );
  return response;
}

export interface FindingsResponse {
  taxYear: number;
  tableYear: number;
  filingStatusSet: boolean;
  findings: FindingOut[];
}

/** Deterministic checklist for the proactive panel. No AI call, no AI cost. */
export async function handleGetZachFindings(
  deps: Pick<ZachDeps, "db" | "now" | "env">,
  request: CallableRequest
): Promise<FindingsResponse> {
  const now = deps.now();
  const cfg = await loadZachConfig(deps.db, now.getTime(), deps.env);
  const callerUid = requireFreshMfa(request, now.getTime());
  const taxYear = Number((request.data as Record<string, unknown> | undefined)?.taxYear);
  if (!Number.isInteger(taxYear) || !isSupportedTaxYear(taxYear, now)) {
    throw new HttpsError("invalid-argument", "Choose a supported tax year.");
  }
  const { effectiveOwnerUid } = await resolveEffectiveOwner(request);
  await checkFindingsLimit(deps.db, callerUid, now, cfg);
  const ctx = await loadZachContext(deps.db, effectiveOwnerUid, taxYear, now.toISOString().slice(0, 10));
  return {
    taxYear,
    tableYear: ctx.tableYear,
    filingStatusSet: ctx.filingStatus !== null,
    findings: withPaths(ctx.findings),
  };
}

export const askZach = onCall(
  {
    secrets: ["ANTHROPIC_API_KEY", "RESEND_API_KEY"],
    cors: true,
    invoker: "public",
    timeoutSeconds: 90,
    memory: "512MiB",
    maxInstances: 20,
  },
  async (request) => {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new HttpsError("internal", "Zach isn't configured.");
    return handleAskZach(
      { db: admin.firestore(), callModel: anthropicCaller(apiKey), now: () => new Date(), env: process.env },
      request
    );
  }
);

export const getZachFindings = onCall({ cors: true, invoker: "public", maxInstances: 20 }, async (request) =>
  handleGetZachFindings({ db: admin.firestore(), now: () => new Date(), env: process.env }, request)
);
