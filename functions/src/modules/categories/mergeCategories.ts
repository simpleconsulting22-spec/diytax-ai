import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../../middleware/auth";
import { normalizeCategoryName } from "../../utils/normalizeCategory";

const BATCH_SIZE = 499;

/**
 * Merges sourceCategory into targetCategory for the authenticated user.
 *
 * Steps:
 *  1. Validate inputs.
 *  2. Re-write every transaction with category == sourceCategory to targetCategory.
 *  3. Add sourceCategory as an alias on the targetCategory document in the
 *     `categories` collection (if the doc exists).
 *  4. Remove sourceCategory from users/{uid}.customCategories (if present).
 *
 * Returns: { updatedCount: number }
 *
 * Safe to call multiple times — idempotent after the first run.
 */
export const mergeCategories = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const { sourceCategory, targetCategory } = request.data as {
    sourceCategory?: string;
    targetCategory?: string;
  };

  if (!sourceCategory || typeof sourceCategory !== "string") {
    throw new HttpsError("invalid-argument", "sourceCategory is required.");
  }
  if (!targetCategory || typeof targetCategory !== "string") {
    throw new HttpsError("invalid-argument", "targetCategory is required.");
  }

  const normalizedSource = normalizeCategoryName(sourceCategory);
  const normalizedTarget = normalizeCategoryName(targetCategory);

  if (!normalizedSource || !normalizedTarget) {
    throw new HttpsError("invalid-argument", "Category names must not be empty.");
  }
  if (normalizedSource === normalizedTarget) {
    throw new HttpsError("invalid-argument", "sourceCategory and targetCategory are the same after normalization.");
  }

  const db = admin.firestore();

  // ── 1. Re-write transactions ─────────────────────────────────────────────────
  const txnSnap = await db
    .collection("transactions")
    .where("uid", "==", uid)
    .where("category", "==", sourceCategory)
    .get();

  let updatedCount = 0;
  for (let i = 0; i < txnSnap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = txnSnap.docs.slice(i, i + BATCH_SIZE);
    for (const d of slice) {
      batch.update(d.ref, {
        category: targetCategory,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    updatedCount += slice.length;
  }

  // ── 2. Add alias on targetCategory doc (if it exists in `categories`) ────────
  const catSnap = await db
    .collection("categories")
    .where("uid", "==", uid)
    .where("normalizedName", "==", normalizedTarget)
    .limit(1)
    .get();

  if (!catSnap.empty) {
    await catSnap.docs[0].ref.update({
      aliases: admin.firestore.FieldValue.arrayUnion(sourceCategory),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // ── 3. Remove sourceCategory from users/{uid}.customCategories ───────────────
  try {
    await db.collection("users").doc(uid).update({
      customCategories: admin.firestore.FieldValue.arrayRemove(sourceCategory),
    });
  } catch {
    // users doc may not have the field — not fatal
  }

  console.log(
    `[mergeCategories] uid=${uid} "${sourceCategory}" → "${targetCategory}" transactions=${updatedCount}`
  );

  return { updatedCount };
});
