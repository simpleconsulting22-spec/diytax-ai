import { describe, it, expect } from "vitest";
import { matchUserRule, UserRule } from "../src/services/categorizationService";

const rule = (vendorName: string, category: string, extra: Partial<UserRule> = {}): UserRule => ({
  vendorName, category, taxSchedule: "Personal", taxCategory: "", ...extra,
});

describe("matchUserRule", () => {
  it("picks the longest matching rule regardless of order", () => {
    const rules = [rule("state", "Taxes & Licenses"), rule("state farm", "Auto Insurance")];
    expect(matchUserRule(rules, "state farm insurance 800-956-6310 il", "")?.category).toBe("Auto Insurance");
    expect(matchUserRule([...rules].reverse(), "state farm insurance 800-956-6310 il", "")?.category).toBe("Auto Insurance");
  });

  it("does not let a short rule match inside a longer word's rule", () => {
    const rules = [rule("national", "Auto Insurance"), rule("citylight international assembly", "Wages & Salaries")];
    expect(matchUserRule(rules, "zelle payment from citylight international assembly, inc.", "")?.category).toBe("Wages & Salaries");
  });

  it("skips rules scoped to the other direction", () => {
    const rules = [rule("citylight international assembly", "Wages & Salaries", { appliesToType: "income" })];
    expect(matchUserRule(rules, "citylight international assembly, inc.", "", "income")?.category).toBe("Wages & Salaries");
    expect(matchUserRule(rules, "zelle money sent to citylight international assembly", "", "expense")).toBeNull();
  });

  it("still prefers an exact vendor match over a longer substring", () => {
    const rules = [rule("costco by instacart", "Groceries"), rule("costco", "Dog Food")];
    expect(matchUserRule(rules, "costco by instacart", "costco")?.category).toBe("Dog Food");
  });

  it("never matches a retired rule", () => {
    const rules = [rule("costco", "Dog Food", { retired: true }), rule("", "Dog Food", { retired: true })];
    expect(matchUserRule(rules, "costco whse #123", "costco")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchUserRule([rule("turno", "Cleaning")], "walgreens #123", "")).toBeNull();
  });
});
