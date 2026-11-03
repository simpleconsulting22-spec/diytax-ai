import { describe, it, expect } from "vitest";
import { requireFreshMfa, MFA_FRESHNESS_MS } from "../src/middleware/auth";
import {
  dollarFigures,
  figuresAreGrounded,
  isSupportedTaxYear,
  parseModelAnswer,
  redactSensitive,
  requestSchema,
  sanitizeHistory,
} from "../src/zach/zachGuard";
import { chooseModelTier, buildUserTurn, ZACH_SYSTEM_PROMPT } from "../src/zach/zachPrompt";
import { assembleContext, ContextInputs } from "../src/zach/zachContext";
import { yearFacts, SOURCE_CATALOG } from "../src/zach/zachKnowledge";
import { mergeConfig, DEFAULT_CONFIG, worstCaseCost, costUsd } from "../src/zach/zachConfig";
import { sectionForPath, ZACH_ROUTES } from "../src/zach/zachRoutes";
import { computeFederalEstimate } from "../src/shared/taxConstants";
import { requireZachAdmin } from "../src/zach/zachAdmin";

// All data in this file is synthetic.

const NOW = Date.UTC(2026, 10, 2, 15, 0, 0);
const req = (token: Record<string, unknown> | null, uid = "u1") =>
  ({ auth: token ? { uid, token } : undefined, data: {} }) as never;

describe("requireFreshMfa", () => {
  it("accepts a fresh claim", () => {
    expect(requireFreshMfa(req({ mfaVerifiedAt: NOW - 60_000 }), NOW)).toBe("u1");
  });
  it("rejects a missing claim", () => {
    expect(() => requireFreshMfa(req({}), NOW)).toThrow(/sign-in code/);
  });
  it("rejects a claim older than 24 hours", () => {
    expect(() => requireFreshMfa(req({ mfaVerifiedAt: NOW - MFA_FRESHNESS_MS }), NOW)).toThrow();
  });
  it("rejects a claim from the future", () => {
    expect(() => requireFreshMfa(req({ mfaVerifiedAt: NOW + 3_600_000 }), NOW)).toThrow();
  });
  it("rejects a signed-out caller", () => {
    expect(() => requireFreshMfa(req(null), NOW)).toThrow(/logged in/);
  });
});

describe("requireZachAdmin", () => {
  const env = { ZACH_ADMIN_EMAILS: "admin@synthetic.test" } as NodeJS.ProcessEnv;
  const fresh = { mfaVerifiedAt: NOW - 1000 };
  it("allows a verified admin email", () => {
    expect(requireZachAdmin(req({ ...fresh, email: "Admin@synthetic.test", email_verified: true }), NOW, env)).toBe("u1");
  });
  it("rejects an unverified admin email", () => {
    expect(() => requireZachAdmin(req({ ...fresh, email: "admin@synthetic.test", email_verified: false }), NOW, env)).toThrow(/administrator/);
  });
  it("rejects any other user", () => {
    expect(() => requireZachAdmin(req({ ...fresh, email: "user@synthetic.test", email_verified: true }), NOW, env)).toThrow();
  });
  it("rejects an admin without fresh MFA", () => {
    expect(() => requireZachAdmin(req({ email: "admin@synthetic.test", email_verified: true }), NOW, env)).toThrow();
  });
});

describe("redaction of sensitive identifiers", () => {
  it("removes SSNs, EINs, account and card numbers, and emails", () => {
    const out = redactSensitive(
      "SSN 123-45-6789, ssn 123456789, EIN 12-3456789, acct 000123456789, card 4111 1111 1111 1111, me@x.com"
    );
    expect(out).not.toMatch(/123-45-6789|123456789|12-3456789|000123456789|4111|me@x\.com/);
  });
  it("leaves ordinary dollar amounts and years alone", () => {
    expect(redactSensitive("I earned $125,000 in 2025 and paid $3,400.50")).toBe(
      "I earned $125,000 in 2025 and paid $3,400.50"
    );
  });
});

describe("request validation", () => {
  it("rejects empty and oversized messages", () => {
    expect(requestSchema.safeParse({ message: " ", taxYear: 2025 }).success).toBe(false);
    expect(requestSchema.safeParse({ message: "x".repeat(1501), taxYear: 2025 }).success).toBe(false);
  });
  it("rejects a malformed conversation id", () => {
    expect(requestSchema.safeParse({ message: "hi", taxYear: 2025, conversationId: "../x" }).success).toBe(false);
  });
  it("supports the app's year range only", () => {
    const now = new Date(NOW);
    expect(isSupportedTaxYear(2024, now)).toBe(true);
    expect(isSupportedTaxYear(2027, now)).toBe(true);
    expect(isSupportedTaxYear(2028, now)).toBe(false);
    expect(isSupportedTaxYear(2019, now)).toBe(false);
  });
});

describe("conversation history", () => {
  it("keeps alternating turns, compresses old answers, ends on Zach", () => {
    const h = sanitizeHistory([
      { role: "assistant", content: "stray" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a".repeat(5000) },
      { role: "user", content: "q2" },
    ]);
    expect(h.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(h[1].content.length).toBe(600);
  });
  it("keeps only the most recent turns", () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `t${i}`,
    }));
    const h = sanitizeHistory(turns, 3);
    expect(h).toHaveLength(6);
    expect(h[0].content).toBe("t24");
  });
});

describe("model output validation", () => {
  it("drops unknown sources and routes, keeps allowlisted ones", () => {
    const a = parseModelAnswer(
      JSON.stringify({
        answer: "Hello",
        basis: "general_education",
        sourceIds: ["pub17", "https://evil.example", "pub17"],
        actions: [{ routeId: "taxEstimate" }, { routeId: "deleteEverything" }, { routeId: "javascript:alert(1)" }],
        missingInfo: [],
        seeProfessional: false,
        followUpQuestion: "",
      })
    )!;
    expect(a.sources.map((s) => s.id)).toEqual(["pub17"]);
    expect(a.sources[0].url).toBe(SOURCE_CATALOG.pub17.url);
    expect(a.actions).toEqual([{ routeId: "taxEstimate", ...ZACH_ROUTES.taxEstimate }]);
  });
  it("returns null for non-JSON or empty answers", () => {
    expect(parseModelAnswer("not json")).toBeNull();
    expect(parseModelAnswer(JSON.stringify({ answer: "" }))).toBeNull();
  });
  it("every route is an in-app path", () => {
    for (const r of Object.values(ZACH_ROUTES)) expect(r.path).toMatch(/^\/[a-z/-]+$/);
  });
});

describe("figure check (hallucinated amounts)", () => {
  it("reads dollar figures including k/million", () => {
    expect(dollarFigures("$1,234 and $2.5k and $3 million")).toEqual([1234, 2500, 3_000_000]);
  });
  it("passes figures that appear in the grounding", () => {
    expect(figuresAreGrounded("Your standard deduction is $15,750.", [{ sd: 15750 }])).toBe(true);
  });
  it("flags a figure that appears nowhere", () => {
    expect(figuresAreGrounded("The credit is worth $2,200.", [{ sd: 15750 }])).toBe(false);
  });
});

describe("model selection", () => {
  it("uses the fast model for simple navigation questions", () => {
    expect(chooseModelTier("Where do I add a receipt?", "chat", true)).toBe("fast");
  });
  it("uses the strong model for reasoning questions", () => {
    expect(chooseModelTier("Can you explain this calculation of my self-employment tax?", "chat", true)).toBe("deep");
    expect(chooseModelTier("Am I eligible for the child tax credit with two kids?", "chat", true)).toBe("deep");
    expect(chooseModelTier("x", "review", true)).toBe("deep");
  });
  it("keeps everyday questions on the fast model", () => {
    expect(chooseModelTier("Why do I owe taxes?", "chat", true)).toBe("fast");
    expect(chooseModelTier("Where do I add my charitable donations?", "chat", true)).toBe("fast");
  });
  it("never uses the strong model when it isn't allowed", () => {
    expect(chooseModelTier("Can you explain this calculation of my self-employment tax?", "chat", false)).toBe("fast");
  });
});

describe("settings", () => {
  it("defaults to a $25 target and a $50 alert and limit", () => {
    const c = mergeConfig(null, {});
    expect([c.monthlyTargetUsd, c.monthlyAlertUsd, c.monthlyLimitUsd]).toEqual([25, 50, 50]);
    expect(c.enabled).toBe(true);
  });
  it("clamps out-of-range values and rejects unknown models", () => {
    const c = mergeConfig(
      { monthlyLimitUsd: 1e9, perMinutePerUser: 0, models: { fast: { id: "gpt-5", inPerMTok: -1 } } },
      {}
    );
    expect(c.monthlyLimitUsd).toBe(1000);
    expect(c.perMinutePerUser).toBe(1);
    expect(c.models.fast.id).toBe(DEFAULT_CONFIG.models.fast.id);
    expect(c.models.fast.inPerMTok).toBe(0);
  });
  it("the target never exceeds the limit", () => {
    expect(mergeConfig({ monthlyTargetUsd: 80, monthlyLimitUsd: 40 }, {}).monthlyTargetUsd).toBe(40);
  });
  it("the env kill switch wins", () => {
    expect(mergeConfig({ enabled: true }, { ZACH_ENABLED: "false" }).enabled).toBe(false);
  });
  it("worst case is never below actual cost for the same tokens", () => {
    const m = DEFAULT_CONFIG.models.deep;
    expect(worstCaseCost(m, 30_000)).toBeGreaterThanOrEqual(costUsd(m, 10_000, m.maxOutputTokens));
  });
});

describe("sections", () => {
  it("maps app pages to sections", () => {
    expect(sectionForPath("/income/ssa")).toBe("income");
    expect(sectionForPath("/schedule-a")).toBe("deductions");
    expect(sectionForPath("/tax-summary")).toBe("self_employment");
    expect(sectionForPath("/nowhere")).toBe("general");
    expect(sectionForPath(42)).toBe("general");
  });
});

// ─── Year accuracy ───────────────────────────────────────────────────────────

describe("tax-year facts come from the verified tables", () => {
  it("2024, 2025 and 2026 single standard deductions", () => {
    expect(yearFacts(2024, "single").standardDeduction.Single).toBe(14600);
    expect(yearFacts(2025, "single").standardDeduction.Single).toBe(15750);
    expect(yearFacts(2026, "single").standardDeduction.Single).toBe(16100);
  });
  it("lists every status when the status is unknown", () => {
    expect(Object.keys(yearFacts(2025).standardDeduction)).toHaveLength(5);
  });
  it("discloses when a year has no verified tables", () => {
    const f = yearFacts(2023);
    expect(f.tablesAvailableForRequestedYear).toBe(false);
    expect(f.tableYear).not.toBe(2023);
  });
});

// ─── Scenario context tests ──────────────────────────────────────────────────

const base = (over: Partial<ContextInputs>): ContextInputs => ({
  taxYear: 2025,
  today: "2026-11-02",
  profile: { filingStatus: "single" },
  transactions: [],
  manualDeductions: [],
  ssaForms: [],
  retirementForms: [],
  ...over,
});

const t = (category: string, amount: number, type: string, extra: Record<string, unknown> = {}) => ({
  category,
  amount,
  type,
  status: "categorized",
  ...extra,
});

describe("scenarios: Zach's numbers equal the tax engine's", () => {
  it("W-2 single filer", () => {
    const ctx = assembleContext(base({ transactions: [t("Wages & Salaries", 60000, "income")] }));
    const e = computeFederalEstimate({
      scheduleCNet: 0, scheduleENet: 0, w2Wages: 60000, otherOrdinaryIncome: 0,
      itemizedDeductions: 0, iraContributions: 0, filingStatus: "single", taxYear: 2025,
    });
    expect(ctx.estimate!.totalTax).toBe(e.totalTax);
    expect(ctx.estimate!.standardDeduction).toBe(15750);
    expect(ctx.filingStatus).toBe("Single");
  });

  it("married filing jointly vs separately use different tables", () => {
    const rows = [t("Wages & Salaries", 120000, "income")];
    const mfj = assembleContext(base({ profile: { filingStatus: "married_jointly" }, transactions: rows }));
    const mfs = assembleContext(base({ profile: { filingStatus: "married_separately" }, transactions: rows }));
    expect(mfj.estimate!.standardDeduction).toBe(31500);
    expect(mfs.estimate!.standardDeduction).toBe(15750);
    expect(mfj.estimate!.totalTax).toBeLessThan(mfs.estimate!.totalTax);
  });

  it("head of household", () => {
    const ctx = assembleContext(base({ profile: { filingStatus: "hoh" }, transactions: [t("Wages & Salaries", 50000, "income")] }));
    expect(ctx.filingStatus).toBe("Head of Household");
    expect(ctx.estimate!.standardDeduction).toBe(23625);
  });

  it("self-employment: SE tax only on Schedule C net", () => {
    const ctx = assembleContext(
      base({
        transactions: [
          t("Business Income", 80000, "income"),
          t("Office Supplies", 5000, "expense"),
          t("Wages & Salaries", 40000, "income"),
        ],
      })
    );
    expect(ctx.totals.scheduleCNet).toBe(75000);
    expect(ctx.estimate!.seTaxBase).toBe(75000);
    expect(ctx.findings.find((f) => f.id === "sch_c_no_expenses")).toBeUndefined();
  });

  it("itemized deductions combine transactions and manual entries", () => {
    const ctx = assembleContext(
      base({
        transactions: [t("Wages & Salaries", 90000, "income"), t("Charitable Contribution", 9000, "expense")],
        manualDeductions: [{ type: "mortgage_interest", amount: 9000 }],
      })
    );
    expect(ctx.estimate!.itemizedDeduction).toBe(18000);
    expect(ctx.estimate!.usingItemized).toBe(true);
  });

  it("multiple income sources stay in their lanes", () => {
    const ctx = assembleContext(
      base({
        transactions: [
          t("Wages & Salaries", 50000, "income"),
          t("Interest Income", 1000, "income"),
          t("Rental Income", 12000, "income"),
          t("Business Income", 10000, "income"),
        ],
      })
    );
    expect(ctx.totals.w2Wages).toBe(50000);
    expect(ctx.totals.otherOrdinaryIncome).toBe(1000);
    expect(ctx.totals.scheduleENet).toBe(12000);
    expect(ctx.estimate!.seTaxBase).toBe(10000);
  });

  it("prior year uses that year's tables", () => {
    const ctx = assembleContext(base({ taxYear: 2024, transactions: [t("Wages & Salaries", 50000, "income")] }));
    expect(ctx.tableYear).toBe(2024);
    expect(ctx.estimate!.standardDeduction).toBe(14600);
  });

  it("missing filing status: no estimate, and an action finding", () => {
    const ctx = assembleContext(base({ profile: {}, transactions: [t("Wages & Salaries", 50000, "income")] }));
    expect(ctx.estimate).toBeNull();
    expect(ctx.findings[0].id).toBe("missing_filing_status");
  });

  it("contradictory W-2 entries are flagged, not summed", () => {
    const ctx = assembleContext(
      base({ profile: { filingStatus: "single", w2Income: 70000 }, transactions: [t("Wages & Salaries", 50000, "income")] })
    );
    expect(ctx.totals.w2Wages).toBe(50000);
    expect(ctx.findings.some((f) => f.id === "w2_two_sources")).toBe(true);
  });

  it("data-quality problems become evidence-based findings", () => {
    const ctx = assembleContext(
      base({
        transactions: [
          t("Business Income", 20000, "income"),
          t("Business Income", 999, "income", { status: "needs_review" }),
          t("", 50, "expense"),
          t("Office Supplies", 100, "expense", { isForceImport: true, duplicateGroupId: "g1" }),
        ],
      })
    );
    const ids = ctx.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["needs_review", "uncategorized", "force_imported", "possible_duplicates"]));
    expect(ctx.findings.find((f) => f.id === "needs_review")!.evidence).toContain("1 of 4");
  });

  it("unsupported year falls back to known tables and says so", () => {
    const ctx = assembleContext(base({ taxYear: 2023, today: "2026-11-02" }));
    expect(ctx.findings.some((f) => f.id === "tables_not_published")).toBe(true);
  });

  it("income forms are reported as not in the estimate", () => {
    const ctx = assembleContext(base({ ssaForms: [{ totalBenefits: 18000 }] }));
    expect(ctx.enteredButNotInEstimate.socialSecurityBenefits).toBe(18000);
    expect(ctx.findings.some((f) => f.id === "income_forms_not_in_estimate")).toBe(true);
  });
});

describe("privacy: the context sent to the AI is minimized", () => {
  it("contains no names, emails, descriptions or account identifiers", () => {
    const ctx = assembleContext(
      base({
        profile: { filingStatus: "married_jointly", ownerName: "Pat Synthetic", spouseName: "Sam Synthetic", email: "pat@synthetic.test" } as never,
        transactions: [
          t("Wages & Salaries", 50000, "income", {
            description: "ACME PAYROLL 9876543210",
            merchantName: "Acme Corp",
            plaidAccountId: "acc_secret_123",
          }) as never,
        ],
        retirementForms: [{ totalDistribution: 1000, taxableAmount: 1000, payerName: "Synthetic Annuity Co" } as never],
      })
    );
    const turn = buildUserTurn({
      message: "hi",
      section: "general",
      mode: "chat",
      yearFacts: yearFacts(2025),
      taxpayerContext: ctx,
      notCalculated: [],
    });
    for (const s of ["Pat", "Sam", "pat@synthetic.test", "ACME", "9876543210", "Acme Corp", "acc_secret_123", "Synthetic Annuity"]) {
      expect(turn).not.toContain(s);
    }
  });

  it("the system prompt holds no taxpayer or year-specific data (safe to cache)", () => {
    expect(ZACH_SYSTEM_PROMPT).not.toMatch(/\$\d/);
  });
});

describe("possible deductions and credits (opportunities)", () => {
  const ids = (c: ReturnType<typeof assembleContext>) => c.findings.map((f) => f.id);

  it("self-employment profit suggests SE health insurance and retirement plans, with sources", () => {
    const ctx = assembleContext(base({ transactions: [t("Business Income", 50000, "income"), t("Office Supplies", 1000, "expense")] }));
    expect(ids(ctx)).toEqual(expect.arrayContaining(["opp_se_health_insurance", "opp_se_retirement", "opp_home_office"]));
    expect(ctx.findings.find((f) => f.id === "opp_se_health_insurance")!.sourceId).toBe("f7206");
  });

  it("no retirement suggestion when IRA contributions are recorded", () => {
    const ctx = assembleContext(base({ profile: { filingStatus: "single", iraContributions: 6000 }, transactions: [t("Business Income", 50000, "income")] }));
    expect(ids(ctx)).not.toContain("opp_se_retirement");
  });

  it("no business suggestions for a W-2-only filer", () => {
    const ctx = assembleContext(base({ transactions: [t("Wages & Salaries", 60000, "income")] }));
    expect(ids(ctx).filter((i) => i.startsWith("opp_"))).toEqual([]);
  });

  it("charity under the standard deduction is explained, not promised", () => {
    const ctx = assembleContext(base({ transactions: [t("Wages & Salaries", 60000, "income"), t("Charitable Contribution", 500, "expense")] }));
    const f = ctx.findings.find((x) => x.id === "opp_charity_standard")!;
    expect(f.severity).toBe("info");
    expect(f.message).not.toMatch(/\$\d/);
  });

  it("head of household prompts a dependent-credit check without claiming eligibility", () => {
    const ctx = assembleContext(base({ profile: { filingStatus: "head_of_household" }, transactions: [t("Wages & Salaries", 40000, "income")] }));
    const f = ctx.findings.find((x) => x.id === "opp_dependent_credits")!;
    expect(f.message).toMatch(/may apply/);
    expect(f.sourceId).toBe("sch8812");
  });

  it("every opportunity cites an allowlisted IRS source and states no dollar savings", async () => {
    const { SOURCE_CATALOG } = await import("../src/zach/zachKnowledge");
    const ctx = assembleContext(
      base({
        profile: { filingStatus: "married_jointly" },
        transactions: [
          t("Business Income", 80000, "income"),
          t("Auto & Vehicle", 3000, "expense"),
          t("Education & Training", 900, "expense"),
          t("Medical Expense", 700, "expense"),
        ],
      })
    );
    const opps = ctx.findings.filter((f) => f.id.startsWith("opp_"));
    expect(opps.length).toBeGreaterThanOrEqual(5);
    for (const o of opps) {
      expect(o.sourceId && SOURCE_CATALOG[o.sourceId]).toBeTruthy();
      expect(o.message).not.toMatch(/\$\d/);
    }
  });
});
