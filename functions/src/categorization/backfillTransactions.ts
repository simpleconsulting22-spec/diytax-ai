import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

// ─── Vendor extraction ────────────────────────────────────────────────────────
// Mirrors the helper in the frontend CSV import hook.

function extractVendor(normalizedDescription: string): string {
  if (!normalizedDescription) return "unknown";
  return normalizedDescription.split(" ")[0] || "unknown";
}

// ─── Core backfill logic ──────────────────────────────────────────────────────

export interface BackfillResult {
  processed: number;
  updated: number;
}

/**
 * One-time backfill for transactions that predate the vendor and
 * categorizationSource fields.
 *
 * Safe by design:
 *  - Only writes fields that are missing/falsy — never overwrites existing values.
 *  - Uses batched writes (max 499 per batch) to stay within Firestore limits.
 */
export async function backfillTransactionFields(userId: string): Promise<BackfillResult> {
  const db = admin.firestore();

  const snap = await db
    .collection("transactions")
    .where("uid", "==", userId)
    .get();

  const docs = snap.docs;
  let processed = 0;
  let updated = 0;

  const BATCH_SIZE = 499;

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    let batchHasWrites = false;

    for (const docSnap of chunk) {
      processed++;
      const txn = docSnap.data();
      const updates: Record<string, unknown> = {};

      // vendor: missing or empty → derive from normalizedDescription
      if (!txn.vendor) {
        updates.vendor = extractVendor((txn.normalizedDescription as string) ?? "");
      }

      // categorizationSource: missing → "unknown"
      // (transactions categorized before this field was introduced)
      if (!txn.categorizationSource) {
        updates.categorizationSource = "unknown";
      }

      if (Object.keys(updates).length > 0) {
        batch.update(docSnap.ref, updates);
        updated++;
        batchHasWrites = true;
      }
    }

    if (batchHasWrites) {
      await batch.commit();
    }
  }

  console.log(
    `[Backfill] uid=${userId} | processed=${processed} | updated=${updated}`
  );

  return { processed, updated };
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const backfillTransactions = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);
  return backfillTransactionFields(uid);
});
