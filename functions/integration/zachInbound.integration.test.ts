import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { assertEmulatorOnly, clearCollection, db } from "./emulatorHarness";
import { RoundDeps, runRound, saveSettingsCore } from "../src/zach/rounds";
import { InboundDeps, processInbound, Answer, ReceivedEmail, ReceivedAttachment } from "../src/zach/inbound";
import { undoCategoryChangeCore } from "../src/categorization/undoCategoryChange";
import type { EmailMessage } from "../src/services/emailService";

// Email replies against the Firestore emulator. SYNTHETIC household; nothing
// leaves the machine (email, Resend, Claude and Storage are all fakes).
const OWNER = "zi_owner", SPOUSE = "zi_spouse";
const EMAILS: Record<string, string> = { [OWNER]: "ziowner@synthetic.test", [SPOUSE]: "zispouse@synthetic.test" };
const PASS = { spf: "pass", dkim: "pass", dmarc: "pass" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

let outbox: EmailMessage[] = [];
let clock = Date.parse("2026-11-02T15:00:00Z");
let emailFixture: ReceivedEmail;
let attachments: ReceivedAttachment[] = [];
let answers: Answer[] = [];
let receiptRead = { merchant: "", amount: 0, date: "", confidence: "low" as const };
const stored: string[] = [];

const roundDeps = (): RoundDeps => ({
  db: db(),
  send: async (m) => void outbox.push(m),
  emailOf: async (u) => EMAILS[u] ?? null,
  now: () => new Date(clock),
  inboundEnabled: async () => true,
});
const inDeps = (): InboundDeps => ({
  db: db(),
  now: () => new Date(clock),
  getEmail: async () => emailFixture,
  listAttachments: async () => attachments,
  download: async () => JPEG,
  interpret: async () => answers,
  readReceipt: async () => ({ ...receiptRead }),
  storeReceipt: async (path) => {
    stored.push(path);
    return `https://storage.synthetic.test/${path}`;
  },
  send: async (m) => void outbox.push(m),
  emailOf: async (u) => EMAILS[u] ?? null,
});

const seed = (id: string, desc: string, amount: number, extra: Record<string, unknown> = {}) =>
  db().collection("transactions").doc(id).set({
    uid: OWNER, taxYear: 2026, date: "2026-10-20", type: "expense", status: "needs_review",
    description: desc, normalizedDescription: desc.toLowerCase(), amount, category: "", ...extra,
  });

let n = 0;
const event = (to: string) => ({ type: "email.received", data: { email_id: `em-${++n}-synthetic`, to: [to], from: emailFixture.from, attachments: [] } });

/** Send a round with replies on; return the Reply-To each person got. */
async function roundReplyTo(): Promise<Record<string, string>> {
  await runRound(roundDeps(), OWNER, "manual");
  const out: Record<string, string> = {};
  for (const m of outbox) out[m.to] = m.replyTo!;
  outbox = [];
  return out;
}

beforeAll(async () => {
  assertEmulatorOnly();
  for (const c of ["users", "accounts"]) await clearCollection(c);
  await db().collection("users").doc(OWNER).set({ sharedUids: [SPOUSE], sharedRoles: { [SPOUSE]: "spouse" } });
  await db().collection("users").doc(SPOUSE).set({ ownerUid: OWNER, role: "spouse" });
});

beforeEach(async () => {
  outbox = [];
  attachments = [];
  answers = [];
  stored.length = 0;
  receiptRead = { merchant: "", amount: 0, date: "", confidence: "low" };
  clock = Date.parse("2026-11-02T15:00:00Z");
  emailFixture = { from: `Spouse <${EMAILS[SPOUSE]}>`, text: "Home Depot was for the rental. Target was personal.", html: null, authentication: PASS };
  for (const c of ["transactions", "zachHouseholds", "zachRounds", "zachReplyTokens", "zachInbound", "zachReceiptInbox", "zachUsage"]) await clearCollection(c);
  await saveSettingsCore(roundDeps(), OWNER, { enabled: true, defaultRespondent: SPOUSE });
});

describe("answering by reply", () => {
  it("round emails carry a private Reply-To per person", async () => {
    await seed("t1", "TARGET 123", -50);
    const r = await roundReplyTo();
    expect(r[EMAILS[SPOUSE]]).toMatch(/^zach\+[a-f0-9]{40}@reply\.diytaxai\.com$/);
    const tokens = await db().collection("zachReplyTokens").get();
    expect(tokens.size).toBe(1);
    // Only the hash is stored.
    expect(tokens.docs[0].id).not.toContain(r[EMAILS[SPOUSE]].slice(5, 45));
  });

  it("saves personal answers, stages deductible ones for one-tap confirmation, and can be undone", async () => {
    await seed("t1", "HOME DEPOT #6512", -240);
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    answers = [
      { index: 0, category: "Repairs & Maintenance", quote: "home depot was for the rental" },
      { index: 1, category: "Other Personal", quote: "target was personal" },
    ];
    const res = await processInbound(inDeps(), event(r[EMAILS[SPOUSE]]), true);
    expect(res).toMatchObject({ status: "processed", answers: 2 });

    const depot = (await db().collection("transactions").doc("t1").get()).data()!;
    const target = (await db().collection("transactions").doc("t2").get()).data()!;
    expect(target).toMatchObject({ category: "Other Personal", status: "categorized", zachTier: "sure", updatedBy: SPOUSE });
    // Deductible: category recorded, but not confirmed.
    expect(depot.category).toBe("Repairs & Maintenance");
    expect(depot.status).toBe("needs_review");
    expect(depot.reviewTriggers).toEqual(["email_answer_confirm"]);
    expect(depot.history.at(-1)).toMatchObject({ by: SPOUSE, source: "email_reply" });

    // Summary goes back to the person, with a fresh Reply-To.
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(EMAILS[SPOUSE]);
    expect(outbox[0].text).toMatch(/Saved:\n- Target/i);
    expect(outbox[0].text).toMatch(/One tap to confirm/);
    expect(outbox[0].replyTo).toMatch(/^zach\+/);

    // Undo reverses exactly the email answer.
    await undoCategoryChangeCore(db(), OWNER, OWNER, "t2");
    const undone = (await db().collection("transactions").doc("t2").get()).data()!;
    expect(undone).toMatchObject({ category: "", status: "needs_review" });
  });

  it("processes each email once", async () => {
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    answers = [{ index: 0, category: "Other Personal", quote: "target was personal" }];
    const e = event(r[EMAILS[SPOUSE]]);
    expect((await processInbound(inDeps(), e, true)).status).toBe("processed");
    expect(await processInbound(inDeps(), e, true)).toMatchObject({ status: "duplicate" });
  });

  it("ignores spoofed senders, failed authentication, unknown tokens and replies when off — silently", async () => {
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    answers = [{ index: 0, category: "Other Personal", quote: "target was personal" }];
    const to = r[EMAILS[SPOUSE]];

    emailFixture = { ...emailFixture, from: "attacker@evil.test" };
    expect(await processInbound(inDeps(), event(to), true)).toMatchObject({ status: "ignored", reason: "sender_mismatch" });
    emailFixture = { ...emailFixture, from: EMAILS[SPOUSE], authentication: { spf: "fail", dkim: "fail", dmarc: "fail" } };
    expect(await processInbound(inDeps(), event(to), true)).toMatchObject({ status: "ignored", reason: "auth_failed" });
    emailFixture = { ...emailFixture, authentication: { spf: "pass", dkim: "pass", dmarc: "fail" } };
    expect(await processInbound(inDeps(), event(to), true)).toMatchObject({ status: "ignored", reason: "auth_failed" });
    emailFixture = { ...emailFixture, authentication: PASS };
    expect(await processInbound(inDeps(), event(`zach+${"0".repeat(40)}@reply.diytaxai.com`), true)).toMatchObject({ reason: "bad_token" });
    expect(await processInbound(inDeps(), event(to), false)).toMatchObject({ reason: "inbound_off" });
    // The owner can't use the spouse's address either.
    emailFixture = { ...emailFixture, from: EMAILS[OWNER] };
    expect(await processInbound(inDeps(), event(to), true)).toMatchObject({ reason: "sender_mismatch" });

    expect(outbox).toHaveLength(0);
    expect((await db().collection("transactions").doc("t2").get()).data()!.status).toBe("needs_review");
  });

  it("an expired token does nothing; a removed spouse can no longer answer", async () => {
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    answers = [{ index: 0, category: "Other Personal", quote: "target was personal" }];
    clock += 31 * 86_400_000;
    expect(await processInbound(inDeps(), event(r[EMAILS[SPOUSE]]), true)).toMatchObject({ reason: "bad_token" });

    clock = Date.parse("2026-11-02T15:00:00Z");
    const r2 = await roundReplyTo();
    await db().collection("users").doc(OWNER).set({ sharedUids: [], sharedRoles: {} });
    expect(await processInbound(inDeps(), event(r2[EMAILS[SPOUSE]]), true)).toMatchObject({ reason: "not_member" });
    await db().collection("users").doc(OWNER).set({ sharedUids: [SPOUSE], sharedRoles: { [SPOUSE]: "spouse" } });
  });

  it("answers only this person's questions, and never a transaction answered meanwhile", async () => {
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    await db().collection("transactions").doc("t2").update({ status: "categorized", category: "Groceries" });
    answers = [{ index: 0, category: "Other Personal", quote: "target was personal" }];
    await processInbound(inDeps(), event(r[EMAILS[SPOUSE]]), true);
    expect((await db().collection("transactions").doc("t2").get()).data()!.category).toBe("Groceries");
  });
});

describe("receipts by reply", () => {
  it("attaches a receipt to the one matching question without changing its category", async () => {
    await seed("t1", "HOME DEPOT #6512", -240.5);
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    attachments = [
      { id: "a1", filename: "receipt.jpg", size: 200_000, content_type: "image/jpeg", content_disposition: "attachment", download_url: "https://x.test/a1" },
      { id: "a2", filename: "logo.png", size: 3_000, content_type: "image/png", content_disposition: "inline", download_url: "https://x.test/a2" },
      { id: "a3", filename: "notes.pdf", size: 9_000, content_type: "application/pdf", content_disposition: "attachment", download_url: "https://x.test/a3" },
    ];
    receiptRead = { merchant: "Home Depot", amount: 240.5, date: "2026-10-20", confidence: "high" };
    emailFixture = { ...emailFixture, text: "receipt attached" };
    const res = await processInbound(inDeps(), event(r[EMAILS[SPOUSE]]), true);
    expect(res).toMatchObject({ status: "processed", receipts: 1 });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(new RegExp(`^receipts/${OWNER}/email/em-\\d+-synthetic/1\\.jpg$`));
    const t1 = (await db().collection("transactions").doc("t1").get()).data()!;
    expect(t1).toMatchObject({ receiptStoragePath: stored[0], receiptSource: "email", status: "needs_review", category: "" });
    expect(outbox[0].text).toMatch(/Receipts attached:\n- receipt.jpg → HOME DEPOT/i);
  });

  it("keeps an unmatched receipt in the inbox instead of guessing", async () => {
    await seed("t2", "TARGET 123", -50);
    const r = await roundReplyTo();
    attachments = [{ id: "a1", filename: "r.jpg", size: 100_000, content_type: "image/jpeg", content_disposition: "attachment", download_url: "https://x.test/a1" }];
    receiptRead = { merchant: "Shell", amount: 61.2, date: "2026-10-20", confidence: "high" };
    await processInbound(inDeps(), event(r[EMAILS[SPOUSE]]), true);
    expect((await db().collection("transactions").doc("t2").get()).data()!.receiptStoragePath).toBeUndefined();
    const inbox = await db().collection("zachReceiptInbox").get();
    expect(inbox.size).toBe(1);
    expect(inbox.docs[0].data()).toMatchObject({ ownerUid: OWNER, by: SPOUSE });
  });
});
