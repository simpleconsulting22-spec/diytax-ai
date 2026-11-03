// Undo the most recent category change on a transaction, using the history
// that every automatic and manual categorization now records.

import * as admin from "firebase-admin";
// Modular FieldValue: the namespace form breaks under the Functions emulator
// (see getTaxForecast.ts).
import { FieldValue } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";
import { requireFreshMfa, resolveEffectiveOwner } from "../middleware/auth";
import { HistoryEntry } from "./decisionPolicy";

export interface UndoResult {
  undone: boolean;
  restored?: HistoryEntry["before"];
  remaining: number;
}

export async function undoCategoryChangeCore(
  db: admin.firestore.Firestore,
  ownerUid: string,
  callerUid: string,
  transactionId: string
): Promise<UndoResult> {
  const ref = db.collection("transactions").doc(transactionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Transaction not found.");
    const t = snap.data()!;
    // Household scope: the verified owner's rows only.
    if (t.uid !== ownerUid) throw new HttpsError("not-found", "Transaction not found.");

    const history = Array.isArray(t.history) ? (t.history as HistoryEntry[]) : [];
    const last = history[history.length - 1];
    if (!last) return { undone: false, remaining: 0 };

    // Reverse only the intended operation: if the row no longer matches what
    // that change produced (something else changed it since), refuse rather
    // than overwrite the later, unrelated change.
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    const current = { category: s(t.category), taxCategory: s(t.taxCategory), taxSchedule: s(t.taxSchedule), status: s(t.status) };
    const a = last.after;
    if (
      current.category !== a.category ||
      current.taxCategory !== a.taxCategory ||
      current.taxSchedule !== a.taxSchedule ||
      current.status !== a.status
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This transaction has changed since that edit, so it can't be undone automatically. Set the category directly instead."
      );
    }

    const restored = last.before;
    tx.update(ref, {
      category: restored.category,
      taxCategory: restored.taxCategory,
      taxSchedule: restored.taxSchedule,
      status: restored.status || "needs_review",
      // After an undo the row is no longer a confirmed user choice unless the
      // restored state itself came from one.
      isUserModified: history.length > 1 && history[history.length - 2].source === "user",
      zachTier: restored.status === "categorized" ? "likely" : "ask",
      history: history.slice(0, -1),
      updatedBy: callerUid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { undone: true, restored, remaining: history.length - 1 };
  });
}

export const undoCategoryChange = onCall({ cors: true, invoker: "public" }, async (request: CallableRequest) => {
  const callerUid = requireFreshMfa(request);
  const transactionId = (request.data as { transactionId?: unknown } | undefined)?.transactionId;
  if (typeof transactionId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(transactionId)) {
    throw new HttpsError("invalid-argument", "transactionId is required.");
  }
  const { effectiveOwnerUid } = await resolveEffectiveOwner(request);
  return undoCategoryChangeCore(admin.firestore(), effectiveOwnerUid, callerUid, transactionId);
});
