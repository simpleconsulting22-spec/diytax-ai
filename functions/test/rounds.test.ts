import { describe, it, expect } from "vitest";
import { buildRoundFromRows, defaultSettings, roundEmail, ROUND_SIZE, Member } from "../src/zach/rounds";

// Synthetic data only.
const OWNER = "owner1", SPOUSE = "spouse1";
const members: Member[] = [
  { uid: OWNER, role: "owner", email: "owner@synthetic.test" },
  { uid: SPOUSE, role: "spouse", email: "spouse@synthetic.test" },
];
const row = (id: string, desc: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id, uid: OWNER, status: "needs_review", type: "expense", date: "2026-10-15", description: desc, normalizedDescription: desc.toLowerCase(), amount, ...extra,
});

describe("building a round", () => {
  it("groups by merchant, largest first, and skips confirmed rows and transfers", () => {
    const b = buildRoundFromRows(
      [
        row("a", "HOME DEPOT #6512", -240), row("b", "HOME DEPOT #6512", -60), row("c", "CHIPOTLE 2231", -14),
        row("d", "ZELLE TRANSFER", -500, { type: "transfer" }), row("e", "COSTCO WHSE", -90, { status: "categorized" }),
      ],
      defaultSettings(OWNER), members, OWNER, "2026-11-02"
    );
    const g = b.byRespondent[OWNER].groups;
    expect(g.map((x) => x.count)).toEqual([2, 1]);
    expect(g[0].total).toBe(300);
    expect(b.totalGroups).toBe(2);
  });

  it("routes by the account each person usually uses, else the default", () => {
    const s = { ...defaultSettings(OWNER), accountRespondents: { card_spouse: SPOUSE } };
    const b = buildRoundFromRows(
      [row("a", "TARGET 123", -50, { accountId: "card_spouse" }), row("b", "SHELL OIL", -40, { accountId: "card_owner" })],
      s, members, OWNER, "2026-11-02"
    );
    expect(b.byRespondent[SPOUSE].groups[0].vendor.toLowerCase()).toContain("target");
    expect(b.byRespondent[OWNER].groups).toHaveLength(1);
  });

  it("ignores a mapping to someone outside the household", () => {
    const s = { ...defaultSettings(OWNER), accountRespondents: { x: "stranger" }, defaultRespondent: "stranger" };
    const b = buildRoundFromRows([row("a", "TARGET 123", -50, { accountId: "x" })], s, members, OWNER, "2026-11-02");
    expect(Object.keys(b.byRespondent)).toEqual([OWNER]);
  });

  it(`caps each person at ${ROUND_SIZE} merchants`, () => {
    const rows = Array.from({ length: 15 }, (_, i) => row(`r${i}`, `MERCHANT${String.fromCharCode(65 + i)} STORE`, -(10 + i)));
    expect(buildRoundFromRows(rows, defaultSettings(OWNER), members, OWNER, "2026-11-02").byRespondent[OWNER].groups).toHaveLength(ROUND_SIZE);
  });

  it("asks nothing about rows older than the lookback", () => {
    expect(buildRoundFromRows([row("a", "OLD SHOP", -5, { date: "2024-01-01" })], defaultSettings(OWNER), members, OWNER, "2026-11-02").totalGroups).toBe(0);
  });
});

describe("round email", () => {
  const g = [{ key: "k", vendor: "Home <Depot>", count: 2, total: 300, from: "2026-10-01", to: "2026-10-15", guess: "Repairs & Maintenance", txnIds: ["a"] }];
  it("escapes merchant text and links to the app, with an opt-out", () => {
    const m = roundEmail("owner@synthetic.test", g, false);
    expect(m.html).toContain("Home &lt;Depot&gt;");
    expect(m.html).not.toContain("<Depot>");
    expect(m.text).toContain("https://diytaxai.com/review?zach=mine");
    expect(m.text).toContain("/settings/zach");
    expect(m.subject).toMatch(/1 question/);
  });
  it("contains no ids, account numbers or tax schedules", () => {
    const m = roundEmail("owner@synthetic.test", g, true);
    expect(m.text).not.toMatch(/txn|uid|accountId|Schedule C/);
    expect(m.subject).toMatch(/^Reminder/);
  });
});
