// One-shot cleanup: clear category / taxCategory / taxSchedule / entity
// fields on every transaction with type === "transfer" for the calling user.
// Transfers don't belong to a tax category or entity (they net out across
// accounts), so any prior categorization on them is junk that surfaces in
// reports and confuses the learning loop.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

const BATCH_SIZE = 499;

export const cleanupTransferCategorization = onCall(
  { cors: true, invoker: "public" },
  async (request) => {
    const uid = await requireAuth(request);
    const db = admin.firestore();

    const snap = await db
      .collection("transactions")
      .where("uid",  "==", uid)
      .where("type", "==", "transfer")
      .get();

    // Only update rows that actually have something to clear — skips rows
    // that are already clean so we don't bump updatedAt for no reason.
    const dirty = snap.docs.filter((d) => {
      const x = d.data();
      return Boolean(
        (x.category && String(x.category).trim()) ||
        (x.taxCategory && String(x.taxCategory).trim()) ||
        (x.taxSchedule && String(x.taxSchedule).trim()) ||
        x.entityId ||
        x.entityName ||
        (x.entityType && x.entityType !== "personal")
      );
    });

    let updated = 0;
    for (let i = 0; i < dirty.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = dirty.slice(i, i + BATCH_SIZE);
      for (const d of chunk) {
        batch.update(d.ref, {
          category:               "",
          taxCategory:            "",
          taxSchedule:            "",
          entityId:               null,
          entityName:             null,
          entityType:             "personal",
          // Reset categorization signals so the row no longer shows "Learned"
          // for fields it shouldn't have.
          categorizationSource:   "transfer-cleanup",
          entityAssignmentSource: null,
          updatedAt:              admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      updated += chunk.length;
    }

    console.log(
      `[cleanupTransferCategorization] uid=${uid} scanned=${snap.size} updated=${updated}`
    );
    if (!Number.isFinite(updated)) {
      throw new HttpsError("internal", "Cleanup produced an invalid count.");
    }
    return { scanned: snap.size, updated };
  }
);
