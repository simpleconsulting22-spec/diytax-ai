import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import { fetchTransactionsForAccount } from "./fetchTransactions";

/**
 * On-demand "Sync All" — same logic as the daily cron but scoped to the
 * calling user's accounts only. Lets the user verify connection health
 * without waiting for the next scheduled run.
 *
 * Returns per-account succeeded/failed counts plus a small error array so
 * the UI can show "5 of 11 accounts synced — 6 failed (click for details)".
 */
export const syncAllPlaidAccounts = onCall(
  { secrets: ["PLAID_SECRET"], cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
    const uid = await requireAuth(request);
    const db = admin.firestore();

    const snap = await db
      .collection("accounts")
      .where("uid", "==", uid)
      .get();

    if (snap.empty) {
      return { succeeded: 0, failed: 0, skipped: 0, totalImported: 0, errors: [] };
    }

    // Last 14 days — same window as the daily cron.
    const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let totalImported = 0;
    const errors: Array<{ accountId: string; label: string; error: string }> = [];

    for (const doc of snap.docs) {
      const account = doc.data();
      const plaidAccountId = account.plaidAccountId as string | undefined;
      const accessToken    = account.plaidAccessToken as string | undefined;

      // Skip non-Plaid accounts (manual / CSV-imported).
      if (!accessToken) {
        skipped++;
        continue;
      }

      const label = `${account.institutionName ?? "Bank"} – ${account.accountName ?? ""}`;

      try {
        const imported = await fetchTransactionsForAccount(
          uid, doc.id, accessToken, label, startDate, plaidAccountId,
        );
        succeeded++;
        totalImported += imported;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ accountId: doc.id, label, error: message.slice(0, 300) });
        await db.collection("accounts").doc(doc.id).update({
          lastSyncError:    message.slice(0, 500),
          lastSyncErrorAt:  admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => undefined);
      }
    }

    return { succeeded, failed, skipped, totalImported, errors };
  },
);
