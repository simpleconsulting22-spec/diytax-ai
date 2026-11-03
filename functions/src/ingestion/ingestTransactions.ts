import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAuth } from "../middleware/auth";
import {
  Source,
  RawCsvInput,
  RawAiInput,
  RawPlaidInput,
  NormalizedTransaction,
  normalizeTransaction,
  processBatch,
  buildDocId,
} from "./transactionPipeline";
import { runClassificationPipelineForUser } from "../plaid/applyClassificationPipeline";
import { categorizeTransactionLogic } from "../categorization/categorizeTransaction";

export interface IngestReport {
  total:        number;
  imported:     number;
  skipped:      number;     // duplicates + pending-skipped + ALREADY_EXISTS
  errors:       string[];
  importId:     string | null;
}

interface IngestRequest {
  source:      Source;
  accountId:   string;
  transactions: Array<RawCsvInput | RawAiInput | RawPlaidInput>;
  importLabel?: string;
  /**
   * Frontend "import anyway" overrides for rows the dedup engine flagged as
   * exact (or intra-CSV) duplicates. Each entry is the canonical dedupeHash
   * the user wants persisted alongside any existing matching row. Backend
   * gives those rows a unique doc id suffix and tags them with
   * `originalHash` + `isForceImport: true` for lineage.
   */
  forceImportHashes?: string[];
}

const DEDUPE_HASH_IN_LIMIT = 30;   // Firestore "in" operator caps at 30.

/**
 * Core ingestion logic — Plaid sync, CSV import, and AI parser all funnel
 * through this. Steps:
 *
 *   1. Verify the account belongs to the user
 *   2. Normalize every input (canonical shape + dedupe hash)
 *   3. Filter out pending Plaid txns (re-imported when posted)
 *   4. Build user-institutions set so the classifier's internal-payment
 *      detection recognizes user-owned banks
 *   5. processBatch — runs classifier across the whole batch in one pass
 *      (transfer pairing, refund detection, P2P direction inference, etc.)
 *   6. Atomic .create() each doc with deterministic id — race-condition safe
 *   7. Update import record with final counts
 *   8. Run cross-account classification pipeline (catches pairings between
 *      this batch and previously-stored transactions on other accounts)
 *
 * Returns a uniform report.
 */
export async function ingestTransactionsCore(
  uid: string,
  req: IngestRequest,
): Promise<IngestReport> {
  const db = admin.firestore();

  if (!req.source || !req.accountId || !Array.isArray(req.transactions)) {
    throw new HttpsError("invalid-argument", "source, accountId, and transactions are required.");
  }

  // 1. Verify ownership
  const acctSnap = await db.collection("accounts").doc(req.accountId).get();
  if (!acctSnap.exists || acctSnap.data()?.uid !== uid) {
    throw new HttpsError("permission-denied", "Account not found or not owned by user.");
  }

  // 2. Normalize all inputs
  const normalized: NormalizedTransaction[] = req.transactions.map((t) =>
    normalizeTransaction(t, req.source, req.accountId),
  );

  // 3. Skip pending Plaid (will re-import when posted)
  const filtered = normalized.filter((n) => !(n.source === "plaid" && n.pending));
  const pendingSkipped = normalized.length - filtered.length;

  // 4. User institutions (for internal-payment detection in classifier)
  const userAccountsSnap = await db.collection("accounts").where("uid", "==", uid).get();
  const userInstitutions = new Set<string>();
  userAccountsSnap.docs.forEach((d) => {
    const inst = d.data().institutionName as string | undefined;
    if (inst) userInstitutions.add(inst);
  });

  // 5. Process the batch (single classifier pass)
  const processed = processBatch(filtered, userInstitutions);

  const report: IngestReport = {
    total:    req.transactions.length,
    imported: 0,
    skipped:  pendingSkipped,
    errors:   [],
    importId: null,
  };

  // 6. Create import record (so review UI can group + delete batches)
  const importRef = await db.collection("imports").add({
    userId:        uid,
    fileName:      req.importLabel ?? `${req.source} import`,
    source:        req.source,
    accountId:     req.accountId,
    importedCount: 0,
    skippedCount:  0,
    createdAt:     admin.firestore.FieldValue.serverTimestamp(),
  });
  report.importId = importRef.id;

  // 6b. Hash-based dedup pre-flight (CSV / AI only; Plaid keeps its existing
  //     deterministic-doc-id idempotency). Query for any existing transaction
  //     in this account whose dedupeHash matches a row in this batch. The
  //     write loop below uses this set to decide skip vs write — single
  //     source of truth on dedupeHash, doc-id collisions are no longer the
  //     deciding factor (and force-imported rows have unique doc ids anyway).
  const forceSet = new Set(req.forceImportHashes ?? []);
  const existingHashes = req.source === "plaid"
    ? new Set<string>()    // Plaid skips this — its uniqueness is via plaid_transaction_id
    : await fetchExistingDedupeHashes(
        db,
        uid,
        req.accountId,
        filtered.map((n) => n.dedupeHash),
      );
  // Track hashes we've persisted in THIS batch so a CSV with intra-file dupes
  // skips the second occurrence (unless that occurrence is force-imported).
  const writtenInBatch = new Set<string>();

  // 7. Save each transaction with atomic create()
  for (const n of filtered) {
    const isForceImport = forceSet.has(n.dedupeHash);

    // Hash-based dedup decision. Force-imported rows bypass; everything else
    // skips when the hash already exists in Firestore or earlier in this batch.
    if (!isForceImport && (existingHashes.has(n.dedupeHash) || writtenInBatch.has(n.dedupeHash))) {
      report.skipped++;
      continue;
    }

    const docId = buildDocId(n, { forceImport: isForceImport });
    const lookupKey = n.plaidTransactionId ?? n.dedupeHash;
    const proc = processed.get(lookupKey);
    if (!proc) {
      report.errors.push(`No classification for ${lookupKey}`);
      continue;
    }
    const { result, finalType } = proc;
    const taxYear = parseInt(n.date.split("-")[0]) || null;

    const txnData: Record<string, unknown> = {
      uid,
      accountId:             n.accountId,
      importId:              importRef.id,
      source:                n.source,
      date:                  n.date,
      taxYear,
      description:           n.description,
      normalizedDescription: n.normalizedDescription,
      amount:                n.amount,
      plaidSignedAmount:     n.signedAmount,
      type:                  finalType,
      typeSource:            `pipeline:${result.reason}`,
      confidence:            result.confidence,
      // AI transfer with missing direction → force needs_review regardless of
      // what the classifier returned, so the user can confirm the side.
      status:                n.needsManualReview ? "needs_review"
                            : result.status === "auto_resolved" ? "auto_resolved"
                            : result.status === "needs_review" ? "needs_review"
                            : "needs_review",
      category:              "",
      taxCategory:           "",
      taxSchedule:           "",
      dedupeHash:            n.dedupeHash,
      createdAt:             admin.firestore.FieldValue.serverTimestamp(),
    };

    // Plaid-only fields (preserve raw Plaid signals so backfill can re-classify
    // without re-fetching from Plaid)
    if (n.source === "plaid" && n.plaidTransactionId) {
      txnData.plaidTransactionId    = n.plaidTransactionId;
      txnData.plaidAccountId        = n.plaidAccountId;
      txnData.plaidPfcPrimary       = n.plaidPfcPrimary;
      txnData.plaidLegacyCategories = n.plaidLegacyCategories;
    }
    if (result.transferGroupId)     txnData.transferGroupId  = result.transferGroupId;
    if (result.duplicateGroupId)    txnData.duplicateGroupId = result.duplicateGroupId;
    if (result.suggestedDirection)  txnData.suggestedDirection = result.suggestedDirection;
    if (result.excludeFromReports)  txnData.excludeFromReports = true;
    if (n.subType)                  txnData.subType          = n.subType;
    if (n.needsManualReview)        txnData.manualReviewReason = "ai-transfer-direction-missing";
    if (n.aiConfidence)             txnData.aiConfidence     = n.aiConfidence;
    if (n.aiReasoning)              txnData.aiReasoning      = n.aiReasoning;
    if (isForceImport) {
      txnData.originalHash  = n.dedupeHash;
      txnData.isForceImport = true;
    }

    try {
      await db.collection("transactions").doc(docId).create(txnData);
      report.imported++;
      writtenInBatch.add(n.dedupeHash);

      // Categorize newly-imported docs (rules + AI fallback). Skipped for
      // transfer/refund types — those don't go through expense categorization.
      // Best-effort: a categorization failure must not abort the ingest.
      if (finalType === "income" || finalType === "expense") {
        try {
          await categorizeTransactionLogic(uid, docId, n.description, n.description, n.amount);
        } catch (e) {
          console.warn(`[INGEST] categorize failed ${docId}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 6 /* ALREADY_EXISTS */) {
        report.skipped++;
      } else {
        report.errors.push(`${docId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 8. Update import record with final counts
  await importRef.update({
    importedCount: report.imported,
    skippedCount:  report.skipped,
  });

  // 9. Cross-account pipeline run — catches transfer pairings + refunds across
  //    this batch and any previously-saved transactions on other accounts.
  try {
    await runClassificationPipelineForUser(uid);
  } catch (e) {
    console.error("[INGEST] post-ingest classification pipeline error:", e instanceof Error ? e.message : e);
  }

  console.log(`[INGEST] uid=${uid} source=${req.source} acct=${req.accountId} ${JSON.stringify(report)}`);
  return report;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Query Firestore for the subset of `hashes` that already exist as the
 * `dedupeHash` field on a transaction in (uid, accountId). Chunked by 30 to
 * respect the Firestore "in" operator limit. Empty / missing hashes are
 * filtered out (a row with no description+amount has no canonical key and
 * will be handled at write time, not here).
 *
 * Requires composite index: transactions(uid ASC, accountId ASC, dedupeHash ASC).
 */
async function fetchExistingDedupeHashes(
  db:        admin.firestore.Firestore,
  uid:       string,
  accountId: string,
  hashes:    string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  const unique = [...new Set(hashes.filter((h) => h && h.length > 0))];
  if (unique.length === 0) return result;

  for (let i = 0; i < unique.length; i += DEDUPE_HASH_IN_LIMIT) {
    const chunk = unique.slice(i, i + DEDUPE_HASH_IN_LIMIT);
    try {
      const snap = await db
        .collection("transactions")
        .where("uid",        "==", uid)
        .where("accountId",  "==", accountId)
        .where("dedupeHash", "in", chunk)
        .get();
      snap.docs.forEach((d) => {
        const h = d.data().dedupeHash as string | undefined;
        if (h) result.add(h);
      });
    } catch (e) {
      // Index missing or transient query failure — log and continue with
      // whatever we've matched so far. Backend create() collision still
      // protects us as defense-in-depth for any rows we'd've matched here.
      console.warn(
        `[fetchExistingDedupeHashes] chunk ${i}-${i + chunk.length} failed:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return result;
}

// ─── HTTPS callable wrapper ──────────────────────────────────────────────────

export const ingestTransactions = onCall(
  { cors: true, invoker: "public", timeoutSeconds: 540, memory: "1GiB" },
  async (request): Promise<IngestReport> => {
    const uid = await requireAuth(request);
    return ingestTransactionsCore(uid, request.data as IngestRequest);
  },
);
