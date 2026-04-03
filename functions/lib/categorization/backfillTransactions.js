"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillTransactions = void 0;
exports.backfillTransactionFields = backfillTransactionFields;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const auth_1 = require("../middleware/auth");
// ─── Vendor extraction ────────────────────────────────────────────────────────
// Mirrors the helper in the frontend CSV import hook.
function extractVendor(normalizedDescription) {
    if (!normalizedDescription)
        return "unknown";
    return normalizedDescription.split(" ")[0] || "unknown";
}
/**
 * One-time backfill for transactions that predate the vendor and
 * categorizationSource fields.
 *
 * Safe by design:
 *  - Only writes fields that are missing/falsy — never overwrites existing values.
 *  - Uses batched writes (max 499 per batch) to stay within Firestore limits.
 */
async function backfillTransactionFields(userId) {
    const db = admin.firestore();
    const snap = await db
        .collection("transactions")
        .where("uid", "==", userId)
        .get();
    const docs = snap.docs;
    let processed = 0;
    let updated = 0;
    const BATCH_SIZE = 499;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const chunk = docs.slice(i, i + BATCH_SIZE);
        const batch = db.batch();
        let batchHasWrites = false;
        for (const docSnap of chunk) {
            processed++;
            const txn = docSnap.data();
            const updates = {};
            // vendor: missing or empty → derive from normalizedDescription
            if (!txn.vendor) {
                updates.vendor = extractVendor(txn.normalizedDescription ?? "");
            }
            // categorizationSource: missing → "unknown"
            // (transactions categorized before this field was introduced)
            if (!txn.categorizationSource) {
                updates.categorizationSource = "unknown";
            }
            if (Object.keys(updates).length > 0) {
                batch.update(docSnap.ref, updates);
                updated++;
                batchHasWrites = true;
            }
        }
        if (batchHasWrites) {
            await batch.commit();
        }
    }
    console.log(`[Backfill] uid=${userId} | processed=${processed} | updated=${updated}`);
    return { processed, updated };
}
// ─── Cloud Function ───────────────────────────────────────────────────────────
exports.backfillTransactions = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    const uid = await (0, auth_1.requireAuth)(request);
    return backfillTransactionFields(uid);
});
//# sourceMappingURL=backfillTransactions.js.map