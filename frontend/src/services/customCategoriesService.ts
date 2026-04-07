import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { normalizeCategoryName } from "../utils/normalizeCategory";
import { TAX_CATEGORIES } from "../modules/review/components/CategoryDropdown";

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getCustomCategories(uid: string): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return [];
    return (snap.data().customCategories as string[] | undefined) ?? [];
  } catch {
    return [];
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

export interface AddCategoryResult {
  /** Canonical display name to use (may differ from rawName if a match was found). */
  name: string;
  /** true = new category was created; false = matched an existing one. */
  isNew: boolean;
}

/**
 * Safely adds a custom category for a user.
 *
 * Deduplication priority (checked in order):
 *   1. Predefined categories (86 built-ins) — normalized exact match.
 *   2. User's existing customCategories array — normalized exact match.
 *   3. `categories` Firestore collection — normalized exact match.
 *
 * In cases 1–3: returns the *existing* canonical name and adds rawName as an
 * alias on the category doc (when applicable), rather than creating a duplicate.
 *
 * Only when no match exists:
 *   - Appends to users/{uid}.customCategories  (backward-compatible)
 *   - Creates a new document in `categories/{id}`  (new structured model)
 */
export async function addCustomCategory(
  uid: string,
  rawName: string
): Promise<AddCategoryResult> {
  const trimmed = rawName.trim();
  const normalized = normalizeCategoryName(trimmed);

  if (!normalized) return { name: trimmed, isNew: false };

  // 1. Check predefined categories
  const predefinedMatch = TAX_CATEGORIES.find(
    (c) => normalizeCategoryName(c) === normalized
  );
  if (predefinedMatch) {
    return { name: predefinedMatch, isNew: false };
  }

  // 2. Check user's existing customCategories array
  const existingCustom = await getCustomCategories(uid);
  const customMatch = existingCustom.find(
    (c) => normalizeCategoryName(c) === normalized
  );
  if (customMatch) {
    // If the user typed a different spelling, record it as an alias.
    if (customMatch !== trimmed) {
      await _addAliasToDoc(uid, normalized, trimmed);
    }
    return { name: customMatch, isNew: false };
  }

  // 3. Check categories collection
  const catSnap = await getDocs(
    query(
      collection(db, "categories"),
      where("uid", "==", uid),
      where("normalizedName", "==", normalized)
    )
  );
  if (!catSnap.empty) {
    const canonicalName = catSnap.docs[0].data().name as string;
    if (canonicalName !== trimmed) {
      await updateDoc(catSnap.docs[0].ref, { aliases: arrayUnion(trimmed) });
    }
    return { name: canonicalName, isNew: false };
  }

  // 4. Genuinely new — write to both the legacy array and the new collection.
  await updateDoc(doc(db, "users", uid), {
    customCategories: arrayUnion(trimmed),
  });
  await addDoc(collection(db, "categories"), {
    uid,
    name: trimmed,
    normalizedName: normalized,
    parentCategory: null,
    type: "custom",
    aliases: [],
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  return { name: trimmed, isNew: true };
}

// ─── Internal helper ──────────────────────────────────────────────────────────

async function _addAliasToDoc(
  uid: string,
  normalizedCanonical: string,
  alias: string
): Promise<void> {
  try {
    const snap = await getDocs(
      query(
        collection(db, "categories"),
        where("uid", "==", uid),
        where("normalizedName", "==", normalizedCanonical)
      )
    );
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, { aliases: arrayUnion(alias) });
    }
  } catch {
    // Non-fatal — alias recording is best-effort.
  }
}
