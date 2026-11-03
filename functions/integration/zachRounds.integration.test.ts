import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { assertEmulatorOnly, callFunction, clearCollection, createUserWithIdToken, db } from "./emulatorHarness";
import { RoundDeps, runRound, runScheduledRounds, sendDueReminders, saveSettingsCore, getSettingsCore, myRoundCore, REMINDER_AFTER_MS } from "../src/zach/rounds";
import type { EmailMessage } from "../src/services/emailService";

// Email rounds against the Firestore emulator. SYNTHETIC household; email is captured, never sent.
const OWNER = "zr_owner", SPOUSE = "zr_spouse", STRANGER = "zr_stranger";
const EMAILS: Record<string, string> = {
  [OWNER]: "zrowner@synthetic.test",
  [SPOUSE]: "zrspouse@synthetic.test",
  [STRANGER]: "zrstranger@synthetic.test",
};
let outbox: EmailMessage[] = [];
let clock = Date.parse("2026-11-02T15:00:00Z");
const deps = (): RoundDeps => ({
  db: db(),
  send: async (m) => {
    outbox.push(m);
  },
  emailOf: async (u) => EMAILS[u] ?? null,
  now: () => new Date(clock),
});

const seed = (id: string, desc: string, amount: number, extra: Record<string, unknown> = {}) =>
  db().collection("transactions").doc(id).set({
    uid: OWNER, taxYear: 2026, date: "2026-10-20", type: "expense", status: "needs_review",
    description: desc, normalizedDescription: desc.toLowerCase(), amount, category: "", ...extra,
  });

beforeAll(async () => {
  assertEmulatorOnly();
  for (const c of ["users", "transactions", "accounts", "zachHouseholds", "zachRounds", "categoryRules"]) await clearCollection(c);
  await db().collection("users").doc(OWNER).set({ sharedUids: [SPOUSE], sharedRoles: { [SPOUSE]: "spouse" } });
  await db().collection("users").doc(SPOUSE).set({ ownerUid: OWNER, role: "spouse" });
  await db().collection("users").doc(STRANGER).set({ ownerUid: OWNER, role: "spouse" }); // forged, never granted
  await db().collection("accounts").doc("zr_card_spouse").set({ uid: OWNER, institutionName: "Synthetic Bank", accountName: "Card", mask: "1111" });
});

beforeEach(async () => {
  outbox = [];
  clock = Date.parse("2026-11-02T15:00:00Z");
  for (const c of ["transactions", "zachHouseholds", "zachRounds"]) await clearCollection(c);
});

describe("settings", () => {
  it("lists the owner and the verified spouse only, never a forged link", async () => {
    const s = await getSettingsCore(deps(), OWNER, "owner");
    expect(s.members.map((m) => m.uid).sort()).toEqual([OWNER, SPOUSE].sort());
    expect(s.settings.enabled).toBe(false);
    expect(s.accounts[0].name).toContain("1111");
  });

  it("drops routing to non-members and schedules the first round when turned on", async () => {
    const saved = await saveSettingsCore(deps(), OWNER, {
      enabled: true, cadence: "weekly",
      accountRespondents: { zr_card_spouse: SPOUSE, other: STRANGER },
      defaultRespondent: STRANGER,
    });
    expect(saved.accountRespondents).toEqual({ zr_card_spouse: SPOUSE });
    expect(saved.defaultRespondent).toBe(OWNER);
    expect(saved.nextRoundAt).toBe(clock);
  });
});

describe("rounds", () => {
  it("emails each person only their questions, and nothing when there is nothing to ask", async () => {
    expect(await runRound(deps(), OWNER, "manual")).toBeNull();
    expect(outbox).toHaveLength(0);

    await saveSettingsCore(deps(), OWNER, { enabled: true, accountRespondents: { zr_card_spouse: SPOUSE } });
    await seed("t1", "TARGET 123", -50, { accountId: "zr_card_spouse" });
    await seed("t2", "HOME DEPOT #6512", -240, { accountId: "zr_card_owner" });
    const id = await runRound(deps(), OWNER, "manual");
    expect(id).toBeTruthy();
    expect(outbox.map((m) => m.to).sort()).toEqual([EMAILS[OWNER], EMAILS[SPOUSE]].sort());
    const spouseMail = outbox.find((m) => m.to === EMAILS[SPOUSE])!;
    expect(spouseMail.text).toMatch(/target/i);
    expect(spouseMail.text).not.toMatch(/home depot/i);
    const mine = await myRoundCore(deps(), OWNER, SPOUSE);
    expect(mine.keys).toHaveLength(1);
    expect(mine.keys[0]).toContain("target");
  });

  it("the scheduler runs due households only and sets the next date", async () => {
    await saveSettingsCore(deps(), OWNER, { enabled: true, cadence: "weekly" });
    await seed("t1", "HOME DEPOT #6512", -240);
    const r = await runScheduledRounds(deps());
    expect(r.rounds).toBe(1);
    const h = (await db().collection("zachHouseholds").doc(OWNER).get()).data()!;
    expect(h.nextRoundAt).toBe(clock + 7 * 86_400_000);
    expect((await runScheduledRounds(deps())).rounds).toBe(0);
  });

  it("sends one reminder after 3 days, only for questions still open", async () => {
    await saveSettingsCore(deps(), OWNER, { enabled: true, accountRespondents: { zr_card_spouse: SPOUSE } });
    await seed("t1", "TARGET 123", -50, { accountId: "zr_card_spouse" });
    await seed("t2", "HOME DEPOT #6512", -240);
    await runRound(deps(), OWNER, "manual");
    await db().collection("transactions").doc("t2").update({ status: "categorized" }); // owner answered
    outbox = [];
    clock += REMINDER_AFTER_MS + 1000;
    await sendDueReminders(deps());
    expect(outbox.map((m) => m.to)).toEqual([EMAILS[SPOUSE]]);
    expect(outbox[0].subject).toMatch(/^Reminder/);
    outbox = [];
    clock += 86_400_000;
    await sendDueReminders(deps());
    expect(outbox.filter((m) => m.subject.startsWith("Reminder"))).toHaveLength(0);
  });

  it("send-now pushes the next scheduled round out, so nobody gets two in a day", async () => {
    await saveSettingsCore(deps(), OWNER, { enabled: true, cadence: "biweekly" });
    await seed("t1", "HOME DEPOT #6512", -240);
    await runRound(deps(), OWNER, "manual");
    outbox = [];
    await runScheduledRounds(deps());
    expect(outbox).toHaveLength(0);
    const h = (await db().collection("zachHouseholds").doc(OWNER).get()).data()!;
    expect(h.nextRoundAt).toBe(clock + 14 * 86_400_000);
  });
});

describe("answering", () => {
  it("a verified spouse can answer the owner's question; a forged link cannot", async () => {
    await seed("t9", "TARGET 123", -50);
    const spouseToken = await createUserWithIdToken(SPOUSE, EMAILS[SPOUSE], { mfaVerifiedAt: Date.now() });
    const strangerToken = await createUserWithIdToken(STRANGER, EMAILS[STRANGER], { mfaVerifiedAt: Date.now() });
    const bad = await callFunction("updateTransactionCategory", { transactionId: "t9", category: "Groceries" }, strangerToken);
    expect(bad.ok).toBe(false);
    const ok = await callFunction("updateTransactionCategory", { transactionId: "t9", category: "Groceries", taxSchedule: "Personal" }, spouseToken);
    expect(ok.ok).toBe(true);
    const t = (await db().collection("transactions").doc("t9").get()).data()!;
    expect(t).toMatchObject({ category: "Groceries", status: "categorized", updatedBy: SPOUSE });
    expect(t.history[0].by).toBe(SPOUSE);
  });
});
