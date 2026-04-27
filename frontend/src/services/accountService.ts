import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

export type AccountType = "bank" | "credit_card";

const CC_HINT_PATTERNS = [
  /\bcc\b/i,
  /\bcredit\b/i,
  /\bcard\b/i,
  /\bvisa\b/i,
  /\bmastercard\b/i,
  /\bamex\b/i,
  /\bamerican\s+express\b/i,
  /\bdiscover\b/i,
];

export function inferAccountTypeFromName(name: string): AccountType {
  return CC_HINT_PATTERNS.some((re) => re.test(name)) ? "credit_card" : "bank";
}

export function extractLast4FromName(name: string): string | null {
  const digits = name.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// Find an existing CSV-style account doc by name (case-insensitive), or create one.
// Plaid-managed accounts (those with institutionName) are skipped — they are owned
// by the Plaid sync flow and must not be reused for CSV/manual labels.
export async function findOrCreateAccountByName(
  uid: string,
  name: string,
  accountType?: AccountType
): Promise<{ id: string; created: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Account name cannot be empty.");
  const lower = trimmed.toLowerCase();

  const snap = await getDocs(
    query(collection(db, "accounts"), where("uid", "==", uid))
  );
  for (const d of snap.docs) {
    const data = d.data();
    if (data.institutionName) continue;
    const docName = data.name as string | undefined;
    if (docName && docName.trim().toLowerCase() === lower) {
      return { id: d.id, created: false };
    }
  }

  const created = await addDoc(collection(db, "accounts"), {
    uid,
    name: trimmed,
    last4: extractLast4FromName(trimmed),
    accountType: accountType ?? inferAccountTypeFromName(trimmed),
    createdAt: serverTimestamp(),
  });
  return { id: created.id, created: true };
}
