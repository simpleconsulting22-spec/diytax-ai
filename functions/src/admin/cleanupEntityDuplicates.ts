// One-shot cleanup: collapse "duplicate" entity references on the user's
// transactions and categoryRules.
//
// Background: prior versions of useOnboarding deleted-and-recreated entity
// docs on every profile edit, which minted new doc IDs. Transactions
// categorized before the edit kept the old (now-deleted) entityId, so the
// dashboard rendered the same business as multiple sections. This function
// finds those orphan entityId references and reassigns them to the
// canonical surviving entity that matches by (entityType, entityName).

import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";

const BATCH_SIZE = 499;

interface CanonicalEntity {
  id:   string;
  name: string;
  type: "business" | "rental";
}

function keyOf(type: string, name: string): string {
  return `${type}:${name.trim().toLowerCase()}`;
}

export const cleanupEntityDuplicates = onCall(
  { cors: true, invoker: "public" },
  async (request) => {
    const uid = await requireAuth(request);
    const db  = admin.firestore();

    // ── 1. Build canonical entity map ────────────────────────────────────────
    // If the entities collection itself has dupes (rare), the oldest createdAt
    // wins so we deterministically pick the same canonical across runs.
    const entitiesSnap = await db
      .collection("entities")
      .where("userId", "==", uid)
      .get();

    type EntityRow = { id: string; name: string; type: string; createdAt: number };
    const rows: EntityRow[] = [];
    for (const d of entitiesSnap.docs) {
      const data = d.data();
      const t = data.type as string | undefined;
      const n = data.name as string | undefined;
      if (typeof t !== "string" || typeof n !== "string") continue;
      const ts = data.createdAt as admin.firestore.Timestamp | undefined;
      rows.push({
        id: d.id,
        name: n,
        type: t,
        createdAt: ts ? ts.toMillis() : Number.MAX_SAFE_INTEGER,
      });
    }
    rows.sort((a, b) => a.createdAt - b.createdAt);

    const canonicalByKey = new Map<string, CanonicalEntity>();
    const dupEntityIds:  string[] = [];
    for (const r of rows) {
      const k = keyOf(r.type, r.name);
      if (canonicalByKey.has(k)) {
        dupEntityIds.push(r.id);
      } else {
        canonicalByKey.set(k, {
          id:   r.id,
          name: r.name,
          type: r.type as "business" | "rental",
        });
      }
    }
    const validIds = new Set([...canonicalByKey.values()].map((c) => c.id));

    // ── 2. Reassign orphan entityId on transactions ──────────────────────────
    const txnSnap = await db.collection("transactions").where("uid", "==", uid).get();
    const txnUpdates: { ref: admin.firestore.DocumentReference; data: admin.firestore.UpdateData<admin.firestore.DocumentData> }[] = [];
    let txnsOrphaned = 0;

    for (const d of txnSnap.docs) {
      const x   = d.data();
      const eid = x.entityId as string | null | undefined;
      if (!eid) continue;
      if (validIds.has(eid)) continue;
      const k = keyOf(
        (x.entityType as string | undefined) ?? "",
        (x.entityName as string | undefined) ?? "",
      );
      const canonical = canonicalByKey.get(k);
      if (canonical) {
        txnUpdates.push({
          ref: d.ref,
          data: {
            entityId:   canonical.id,
            entityName: canonical.name,
            entityType: canonical.type,
            updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      } else {
        txnsOrphaned++;
      }
    }

    for (let i = 0; i < txnUpdates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const u of txnUpdates.slice(i, i + BATCH_SIZE)) batch.update(u.ref, u.data);
      await batch.commit();
    }

    // ── 3. Reassign orphan entityId on categoryRules ─────────────────────────
    const ruleSnap = await db.collection("categoryRules").where("uid", "==", uid).get();
    const ruleUpdates: { ref: admin.firestore.DocumentReference; data: admin.firestore.UpdateData<admin.firestore.DocumentData> }[] = [];
    let rulesOrphaned = 0;

    for (const d of ruleSnap.docs) {
      const x   = d.data();
      const eid = x.entityId as string | null | undefined;
      if (!eid) continue;
      if (validIds.has(eid)) continue;
      const k = keyOf(
        (x.entityType as string | undefined) ?? "",
        (x.entityName as string | undefined) ?? "",
      );
      const canonical = canonicalByKey.get(k);
      if (canonical) {
        ruleUpdates.push({
          ref: d.ref,
          data: {
            entityId:   canonical.id,
            entityName: canonical.name,
            entityType: canonical.type,
            updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      } else {
        rulesOrphaned++;
      }
    }

    for (let i = 0; i < ruleUpdates.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const u of ruleUpdates.slice(i, i + BATCH_SIZE)) batch.update(u.ref, u.data);
      await batch.commit();
    }

    // ── 4. Delete duplicate entity docs (only after refs are reassigned) ─────
    for (let i = 0; i < dupEntityIds.length; i += BATCH_SIZE) {
      const batch = db.batch();
      for (const id of dupEntityIds.slice(i, i + BATCH_SIZE)) {
        batch.delete(db.collection("entities").doc(id));
      }
      await batch.commit();
    }

    console.log(
      `[cleanupEntityDuplicates] uid=${uid} ` +
      `txnsScanned=${txnSnap.size} txnsReassigned=${txnUpdates.length} txnsOrphaned=${txnsOrphaned} ` +
      `rulesScanned=${ruleSnap.size} rulesReassigned=${ruleUpdates.length} rulesOrphaned=${rulesOrphaned} ` +
      `entityDupsDeleted=${dupEntityIds.length}`,
    );

    return {
      txns:  { scanned: txnSnap.size,  reassigned: txnUpdates.length,  orphaned: txnsOrphaned  },
      rules: { scanned: ruleSnap.size, reassigned: ruleUpdates.length, orphaned: rulesOrphaned },
      entityDupsDeleted: dupEntityIds.length,
    };
  },
);
