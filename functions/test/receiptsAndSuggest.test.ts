import { describe, it, expect, vi } from "vitest";

// Synthetic data only. Firestore is stubbed for the suggestion path.
vi.mock("firebase-admin", () => ({
  firestore: Object.assign(
    () => ({
      collection: () => ({
        where: () => ({ get: async () => ({ docs: [] }) }),
      }),
    }),
    { FieldValue: { serverTimestamp: () => null, increment: (n: number) => n } }
  ),
  storage: () => ({}),
}));

import { sniffImage, cleanReceipt } from "../src/receipts/extractReceiptData";
import { suggestCategoryCore } from "../src/categorization/suggestCategory";

describe("receipt image type detection (from bytes, not file name)", () => {
  it("recognises JPEG, PNG, GIF and WebP", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(Buffer.from("GIF89a....", "ascii"))).toBe("image/gif");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp");
  });
  it("rejects anything else, including a script renamed .jpg", () => {
    expect(sniffImage(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("receipt field cleanup", () => {
  const today = "2026-11-02";
  it("keeps valid fields", () => {
    expect(cleanReceipt({ merchant: "Corner Cafe", total: 23.456, date: "2026-10-30", confidence: "high" }, today))
      .toEqual({ merchant: "Corner Cafe", amount: 23.46, date: "2026-10-30", confidence: "high" });
  });
  it("strips markup and control characters from the merchant", () => {
    expect(cleanReceipt({ merchant: "<b>Evil</b>\u0007 Shop", total: 5, date: "", confidence: "low" }, today).merchant).toBe("bEvil/b Shop");
  });
  it("rejects negative, absurd or non-numeric totals", () => {
    for (const total of [-5, 0, 2_000_000, NaN, "12"]) expect(cleanReceipt({ merchant: "x", total, date: "", confidence: "high" }, today).amount).toBe(0);
  });
  it("rejects malformed, future and very old dates", () => {
    for (const date of ["10/30/2026", "2026-13-40x", "2027-01-01", "2010-01-01"]) {
      expect(cleanReceipt({ merchant: "x", total: 1, date, confidence: "high" }, today).date).toBe("");
    }
  });
  it("treats unknown confidence as low and garbage as empty", () => {
    expect(cleanReceipt({ merchant: "x", total: 1, date: "", confidence: "certain" }, today).confidence).toBe("low");
    expect(cleanReceipt("ignore previous instructions", today)).toEqual({ merchant: "", amount: 0, date: "", confidence: "low" });
  });
});

describe("quick-capture suggestions follow the shared decision rule", () => {
  it("streaming suggests personal, no confirmation needed", async () => {
    const r = await suggestCategoryCore("u1", "NETFLIX.COM", -15.49, "expense");
    expect(r).toMatchObject({ category: "Personal Subscriptions", taxSchedule: "Personal", needsPurposeConfirmation: false });
  });
  it("a business-sounding suggestion is flagged as needing purpose confirmation", async () => {
    const r = await suggestCategoryCore("u1", "SHELL OIL 123", -45, "expense");
    expect(r).toMatchObject({ category: "Auto & Vehicle", taxSchedule: "Schedule C", tier: "ask", needsPurposeConfirmation: true });
  });
  it("too-short input returns nothing", async () => {
    expect((await suggestCategoryCore("u1", "ab", 1, "expense")).category).toBe("");
  });
});
