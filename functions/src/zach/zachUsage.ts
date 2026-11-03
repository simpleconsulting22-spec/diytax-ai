// Zach usage limits, spending controls and cost tracking.
//
// Documents (all in `zachUsage`, closed to clients by firestore.rules):
//   u_{uid}_{YYYY-MM-DD}   per-user day: counts, burst window, last question hash
//   um_{uid}_{YYYY-MM}     per-user month: cost and questions (drives "active users")
//   m_{YYYY-MM}            global month: spend, in-flight reservations, by model,
//                           failures, repeats, active users, conversations, alerts
//   d_{YYYY-MM-DD}         global day: spend and questions
// and `zachConversations/{uid}_{conversationId}`: per-conversation counts and
// cost only. Conversation text is never stored on the server.
//
// Spending limit, honestly described: before each call the worst-case cost of
// that request is reserved against the monthly limit in a transaction, so
// concurrent requests cannot jointly pass it. Actual cost replaces the
// reservation when the call ends. The provider bills independently, so a small
// overrun is still possible (e.g. pricing changes, a crash between the call and
// settlement). This is an application limit, not a provider billing cap.

import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { HttpsError } from "firebase-functions/v2/https";
import { ModelTier, ZachConfig, costUsd } from "./zachConfig";

const FieldValue = admin.firestore.FieldValue;

export const ids = {
  userDay: (uid: string, day: string) => `u_${uid}_${day}`,
  userMonth: (uid: string, month: string) => `um_${uid}_${month}`,
  month: (month: string) => `m_${month}`,
  day: (day: string) => `d_${day}`,
};

export function periodKeys(now: Date): { day: string; month: string; minute: number } {
  const day = now.toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7), minute: Math.floor(now.getTime() / 60_000) };
}

export function questionHash(uid: string, taxYear: number, message: string): string {
  return createHash("sha256")
    .update(`${uid}|${taxYear}|${message.trim().toLowerCase().replace(/\s+/g, " ")}`)
    .digest("hex")
    .slice(0, 32);
}

export interface UserGate {
  deepAllowedForUser: boolean;
}

/**
 * Per-user abuse protection: daily cap, per-minute burst cap, and rejection of
 * the same question repeated within the repeat window. Counts the request.
 */
export async function checkUserLimits(
  db: admin.firestore.Firestore,
  uid: string,
  hash: string,
  now: Date,
  cfg: ZachConfig
): Promise<UserGate> {
  const { day, month, minute } = periodKeys(now);
  const ref = db.collection("zachUsage").doc(ids.userDay(uid, day));
  const monthRef = db.collection("zachUsage").doc(ids.month(month));
  let repeat = false;

  const gate = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data()! : {};
    const count = Number(d.count ?? 0);
    if (count >= cfg.dailyMessagesPerUser) {
      throw new HttpsError(
        "resource-exhausted",
        "You've asked Zach the maximum number of questions for today. He'll be back tomorrow. Everything else in DIYTax AI works as usual."
      );
    }
    const minuteCount = d.minute === minute ? Number(d.minuteCount ?? 0) : 0;
    if (minuteCount >= cfg.perMinutePerUser) {
      throw new HttpsError("resource-exhausted", "You're asking questions quickly. Please wait a minute, then try again.");
    }
    const lastAt = Number(d.lastQuestionAt ?? 0);
    if (
      cfg.repeatWindowSeconds > 0 &&
      d.lastQuestionHash === hash &&
      now.getTime() - lastAt < cfg.repeatWindowSeconds * 1000
    ) {
      repeat = true;
      return null;
    }
    tx.set(
      ref,
      {
        uid,
        day,
        count: count + 1,
        minute,
        minuteCount: minuteCount + 1,
        lastQuestionHash: hash,
        lastQuestionAt: now.getTime(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { deepAllowedForUser: Number(d.deepCount ?? 0) < cfg.dailyDeepPerUser };
  });

  if (repeat || !gate) {
    await monthRef.set({ repeats: FieldValue.increment(1) }, { merge: true }).catch(() => undefined);
    throw new HttpsError("already-exists", "You just asked Zach that. His answer is above.");
  }
  return gate;
}

export interface BudgetReservation {
  reservedUsd: number;
  /** True when month-to-date spend is past the target, so only the fast model may run. */
  throttled: boolean;
  monthId: string;
}

/**
 * Reserve the worst-case cost of one request against the monthly limit.
 * Throws `resource-exhausted` (with a reassuring message) if it would not fit.
 */
export async function reserveBudget(
  db: admin.firestore.Firestore,
  now: Date,
  cfg: ZachConfig,
  worstCaseUsd: number
): Promise<BudgetReservation> {
  const { month } = periodKeys(now);
  const ref = db.collection("zachUsage").doc(ids.month(month));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data()! : {};
    const spent = Number(d.costUsd ?? 0);
    const reserved = Math.max(0, Number(d.reservedUsd ?? 0));
    if (spent + reserved + worstCaseUsd > cfg.monthlyLimitUsd) {
      throw new HttpsError(
        "resource-exhausted",
        "Zach is taking a break for the rest of this month. Your tax information is safe, and the rest of DIYTax AI works as usual."
      );
    }
    tx.set(
      ref,
      { month, reservedUsd: FieldValue.increment(worstCaseUsd), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { reservedUsd: worstCaseUsd, throttled: spent >= cfg.monthlyTargetUsd, monthId: ref.id };
  });
}

export interface SettleArgs {
  uid: string;
  conversationId: string;
  taxYear: number;
  tier: ModelTier;
  inputTokens: number;
  outputTokens: number;
  ok: boolean;
}

export interface SettleResult {
  costUsd: number;
  monthSpendUsd: number;
  crossed: Array<"target" | "alert" | "limit">;
}

/**
 * Replace the reservation with actual cost and record usage by user, model,
 * day, month and conversation. Returns which thresholds this request crossed
 * for the first time this month (each is reported once).
 */
export async function settleUsage(
  db: admin.firestore.Firestore,
  now: Date,
  cfg: ZachConfig,
  r: BudgetReservation,
  a: SettleArgs
): Promise<SettleResult> {
  const { day, month } = periodKeys(now);
  const cost = costUsd(cfg.models[a.tier], a.inputTokens, a.outputTokens);
  const inc = FieldValue.increment;
  const monthRef = db.collection("zachUsage").doc(r.monthId);
  const userMonthRef = db.collection("zachUsage").doc(ids.userMonth(a.uid, month));
  const convRef = db.collection("zachConversations").doc(`${a.uid}_${a.conversationId}`);

  const result = await db.runTransaction(async (tx) => {
    const [m, um, conv] = await Promise.all([tx.get(monthRef), tx.get(userMonthRef), tx.get(convRef)]);
    const md = m.exists ? m.data()! : {};
    const before = Number(md.costUsd ?? 0);
    const after = before + cost;
    const alerts = (md.alertsSent ?? {}) as Record<string, boolean>;
    const crossed: SettleResult["crossed"] = [];
    const check = (k: "target" | "alert" | "limit", t: number) => {
      if (!alerts[k] && t > 0 && after >= t) crossed.push(k);
    };
    check("target", cfg.monthlyTargetUsd);
    check("alert", cfg.monthlyAlertUsd);
    check("limit", cfg.monthlyLimitUsd);

    const newUser = !um.exists;
    const newConv = !conv.exists;
    tx.set(
      monthRef,
      {
        month,
        costUsd: inc(cost),
        reservedUsd: inc(-r.reservedUsd),
        requests: inc(1),
        ...(a.ok ? {} : { failures: inc(1) }),
        ...(newUser ? { activeUsers: inc(1) } : {}),
        ...(newConv ? { conversations: inc(1) } : {}),
        byModel: {
          [a.tier]: {
            requests: inc(1),
            costUsd: inc(cost),
            inputTokens: inc(a.inputTokens),
            outputTokens: inc(a.outputTokens),
          },
        },
        ...(crossed.length
          ? { alertsSent: Object.fromEntries(crossed.map((k) => [k, true])) }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      userMonthRef,
      { uid: a.uid, month, costUsd: inc(cost), questions: inc(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    tx.set(
      convRef,
      {
        uid: a.uid,
        taxYear: a.taxYear,
        turns: inc(1),
        costUsd: inc(cost),
        ...(newConv ? { createdAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { costUsd: cost, monthSpendUsd: after, crossed };
  });

  // Non-transactional counters: day rollup and the user's deep-model count.
  const writes: Array<Promise<unknown>> = [
    db.collection("zachUsage").doc(ids.day(day)).set(
      { day, costUsd: inc(cost), requests: inc(1), ...(a.ok ? {} : { failures: inc(1) }) },
      { merge: true }
    ),
  ];
  if (a.tier === "deep") {
    writes.push(
      db.collection("zachUsage").doc(ids.userDay(a.uid, day)).set({ deepCount: inc(1) }, { merge: true })
    );
  }
  await Promise.all(writes);
  return result;
}

/** Give back a reservation when no billable call was made. */
export async function releaseReservation(
  db: admin.firestore.Firestore,
  r: BudgetReservation,
  failed: boolean
): Promise<void> {
  await db
    .collection("zachUsage")
    .doc(r.monthId)
    .set(
      {
        reservedUsd: FieldValue.increment(-r.reservedUsd),
        ...(failed ? { failures: FieldValue.increment(1) } : {}),
      },
      { merge: true }
    );
}

/** Per-user daily counter for the free findings endpoint. */
export async function checkFindingsLimit(
  db: admin.firestore.Firestore,
  uid: string,
  now: Date,
  cfg: ZachConfig
): Promise<void> {
  const { day } = periodKeys(now);
  const ref = db.collection("zachUsage").doc(ids.userDay(uid, day));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = Number(snap.exists ? snap.data()!.findingsCount ?? 0 : 0);
    if (n >= cfg.dailyFindingsPerUser) {
      throw new HttpsError("resource-exhausted", "Zach's checklist has refreshed a lot today. Please try again tomorrow.");
    }
    tx.set(ref, { uid, day, findingsCount: n + 1 }, { merge: true });
  });
}
