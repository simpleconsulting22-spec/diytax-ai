import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { fetchTransactionsForAccount } from "./fetchTransactions";

/**
 * Safety-net Plaid sync — runs every 6 hours.
 *
 * Plaid pushes webhooks when new transactions are available, but sometimes
 * those webhooks fail silently (institution outage, item access revoked, our
 * webhook handler errors before it can re-throw, etc.). This cron walks every
 * Plaid-linked account on a schedule and pulls the last 14 days of
 * transactions to backfill anything the webhook missed. The unified ingestion
 * pipeline's dedupe logic ensures already-imported transactions aren't
 * duplicated.
 *
 * Schedule: 3 AM and 3 PM America/Chicago. 2× per day balances data
 * freshness against Plaid API costs (Plaid bills per Transactions Update
 * call). Using America/Chicago timezone keeps the local times stable
 * year-round through Daylight Saving Time transitions.
 *
 * Failures are recorded on the account doc as `lastSyncError` so the UI can
 * surface "this bank hasn't synced in N days" warnings.
 */
export const scheduledPlaidSync = onSchedule(
  {
    schedule: "0 3,15 * * *",
    timeZone: "America/Chicago",
    timeoutSeconds: 540,
    memory: "1GiB",
    retryCount: 0, // we already log errors per-account; whole-job retry isn't useful
  },
  async () => {
    const db = admin.firestore();
    const start = Date.now();

    // Pull every account that has a Plaid access token. We don't filter by
    // last-sync-recency — running them all daily is cheap (Plaid's incremental
    // sync API only returns deltas) and guarantees no stragglers.
    const snap = await db
      .collection("accounts")
      .where("plaidAccessToken", "!=", null)
      .get();

    if (snap.empty) {
      console.log("[scheduledPlaidSync] no Plaid-linked accounts found — skipping");
      return;
    }

    console.log(`[scheduledPlaidSync] starting daily sync of ${snap.size} accounts`);

    // Last 14 days — wide enough to catch anything a missed webhook would have
    // delivered, narrow enough to keep each Plaid call fast.
    const startDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    let succeeded = 0;
    let failed = 0;
    let totalImported = 0;

    // Run sequentially. Plaid rate-limits aggressively; serial calls are safer
    // and 540s is plenty for a few dozen accounts at ~5s each.
    for (const doc of snap.docs) {
      const account = doc.data();
      const uid = account.uid as string | undefined;
      const plaidAccountId = account.plaidAccountId as string | undefined;
      const accessToken = account.plaidAccessToken as string | undefined;

      if (!uid || !accessToken) {
        console.warn(`[scheduledPlaidSync] account ${doc.id} missing uid or accessToken — skipping`);
        continue;
      }

      const label = `${account.institutionName ?? "Bank"} – ${account.accountName ?? ""}`;

      try {
        const imported = await fetchTransactionsForAccount(
          uid,
          doc.id,
          accessToken,
          label,
          startDate,
          plaidAccountId,
        );
        succeeded++;
        totalImported += imported;
        console.log(`[scheduledPlaidSync] ${doc.id} (${label}): imported ${imported}`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduledPlaidSync] ${doc.id} (${label}) failed:`, err);
        // Record the failure so the UI can surface "X hasn't synced in N days".
        await db.collection("accounts").doc(doc.id).update({
          lastSyncError:    message.slice(0, 500),
          lastSyncErrorAt:  admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => undefined);
      }
    }

    const elapsedMs = Date.now() - start;
    console.log(
      `[scheduledPlaidSync] done in ${elapsedMs}ms — ` +
      `succeeded=${succeeded} failed=${failed} imported=${totalImported}`
    );
  }
);
