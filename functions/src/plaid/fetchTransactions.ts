import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requireAuth } from "../middleware/auth";
import { categorizeTransactionLogic } from "../categorization/categorizeTransaction";
import { classifyTransactionType, detectAmountSignConvention } from "./classifyTransactionType";
import { classifyTransaction, TxnInput } from "./classifyTransactionPipeline";

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
    // ── 0. Skip pending transactions ─────────────────────────────────────────
    // Plaid issues a separate transaction_id for the pending state and another
    // for the posted state of the same real-world transaction. Importing both
    // creates duplicates that look like the same transaction listed twice.
    // Posted is the source of truth; we only persist that.
    if (txn.pending) { skipped++; continue; }

    const description = txn.name ?? "";
    const amount = Math.abs(txn.amount);
    const normDesc = normalize(description);

    // ── 1. Cross-system fuzzy dedup (catches CSV / AI Parser imports) ─────────
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

    // Defense in depth: even though Plaid already filtered by account_ids when we
    // requested it, double-check that the returned txn really belongs to this
    // account. This stops cross-account contamination if Plaid ever returns a
    // wrong-account txn (which we've seen for credit unions in practice).
    if (plaidAccountId && txn.account_id !== plaidAccountId) {
      console.warn(`[CROSS_ACCT_DROP] uid=${uid} expected=${plaidAccountId} got=${txn.account_id} txn=${txn.transaction_id}`);
      skipped++;
      continue;
    }

    // Use Plaid's transaction_id as the Firestore doc ID. With create() this
    // is atomically idempotent — concurrent syncs of the same transaction
    // can't produce duplicate docs (the second create call errors with
    // ALREADY_EXISTS, which we treat as a skip).
    const transactionId = `plaid_${txn.transaction_id}`;
    const merchantName = txn.merchant_name ?? txn.name ?? "";

    // New pipeline: amount sign is the base direction (Plaid's documented
    // convention). Description-based transfer / refund / P2P overrides apply.
    // Cross-account pairing happens in a separate post-fetch sweep
    // (applyClassificationPipeline) since it needs visibility into other
    // accounts' transactions.
    const pipelineInput: TxnInput = {
      plaidTransactionId: txn.transaction_id,
      accountId,
      signedAmount: txn.amount,
      absAmount: amount,
      date: txn.date,
      description,
      merchantName,
    };
    const pipelineResult = classifyTransaction(pipelineInput, [pipelineInput]);
    const type = pipelineResult.type;
    const typeSource = `pipeline:${pipelineResult.reason}`;
    void amountSignInverted; void ignoreAmountSign; void classifyTransactionType;

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

    try {
      await db.collection("transactions").doc(transactionId).create(txnData);
    } catch (err) {
      // ALREADY_EXISTS (Firestore code 6) means this Plaid transaction was
      // already imported (concurrent sync, webhook + initial fetch overlap,
      // etc.). That's a no-op — preserves whatever the user has already done
      // with the existing doc (manual category, type override, etc.).
      const code = (err as { code?: number }).code;
      if (code === 6) { skipped++; continue; }
      throw err;
    }

    // Categorize (only runs for genuinely new transactions)
    await categorizeTransactionLogic(uid, transactionId, merchantName, description, amount);

    imported++;
  }

  // Update import record with final counts
  await importRef.update({ importedCount: imported, skippedCount: skipped });

  // Cross-account pairing + refund detection. Runs after every sync so as new
  // transactions arrive on one account they immediately get paired with their
  // matching counterpart on another account.
  try {
    const { runClassificationPipelineForUser } = await import("./applyClassificationPipeline");
    await runClassificationPipelineForUser(uid);
  } catch (e) {
    console.error("[FETCH] classification pipeline failed:", e instanceof Error ? e.message : e);
  }

  return imported;
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
