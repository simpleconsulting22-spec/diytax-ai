// Legacy single-transaction categorize callable.
//
// Nothing in the app calls this any more. It used to send one row to OpenAI
// with a business-only category list and auto-confirm anything above 0.8,
// bypassing the user's rules. It is kept (so existing clients don't break) but
// now routes through the shared categorizer and decision policy, scoped to
// the verified household and behind a fresh second factor.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { requireFreshMfa, resolveEffectiveOwner } from "../middleware/auth";
import { categorizeSpecificTransactions } from "./categorizeBatch";

export const categorizeTransaction = onCall(
  { cors: true, invoker: "public", secrets: ["ANTHROPIC_API_KEY"] },
  async (request) => {
    requireFreshMfa(request);
    const data = (request.data ?? {}) as { transactionId?: unknown };
    if (typeof data.transactionId !== "string" || !data.transactionId) {
      throw new HttpsError("invalid-argument", "transactionId is required.");
    }
    const { callerUid, effectiveOwnerUid, role } = await resolveEffectiveOwner(request);
    return categorizeSpecificTransactions(effectiveOwnerUid, [data.transactionId], callerUid, role);
  }
);
