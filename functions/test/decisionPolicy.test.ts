import { describe, it, expect } from "vitest";
import { decide, riskFlags, appendHistory, HISTORY_LIMIT, AUTO_CONFIRM_CONFIDENCE } from "../src/categorization/decisionPolicy";
import { categorizeTransactionsBatch, CategorizationResult } from "../src/services/categorizationService";

// Synthetic data only.

const r = (over: Partial<CategorizationResult>): CategorizationResult => ({
  category: "Office Supplies",
  taxCategory: "Office Supplies",
  taxSchedule: "Schedule C",
  confidence: 0.9,
  source: "ai",
  categorizationExplanation: "",
  ...over,
});

describe("decision policy: Sure / Likely / Ask", () => {
  it("a user-approved rule is Sure and confirmed", () => {
    expect(decide(r({ source: "user_rule", confidence: 0.95 }), { amount: 40 })).toMatchObject({ status: "categorized", tier: "sure" });
  });

  it("a user rule stays Sure even for a risky merchant (the user decided)", () => {
    const d = decide(r({ source: "user_rule" }), { amount: 300, description: "MARRIOTT CHICAGO" });
    expect(d.tier).toBe("sure");
    expect(d.riskFlags).toContain("lodging");
  });

  it("a built-in keyword rule is Likely, never Sure", () => {
    expect(decide(r({ source: "rule", confidence: 1 }), { amount: 20, description: "GITHUB" })).toMatchObject({ status: "categorized", tier: "likely" });
  });

  it("confident AI with no risk is Likely; below the cut-off it is Ask", () => {
    expect(decide(r({ confidence: AUTO_CONFIRM_CONFIDENCE }), { amount: 20 }).tier).toBe("likely");
    expect(decide(r({ confidence: 0.84 }), { amount: 20 })).toMatchObject({ status: "needs_review", tier: "ask" });
  });

  it("the old 0.80 auto-confirm no longer confirms", () => {
    expect(decide(r({ confidence: 0.8 }), { amount: 20 }).status).toBe("needs_review");
  });

  it("no category, or no source, is Ask", () => {
    expect(decide(r({ category: "" }), { amount: 1 }).tier).toBe("ask");
    expect(decide(r({ source: "none" }), { amount: 1 }).tier).toBe("ask");
  });

  it("risk flags force Ask even for confident AI or keyword hits", () => {
    expect(decide(r({ confidence: 0.9 }), { amount: 200, description: "HILTON GARDEN INN" })).toMatchObject({ tier: "ask", status: "needs_review" });
    expect(decide(r({ category: "Business Meals", confidence: 0.9 }), { amount: 75 }).tier).toBe("ask");
    expect(decide(r({ category: "Charitable Contribution", taxSchedule: "Schedule A", confidence: 0.9 }), { amount: 250 }).tier).toBe("ask");
    expect(decide(r({ source: "rule", confidence: 1 }), { amount: 30, description: "AMAZON MKTPL" }).tier).toBe("ask");
  });
});

describe("risk flags", () => {
  it("meals and travel under $75 are not flagged", () => {
    expect(riskFlags(r({ category: "Business Meals" }), { amount: 74.99 })).toEqual([]);
  });
  it("charity under $250 is not flagged", () => {
    expect(riskFlags(r({ category: "Charitable Contribution", taxSchedule: "Schedule A" }), { amount: 249 })).toEqual([]);
  });
  it("mixed-use and lodging flags apply only to deductible schedules", () => {
    expect(riskFlags(r({ category: "Groceries", taxSchedule: "Personal" }), { amount: 90, description: "COSTCO WHSE" })).toEqual([]);
    expect(riskFlags(r({ taxSchedule: "Personal" }), { amount: 300, description: "MARRIOTT" })).toEqual([]);
  });
});

describe("history", () => {
  it("keeps only the most recent entries", () => {
    const e = (i: number) => ({ at: i, by: "u", source: "user", before: { category: `${i}`, taxCategory: "", taxSchedule: "", status: "" }, after: { category: `${i + 1}`, taxCategory: "", taxSchedule: "", status: "" } });
    let h: ReturnType<typeof appendHistory> = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = appendHistory(h, e(i));
    expect(h).toHaveLength(HISTORY_LIMIT);
    expect(h[0].at).toBe(5);
  });
});

describe("keyword rules", () => {
  const run = async (description: string, type = "expense") =>
    (await categorizeTransactionsBatch([{ idx: 0, txn: { description, normalizedDescription: description.toLowerCase(), amount: 15.49, type } }], [], [])).get(0)!;

  it("Netflix and Spotify are personal subscriptions, not Schedule C", async () => {
    for (const d of ["NETFLIX.COM", "Spotify USA"]) {
      const res = await run(d);
      expect(res.taxSchedule).toBe("Personal");
      expect(res.category).toBe("Personal Subscriptions");
    }
  });

  it("business software still maps to Schedule C, as a Likely guess", async () => {
    const res = await run("ADOBE *CREATIVE CLD");
    expect(res.taxSchedule).toBe("Schedule C");
    expect(decide(res, { amount: 54.99, description: "ADOBE *CREATIVE CLD" }).tier).toBe("likely");
  });

  it("a user rule beats the keyword list", async () => {
    const res = (await categorizeTransactionsBatch(
      [{ idx: 0, txn: { description: "NETFLIX.COM", normalizedDescription: "netflix.com", amount: 15.49, type: "expense" } }],
      [{ vendorName: "netflix", category: "Advertising & Marketing", taxSchedule: "Schedule C", taxCategory: "Advertising & Marketing" }],
      []
    )).get(0)!;
    expect(res.source).toBe("user_rule");
    expect(decide(res, { amount: 15.49 }).tier).toBe("sure");
  });
});
