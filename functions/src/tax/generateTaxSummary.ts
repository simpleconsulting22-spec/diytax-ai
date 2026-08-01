import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { resolveEffectiveOwner } from "../middleware/auth";
import { summarizeTransactions, SummarizableTransaction } from "./summarizeTransactions";

/**
 * Tax summary for one year. All aggregation lives in `summarizeTransactions`
 * so it can be unit-tested without Firestore; this wrapper only fetches.
 */
export const generateTaxSummary = onCall({ cors: true, invoker: "public" }, async (request) => {
  // Shared users (spouse / accountant) must see the OWNER's data. Using the
  // caller's uid returned an empty summary for every shared user.
  const { effectiveOwnerUid } = await resolveEffectiveOwner(request);

  const data = (request.data ?? {}) as { taxYear?: number };
  const taxYear = data.taxYear ?? new Date().getFullYear();

  const db = admin.firestore();

  const txnsSnap = await db
    .collection("transactions")
    .where("uid", "==", effectiveOwnerUid)
    .where("date", ">=", `${taxYear}-01-01`)
    .where("date", "<=", `${taxYear}-12-31`)
    .get();

  const sessionId = `${effectiveOwnerUid}_${taxYear}`;
  const sessionSnap = await db.collection("taxSessions").doc(sessionId).get();
  const answers = sessionSnap.exists ? (sessionSnap.data()?.answers ?? {}) : {};

  const totals = summarizeTransactions(
    txnsSnap.docs.map((d) => d.data() as SummarizableTransaction)
  );

  return { taxYear, ...totals, answers };
});
