import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { detectAmountSignConvention } from "./classifyTransactionType";
import { ingestTransactionsCore } from "../ingestion/ingestTransactions";
import { RawPlaidInput } from "../ingestion/transactionPipeline";

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

// ─── Fuzzy cross-source dedup ─────────────────────────────────────────────────
// Catches descriptions that differ slightly between Plaid and a prior CSV
// import (e.g. "Amazon.com*K1" vs "AMAZON.COM"). The unified pipeline's
// dedupeHash only catches exact matches, so we pre-filter here before handing
// to ingestTransactionsCore.

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

  // ── Detect amount-sign convention for this account ─────────────────────────
  // Some institutions (e.g. PenFed and many credit unions) invert Plaid's
  // documented sign convention. We auto-detect by sampling transactions Plaid
  // classifies definitively (via PFC, legacy categories, or description keywords)
  // and comparing to the amount sign. Persist on the account doc so it sticks.
  const acctSnap = await db.collection("accounts").doc(accountId).get();
  const acctData = acctSnap.data() ?? {};
  const storedInverted: boolean | undefined = acctData.amountSignInverted;

  const storedIgnoreSign: boolean | undefined = acctData.ignoreAmountSign;
  const detected = detectAmountSignConvention(plaidTransactions);
  let amountSignInverted: boolean;
  let ignoreAmountSign: boolean;
  if (detected === "inverted") {
    amountSignInverted = true;
    ignoreAmountSign = false;
  } else if (detected === "standard") {
    amountSignInverted = false;
    ignoreAmountSign = false;
  } else if (detected === "no-sign-info") {
    // Every txn has the same sign — this account's sign field is meaningless.
    amountSignInverted = false;
    ignoreAmountSign = true;
  } else {
    // Couldn't auto-detect — preserve whatever we already had, default to Plaid standard.
    amountSignInverted = storedInverted ?? false;
    ignoreAmountSign  = storedIgnoreSign ?? false;
  }

  const updates: Record<string, unknown> = {};
  if (detected !== "unknown") {
    if (storedInverted !== amountSignInverted) updates.amountSignInverted = amountSignInverted;
    if (storedIgnoreSign !== ignoreAmountSign) updates.ignoreAmountSign  = ignoreAmountSign;
    if (Object.keys(updates).length > 0) {
      updates.amountSignDetectedAt       = admin.firestore.FieldValue.serverTimestamp();
      updates.amountSignDetectionMethod  = "auto";
      await db.collection("accounts").doc(accountId).update(updates);
      console.log(`[SIGN_CONVENTION] uid=${uid} acct=${accountId} convention=${detected} (was inverted=${storedInverted ?? "unset"}, ignore=${storedIgnoreSign ?? "unset"})`);
    }
  }

  void amountSignInverted; void ignoreAmountSign;

  // ── Pre-filter: cross-system fuzzy dedup (catches CSV/AI imports of same
  // transactions before this Plaid sync) + drop pending + drop wrong-account
  // contamination. Survivors go through the unified ingestion pipeline.
  const dates = plaidTransactions.map((t) => t.date);
  const existingByDate = await buildExistingByDate(db, uid, dates);

  const survivors: RawPlaidInput[] = [];
  let preFilteredOut = 0;

  for (const txn of plaidTransactions) {
    if (txn.pending) { preFilteredOut++; continue; }

    if (plaidAccountId && txn.account_id !== plaidAccountId) {
      console.warn(`[CROSS_ACCT_DROP] uid=${uid} expected=${plaidAccountId} got=${txn.account_id} txn=${txn.transaction_id}`);
      preFilteredOut++;
      continue;
    }

    const description = txn.name ?? "";
    const amount = Math.abs(txn.amount);
    const normDesc = normalize(description);

    // Skip fuzzy match against same-Plaid-but-different-account txns —
    // those are almost always the two sides of an internal transfer.
    const sameDay = existingByDate.get(txn.date) ?? [];
    const isCrossSourceDup = sameDay.some((e) => {
      if (Math.abs(e.amount - amount) > 0.01) return false;
      if (jaccard(normDesc, e.normalizedDescription) < 0.75) return false;
      if (e.source === "plaid" && e.plaidAccountId && e.plaidAccountId !== txn.account_id) return false;
      return true;
    });
    if (isCrossSourceDup) { preFilteredOut++; continue; }

    survivors.push({
      transaction_id: txn.transaction_id,
      account_id:     txn.account_id,
      amount:         txn.amount,
      date:           txn.date,
      name:           txn.name ?? "",
      merchant_name:  txn.merchant_name ?? null,
      personal_finance_category: txn.personal_finance_category
        ? { primary: txn.personal_finance_category.primary ?? null }
        : null,
      category:       (txn.category ?? null) as string[] | null,
      pending:        txn.pending,
    });
  }

  // ── Hand off to unified ingestion pipeline ───────────────────────────────
  const syncLabel = accountLabel ?? "Plaid Sync";
  const report = await ingestTransactionsCore(uid, {
    source:        "plaid",
    accountId,
    transactions:  survivors,
    importLabel:   syncLabel,
  });

  console.log(`[FETCH] uid=${uid} acct=${accountId} prefiltered=${preFilteredOut} ${JSON.stringify(report)}`);

  return report.imported;
}

export const fetchTransactions = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request) => {
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
