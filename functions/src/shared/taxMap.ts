// ─── Backend mirror of frontend/src/shared/taxMap.ts ─────────────────────────
//
// MUST stay in sync with the frontend canonical file (Firebase Functions can't
// import from frontend/). The category list is used to:
//   1) auto-generate the AI prompt's category narrative (no more drift)
//   2) validate the AI's category response (unknown categories fall through)
//   3) provide a fallback "Other ..." category per transaction type
//
// If you change TAX_MAP in either file, change it in BOTH. A future cleanup
// can extract this to a shared package; for now the duplication is documented
// and intentional.

export type TaxBucket =
  | "ordinary_income"
  | "se_income"
  | "rental_income"
  | "se_expense"
  | "rental_expense"
  | "itemized_deduction"
  | "personal";

export type TaxSchedule = "Form 1040" | "Schedule A" | "Schedule C" | "Schedule E" | "Personal";

export type CategoryGroupName =
  | "Income"
  | "Business Expenses (Sch. C)"
  | "Deductions (Sch. A)"
  | "Rental (Sch. E)"
  | "Personal";

export interface TaxMapping {
  category: string;
  group: CategoryGroupName;
  taxSchedule: TaxSchedule;
  taxBucket: TaxBucket;
  hint?: string;
}

export const TAX_MAP: TaxMapping[] = [
  // Income
  { category: "Wages & Salaries",  group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "W-2 paycheck or salary — taxed as regular income, no SE tax." },
  { category: "Business Income",   group: "Income", taxSchedule: "Schedule C", taxBucket: "se_income",       hint: "Self-employment income — pays income tax + 15.3% SE tax." },
  { category: "Rental Income",     group: "Income", taxSchedule: "Schedule E", taxBucket: "rental_income",   hint: "Rental property income — reported on Schedule E." },
  { category: "Investment Income", group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Capital gains / investment proceeds — flows into AGI." },
  { category: "Interest Income",   group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Interest from banks / bonds — taxed as regular income." },
  { category: "Dividend Income",   group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Stock dividends — taxed as regular income." },
  { category: "Other Income",      group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Miscellaneous taxable income — flows into AGI." },

  // Business Expenses (Schedule C)
  { category: "Advertising & Marketing", group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Deductible business expense." },
  { category: "Auto & Vehicle",          group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business mileage / vehicle costs." },
  { category: "Bank Fees & Charges",     group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Banking fees (business or personal)." },
  { category: "Business Insurance",      group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business liability / property insurance." },
  { category: "Business Meals",          group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Meals with clients / while traveling (50% deductible)." },
  { category: "Business Travel",         group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Travel for work — flights, hotels, ground transport." },
  { category: "Computer & Software",     group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Hardware, SaaS, productivity tools." },
  { category: "Contract Labor",          group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Payments to 1099 contractors." },
  { category: "Education & Training",    group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Work-related courses / certifications." },
  { category: "Equipment & Machinery",   group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Tools / equipment used for the business." },
  { category: "Home Office",             group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Allocable home office costs." },
  { category: "Legal & Professional",    group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Lawyer / accountant / consultant fees." },
  { category: "Licenses & Permits",      group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business licenses, occupational permits." },
  { category: "Office Supplies",         group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Pens, paper, small office goods." },
  { category: "Phone & Internet",        group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Phone / internet — allocable portion." },
  { category: "Postage & Shipping",      group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Shipping costs for the business." },
  { category: "Printing & Publishing",   group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Marketing materials, print services." },
  { category: "Rent & Lease",            group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Office / equipment / housing rental." },
  { category: "Repairs & Maintenance",   group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Upkeep of property / equipment." },
  { category: "Taxes & Licenses",        group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business taxes (excluding income tax)." },
  { category: "Utilities",               group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Electricity / water / gas." },
  { category: "Other Business Expense",  group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Catch-all for ordinary, necessary business costs." },

  // Schedule A — Itemized Deductions
  { category: "Charitable Contribution", group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Donations to qualified charities." },
  { category: "Medical Expense",         group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Medical costs above 7.5% of AGI." },
  { category: "Dental Expense",          group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Dental costs (grouped with medical for the AGI floor)." },
  { category: "State & Local Taxes",     group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Property + state income/sales tax — capped at $10k." },
  { category: "Mortgage Interest",       group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Home mortgage interest." },
  { category: "Investment Expense",      group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Investment-related fees (mostly suspended through 2025)." },
  { category: "Casualty Loss",           group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Federally-declared disaster losses." },

  // Schedule E — Rental
  { category: "Mortgage Interest (Rental)",   group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Mortgage interest on rental property." },
  { category: "Property Management",          group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Property manager fees." },
  { category: "Property Taxes",               group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Property tax on rental real estate." },
  { category: "Rental Insurance",             group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Landlord insurance." },
  { category: "Rental Repairs & Maintenance", group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Upkeep of rental property." },
  { category: "Rental Supplies",              group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Supplies consumed by the rental." },
  { category: "Rental Utilities",             group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Utilities paid by the landlord." },

  // Personal — no tax impact
  { category: "Groceries",               group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Dining & Restaurants",    group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact (different from Business Meals)." },
  { category: "Entertainment",           group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Personal Care",           group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Clothing & Apparel",      group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Healthcare",              group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Use Medical Expense if itemizing for taxes." },
  { category: "Personal Transportation", group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Personal Subscriptions",  group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Other Personal",          group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },

  // Explicitly non-deductible business money movements. These look like
  // business expenses in a bank feed but must never reduce Schedule C profit,
  // so they get real categories rather than being guessed into a deduction.
  { category: "Owner Draw / Distribution", group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Money taken out of the business — not a deductible expense." },
  { category: "Loan Principal Payment",    group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Only loan INTEREST is deductible; principal repayment is not." },
  { category: "Reimbursed Expense",        group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "You were paid back for this, so it is not deductible." },
  { category: "Income Tax Payment",        group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Federal/state income tax and estimated payments are not business deductions." },
];

const BY_CATEGORY: Record<string, TaxMapping> = Object.fromEntries(
  TAX_MAP.map((m) => [m.category, m])
);

const NORMALIZED_BY_CATEGORY: Record<string, TaxMapping> = Object.fromEntries(
  TAX_MAP.map((m) => [m.category.toLowerCase().replace(/\s+/g, " ").trim(), m])
);

/** Strict lookup. Returns undefined if the category isn't in TAX_MAP. */
export function getMapping(category: string | null | undefined): TaxMapping | undefined {
  if (!category) return undefined;
  return BY_CATEGORY[category];
}

/**
 * The "natural" bucket for a category — what the IRS would call this kind of
 * transaction in isolation, ignoring who the user assigned it to. Driven by
 * TAX_MAP with a legacy fallback to the stored `taxSchedule`.
 *
 * Ported from the frontend canonical file so backend aggregation routes money
 * the same way the dashboard does.
 */
function getNaturalBucket(txn: {
  category?: string | null;
  taxCategory?: string | null;
  taxSchedule?: string | null;
  type?: string;
}): TaxBucket {
  const m = getMapping(txn.category ?? txn.taxCategory);
  if (m) return m.taxBucket;
  // Legacy fallback — derive from taxSchedule + type.
  if (txn.taxSchedule === "Schedule C") return txn.type === "income" ? "se_income" : "se_expense";
  if (txn.taxSchedule === "Schedule E") return txn.type === "income" ? "rental_income" : "rental_expense";
  if (txn.taxSchedule === "Schedule A") return "itemized_deduction";
  if (txn.type === "income") return "ordinary_income";
  return "personal";
}

/**
 * Resolve a transaction's tax bucket from BOTH its category and its assigned
 * entity. Business entities promote Sch A / Sch E expenses to Sch C; rental
 * entities do the mirror image. Personal / unset entities trust the category.
 *
 * MUST match frontend/src/shared/taxMap.ts — see the mirror note at the top.
 */
export function getTaxBucket(txn: {
  category?: string | null;
  taxCategory?: string | null;
  taxSchedule?: string | null;
  type?: string;
  entityType?: string | null;
}): TaxBucket {
  const natural = getNaturalBucket(txn);
  const entity = txn.entityType;

  if (entity === "business") {
    if (natural === "itemized_deduction" || natural === "rental_expense") return "se_expense";
    if (natural === "rental_income") return "se_income";
    return natural;
  }

  if (entity === "rental") {
    if (natural === "itemized_deduction" || natural === "se_expense") return "rental_expense";
    if (natural === "se_income") return "rental_income";
    return natural;
  }

  return natural;
}

/** True for buckets that represent money coming IN. */
export function isIncomeBucket(bucket: TaxBucket): boolean {
  return bucket === "ordinary_income" || bucket === "se_income" || bucket === "rental_income";
}

/**
 * Categories that are actual W-2 wages. These matter separately from other
 * ordinary income because W-2 social security wages consume the OASDI wage
 * base, reducing how much self-employment income is still subject to the
 * 12.4% portion. Interest and dividends do NOT consume the base.
 */
const W2_WAGE_CATEGORIES: ReadonlySet<string> = new Set(["Wages & Salaries"]);

export function isW2WageCategory(category: string | null | undefined): boolean {
  return !!category && W2_WAGE_CATEGORIES.has(category);
}

/**
 * Lenient lookup — case/whitespace insensitive. Lets us repair AI responses
 * that drift in casing ("Wages and Salaries" vs "Wages & Salaries"). Caller
 * should still treat a hit here as confidence-reducing — the AI didn't return
 * the canonical form.
 */
export function getMappingFuzzy(category: string | null | undefined): TaxMapping | undefined {
  if (!category) return undefined;
  if (BY_CATEGORY[category]) return BY_CATEGORY[category];
  const normalized = category.toLowerCase().replace(/\s+/g, " ").trim();
  return NORMALIZED_BY_CATEGORY[normalized];
}

/** True if the category string is exactly one of the canonical TAX_MAP entries. */
export function isValidCategory(category: string | null | undefined): boolean {
  return !!category && BY_CATEGORY[category] !== undefined;
}

/**
 * Safe fallback for an AI response that returned an unknown category.
 * Picks the appropriate "Other ..." bucket based on the transaction type
 * so the row routes somewhere sane, even if the AI hallucinated.
 */
export function fallbackCategoryForType(type: string | null | undefined): TaxMapping {
  if (type === "income") return BY_CATEGORY["Other Income"];
  // Default to Personal for unknown — safer than over-claiming a deduction.
  return BY_CATEGORY["Other Personal"];
}

/**
 * Build the category-list narrative used in AI prompts. Generated from
 * TAX_MAP so the prompt and validator can never disagree.
 */
export function buildAIPromptCategoryList(): string {
  const groups = new Map<CategoryGroupName, string[]>();
  for (const m of TAX_MAP) {
    if (!groups.has(m.group)) groups.set(m.group, []);
    groups.get(m.group)!.push(m.category);
  }
  const labelFor: Record<CategoryGroupName, string> = {
    "Income":                    "Income (taxed as ordinary or self-employment depending on category)",
    "Business Expenses (Sch. C)": "Business Expenses — Schedule C deductions",
    "Deductions (Sch. A)":        "Itemized Deductions — Schedule A",
    "Rental (Sch. E)":            "Rental Property — Schedule E",
    "Personal":                   "Personal — no tax impact",
  };
  const order: CategoryGroupName[] = [
    "Income",
    "Business Expenses (Sch. C)",
    "Deductions (Sch. A)",
    "Rental (Sch. E)",
    "Personal",
  ];
  const lines: string[] = [];
  for (const g of order) {
    const cats = groups.get(g);
    if (!cats || cats.length === 0) continue;
    lines.push(`  ${labelFor[g]}: ${cats.join(", ")}`);
  }
  return lines.join("\n");
}

/** Allowed taxSchedule strings — for AI prompt + validation. */
export const VALID_TAX_SCHEDULES: TaxSchedule[] = [
  "Form 1040", "Schedule A", "Schedule C", "Schedule E", "Personal",
];

/** Lookup the canonical taxSchedule + taxBucket for a category. */
export function scheduleForCategory(category: string): { taxSchedule: TaxSchedule; taxBucket: TaxBucket } | undefined {
  const m = BY_CATEGORY[category];
  if (!m) return undefined;
  return { taxSchedule: m.taxSchedule, taxBucket: m.taxBucket };
}
