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
 * Resolve a transaction's tax bucket using the canonical map first, then
 * falling back to the legacy `taxSchedule` field for transactions that
 * pre-date the map (or use a custom category).
 */
export function getTaxBucket(txn: {
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
