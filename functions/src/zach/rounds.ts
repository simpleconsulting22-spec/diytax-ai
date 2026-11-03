// Zach's question rounds.
//
// Per household (the owner's account). Rounds are OFF until the owner turns
// them on. On each round, Needs-review transactions are grouped by merchant,
// routed to the household member who usually uses that account (default: the
// owner), capped at 10 merchants per person, and emailed with a link to
// answer in DIYTax AI (sign-in + 6-digit code; answers are audited and
// undoable). No email is sent when there is nothing to ask. One reminder
// after 3 days if that person's questions are still open.
//
// Members are the owner and spouses linked through the verified shared-access
// grant (owner doc sharedUids + sharedRoles). Accountants are not sent rounds.

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { randomUUID } from "crypto";
import { requireFreshMfa, resolveEffectiveOwner } from "../middleware/auth";
import { extractVendor } from "../shared/vendorExtraction";
import { EmailMessage, sendEmail } from "../services/emailService";
import { loadZachConfig } from "./zachConfig";
import { createReplyAddress } from "./replyTokens";

export const ROUND_SIZE = 10;
export const REMINDER_AFTER_MS = 3 * 86_400_000;
export const LOOKBACK_DAYS = 400;
export const APP_URL = "https://diytaxai.com";
export const REPLY_HINT =
  'Or just reply to this email in your own words, for example "Home Depot was for the rental, Target was personal". You can attach receipt photos too. Anything that would be deductible still needs one tap in the app to confirm.';
const CADENCE_MS = { weekly: 7 * 86_400_000, biweekly: 14 * 86_400_000, monthly: 30 * 86_400_000 } as const;
export type Cadence = keyof typeof CADENCE_MS;

export interface RoundSettings {
  enabled: boolean;
  cadence: Cadence;
  /** accountId → member uid who usually answers for it. */
  accountRespondents: Record<string, string>;
  defaultRespondent: string;
  nextRoundAt: number | null;
  lastRoundAt: number | null;
}

export function defaultSettings(ownerUid: string): RoundSettings {
  return { enabled: false, cadence: "biweekly", accountRespondents: {}, defaultRespondent: ownerUid, nextRoundAt: null, lastRoundAt: null };
}

export interface Member {
  uid: string;
  role: "owner" | "spouse";
  email: string;
}

export interface RoundGroup {
  key: string;
  vendor: string;
  count: number;
  total: number;
  from: string;
  to: string;
  guess: string | null;
  txnIds: string[];
}

export interface BuiltRound {
  byRespondent: Record<string, { email: string; groups: RoundGroup[] }>;
  totalGroups: number;
}

interface TxnRow {
  id: string;
  uid?: unknown;
  status?: unknown;
  type?: unknown;
  date?: unknown;
  description?: unknown;
  normalizedDescription?: unknown;
  vendor?: unknown;
  amount?: unknown;
  category?: unknown;
  accountId?: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Household members who can receive rounds. Uses the verified grant only. */
export async function householdMembers(
  db: admin.firestore.Firestore,
  ownerUid: string,
  emailOf: (uid: string) => Promise<string | null>
): Promise<Member[]> {
  const owner = (await db.collection("users").doc(ownerUid).get()).data() ?? {};
  const members: Member[] = [];
  const ownerEmail = await emailOf(ownerUid);
  if (ownerEmail) members.push({ uid: ownerUid, role: "owner", email: ownerEmail });
  const shared = Array.isArray(owner.sharedUids) ? (owner.sharedUids as unknown[]) : [];
  const roles = (owner.sharedRoles ?? {}) as Record<string, unknown>;
  for (const uid of shared) {
    if (typeof uid !== "string" || roles[uid] !== "spouse") continue;
    // Both sides of the link must agree, as in resolveEffectiveOwner.
    const doc = (await db.collection("users").doc(uid).get()).data();
    if (doc?.ownerUid !== ownerUid) continue;
    const email = await emailOf(uid);
    if (email) members.push({ uid, role: "spouse", email });
  }
  return members;
}

/** Pure: group Needs-review rows by merchant and route each group. */
export function buildRoundFromRows(
  rows: TxnRow[],
  settings: RoundSettings,
  members: Member[],
  ownerUid: string,
  todayISO: string
): BuiltRound {
  const memberIds = new Set(members.map((m) => m.uid));
  const cutoff = new Date(Date.parse(`${todayISO}T00:00:00Z`) - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const groups = new Map<string, RoundGroup & { accounts: Map<string, number> }>();

  for (const t of rows) {
    if (str(t.status) !== "needs_review" || str(t.type) === "transfer") continue;
    const date = str(t.date);
    if (date && date < cutoff) continue;
    const vendor =
      extractVendor({ description: str(t.description), normalizedDescription: str(t.normalizedDescription), vendor: str(t.vendor) }) ||
      str(t.description).slice(0, 28);
    if (!vendor) continue;
    const key = vendor.toLowerCase();
    const g = groups.get(key) ?? { key, vendor, count: 0, total: 0, from: date, to: date, guess: null as string | null, txnIds: [] as string[], accounts: new Map<string, number>() };
    g.count++;
    g.total += Math.abs(Number(t.amount) || 0);
    if (date && (!g.from || date < g.from)) g.from = date;
    if (date && date > g.to) g.to = date;
    if (!g.guess && str(t.category)) g.guess = str(t.category);
    if (g.txnIds.length < 50) g.txnIds.push(t.id);
    const acct = str(t.accountId);
    if (acct) g.accounts.set(acct, (g.accounts.get(acct) ?? 0) + 1);
    groups.set(key, g);
  }

  const fallback = memberIds.has(settings.defaultRespondent) ? settings.defaultRespondent : ownerUid;
  const byRespondent: BuiltRound["byRespondent"] = {};
  const sorted = [...groups.values()].sort((a, b) => b.total - a.total);
  for (const g of sorted) {
    const topAccount = [...g.accounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const mapped = topAccount ? settings.accountRespondents[topAccount] : undefined;
    const to = mapped && memberIds.has(mapped) ? mapped : fallback;
    const member = members.find((m) => m.uid === to);
    if (!member) continue;
    const bucket = (byRespondent[to] ??= { email: member.email, groups: [] });
    if (bucket.groups.length >= ROUND_SIZE) continue;
    const { accounts: _a, ...plain } = g;
    void _a;
    bucket.groups.push({ ...plain, total: Math.round(plain.total * 100) / 100 });
  }
  const totalGroups = Object.values(byRespondent).reduce((n, r) => n + r.groups.length, 0);
  return { byRespondent, totalGroups };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Email for one person's questions. Merchant names and amounts only. */
export function roundEmail(email: string, groups: RoundGroup[], reminder: boolean, replyTo?: string): EmailMessage {
  const n = groups.length;
  const subject = reminder
    ? `Reminder: Zach still has ${n} question${n !== 1 ? "s" : ""} for you`
    : `Zach has ${n} question${n !== 1 ? "s" : ""} about recent transactions`;
  const lines = groups.map((g) => {
    const when = !g.from ? "" : g.from === g.to ? g.from : `${g.from} to ${g.to}`;
    const guess = g.guess ? ` Zach's guess: ${g.guess}.` : "";
    return { text: `- ${g.vendor}: ${g.count} charge${g.count !== 1 ? "s" : ""}, ${usd(g.total)}${when ? ` (${when})` : ""}.${guess}`, g, when, guess };
  });
  const link = `${APP_URL}/review?zach=mine`;
  const settings = `${APP_URL}/settings/zach`;
  const text =
    `${reminder ? "A quick reminder: " : ""}Zach needs your help with a few transactions while you still remember them.\n\n` +
    lines.map((l) => l.text).join("\n") +
    `\n\nAnswer in DIYTax AI (about 2 minutes): ${link}\n\n` +
    (replyTo ? `${REPLY_HINT}\n\n` : "") +
    `Nothing changes until you answer, and every answer can be undone.\n` +
    `Change how often Zach asks, or turn rounds off: ${settings}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,sans-serif;color:#111827;max-width:560px">` +
    `<p>${reminder ? "A quick reminder: " : ""}Zach needs your help with a few transactions while you still remember them.</p>` +
    `<ul style="padding-left:18px">${lines
      .map((l) => `<li style="margin-bottom:6px"><strong>${esc(l.g.vendor)}</strong>: ${l.g.count} charge${l.g.count !== 1 ? "s" : ""}, ${usd(l.g.total)}${l.when ? ` (${esc(l.when)})` : ""}.${esc(l.guess)}</li>`)
      .join("")}</ul>` +
    `<p><a href="${link}" style="display:inline-block;background:#16A34A;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Answer in DIYTax AI</a></p>` +
    (replyTo ? `<p style="font-size:14px">${esc(REPLY_HINT)}</p>` : "") +
    `<p style="color:#6b7280;font-size:13px">Nothing changes until you answer, and every answer can be undone.<br>` +
    `<a href="${settings}" style="color:#6b7280">Change how often Zach asks, or turn rounds off</a>.</p></div>`;
  return { to: email, subject, html, text, ...(replyTo ? { replyTo } : {}) };
}

// ─── Firestore plumbing ──────────────────────────────────────────────────────

export interface RoundDeps {
  db: admin.firestore.Firestore;
  send: (m: EmailMessage) => Promise<unknown>;
  emailOf: (uid: string) => Promise<string | null>;
  now: () => Date;
  /** True when replies to round emails are being received (config/zach.inboundEmail). */
  inboundEnabled?: () => Promise<boolean>;
}

export const defaultDeps = (): RoundDeps => ({
  db: admin.firestore(),
  send: sendEmail,
  emailOf: async (uid) => {
    try {
      const u = await admin.auth().getUser(uid);
      return u.email ?? null;
    } catch {
      return null;
    }
  },
  now: () => new Date(),
  inboundEnabled: async () => (await loadZachConfig(admin.firestore(), Date.now())).inboundEmail,
});

/** Reply-To for one person's questions, when replies are on. Never blocks the round. */
async function replyAddressFor(deps: RoundDeps, ownerUid: string, uid: string, email: string, roundId: string, groups: RoundGroup[]): Promise<string | undefined> {
  try {
    if (!deps.inboundEnabled || !(await deps.inboundEnabled())) return undefined;
    return await createReplyAddress(
      deps.db,
      { ownerUid, respondentUid: uid, email, roundId, groups: groups.map(({ key, vendor, count, total, guess, txnIds }) => ({ key, vendor, count, total, guess: guess ?? null, txnIds })) },
      deps.now().getTime()
    );
  } catch (err) {
    console.error("[zachRounds] reply address failed", err instanceof Error ? err.message.slice(0, 120) : "unknown");
    return undefined;
  }
}

export async function loadSettings(db: admin.firestore.Firestore, ownerUid: string): Promise<RoundSettings> {
  const snap = await db.collection("zachHouseholds").doc(ownerUid).get();
  return { ...defaultSettings(ownerUid), ...(snap.exists ? (snap.data() as Partial<RoundSettings>) : {}) };
}

export async function buildRound(deps: RoundDeps, ownerUid: string): Promise<{ built: BuiltRound; members: Member[]; settings: RoundSettings }> {
  const settings = await loadSettings(deps.db, ownerUid);
  const members = await householdMembers(deps.db, ownerUid, deps.emailOf);
  const snap = await deps.db.collection("transactions").where("uid", "==", ownerUid).where("status", "==", "needs_review").get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TxnRow);
  const built = buildRoundFromRows(rows, settings, members, ownerUid, deps.now().toISOString().slice(0, 10));
  return { built, members, settings };
}

/** Build, store and email a round. Returns the round id, or null if nothing to ask. */
export async function runRound(deps: RoundDeps, ownerUid: string, trigger: "schedule" | "manual"): Promise<string | null> {
  const { built, settings } = await buildRound(deps, ownerUid);
  const now = deps.now().getTime();
  // Any round (manual or scheduled) pushes the next scheduled one out by the
  // full cadence, so "Send now" never leads to a second email the same day.
  if (settings.enabled) {
    await deps.db.collection("zachHouseholds").doc(ownerUid).set(
      { lastRoundAt: now, nextRoundAt: now + CADENCE_MS[settings.cadence] },
      { merge: true }
    );
  }
  if (built.totalGroups === 0) {
    await deps.db.collection("zachHouseholds").doc(ownerUid).set({ lastCheckedAt: now }, { merge: true });
    return null;
  }
  const roundId = randomUUID();
  const respondents: Record<string, unknown> = {};
  for (const [uid, r] of Object.entries(built.byRespondent)) {
    respondents[uid] = { groups: r.groups.map(({ key, vendor, count, total, guess, txnIds }) => ({ key, vendor, count, total, guess, txnIds })), sentAt: null, remindedAt: null };
  }
  await deps.db.collection("zachRounds").doc(roundId).set({
    ownerUid,
    trigger,
    createdAt: now,
    reminderDueAt: now + REMINDER_AFTER_MS,
    reminderDone: false,
    respondents,
  });
  for (const [uid, r] of Object.entries(built.byRespondent)) {
    try {
      const replyTo = await replyAddressFor(deps, ownerUid, uid, r.email, roundId, r.groups);
      await deps.send(roundEmail(r.email, r.groups, false, replyTo));
      await deps.db.collection("zachRounds").doc(roundId).update({ [`respondents.${uid}.sentAt`]: now });
    } catch (err) {
      console.error("[zachRounds] send failed", { ownerUid, roundId, error: err instanceof Error ? err.message.slice(0, 160) : "unknown" });
    }
  }
  return roundId;
}

/** One reminder per person, only for questions still in Needs review. */
export async function sendDueReminders(deps: RoundDeps): Promise<number> {
  const now = deps.now().getTime();
  const due = await deps.db.collection("zachRounds").where("reminderDone", "==", false).where("reminderDueAt", "<=", now).limit(200).get();
  let sent = 0;
  for (const roundDoc of due.docs) {
    const round = roundDoc.data();
    const settings = await loadSettings(deps.db, round.ownerUid);
    const members = settings.enabled ? await householdMembers(deps.db, round.ownerUid, deps.emailOf) : [];
    for (const [uid, r] of Object.entries((round.respondents ?? {}) as Record<string, { groups: RoundGroup[]; sentAt: number | null }>)) {
      const member = members.find((m) => m.uid === uid);
      if (!member || !r.sentAt) continue;
      const open: RoundGroup[] = [];
      for (const g of r.groups) {
        const snaps = await Promise.all(g.txnIds.slice(0, 50).map((id) => deps.db.collection("transactions").doc(id).get()));
        const stillOpen = snaps.filter((s) => s.exists && s.data()!.uid === round.ownerUid && s.data()!.status === "needs_review");
        if (stillOpen.length > 0) open.push({ ...g, count: stillOpen.length });
      }
      if (open.length === 0) continue;
      try {
        const groups = open.map((g) => ({ ...g, from: "", to: "", guess: g.guess ?? null }));
        const replyTo = await replyAddressFor(deps, round.ownerUid, uid, member.email, roundDoc.id, groups);
        await deps.send(roundEmail(member.email, groups, true, replyTo));
        await roundDoc.ref.update({ [`respondents.${uid}.remindedAt`]: now });
        sent++;
      } catch (err) {
        console.error("[zachRounds] reminder failed", { roundId: roundDoc.id, error: err instanceof Error ? err.message.slice(0, 160) : "unknown" });
      }
    }
    await roundDoc.ref.update({ reminderDone: true });
  }
  return sent;
}

export async function runScheduledRounds(deps: RoundDeps): Promise<{ rounds: number; reminders: number }> {
  const now = deps.now().getTime();
  const due = await deps.db.collection("zachHouseholds").where("enabled", "==", true).where("nextRoundAt", "<=", now).limit(500).get();
  let rounds = 0;
  for (const h of due.docs) {
    const settings = { ...defaultSettings(h.id), ...(h.data() as Partial<RoundSettings>) };
    try {
      if (await runRound(deps, h.id, "schedule")) rounds++;
    } catch (err) {
      console.error("[zachRounds] round failed", { ownerUid: h.id, error: err instanceof Error ? err.message.slice(0, 160) : "unknown" });
    }
    await h.ref.set({ lastRoundAt: now, nextRoundAt: now + CADENCE_MS[settings.cadence] }, { merge: true });
  }
  const reminders = await sendDueReminders(deps);
  return { rounds, reminders };
}

// ─── Callables ───────────────────────────────────────────────────────────────

async function householdContext(request: CallableRequest) {
  requireFreshMfa(request);
  const { callerUid, effectiveOwnerUid, role } = await resolveEffectiveOwner(request);
  if (role === "accountant") throw new HttpsError("permission-denied", "Question rounds are for household members.");
  return { callerUid, ownerUid: effectiveOwnerUid, role };
}

export async function getSettingsCore(deps: RoundDeps, ownerUid: string, role: string) {
  const settings = await loadSettings(deps.db, ownerUid);
  const members = await householdMembers(deps.db, ownerUid, deps.emailOf);
  const accts = await deps.db.collection("accounts").where("uid", "==", ownerUid).get();
  return {
    settings,
    canEdit: role === "owner",
    members: members.map((m) => ({ uid: m.uid, role: m.role, email: m.email })),
    accounts: accts.docs.map((d) => {
      const a = d.data();
      const name = [str(a.institutionName), str(a.accountName) || str(a.name)].filter(Boolean).join(" – ");
      return { id: d.id, name: `${name || "Account"}${a.mask ? ` ····${a.mask}` : ""}` };
    }),
  };
}

export async function saveSettingsCore(deps: RoundDeps, ownerUid: string, data: unknown): Promise<RoundSettings> {
  const d = (data ?? {}) as Record<string, unknown>;
  const current = await loadSettings(deps.db, ownerUid);
  const members = await householdMembers(deps.db, ownerUid, deps.emailOf);
  const memberIds = new Set(members.map((m) => m.uid));
  const cadence: Cadence = d.cadence === "weekly" || d.cadence === "monthly" ? d.cadence : d.cadence === "biweekly" ? "biweekly" : current.cadence;
  const enabled = typeof d.enabled === "boolean" ? d.enabled : current.enabled;
  const accountRespondents: Record<string, string> = {};
  if (d.accountRespondents && typeof d.accountRespondents === "object") {
    for (const [acct, uid] of Object.entries(d.accountRespondents as Record<string, unknown>)) {
      if (/^[A-Za-z0-9_-]{1,128}$/.test(acct) && typeof uid === "string" && memberIds.has(uid)) accountRespondents[acct] = uid;
    }
  }
  const defaultRespondent = typeof d.defaultRespondent === "string" && memberIds.has(d.defaultRespondent) ? d.defaultRespondent : ownerUid;
  const now = deps.now().getTime();
  const next: RoundSettings = {
    ...current,
    enabled,
    cadence,
    accountRespondents,
    defaultRespondent,
    // Turning rounds on schedules the first one for the next daily run.
    nextRoundAt: enabled ? (current.enabled && current.nextRoundAt ? current.nextRoundAt : now) : null,
  };
  await deps.db.collection("zachHouseholds").doc(ownerUid).set({ ...next, updatedAt: now }, { merge: false });
  return next;
}

export const getZachRoundSettings = onCall({ cors: true, invoker: "public" }, async (request) => {
  const { ownerUid, role } = await householdContext(request);
  return getSettingsCore(defaultDeps(), ownerUid, role);
});

export const saveZachRoundSettings = onCall({ cors: true, invoker: "public" }, async (request) => {
  const { ownerUid, role } = await householdContext(request);
  if (role !== "owner") throw new HttpsError("permission-denied", "Only the account owner can change question rounds.");
  return saveSettingsCore(defaultDeps(), ownerUid, request.data);
});

export const previewZachRound = onCall({ cors: true, invoker: "public" }, async (request) => {
  const { ownerUid, role } = await householdContext(request);
  if (role !== "owner") throw new HttpsError("permission-denied", "Only the account owner can preview rounds.");
  const { built } = await buildRound(defaultDeps(), ownerUid);
  return built;
});

export const sendZachRoundNow = onCall({ cors: true, invoker: "public", secrets: ["RESEND_API_KEY"] }, async (request) => {
  const { ownerUid, role } = await householdContext(request);
  if (role !== "owner") throw new HttpsError("permission-denied", "Only the account owner can send a round.");
  const deps = defaultDeps();
  const ref = deps.db.collection("zachHouseholds").doc(ownerUid);
  const now = deps.now().getTime();
  await deps.db.runTransaction(async (tx) => {
    const last = Number((await tx.get(ref)).data()?.lastManualAt ?? 0);
    if (now - last < 3_600_000) throw new HttpsError("resource-exhausted", "You can send a round once an hour.");
    tx.set(ref, { lastManualAt: now }, { merge: true });
  });
  const roundId = await runRound(deps, ownerUid, "manual");
  return { sent: roundId !== null };
});

/** Merchant keys Zach routed to the caller in the latest round (last 30 days). */
export const getMyZachRound = onCall({ cors: true, invoker: "public" }, async (request) => {
  const { callerUid, ownerUid } = await householdContext(request);
  return myRoundCore(defaultDeps(), ownerUid, callerUid);
});

export async function myRoundCore(deps: RoundDeps, ownerUid: string, callerUid: string) {
  const since = deps.now().getTime() - 30 * 86_400_000;
  const snap = await deps.db.collection("zachRounds").where("ownerUid", "==", ownerUid).get();
  const latest = snap.docs
    .map((d) => d.data())
    .filter((r) => Number(r.createdAt) >= since && r.respondents?.[callerUid])
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
  const groups = (latest?.respondents?.[callerUid]?.groups ?? []) as RoundGroup[];
  return { keys: groups.map((g) => g.key), createdAt: latest ? Number(latest.createdAt) : null };
}

export const zachRoundScheduler = onSchedule(
  { schedule: "0 9 * * *", timeZone: "America/Chicago", secrets: ["RESEND_API_KEY"] },
  async () => {
    const r = await runScheduledRounds(defaultDeps());
    console.log(JSON.stringify({ event: "zach_rounds", ...r }));
  }
);

// Re-exported for tests.
export { FieldValue };
