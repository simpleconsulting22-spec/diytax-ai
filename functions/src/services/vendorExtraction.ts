/**
 * Vendor Extraction Service
 *
 * Strips bank-export noise from transaction descriptions and returns a clean,
 * canonical vendor name suitable for matching in categoryRules.
 *
 * Bank exports routinely include payment-processor prefixes ("SQ* ", "TST* "),
 * trailing reference numbers, and state abbreviations that obscure the real
 * merchant name. This service normalises those away and maps common aliases
 * (e.g. "amzn" → "amazon") so the learning system can match reliably.
 */

// ─── Noise patterns to strip from the start of the description ───────────────

const LEADING_NOISE: RegExp[] = [
  /^sq\s*\*\s*/i,             // Square POS: "SQ* Vendor"
  /^tst\s*\*\s*/i,             // Toast POS: "TST* Vendor"
  /^pp\s*\*\s*/i,              // PayPal legacy
  /^paypal\s*\*?\s*(transfer|payment)?\s*/i,
  /^amzn\s+mktp(\s+us)?\s*/i, // Amazon Marketplace
  /^amazon\.com\/bill\s*/i,
  /^ach\s+(credit|debit|transfer|payment)?\s*[-:]?\s*/i,
  /^wire\s+(transfer|in|out)?\s*[-:]?\s*/i,
  /^pos\s*#?\s*\d*\s*/i,      // POS terminal
  /^debit\s+card\s+purchase\s*/i,
  /^debit\s+card\s*/i,
  /^credit\s+card\s*/i,
  /^purchase\s+(at\s+|-\s*)?/i,
  /^payment\s+to\s+/i,
  /^autopay\s+/i,
  /^zelle\s+(to|from|payment\s+(to|from)?|transfer\s+(to|from)?)\s*[-:]?\s*/i,
  /^zelle\s+\d+\s*/i,                     // "ZELLE 123456 JANE DOE"
  /^zelle\s*[-:]?\s*/i,
  /^venmo\s+(payment|cashout)?\s*[-:]?\s*/i,
  /^cash\s*app\s*\*?\s*/i,
  /^checkcard\s+\d*\s*/i,
  /^recurring\s+payment\s*/i,
  /^online\s+(banking\s+)?(payment|purchase|transfer)\s*[-:]?\s*/i,
  /^mobile\s+(deposit|payment)\s*[-:]?\s*/i,
  /^bill\s+pay(ment)?\s+-?\s*/i,
  /^interest\s+(paid|credit|earned|income)?\s*[-:]?\s*/i,
  /^dividend\s+(paid|credit|earned|income)?\s*[-:]?\s*/i,
  /^(monthly|annual)\s+(fee|charge|service\s+charge|maintenance)\s*[-:]?\s*/i,
  /^service\s+(fee|charge)\s*[-:]?\s*/i,
  /^\d{4,}\s+/,               // Leading long numeric codes
];

// Generic tokens — never identify a specific payee. Includes payment methods
// AND bank-statement accounting terms. If extraction yields ONLY these, treat
// as "no vendor" so downstream learning refuses to match across unrelated rows.
const GENERIC_PAYMENT_TOKENS: ReadonlySet<string> = new Set([
  "zelle", "venmo", "paypal", "cashapp", "cash", "ach",
  "wire", "transfer", "payment", "deposit", "withdrawal",
  "check", "debit", "credit", "atm", "online", "mobile",
  "billpay", "autopay", "recurring", "purchase", "pos",
  "interest", "dividend", "fee", "charge", "earnings",
  "service", "monthly", "annual", "paid", "earned",
  "income", "refund", "rebate", "reversal", "adjustment",
  "to", "from", "the", "for", "and", "of",
]);

function isAllGeneric(key: string): boolean {
  return key.split(/\s+/).every((w) => GENERIC_PAYMENT_TOKENS.has(w));
}

// ─── Trailing noise to strip ──────────────────────────────────────────────────

const TRAILING_NOISE: RegExp[] = [
  /\s+#\d+.*/,                // Store number "#4521 ..."
  /\s+\d{6,}.*/,              // Long trailing reference numbers
  /\s+[A-Z]{2}$/,             // State abbreviation "CA", "TX"
  /\s+\d{3}-\d{4}$/,         // Phone fragment
];

// ─── Brand alias map — pattern → canonical name ───────────────────────────────

const BRAND_ALIASES: Array<[RegExp, string]> = [
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
  // Rideshare / travel
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

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract a clean canonical vendor name from a transaction description.
 *
 * @param description          Raw description as exported from the bank
 * @param normalizedDescription Lowercased/trimmed description (preferred input)
 * @returns Lowercase canonical vendor name (1–3 words max)
 */
export function extractVendorName(
  description: string,
  normalizedDescription?: string
): string {
  let s = (normalizedDescription ?? description).trim().toLowerCase();

  // Iteratively strip leading noise (some descriptions have multiple prefixes)
  let changed = true;
  while (changed) {
    changed = false;
    for (const pat of LEADING_NOISE) {
      const next = s.replace(pat, "").trim();
      if (next !== s) {
        s = next;
        changed = true;
        break; // restart from beginning after any change
      }
    }
  }

  // Strip trailing noise
  for (const pat of TRAILING_NOISE) {
    s = s.replace(pat, "").trim();
  }

  // Check brand aliases
  for (const [pattern, canonical] of BRAND_ALIASES) {
    if (pattern.test(s)) return canonical;
  }

  // Extract first 1–2 meaningful words (at least 2 chars, contains a letter)
  const words = s.split(/\s+/).filter((w) => /[a-z]/.test(w) && w.length >= 2);
  if (words.length === 0) {
    return (description.split(/\s+/)[0] ?? "unknown").toLowerCase().slice(0, 30);
  }

  // Brand alias didn't match. Return the FULL stripped fingerprint as the
  // vendor key — strict match, so "interest charge:cash advances" only
  // matches other rows with that exact descriptor (not "interest charge:cash
  // promo"). Trades cascade breadth for precision; safer for auto-learning.
  const fingerprint = words.join(" ");
  if (isAllGeneric(fingerprint)) return "";
  return fingerprint.slice(0, 80); // cap length
}
