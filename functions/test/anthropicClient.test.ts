import { describe, it, expect, afterEach } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  CANONICAL_CATEGORIES,
  CATEGORIZATION_MODEL,
  RECEIPT_MODEL,
  describeAnthropicError,
  firstText,
  getAnthropic,
} from "../src/services/anthropicClient";
import { isValidCategory, scheduleForCategory, TAX_MAP } from "../src/shared/taxMap";

// ─── Why this file exists ─────────────────────────────────────────────────────
//
// CANONICAL_CATEGORIES is injected into the JSON schema as an `enum`, which the
// API enforces. That makes it load-bearing in a way a plain constant is not: if
// a TAX_MAP refactor empties it, renames a category, or lets a non-routable
// value in, structured outputs would reject or mis-shape EVERY categorization
// response at runtime — with a clean typecheck and a clean build. There is no
// compiler error to catch it, so it is caught here.

describe("CANONICAL_CATEGORIES — the structured-output enum", () => {
  it("is non-empty", () => {
    // An empty enum is not a no-op: it makes every response unsatisfiable.
    expect(CANONICAL_CATEGORIES.length).toBeGreaterThan(0);
  });

  it("contains no duplicates", () => {
    expect(new Set(CANONICAL_CATEGORIES).size).toBe(CANONICAL_CATEGORIES.length);
  });

  it("contains only categories TAX_MAP recognizes", () => {
    const unroutable = CANONICAL_CATEGORIES.filter((c) => !isValidCategory(c));
    expect(unroutable).toEqual([]);
  });

  it("gives every category a tax schedule, so no accepted answer is unroutable", () => {
    const scheduleless = CANONICAL_CATEGORIES.filter((c) => !scheduleForCategory(c));
    expect(scheduleless).toEqual([]);
  });

  it("covers every category in TAX_MAP — the model can reach the whole map", () => {
    const missing = TAX_MAP.map((m) => m.category).filter(
      (c) => !CANONICAL_CATEGORIES.includes(c)
    );
    expect(missing).toEqual([]);
  });

  it("has no leading/trailing whitespace that would break exact enum matching", () => {
    const untrimmed = CANONICAL_CATEGORIES.filter((c) => c !== c.trim());
    expect(untrimmed).toEqual([]);
  });
});

describe("model selection", () => {
  it("uses a Haiku model for high-volume categorization", () => {
    expect(CATEGORIZATION_MODEL).toBe("claude-haiku-4-5");
  });

  it("uses a higher tier for receipt OCR, where a misread total becomes a wrong deduction", () => {
    expect(RECEIPT_MODEL).toBe("claude-sonnet-5");
  });

  it("pins bare model aliases, never date-suffixed variants", () => {
    for (const model of [CATEGORIZATION_MODEL, RECEIPT_MODEL]) {
      expect(model).not.toMatch(/-\d{8}$/);
    }
  });
});

describe("getAnthropic", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it("returns null when the key is unset, so callers degrade instead of throwing", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(getAnthropic()).toBeNull();
  });

  it("returns null when the key is whitespace only", () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    expect(getAnthropic()).toBeNull();
  });

  it("returns a client when the key is present", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
    expect(getAnthropic()).not.toBeNull();
  });
});

describe("firstText", () => {
  const msg = (content: unknown[]) => ({ content } as unknown as Anthropic.Message);

  it("returns the first text block", () => {
    expect(firstText(msg([{ type: "text", text: '{"a":1}' }]))).toBe('{"a":1}');
  });

  it("skips non-text blocks rather than returning empty", () => {
    expect(
      firstText(msg([{ type: "thinking", thinking: "..." }, { type: "text", text: "ok" }]))
    ).toBe("ok");
  });

  it("returns empty string when there is no text block", () => {
    // Callers pair this with `|| "{}"`, so an empty return must not be undefined.
    expect(firstText(msg([]))).toBe("");
  });
});

describe("describeAnthropicError", () => {
  it("stringifies a plain Error", () => {
    expect(describeAnthropicError(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error throw", () => {
    expect(describeAnthropicError("kaboom")).toBe("kaboom");
  });
});
