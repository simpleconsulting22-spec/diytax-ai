import { describe, it, expect } from "vitest";
import {
  decide,
  reviewTriggers,
  appendHistory,
  HISTORY_LIMIT,
  AUTO_CONFIRM_CONFIDENCE,
  REVIEW_TRIGGER_MEALS_TRAVEL_USD,
  REVIEW_TRIGGER_CHARITY_USD,
} from "../src/categorization/decisionPolicy";
import { categorizeTransactionsBatch, CategorizationResult } from "../src/services/categorizationService";

// Synthetic data only.

const r = (over: Partial<CategorizationResult>): CategorizationResult => ({
  category: "Groceries",
  taxCategory: "Groceries",
  taxSchedule: "Personal",
  confidence: 0.9,
  source: "ai",
  categorizationExplanation: "",
  ...over,
});
const biz = (over: Partial<CategorizationResult> = {}) =>
  r({ category: "Office Supplies", taxCategory: "Office Supplies", taxSchedule: "Schedule C", ...over });

describe("decision policy: Sure / Likely / Ask", () => {
  it("a user-approved rule is Sure and confirmed, even on a deductible schedule", () => {
    expect(decide(biz({ source: "user_rule", confidence: 0.95 }), { amount: 40, type: "expense" })).toMatchObject({ status: "categorized", tier: "sure" });
  });

  it("a user rule stays Sure even when a review trigger fires (the user decided)", () => {
    const d = decide(biz({ source: "user_rule" }), { amount: 300, type: "expense", description: "MARRIOTT CHICAGO" });
    expect(d.tier).toBe("sure");
    expect(d.reviewTriggers).toContain("lodging");
  });

  it("an automatic guess never confirms a deductible expense", () => {
    for (const schedule of ["Schedule C", "Schedule E", "Schedule A"]) {
      for (const source of ["rule", "ai"] as const) {
        const d = decide(biz({ taxSchedule: schedule, source, confidence: 1 }), { amount: 20, type: "expense" });
        expect(d).toMatchObject({ status: "needs_review", tier: "ask" });
        expect(d.reviewTriggers).toContain("needs_purpose_confirmation");
      }
    }
  });

  it("confident non-deductible guesses (personal, income) can be Likely", () => {
    expect(decide(r({ confidence: AUTO_CONFIRM_CONFIDENCE }), { amount: 20, type: "expense" }).tier).toBe("likely");
    expect(decide(r({ source: "rule", confidence: 1, category: "Wages & Salaries", taxSchedule: "Form 1040" }), { amount: 3000, type: "income" }).tier).toBe("likely");
    expect(decide(r({ category: "Business Income", taxSchedule: "Schedule C", confidence: 0.9 }), { amount: 500, type: "income" }).tier).toBe("likely");
  });

  it("below the confidence cut-off is Ask; the old 0.80 auto-confirm is gone", () => {
    expect(decide(r({ confidence: 0.84 }), { amount: 20 })).toMatchObject({ status: "needs_review", tier: "ask" });
    expect(decide(r({ confidence: 0.8 }), { amount: 20 }).status).toBe("needs_review");
  });

  it("no category, or no source, is Ask", () => {
    expect(decide(r({ category: "" }), { amount: 1 }).tier).toBe("ask");
    expect(decide(r({ source: "none" }), { amount: 1 }).tier).toBe("ask");
  });
});

describe("review triggers are prompts to look, not tax rules", () => {
  it("thresholds are the documented internal values", () => {
    expect(REVIEW_TRIGGER_MEALS_TRAVEL_USD).toBe(75);
    expect(REVIEW_TRIGGER_CHARITY_USD).toBe(250);
  });
  it("fire at the thresholds and not below", () => {
    expect(reviewTriggers(biz({ category: "Business Meals" }), { amount: 75 })).toContain("meals_travel_75");
    expect(reviewTriggers(biz({ category: "Business Meals" }), { amount: 74.99 })).toEqual([]);
    expect(reviewTriggers(r({ category: "Charitable Contribution", taxSchedule: "Schedule A" }), { amount: 250 })).toContain("charity_250");
    expect(reviewTriggers(r({ category: "Charitable Contribution", taxSchedule: "Schedule A" }), { amount: 249 })).toEqual([]);
  });
  it("lodging and mixed-use triggers apply only to deductible schedules", () => {
    expect(reviewTriggers(r({ taxSchedule: "Personal" }), { amount: 90, description: "COSTCO WHSE" })).toEqual([]);
    expect(reviewTriggers(r({ taxSchedule: "Personal" }), { amount: 300, description: "MARRIOTT" })).toEqual([]);
    expect(reviewTriggers(biz(), { amount: 30, description: "AMAZON MKTPL" })).toContain("mixed_use_merchant");
  });
  it("a trigger on a personal item still lets a confident guess through as Likely", () => {
    expect(decide(r({ category: "Dining & Restaurants" }), { amount: 120, type: "expense" }).tier).toBe("likely");
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

  it("streaming defaults to personal, with an explanation inviting a business change", async () => {
    for (const d of ["NETFLIX.COM", "Spotify USA"]) {
      const res = await run(d);
      expect(res).toMatchObject({ category: "Personal Subscriptions", taxSchedule: "Personal" });
      expect(res.categorizationExplanation).toMatch(/business purpose/);
      expect(decide(res, { amount: 15.49, type: "expense" }).tier).toBe("likely");
    }
  });

  it("business-sounding keywords suggest Schedule C but wait for confirmation", async () => {
    for (const d of ["ADOBE *CREATIVE CLD", "SHELL OIL 123", "UBER TRIP"]) {
      const res = await run(d);
      expect(res.taxSchedule).toBe("Schedule C");
      expect(decide(res, { amount: 25, type: "expense", description: d })).toMatchObject({ status: "needs_review", tier: "ask" });
    }
  });

  it("a user rule beats the keyword list and makes a business streaming charge Sure", async () => {
    const res = (await categorizeTransactionsBatch(
      [{ idx: 0, txn: { description: "NETFLIX.COM", normalizedDescription: "netflix.com", amount: 15.49, type: "expense" } }],
      [{ vendorName: "netflix", category: "Advertising & Marketing", taxSchedule: "Schedule C", taxCategory: "Advertising & Marketing" }],
      []
    )).get(0)!;
    expect(res.source).toBe("user_rule");
    expect(decide(res, { amount: 15.49, type: "expense" }).tier).toBe("sure");
  });
});
