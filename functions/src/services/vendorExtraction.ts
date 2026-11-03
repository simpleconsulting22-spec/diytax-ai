// Backward-compatible re-export. The canonical implementation lives at
// functions/src/shared/vendorExtraction.ts (mirror of
// frontend/src/shared/vendorExtraction.ts). All future imports should use
// the shared path; this file exists so existing call sites keep working.
export {
  extractVendor,
  extractVendorName,
  GENERIC_PAYMENT_TOKENS,
  PAYMENT_PREFIX_STRIP,
  TRAILING_NOISE,
  BRAND_ALIASES,
  isAllGeneric,
  stripPaymentPrefixes,
  stripTrailingNoise,
} from "../shared/vendorExtraction";
