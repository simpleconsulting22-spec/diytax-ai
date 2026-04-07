/**
 * Normalizes a category name for deduplication, alias detection, and comparison.
 *
 * Strips leading/trailing whitespace, lowercases, removes every character that
 * is not a-z or 0-9.  The result is used as a stable key — never displayed.
 *
 * Examples:
 *   "Business Meals"         → "businessmeals"
 *   "  business meals!  "   → "businessmeals"
 *   "Meals & Entertainment"  → "mealsentertainment"
 *   "meals"                  → "meals"
 */
export function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
