import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { categorizeTransactionLogic } from "../categorization/categorizeTransaction";
import { classifyTransactionType } from "./classifyTransactionType";

function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const plaidEnv = process.env.PLAID_ENV ?? "sandbox";

  if (!clientId || !secret) {
    throw new HttpsError("internal", "Plaid credentials not configured.");
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[plaidEnv as keyof typeof PlaidEnvironments] ?? PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

// ─── Fuzzy dedup helpers ──────────────────────────────────────────────────────

// Must match the normalize() function in useCSVImport.ts so descriptions
// stored by CSV imports are comparable to Plaid descriptions.
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function jaccard(a: string, b: string): number {
  const wa = new Set(a.split(/\s+/).filter((w) => w.length > 1));
  const wb = new Set(b.split(/\s+/).filter((w) => w.length > 1));
  let intersection = 0;
  wa.forEach((w) => { if (wb.has(w)) intersection++; });
  const union = wa.size + wb.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// Builds a map of date → existing transactions for cross-system dedup.
// Batches date lookups in groups of 30 (Firestore "in" limit).
interface ExistingTxn {
  amount: number;
  normalizedDescription: string;
  source: string | null;
  plaidAccountId: string | null;
}

async function buildExistingByDate(
  db: admin.firestore.Firestore,
  uid: string,
  dates: string[]
): Promise<Map<string, ExistingTxn[]>> {
  const result = new Map<string, ExistingTxn[]>();
  const uniqueDates = [...new Set(dates)];

  for (let i = 0; i < uniqueDates.length; i += 30) {
    const chunk = uniqueDates.slice(i, i + 30);
    try {
      const snap = await db
        .collection("transactions")
        .where("uid", "==", uid)
        .where("date", "in", chunk)
        .limit(500)
        .get();

      snap.docs.forEach((d) => {
        const data = d.data();
        const date = data.date as string;
        if (!data.normalizedDescription) return;
        if (!result.has(date)) result.set(date, []);
        result.get(date)!.push({
          amount:                data.amount as number,
          normalizedDescription: data.normalizedDescription as string,
          source:                (data.source as string | undefined) ?? null,
          plaidAccountId:        (data.plaidAccountId as string | undefined) ?? null,
        });
      });
    } catch {
      // Index may not exist — skip fuzzy dedup for this chunk
    }
  }

  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchTransactionsForAccount(
  uid: string,
  accountId: string,
  accessToken: string,
  accountLabel?: string,
  startDate?: string,
  plaidAccountId?: string
): Promise<number> {
  const plaidClient = getPlaidClient();
  const db = admin.firestore();

  const endDate = new Date().toISOString().split("T")[0];

  // First sync (no prior transactions for this account) → 24 months of history.
  // Ongoing syncs → 90 days. Caller can override via startDate.
  let resolvedStart: string;
  if (startDate) {
    resolvedStart = startDate;
  } else {
    const existing = await db.collection("transactions")
      .where("uid", "==", uid)
      .where("accountId", "==", accountId)
      .limit(1)
      .get();
    const isFirstSync = existing.empty;
    const daysBack = isFirstSync ? 730 : 90;
    resolvedStart = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
      .toISOString().split("T")[0];
  }

  // Plaid caps each call at 500 transactions — paginate until we've fetched all.
  const plaidTransactions: Awaited<ReturnType<typeof plaidClient.transactionsGet>>["data"]["transactions"] = [];
  let offset = 0;
  let totalAvailable = Infinity;
  while (offset < totalAvailable) {
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: resolvedStart,
      end_date: endDate,
      options: {
        count: 500,
        offset,
        ...(plaidAccountId ? { account_ids: [plaidAccountId] } : {}),
      },
    });
    plaidTransactions.push(...response.data.transactions);
    totalAvailable = response.data.total_transactions;
    if (response.data.transactions.length === 0) break;
    offset += response.data.transactions.length;
  }

  console.log(`[PLAID_FETCH] uid=${uid} acct=${accountId} from=${resolvedStart} to=${endDate} fetched=${plaidTransactions.length}/${totalAvailable}`);

  // Create an import record so this batch can be found / deleted later
  const importRef = db.collection("imports").doc();
  const importId = importRef.id;
  const syncLabel = accountLabel ?? "Plaid Sync";
  await importRef.set({
    userId: uid,
    fileName: syncLabel,
    importedCount: 0,
    skippedCount: 0,
    source: "plaid",
    accountId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Pre-build lookup of existing transactions by date for cross-system fuzzy dedup
  const dates = plaidTransactions.map((t) => t.date);
  const existingByDate = await buildExistingByDate(db, uid, dates);

  let imported = 0;
  let skipped = 0;

  for (const txn of plaidTransactions) {
    // ── 1. Plaid-to-Plaid exact dedup ────────────────────────────────────────
    const plaidDup = await db
      .collection("transactions")
      .where("plaidTransactionId", "==", txn.transaction_id)
      .limit(1)
      .get();

    if (!plaidDup.empty) { skipped++; continue; }

    const description = txn.name ?? "";
    const amount = Math.abs(txn.amount);
    const normDesc = normalize(description);

    // ── 2. Cross-system fuzzy dedup (catches CSV / AI Parser imports) ─────────
    // Skip the fuzzy match when the existing transaction is also from Plaid but
    // tied to a DIFFERENT plaid account — those are almost always the two sides
    // of an internal transfer (e.g. checking → savings) and both should be kept.
    const sameDay = existingByDate.get(txn.date) ?? [];
    const isCsvDup = sameDay.some((e) => {
      if (Math.abs(e.amount - amount) > 0.01) return false;
      if (jaccard(normDesc, e.normalizedDescription) < 0.75) return false;
      if (e.source === "plaid" && e.plaidAccountId && e.plaidAccountId !== txn.account_id) {
        return false;
      }
      return true;
    });

    if (isCsvDup) { skipped++; continue; }

    const transactionId = db.collection("transactions").doc().id;
    const merchantName = txn.merchant_name ?? txn.name ?? "";

    const { type, source: typeSource } = classifyTransactionType(txn);

    // DIAGNOSTIC — log every transaction across every connected account
    console.log(`[TXN_DEBUG] uid=${uid} acct=${plaidAccountId ?? "all"} name="${txn.name}" amount=${txn.amount} pfc="${(txn.personal_finance_category?.primary ?? "").toUpperCase()}" legacy=${JSON.stringify(txn.category ?? [])} type=${type} src=${typeSource}`);

    const taxYear = parseInt(txn.date.split("-")[0]);

    const txnData = {
      transactionId,
      uid,
      accountId,
      importId,
      plaidTransactionId: txn.transaction_id,
      plaidAccountId: txn.account_id,
      amount,
      type,
      typeSource,
      taxYear,
      date: txn.date,
      description,
      normalizedDescription: normDesc,
      merchantName,
      // Raw Plaid signals — kept so backfill can re-classify without re-fetching
      plaidSignedAmount: txn.amount,
      plaidPfcPrimary: txn.personal_finance_category?.primary ?? null,
      plaidLegacyCategories: (txn.category ?? []) as string[],
      category: "",
      taxCategory: "",
      taxSchedule: "",
      aiCategory: "",
      confidenceScore: 0,
      status: "needs_review",
      source: "plaid",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("transactions").doc(transactionId).set(txnData);

    // Categorize
    await categorizeTransactionLogic(uid, transactionId, merchantName, description, amount);

    imported++;
  }

  // Update import record with final counts
  await importRef.update({ importedCount: imported, skippedCount: skipped });

  return imported;
}

export const fetchTransactions = onCall({ cors: true, invoker: "public" }, async (request) => {
  const uid = await requireAuth(request);

  const data = request.data as { accountId?: string; startDate?: string };
  if (!data.accountId) {
    throw new HttpsError("invalid-argument", "accountId is required.");
  }

  const db = admin.firestore();
  const accountSnap = await db.collection("accounts").doc(data.accountId).get();

  if (!accountSnap.exists) {
    throw new HttpsError("not-found", "Account not found.");
  }

  const account = accountSnap.data()!;
  if (account.uid !== uid) {
    throw new HttpsError("permission-denied", "Access denied.");
  }

  const imported = await fetchTransactionsForAccount(
    uid,
    data.accountId,
    account.plaidAccessToken,
    undefined,
    data.startDate,
    account.plaidAccountId as string | undefined,
  );

  return { imported };
});
