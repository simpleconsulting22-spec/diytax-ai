import { describe, it, expect } from "vitest";
import { AI_RESPONSE_SCHEMA, aiProvider, maskDigits } from "../src/services/aiCategorizer";
import { TAX_MAP } from "../src/shared/taxMap";
import { MAX_AI_ROWS_PER_RUN } from "../src/services/categorizationService";

describe("AI categorizer", () => {
  it("prefers Anthropic, falls back to OpenAI, else none", () => {
    expect(aiProvider({ ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" } as never)).toBe("anthropic");
    expect(aiProvider({ OPENAI_API_KEY: "y" } as never)).toBe("openai");
    expect(aiProvider({ ANTHROPIC_API_KEY: "  " } as never)).toBe("none");
  });
  it("masks account and card numbers before anything is sent", () => {
    expect(maskDigits("ZELLE TO 1234567890 REF 4111111111111111")).toBe("ZELLE TO # REF #");
    expect(maskDigits("STARBUCKS #1234")).toBe("STARBUCKS #1234");
  });
  it("the model can only return the app's own categories", () => {
    const allowed = AI_RESPONSE_SCHEMA.properties.results.items.properties.category.enum;
    expect(new Set(allowed)).toEqual(new Set(TAX_MAP.map((m) => m.category)));
  });
  it("caps AI rows per run", () => {
    expect(MAX_AI_ROWS_PER_RUN).toBe(2000);
  });
});
