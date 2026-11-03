// ─── Canonical vendor extraction ─────────────────────────────────────────────
//
// THE single source of truth for normalizing a raw transaction description
// into a stable "vendor key" used by:
//   - the rule-learning system (categoryRules keyed by vendorName)
//   - the cascade matcher ("apply this to similar transactions?")
//   - the search UX
//
// MUST stay in sync with functions/src/shared/vendorExtraction.ts (Firebase
// Functions can't import from frontend/). Edit BOTH files together.

// ─── Generic tokens — never identify a real merchant ─────────────────────────
//
// Includes payment-method words (zelle, ach) and bank-statement accounting
// terms (interest, fee). When extraction yields ONLY these tokens, we refuse
// to use them as a vendor key — the description didn't actually identify a
// payee, and learning from it would poison rules across unrelated payees.

export const GENERIC_PAYMENT_TOKENS: ReadonlySet<string> = new Set([
  // Payment methods
  "zelle", "venmo", "paypal", "cashapp", "cash", "ach",
  "wire", "transfer", "payment", "deposit", "withdrawal",
  "check", "debit", "credit", "atm", "online", "mobile",
  "billpay", "autopay", "recurring", "purchase", "pos",
  // Bank-statement accounting terms
  "interest", "dividend", "fee", "charge", "earnings",
  "service", "monthly", "annual", "paid", "earned",
  "income", "refund", "rebate", "reversal", "adjustment",
  // Connectors
  "to", "from", "the", "for", "and", "of",
]);

export function isAllGeneric(key: string): boolean {
  return key.split(/\s+/).every((w) => GENERIC_PAYMENT_TOKENS.has(w));
}

// ─── Leading-noise patterns ──────────────────────────────────────────────────
//
// Strip processor prefixes / payment-rail labels so the actual payee surfaces.
// Order matters — longer / more specific patterns must come first. The
// extractor applies these iteratively until none match.

export const PAYMENT_PREFIX_STRIP: RegExp[] = [
  // Square / Toast POS prefixes
  /^sq\s*\*\s*/i,
  /^tst\s*\*\s*/i,
  // Amazon
  /^amzn\s+mktp(\s+us)?\s*/i,
  /^amazon\.com\/bill\s*/i,
  // Plaid / generic processor
  /^pp\s*\*\s*/i,
  /^paypal\s*\*?\s*(transfer|payment)?\s*/i,
  // ACH / wire
  /^ach\s+(credit|debit|transfer|payment)?\s*[-:]?\s*/i,
  /^wire\s+(transfer|in|out)?\s*[-:]?\s*/i,
  // P2P rails — strip brand + verb + connector so RECIPIENT name surfaces
  /^zelle\s+(to|from|payment\s+(to|from)?|transfer\s+(to|from)?)\s*[-:]?\s*/i,
  /^zelle\s+\d+\s*/i,                                       // "ZELLE 123456 JANE DOE"
  /^zelle\s*[-:]?\s*/i,                                     // "ZELLE - JANE DOE"
  /^venmo\s+(payment|cashout)?\s*[-:]?\s*/i,
  /^cash\s*app\s*\*?\s*/i,
  // Card / POS labels
  /^pos\s*#?\s*\d*\s*/i,
  /^debit\s+card\s+purchase\s*[-:]?\s*/i,
  /^debit\s+card\s*/i,
  /^credit\s+card\s*/i,
  /^checkcard\s+\d*\s*/i,
  // Generic action verbs that don't identify a vendor
  /^purchase\s+(at\s+|-\s*)?/i,
  /^payment\s+to\s+/i,
  /^autopay\s+/i,
  /^recurring\s+payment\s*[-:]?\s*/i,
  /^online\s+(banking\s+)?(payment|purchase|transfer)\s*[-:]?\s*/i,
  /^mobile\s+(deposit|payment)\s*[-:]?\s*/i,
  /^bill\s*pay(ment)?\s*[-:]?\s*/i,
  // Bank-statement accounting prefixes
  /^interest\s+(paid|credit|earned|income)?\s*[-:]?\s*/i,
  /^dividend\s+(paid|credit|earned|income)?\s*[-:]?\s*/i,
  /^(monthly|annual)\s+(fee|charge|service\s+charge|maintenance)\s*[-:]?\s*/i,
  /^service\s+(fee|charge)\s*[-:]?\s*/i,
  // Leading long numeric reference codes
  /^\d{4,}\s+/,
];

export function stripPaymentPrefixes(s: string): string {
  let out = s.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of PAYMENT_PREFIX_STRIP) {
      const next = out.replace(pat, "").trim();
      if (next !== out) {
        out = next;
        changed = true;
        break;
      }
    }
  }
  return out;
}

// ─── Trailing-noise patterns ─────────────────────────────────────────────────

export const TRAILING_NOISE: RegExp[] = [
  /\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,                  // " 1/14" / " 01/14/2025"
  /\s+\d{4}-\d{2}-\d{2}$/,                              // " 2025-01-14"
  /\s+#\s*\d+.*$/,                                       // " #4521 ..."
  /\s+\d{6,}.*$/,                                        // long trailing reference numbers
  /\s+[a-z]{2}$/i,                                       // trailing state abbreviation
  /\s+\d{3}-\d{4}$/,                                     // phone fragment
];

export function stripTrailingNoise(s: string): string {
  let out = s;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of TRAILING_NOISE) {
      const next = out.replace(pat, "").trimEnd();
      if (next !== out) {
        out = next;
        changed = true;
        break;
      }
    }
  }
  return out;
}

// ─── Brand aliases — well-known merchants that have multiple description forms
//
// Applied AFTER prefix-stripping. The regex tests against the cleaned string;
// match → return the canonical short name. Lets "amzn", "amazon.com", and
// "amazon mktp" all collapse to one vendor key.

export const BRAND_ALIASES: Array<[RegExp, string]> = [
  // Retail
  [/^amzn\b/i,                "amazon"],
  [/^amazon\b/i,              "amazon"],
  [/^wal.?mart\b/i,           "walmart"],
  [/^wmt\b/i,                 "walmart"],
  [/^costco\b/i,              "costco"],
  [/^target\b/i,              "target"],
  [/^home\s+depot\b/i,        "home depot"],
  [/^lowe.?s\b/i,             "lowes"],
  [/^best\s+buy\b/i,          "best buy"],
  [/^staples\b/i,             "staples"],
  [/^office\s+depot\b/i,      "office depot"],
  // Food & drink
  [/^starbucks\b/i,           "starbucks"],
  [/^mcdonald/i,              "mcdonalds"],
  [/^chick.fil/i,             "chick-fil-a"],
  [/^chipotle/i,              "chipotle"],
  [/^dunkin/i,                "dunkin"],
  [/^subway\b/i,              "subway"],
  [/^domino/i,                "dominos"],
  [/^pizza\s+hut/i,           "pizza hut"],
  // Rideshare / delivery
  [/^uber\s*eats/i,           "uber eats"],
  [/^uber\b/i,                "uber"],
  [/^lyft\b/i,                "lyft"],
  [/^doordash\b/i,            "doordash"],
  [/^grubhub\b/i,             "grubhub"],
  [/^instacart/i,             "instacart"],
  // Streaming & software
  [/^netflix/i,               "netflix"],
  [/^spotify/i,               "spotify"],
  [/^hulu\b/i,                "hulu"],
  [/^disney\+?\b/i,           "disney+"],
  [/^apple\.?com/i,           "apple"],
  [/^google\b/i,              "google"],
  [/^microsoft\b/i,           "microsoft"],
  [/^adobe\b/i,               "adobe"],
  [/^zoom\.?us/i,             "zoom"],
  [/^dropbox\b/i,             "dropbox"],
  [/^github\b/i,              "github"],
  [/^heroku\b/i,              "heroku"],
  [/^openai\b/i,              "openai"],
  [/^notion\b/i,              "notion"],
  [/^slack\b/i,               "slack"],
  [/^figma\b/i,               "figma"],
  [/^shopify\b/i,             "shopify"],
  [/^stripe\b/i,              "stripe"],
  [/^quickbooks/i,            "quickbooks"],
  [/^aws\b/i,                 "amazon web services"],
  [/^amazon\s*web\s*services/i, "amazon web services"],
  [/^digitalocean\b/i,        "digitalocean"],
  [/^twilio\b/i,              "twilio"],
  [/^sendgrid\b/i,            "sendgrid"],
  // Gas / utilities
  [/^shell\b/i,               "shell"],
  [/^chevron\b/i,             "chevron"],
  [/^exxon/i,                 "exxon"],
  [/^bp\s+#/i,                "bp"],
  // Telecom
  [/^at&t/i,                  "at&t"],
  [/^verizon/i,               "verizon"],
  [/^t.?mobile/i,             "t-mobile"],
  [/^comcast/i,               "comcast"],
];

// ─── Public API ──────────────────────────────────────────────────────────────

interface TxnLike {
  description?: string | null;
  normalizedDescription?: string | null;
  vendor?: string | null;
}

/**
 * Returns the cascade key for a transaction or raw description.
 *
 * Two-tier strategy:
 *   1) Trust txn.vendor when it's a clean merchant name (set by ingest).
 *      Reject it if it's purely generic (zelle / fee / etc.) so we fall
 *      through to a more informative fingerprint.
 *   2) Build a fingerprint from the description: lowercase, strip leading
 *      payment prefixes, strip trailing noise, collapse whitespace. If a
 *      brand alias matches the cleaned string, return its canonical short
 *      name; otherwise return the full stripped fingerprint. Strict
 *      full-string match between two transactions = same vendor.
 *
 * Returns "" when nothing meaningful survives (description was just a
 * generic payment-method token), so callers can refuse to fire the cascade.
 */
export function extractVendor(input: string | TxnLike | null | undefined): string {
  if (input == null) return "";
  if (typeof input !== "string") {
    const pre = input.vendor?.trim().toLowerCase();
    if (pre && !isAllGeneric(pre)) return pre;
    return extractVendor(input.normalizedDescription || input.description || "");
  }

  const lowered = input.toLowerCase();
  const stripped = stripPaymentPrefixes(lowered);
  const trimmed  = stripTrailingNoise(stripped).trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  // Brand alias match (post-strip) — collapses retail variants to one key.
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(trimmed)) return canonical;
  }

  if (isAllGeneric(trimmed)) return "";
  return trimmed.slice(0, 80); // cap length
}

/**
 * Backward-compatible alias — backend code historically used `extractVendorName`
 * with two args (description, normalizedDescription). New code should call
 * `extractVendor` directly.
 */
export function extractVendorName(description: string, normalizedDescription?: string): string {
  return extractVendor({ description, normalizedDescription });
}
