// ─── Single source of truth: category → tax treatment ────────────────────────
//
// This file is THE canonical mapping. Every other place that needs to know how
// a category is taxed (CategoryDropdown, QuickCaptureFAB, taxCalculator, AI
// prompt builders) must read from here — never hard-code the mapping inline.
//
// AI/keyword categorization writes a `category` string onto each transaction.
// The tax engine then asks `getTaxBucket(txn)` to decide where the dollars
// flow (AGI? Schedule C net? Schedule A deduction? No tax impact?).

export type TaxBucket =
  | "ordinary_income"     // W-2 wages, interest, dividends, etc. → flows into AGI
  | "se_income"           // Schedule C business income → AGI via Sch C net + SE tax
  | "rental_income"       // Schedule E rental income (not yet in meter)
  | "se_expense"          // Schedule C deduction → reduces Sch C net
  | "rental_expense"      // Schedule E deduction → reduces Sch E net
  | "itemized_deduction"  // Schedule A → competes with the standard deduction
  | "personal";           // No tax impact

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
  /** Plain-English hint shown in tooltips and AI prompts. */
  hint?: string;
}

// ─── The mapping ──────────────────────────────────────────────────────────────

export const TAX_MAP: TaxMapping[] = [
  // Income — flows into AGI (W-2-style) unless it's Schedule C/E.
  { category: "Wages & Salaries",  group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "W-2 paycheck or salary — taxed as regular income, no SE tax." },
  { category: "Business Income",   group: "Income", taxSchedule: "Schedule C", taxBucket: "se_income",       hint: "Self-employment income — pays income tax + 15.3% SE tax." },
  { category: "Rental Income",     group: "Income", taxSchedule: "Schedule E", taxBucket: "rental_income",   hint: "Rental property income — reported on Schedule E." },
  { category: "Investment Income", group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Capital gains / investment proceeds — flows into AGI." },
  { category: "Interest Income",   group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Interest from banks / bonds — taxed as regular income." },
  { category: "Dividend Income",   group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Stock dividends — taxed as regular income (qualified rates not yet modeled)." },
  { category: "Other Income",      group: "Income", taxSchedule: "Form 1040",  taxBucket: "ordinary_income", hint: "Miscellaneous taxable income — flows into AGI." },

  // Business Expenses — reduce Schedule C net profit.
  { category: "Advertising & Marketing", group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Deductible business expense." },
  { category: "Auto & Vehicle",          group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business mileage / vehicle costs." },
  { category: "Bank Fees & Charges",     group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business banking fees." },
  { category: "Business Insurance",      group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business liability / property insurance." },
  { category: "Business Meals",          group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Meals with clients / while traveling (50% deductible at filing)." },
  { category: "Business Travel",         group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Travel for work — flights, hotels, ground transport." },
  { category: "Computer & Software",     group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Hardware, SaaS, productivity tools." },
  { category: "Contract Labor",          group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Payments to 1099 contractors." },
  { category: "Education & Training",    group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Work-related courses / certifications." },
  { category: "Equipment & Machinery",   group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Tools / equipment used for the business." },
  { category: "Home Office",             group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Allocable home office costs." },
  { category: "Legal & Professional",    group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Lawyer / accountant / consultant fees." },
  { category: "Licenses & Permits",      group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business licenses, occupational permits." },
  { category: "Office Supplies",         group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Pens, paper, small office goods." },
  { category: "Phone & Internet",        group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business phone / internet — allocable portion." },
  { category: "Postage & Shipping",      group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Shipping costs for the business." },
  { category: "Printing & Publishing",   group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Marketing materials, print services." },
  { category: "Rent & Lease",            group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Office / equipment rental." },
  { category: "Repairs & Maintenance",   group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Upkeep of business property / equipment." },
  { category: "Taxes & Licenses",        group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Business taxes (excluding income tax)." },
  { category: "Utilities",               group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Electricity / water / gas for business space." },
  { category: "Other Business Expense",  group: "Business Expenses (Sch. C)", taxSchedule: "Schedule C", taxBucket: "se_expense", hint: "Catch-all for ordinary, necessary business costs." },

  // Itemized deductions — Schedule A. Only matter if total itemized beats standard.
  { category: "Charitable Contribution", group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Donations to qualified charities." },
  { category: "Medical Expense",         group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Medical costs above 7.5% of AGI are deductible." },
  { category: "Dental Expense",          group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Dental costs grouped with medical for the 7.5% AGI floor." },
  { category: "State & Local Taxes",     group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Property + state income/sales tax — capped at $10k." },
  { category: "Mortgage Interest",       group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Home mortgage interest on primary/secondary home." },
  { category: "Investment Expense",      group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Investment-related fees (mostly suspended through 2025)." },
  { category: "Casualty Loss",           group: "Deductions (Sch. A)", taxSchedule: "Schedule A", taxBucket: "itemized_deduction", hint: "Federally-declared disaster losses." },

  // Rental — Schedule E. Reduce rental net (not yet folded into the meter).
  { category: "Mortgage Interest (Rental)",  group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Mortgage interest on rental property." },
  { category: "Property Management",         group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Property manager fees." },
  { category: "Property Taxes",              group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Property tax on rental real estate." },
  { category: "Rental Insurance",            group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Landlord insurance." },
  { category: "Rental Repairs & Maintenance",group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Upkeep of rental property." },
  { category: "Rental Supplies",             group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Supplies consumed by the rental." },
  { category: "Rental Utilities",            group: "Rental (Sch. E)", taxSchedule: "Schedule E", taxBucket: "rental_expense", hint: "Utilities paid by the landlord." },

  // Personal — no tax impact.
  { category: "Groceries",                group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Dining & Restaurants",     group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact (different from Business Meals)." },
  { category: "Entertainment",            group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Personal Care",            group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Clothing & Apparel",       group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact (uniforms required by employer may qualify — categorize as Other Business Expense if so)." },
  { category: "Healthcare",               group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Use Medical Expense if itemizing for taxes." },
  { category: "Personal Transportation",  group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Personal Subscriptions",   group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },
  { category: "Other Personal",           group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "No tax impact." },

  // Explicitly non-deductible business money movements. These look like
  // business expenses in a bank feed but must never reduce Schedule C profit,
  // so they get real categories rather than being guessed into a deduction.
  { category: "Owner Draw / Distribution", group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Money taken out of the business — not a deductible expense." },
  { category: "Loan Principal Payment",    group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Only loan INTEREST is deductible; principal repayment is not." },
  { category: "Reimbursed Expense",        group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "You were paid back for this, so it is not deductible." },
  { category: "Income Tax Payment",        group: "Personal", taxSchedule: "Personal", taxBucket: "personal", hint: "Federal/state income tax and estimated payments are not business deductions." },
];

// ─── Derived: lookup helpers and dropdown groups ──────────────────────────────

const BY_CATEGORY: Record<string, TaxMapping> = Object.fromEntries(
  TAX_MAP.map((m) => [m.category, m])
);

/** Strict lookup. Returns undefined if the category isn't in the map. */
export function getMapping(category: string | null | undefined): TaxMapping | undefined {
  if (!category) return undefined;
  return BY_CATEGORY[category];
}

/**
 * The "natural" bucket for a category — what the IRS would call this kind of
 * transaction in isolation, ignoring who the user assigned it to. Driven by
 * the canonical TAX_MAP with a legacy fallback to the stored `taxSchedule`.
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
 * Resolve a transaction's tax bucket given BOTH its category and the entity
 * the user assigned it to. Entity assignment narrows or affirms when set:
 *
 *  - Business entity: Sch A and Sch E expenses get promoted to Sch C
 *    deductions (e.g. "Mortgage Interest" expense tagged Business → Sch C
 *    interest deduction). "ordinary_income" stays ordinary (W-2 wages
 *    don't become SE just because tagged Business). Personal categories
 *    stay personal — tagging "Groceries" Business doesn't make it
 *    deductible.
 *  - Rental entity: symmetric to Business but routes to Schedule E.
 *  - Personal entity: NO routing changes — the natural category bucket is
 *    trusted. If a Sch C category is tagged Personal it still counts as
 *    Sch C (likely a misclassification the user should fix; surfaced via
 *    detectClassificationMismatch rather than silently rerouted).
 *  - Null / undefined: use the natural bucket. Preserves behavior for
 *    pre-entity transactions.
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
    // Promote Sch A and Sch E expenses to Sch C; leave SE income/expense and
    // ordinary_income alone. Personal categories stay personal — entity tag
    // doesn't make a non-business category suddenly deductible.
    if (natural === "itemized_deduction" || natural === "rental_expense") return "se_expense";
    if (natural === "rental_income") return "se_income";
    return natural;
  }

  if (entity === "rental") {
    // Symmetric: promote Sch A and Sch C expenses to Sch E.
    if (natural === "itemized_deduction" || natural === "se_expense") return "rental_expense";
    if (natural === "se_income") return "rental_income";
    return natural;
  }

  // personal / null / undefined — trust the natural category bucket.
  // Mismatches between category and entity are surfaced separately for the
  // user to correct, rather than silently re-routed here.
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
 * Categories that are unambiguously business by name. A user who picked one
 * of these AND tagged the row Personal almost certainly made a mistake —
 * worth flagging. Other Schedule C categories (Bank Fees, Rent & Lease,
 * Utilities, Phone & Internet, Auto, etc.) are dual-use and commonly tagged
 * Personal for legitimate reasons; we don't flag those.
 */
const UNAMBIGUOUSLY_BUSINESS: ReadonlySet<string> = new Set([
  "Advertising & Marketing",
  "Business Insurance",
  "Business Meals",
  "Business Travel",
  "Contract Labor",
  "Home Office",
  "Other Business Expense",
]);

/**
 * Detect when a transaction's category and entity assignment disagree in a
 * way the user should review and fix. Conservative — only flags clear
 * contradictions, not categories that have legitimate personal uses.
 *
 * Returns a short reason string for UI display, or null if the row looks fine.
 */
export function detectClassificationMismatch(txn: {
  category?: string | null;
  taxCategory?: string | null;
  taxSchedule?: string | null;
  type?: string;
  entityType?: string | null;
}): string | null {
  const cat     = txn.category ?? txn.taxCategory ?? "";
  const natural = getNaturalBucket(txn);
  const entity  = txn.entityType;

  // Personal-tagged with a CLEARLY business-only category name.
  if (entity === "personal") {
    if (natural === "se_expense" && UNAMBIGUOUSLY_BUSINESS.has(cat)) {
      return `"${cat}" is a business-only category — assign to a business entity, or pick a different category for personal use.`;
    }
    // Income categories are unambiguous regardless.
    if (natural === "se_income") {
      return `"${cat}" is business income — assign to a business entity, or pick "Other Income" if it's personal.`;
    }
    if (natural === "rental_income") {
      return `"${cat}" is rental income — assign to a rental entity.`;
    }
    if (natural === "rental_expense") {
      return `"${cat}" is a rental expense — assign to a rental entity, or pick a non-rental category if it's personal.`;
    }
  }

  // Cross-entity: rental category tagged to business or vice-versa.
  if (entity === "business") {
    if (natural === "rental_expense") return `"${cat}" is a rental category — should this be tagged to a rental, not a business?`;
    if (natural === "rental_income")  return `"${cat}" is rental income — should this be tagged to a rental, not a business?`;
  }
  if (entity === "rental") {
    if (natural === "se_income")      return `"${cat}" is business income — should this be tagged to a business, not a rental?`;
    // Note: business expenses tagged to a rental entity are valid (Sch E
    // expenses cover lots of categories) — getTaxBucket already promotes
    // them. Don't flag.
  }

  return null;
}

/** Dropdown groupings, in display order. Derived from the map. */
export const CATEGORY_GROUPS: Array<{ group: CategoryGroupName; categories: string[] }> = (() => {
  const order: CategoryGroupName[] = [
    "Income",
    "Business Expenses (Sch. C)",
    "Deductions (Sch. A)",
    "Rental (Sch. E)",
    "Personal",
  ];
  return order.map((g) => ({
    group: g,
    categories: TAX_MAP.filter((m) => m.group === g).map((m) => m.category),
  }));
})();

/** Flat category list (for dropdowns / typeahead). */
export const TAX_CATEGORIES: string[] = TAX_MAP.map((m) => m.category);
