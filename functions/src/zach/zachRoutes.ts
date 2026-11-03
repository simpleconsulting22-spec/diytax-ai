// The only places Zach may send a user. Zach's model output names a route id;
// the server maps it to a path here, so a crafted answer can never produce an
// arbitrary link, an external URL, or an action that changes data.

export const ZACH_ROUTES = {
  dashboard: { path: "/dashboard", label: "Open the dashboard" },
  taxEstimate: { path: "/tax-estimate", label: "See the tax estimate breakdown" },
  scheduleC: { path: "/tax-summary", label: "Open the Schedule C summary" },
  scheduleA: { path: "/schedule-a", label: "Open Schedule A (itemized deductions)" },
  scheduleE: { path: "/schedule-e", label: "Open Schedule E (rental income)" },
  deductions: { path: "/deductions", label: "Add or review deductions" },
  ssaIncome: { path: "/income/ssa", label: "Enter Social Security income" },
  retirementIncome: { path: "/income/retirement", label: "Enter retirement income" },
  review: { path: "/review", label: "Review transactions" },
  transactions: { path: "/transactions", label: "Open transactions" },
  transfers: { path: "/transfers", label: "Check transfers" },
  importCsv: { path: "/import-csv", label: "Import a bank CSV" },
  bankAccounts: { path: "/bank-accounts", label: "Connect bank accounts" },
  categories: { path: "/settings/categories", label: "Manage categories" },
  taxProfile: { path: "/onboarding", label: "Update your tax profile (filing status)" },
} as const;

export type ZachRouteId = keyof typeof ZACH_ROUTES;
export const ZACH_ROUTE_IDS = Object.keys(ZACH_ROUTES) as ZachRouteId[];

export function isZachRouteId(id: unknown): id is ZachRouteId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ZACH_ROUTES, id);
}

export type ZachSection =
  | "income"
  | "deductions"
  | "self_employment"
  | "rental"
  | "review"
  | "estimate"
  | "general";

export const SECTION_DESCRIPTIONS: Record<ZachSection, string> = {
  income: "Income entry (W-2 wages, Social Security, retirement distributions, other income)",
  deductions: "Deductions (standard vs itemized, Schedule A items)",
  self_employment: "Self-employment (Schedule C business income and expenses)",
  rental: "Rental income (Schedule E)",
  review: "Reviewing and categorizing transactions",
  estimate: "Tax estimate and dashboard",
  general: "General",
};

/** Map the page the user is on to a section. Unknown paths are "general". */
export function sectionForPath(path: unknown): ZachSection {
  if (typeof path !== "string") return "general";
  const p = path.split("?")[0].toLowerCase();
  if (p.startsWith("/income")) return "income";
  if (p === "/deductions" || p === "/schedule-a") return "deductions";
  if (p === "/tax-summary") return "self_employment";
  if (p === "/schedule-e") return "rental";
  if (p === "/review" || p === "/transactions" || p === "/transfers" || p === "/import-csv") return "review";
  if (p === "/tax-estimate" || p === "/dashboard" || p === "/coach") return "estimate";
  return "general";
}
