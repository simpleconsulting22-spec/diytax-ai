#!/usr/bin/env node
/**
 * READ-ONLY dry run: streaming charges booked to Schedule C.
 *
 * Purpose: before any change to past transactions, show which streaming
 * charges (Netflix, Spotify, ...) are currently counted as Schedule C
 * business expenses, which of those were set automatically (candidates to
 * move to Personal Subscriptions) versus set by the user (left alone), and
 * how the Schedule C expense total would change. It CHANGES NOTHING.
 * Any actual change needs the user's approval and the backup -> apply
 * workflow.
 *
 * Read-only guarantees:
 *   - Only `collection().where().get()` reads are made.
 *   - Every Firestore write entry point (set/update/delete/create on
 *     documents, batch, bulkWriter, runTransaction) is replaced with a
 *     function that throws before anything is sent.
 *
 * Privacy: prints no uids, emails, document ids or account ids. Merchant text
 * is truncated to 32 characters with long digit runs masked.
 *
 * Usage (from the functions/ folder, after `npm run build`):
 *   node scripts/dry-run-streaming-schedule-c.js --email you@example.com --year 2026
 * Requires Application Default Credentials with read access to the project.
 */
const admin = require("firebase-admin");
const { Firestore, DocumentReference, WriteBatch } = require("@google-cloud/firestore");
const { analyzeStreaming } = require("../lib/maintenance/streamingDryRun");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── Read-only guard ────────────────────────────────────────────────────────
const blocked = (what) => () => {
  throw new Error(`dry run is read-only: ${what} is blocked`);
};
for (const m of ["set", "update", "delete", "create"]) DocumentReference.prototype[m] = blocked(`DocumentReference.${m}`);
for (const m of ["set", "update", "delete", "create", "commit"]) WriteBatch.prototype[m] = blocked(`WriteBatch.${m}`);
for (const m of ["batch", "bulkWriter", "runTransaction", "recursiveDelete"]) Firestore.prototype[m] = blocked(`Firestore.${m}`);

(async () => {
  const email = arg("email");
  const year = Number(arg("year", String(new Date().getFullYear())));
  if (!email) {
    console.error("Usage: node scripts/dry-run-streaming-schedule-c.js --email you@example.com [--year 2026]");
    process.exit(2);
  }
  admin.initializeApp({ projectId: arg("project", "diytax-ai") });
  const user = await admin.auth().getUserByEmail(email);
  const snap = await admin.firestore().collection("transactions")
    .where("uid", "==", user.uid).where("taxYear", "==", year).get();
  const r = analyzeStreaming(snap.docs.map((d) => d.data()));

  const usd = (n) => `$${n.toFixed(2)}`;
  console.log(`DRY RUN (read-only) — ${year} — nothing was changed\n`);
  console.log(`Transactions scanned:              ${r.rowsScanned}`);
  console.log(`Schedule C expenses counted now:   ${usd(r.scheduleCExpensesNow)}`);
  console.log(`Streaming charges found:           ${r.streamingCharges}\n`);
  for (const l of r.lines) {
    console.log(`  ${l.date}  ${l.merchant.padEnd(32)} ${usd(l.amount).padStart(9)}  ${l.category} | ${l.schedule} | ${l.status} | set by ${l.setBy} → ${l.proposal}`);
  }
  console.log(`\nProposed (automatic) moves out of Schedule C: ${r.proposedMoves} charges, ${usd(r.proposedMoveTotal)}`);
  console.log(`Schedule C expenses if approved:   ${usd(r.scheduleCExpensesIfMoved)}`);
  console.log(`\nCharges you set yourself are never proposed for change.`);
  process.exit(0);
})().catch((e) => {
  console.error("Dry run failed:", e.message);
  process.exit(1);
});
