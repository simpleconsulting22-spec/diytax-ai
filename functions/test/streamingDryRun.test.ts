import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { analyzeStreaming, safeMerchant } from "../src/maintenance/streamingDryRun";

// Synthetic rows only.
const row = (o: Record<string, unknown>) => ({ type: "expense", status: "categorized", ...o });

describe("streaming dry run analysis", () => {
  const rows = [
    row({ date: "2026-01-05", description: "NETFLIX.COM 8665797172", amount: -15.49, category: "Software & Subscriptions", taxSchedule: "Schedule C" }),
    row({ date: "2026-02-05", description: "SPOTIFY USA", amount: -11.99, category: "Software & Subscriptions", taxSchedule: "Schedule C", isUserModified: true }),
    row({ date: "2026-03-05", description: "HULU 123456", amount: -7.99, category: "Personal Subscriptions", taxSchedule: "Personal" }),
    row({ date: "2026-03-09", description: "ADOBE", amount: -54.99, category: "Software & Subscriptions", taxSchedule: "Schedule C" }),
  ];
  const r = analyzeStreaming(rows);

  it("proposes moving only automatic Schedule C streaming charges", () => {
    expect(r.streamingCharges).toBe(3);
    expect(r.proposedMoves).toBe(1);
    expect(r.proposedMoveTotal).toBe(15.49);
  });
  it("never proposes changing a charge the user set", () => {
    expect(r.lines.find((l) => l.merchant.startsWith("SPOTIFY"))!.proposal).toBe("leave as is");
  });
  it("computes Schedule C before and after", () => {
    expect(r.scheduleCExpensesNow).toBe(82.47);
    expect(r.scheduleCExpensesIfMoved).toBe(66.98);
  });
  it("masks long digit runs in merchant text", () => {
    expect(safeMerchant("NETFLIX.COM 8665797172")).toBe("NETFLIX.COM ####");
  });
});

describe("dry-run script is read-only", () => {
  const src = readFileSync(join(__dirname, "..", "scripts", "dry-run-streaming-schedule-c.js"), "utf8");
  it("blocks every Firestore write entry point before running", () => {
    for (const m of ['"set", "update", "delete", "create"]) DocumentReference', 'WriteBatch.prototype', '"batch", "bulkWriter", "runTransaction"']) {
      expect(src).toContain(m);
    }
  });
  it("makes no write calls itself", () => {
    const body = src.slice(src.indexOf("(async () => {"));
    expect(body).not.toMatch(/\.(set|update|delete|add|create|commit)\(/);
  });
  it("prints no uid or document id", () => {
    expect(src).not.toMatch(/console\.log\([^)]*(uid|\.id\b)/);
  });
});
