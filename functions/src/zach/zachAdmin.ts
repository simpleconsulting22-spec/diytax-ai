// Administrator controls for Zach: a cost summary and the settings editor.
//
// Access: a fresh MFA claim AND a verified email on the ZACH_ADMIN_EMAILS list.
// The default is the same single administrator email already pinned for
// DIYTax AI's other admin callables (admin/wipeBankData.ts). The summary is
// aggregate-only: no uids, emails or taxpayer data leave it.

import * as admin from "firebase-admin";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireFreshMfa } from "../middleware/auth";
import { CONFIG_BOUNDS, DEFAULT_CONFIG, ZachConfig, clearZachConfigCache, loadZachConfig } from "./zachConfig";
import { ids, periodKeys } from "./zachUsage";
import { sendEmail, FROM_HEADER } from "../services/emailService";

const DEFAULT_ADMIN_EMAILS = ["deboijiwola@gmail.com"];

export function adminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.ZACH_ADMIN_EMAILS;
  const list = raw ? raw.split(",") : DEFAULT_ADMIN_EMAILS;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function requireZachAdmin(request: CallableRequest, now: number = Date.now(), env = process.env): string {
  const uid = requireFreshMfa(request, now);
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const email = typeof token.email === "string" ? token.email.toLowerCase() : "";
  if (!email || token.email_verified !== true || !adminEmails(env).includes(email)) {
    throw new HttpsError("permission-denied", "Only a DIYTax AI administrator can do that.");
  }
  return uid;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export interface ZachAdminSummary {
  month: string;
  config: ZachConfig;
  spend: {
    monthToDateUsd: number;
    inFlightReservedUsd: number;
    targetUsd: number;
    alertUsd: number;
    limitUsd: number;
    percentOfLimit: number;
    status: "normal" | "throttled_to_fast_model" | "limit_reached";
  };
  activity: {
    questions: number;
    activeUsers: number;
    conversations: number;
    failures: number;
    repeatsBlocked: number;
    avgCostPerQuestionUsd: number;
    avgCostPerConversationUsd: number;
    avgCostPerActiveUserUsd: number;
  };
  byModel: Array<{ tier: string; model: string; questions: number; costUsd: number; inputTokens: number; outputTokens: number; share: number }>;
  daily: Array<{ day: string; costUsd: number; questions: number; failures: number }>;
  note: string;
}

export async function buildAdminSummary(db: admin.firestore.Firestore, now: Date): Promise<ZachAdminSummary> {
  const cfg = await loadZachConfig(db, now.getTime());
  const { month } = periodKeys(now);
  const mSnap = await db.collection("zachUsage").doc(ids.month(month)).get();
  const m = mSnap.exists ? mSnap.data()! : {};

  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const daySnaps = await db.getAll(...days.map((d) => db.collection("zachUsage").doc(ids.day(d))));

  const spent = Number(m.costUsd ?? 0);
  const questions = Number(m.requests ?? 0);
  const activeUsers = Number(m.activeUsers ?? 0);
  const conversations = Number(m.conversations ?? 0);
  const byModelRaw = (m.byModel ?? {}) as Record<string, Record<string, number>>;

  return {
    month,
    config: cfg,
    spend: {
      monthToDateUsd: round(spent),
      inFlightReservedUsd: round(Math.max(0, Number(m.reservedUsd ?? 0))),
      targetUsd: cfg.monthlyTargetUsd,
      alertUsd: cfg.monthlyAlertUsd,
      limitUsd: cfg.monthlyLimitUsd,
      percentOfLimit: cfg.monthlyLimitUsd > 0 ? Math.round((spent / cfg.monthlyLimitUsd) * 1000) / 10 : 0,
      status: spent >= cfg.monthlyLimitUsd ? "limit_reached" : spent >= cfg.monthlyTargetUsd ? "throttled_to_fast_model" : "normal",
    },
    activity: {
      questions,
      activeUsers,
      conversations,
      failures: Number(m.failures ?? 0),
      repeatsBlocked: Number(m.repeats ?? 0),
      avgCostPerQuestionUsd: questions ? round(spent / questions) : 0,
      avgCostPerConversationUsd: conversations ? round(spent / conversations) : 0,
      avgCostPerActiveUserUsd: activeUsers ? round(spent / activeUsers) : 0,
    },
    byModel: (["fast", "deep"] as const).map((tier) => {
      const b = byModelRaw[tier] ?? {};
      const q = Number(b.requests ?? 0);
      return {
        tier,
        model: cfg.models[tier].id,
        questions: q,
        costUsd: round(Number(b.costUsd ?? 0)),
        inputTokens: Number(b.inputTokens ?? 0),
        outputTokens: Number(b.outputTokens ?? 0),
        share: questions ? Math.round((q / questions) * 1000) / 10 : 0,
      };
    }),
    daily: daySnaps.map((s, i) => {
      const d = s.exists ? s.data()! : {};
      return {
        day: days[i],
        costUsd: round(Number(d.costUsd ?? 0)),
        questions: Number(d.requests ?? 0),
        failures: Number(d.failures ?? 0),
      };
    }),
    note:
      "Estimated from token counts and list prices. This is an application limit, not a provider billing cap; check the Anthropic Console for billed amounts.",
  };
}

export const getZachAdminSummary = onCall({ cors: true, invoker: "public" }, async (request) => {
  requireZachAdmin(request);
  return buildAdminSummary(admin.firestore(), new Date());
});

const usd = z.number().min(CONFIG_BOUNDS.monthlyUsd.min).max(CONFIG_BOUNDS.monthlyUsd.max);
export const configUpdateSchema = z
  .object({
    enabled: z.boolean(),
    monthlyTargetUsd: usd,
    monthlyAlertUsd: usd,
    monthlyLimitUsd: usd,
    dailyMessagesPerUser: z.number().int().min(0).max(CONFIG_BOUNDS.dailyMessagesPerUser.max),
    dailyDeepPerUser: z.number().int().min(0).max(CONFIG_BOUNDS.dailyDeepPerUser.max),
    perMinutePerUser: z.number().int().min(1).max(CONFIG_BOUNDS.perMinutePerUser.max),
    historyTurns: z.number().int().min(0).max(CONFIG_BOUNDS.historyTurns.max),
  })
  .partial()
  .strict();

export const setZachConfig = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = requireZachAdmin(request);
  const parsed = configUpdateSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid settings.");
  }
  const db = admin.firestore();
  await db.collection("config").doc("zach").set(
    { ...parsed.data, updatedBy: uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  await db.collection("config").doc("zach").collection("history").add({
    change: parsed.data,
    updatedBy: uid,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  clearZachConfigCache();
  return buildAdminSummary(db, new Date());
});

/** Email the administrators the first time a threshold is crossed in a month. */
export async function sendBudgetAlert(
  crossed: Array<"target" | "alert" | "limit">,
  spendUsd: number,
  cfg: ZachConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!crossed.length) return;
  const lines: Record<string, string> = {
    target: `Zach passed the $${cfg.monthlyTargetUsd} monthly target. New questions now use the lower-cost model only.`,
    alert: `Zach passed the $${cfg.monthlyAlertUsd} monthly alert threshold.`,
    limit: `Zach reached the $${cfg.monthlyLimitUsd} monthly limit. New AI questions are paused until next month or until you raise the limit.`,
  };
  const body = crossed.map((k) => lines[k]).join(" ");
  const text = `${body}\n\nEstimated month-to-date spend: $${spendUsd.toFixed(2)}.\nOpen /admin/zach in DIYTax AI to see details or change limits.`;
  for (const to of adminEmails(env)) {
    try {
      await sendEmail({
        to,
        subject: `Zach spending alert: $${spendUsd.toFixed(2)} this month`,
        text,
        html: `<p>${body}</p><p>Estimated month-to-date spend: <strong>$${spendUsd.toFixed(2)}</strong>.</p><p>Open <a href="https://diytaxai.com/admin/zach">Zach usage</a> to see details or change limits.</p>`,
      });
    } catch (err) {
      console.error("[zach] budget alert email failed", err instanceof Error ? err.message : err);
    }
  }
  console.warn(JSON.stringify({ event: "zach_budget_alert", crossed, spendUsd: Math.round(spendUsd * 100) / 100, from: FROM_HEADER }));
}

export { DEFAULT_CONFIG };
