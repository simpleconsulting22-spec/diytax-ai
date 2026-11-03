import { describe, it, expect, beforeAll } from "vitest";
import { assertEmulatorOnly, callFunction, clearCollection, createUserWithIdToken, db } from "./emulatorHarness";
import { undoCategoryChangeCore } from "../src/categorization/undoCategoryChange";
import { ingestTransactionsCore } from "../src/ingestion/ingestTransactions";

// M0 classification fixes against the emulators, synthetic data only.

const OWNER = { uid: "m0_owner", email: "m0owner@synthetic.test" };
const OTHER = { uid: "m0_other", email: "m0other@synthetic.test" };
let token: string;
let noMfaToken: string;

const seedTxn = (id: string, over: Record<string, unknown> = {}) =>
  db().collection("transactions").doc(id).set({
    uid: OWNER.uid, taxYear: 2026, date: "2026-03-01", type: "expense", status: "needs_review",
    description: "ACME OFFICE SUPPLY 123", normalizedDescription: "acme office supply 123", vendor: "acme office supply",
    amount: 42, category: "", taxCategory: "", taxSchedule: "", ...over,
  });

const rulesFor = async (uid: string) =>
  (await db().collection("categoryRules").where("uid", "==", uid).get()).docs.map((d) => d.data());

beforeAll(async () => {
  assertEmulatorOnly();
  for (const c of ["transactions", "categoryRules", "users", "accounts", "imports", "entities"]) await clearCollection(c);
  token = await createUserWithIdToken(OWNER.uid, OWNER.email, { mfaVerifiedAt: Date.now() });
  noMfaToken = await createUserWithIdToken(OTHER.uid, OTHER.email);
  await db().collection("users").doc(OWNER.uid).set({ email: OWNER.email });
});

describe("manual edits are one-time unless the user asks for a rule", () => {
  it("changes the transaction and writes no rule by default", async () => {
    await seedTxn("m0_t1");
    const r = await callFunction("updateTransactionCategory", { transactionId: "m0_t1", category: "Office Supplies", taxSchedule: "Schedule C" }, token);
    expect(r.ok).toBe(true);
    expect(r.result!.ruleSaved).toBe(false);
    const t = (await db().collection("transactions").doc("m0_t1").get()).data()!;
    expect(t).toMatchObject({ category: "Office Supplies", status: "categorized", zachTier: "sure", isUserModified: true });
    expect(t.history).toHaveLength(1);
    expect(t.history[0].before.status).toBe("needs_review");
    expect(await rulesFor(OWNER.uid)).toHaveLength(0);
  });

  it("writes a rule only with createRule", async () => {
    await seedTxn("m0_t2");
    const r = await callFunction("updateTransactionCategory", { transactionId: "m0_t2", category: "Office Supplies", createRule: true }, token);
    expect(r.result!.ruleSaved).toBe(true);
    expect(await rulesFor(OWNER.uid)).toHaveLength(1);
  });

  it("requires a fresh MFA claim", async () => {
    const r = await callFunction("updateTransactionCategory", { transactionId: "m0_t1", category: "Groceries" }, noMfaToken);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("PERMISSION_DENIED");
  });
});

describe("undo", () => {
  it("restores the previous values and pops the history", async () => {
    await seedTxn("m0_t3");
    await callFunction("updateTransactionCategory", { transactionId: "m0_t3", category: "Groceries", taxSchedule: "Personal" }, token);
    const res = await undoCategoryChangeCore(db(), OWNER.uid, OWNER.uid, "m0_t3");
    expect(res.undone).toBe(true);
    const t = (await db().collection("transactions").doc("m0_t3").get()).data()!;
    expect(t).toMatchObject({ category: "", status: "needs_review", isUserModified: false });
    expect(t.history).toHaveLength(0);
    expect((await undoCategoryChangeCore(db(), OWNER.uid, OWNER.uid, "m0_t3")).undone).toBe(false);
  });

  it("cannot touch another household's transaction", async () => {
    await seedTxn("m0_t4");
    await expect(undoCategoryChangeCore(db(), OTHER.uid, OTHER.uid, "m0_t4")).rejects.toThrow(/not found/i);
  });
});

describe("ingest uses the shared categorizer and decision policy", () => {
  it("applies user rules as Sure and streaming as personal, never Schedule C", async () => {
    await db().collection("accounts").doc("m0_acct").set({ uid: OWNER.uid, institutionName: "Synthetic Bank" });
    await db().collection("categoryRules").add({ uid: OWNER.uid, vendorName: "acme office supply", category: "Office Supplies", taxCategory: "Office Supplies", taxSchedule: "Schedule C" });
    const report = await ingestTransactionsCore(OWNER.uid, {
      source: "csv",
      accountId: "m0_acct",
      transactions: [
        { date: "2026-04-02", description: "ACME OFFICE SUPPLY 456", amount: -60 },
        { date: "2026-04-03", description: "NETFLIX.COM", amount: -15.49 },
      ],
    } as never);
    expect(report.imported).toBe(2);
    const rows = (await db().collection("transactions").where("importId", "==", report.importId).get()).docs.map((d) => d.data());
    const acme = rows.find((t) => String(t.description).startsWith("ACME"))!;
    const netflix = rows.find((t) => String(t.description).startsWith("NETFLIX"))!;
    expect(acme).toMatchObject({ category: "Office Supplies", status: "categorized", zachTier: "sure" });
    expect(netflix.categorizationExplanation).toMatch(/business purpose/);
    expect(netflix).toMatchObject({ category: "Personal Subscriptions", taxSchedule: "Personal", zachTier: "likely" });
    expect(netflix.taxSchedule).not.toBe("Schedule C");
    expect(acme.history).toHaveLength(1);
  });
});

describe("undo reverses only the intended operation", () => {
  it("refuses when the row changed after the recorded edit", async () => {
    await seedTxn("m0_t5");
    await callFunction("updateTransactionCategory", { transactionId: "m0_t5", category: "Groceries", taxSchedule: "Personal" }, token);
    // A later change made outside the recorded history (e.g. an import fix).
    await db().collection("transactions").doc("m0_t5").update({ category: "Dining & Restaurants" });
    await expect(undoCategoryChangeCore(db(), OWNER.uid, OWNER.uid, "m0_t5")).rejects.toThrow(/changed since/);
    const t = (await db().collection("transactions").doc("m0_t5").get()).data()!;
    expect(t.category).toBe("Dining & Restaurants");
    expect(t.history).toHaveLength(1);
  });

  it("undoes two edits one at a time, newest first", async () => {
    await seedTxn("m0_t6");
    await callFunction("updateTransactionCategory", { transactionId: "m0_t6", category: "Groceries", taxSchedule: "Personal" }, token);
    await callFunction("updateTransactionCategory", { transactionId: "m0_t6", category: "Office Supplies", taxSchedule: "Schedule C" }, token);
    await undoCategoryChangeCore(db(), OWNER.uid, OWNER.uid, "m0_t6");
    let t = (await db().collection("transactions").doc("m0_t6").get()).data()!;
    expect(t).toMatchObject({ category: "Groceries", taxSchedule: "Personal", status: "categorized", isUserModified: true });
    await undoCategoryChangeCore(db(), OWNER.uid, OWNER.uid, "m0_t6");
    t = (await db().collection("transactions").doc("m0_t6").get()).data()!;
    expect(t).toMatchObject({ category: "", status: "needs_review", isUserModified: false });
  });
});
