"use strict";
/**
 * Entity Prediction Service
 *
 * Predicts the most likely business/rental entity for a transaction based on:
 *   1. A vendor-level categoryRule that already has an entityId stored
 *   2. The most frequently used entity for that category across past
 *      categorized transactions (frequency-based fallback)
 *
 * Returns null entityId when no prediction is possible (e.g. personal
 * transactions or no prior data), so callers should not overwrite an existing
 * user-assigned entity.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.predictEntity = predictEntity;
async function predictEntity(uid, vendor, category, db) {
    const NONE = {
        entityId: null,
        entityName: null,
        entityType: "personal",
        predictionSource: "none",
    };
    // ── 1. Vendor rule lookup ────────────────────────────────────────────────────
    // If this vendor's categoryRule already has an entityId from a previous
    // manual assignment, use it with high confidence.
    if (vendor) {
        const ruleSnap = await db
            .collection("categoryRules")
            .where("uid", "==", uid)
            .where("vendorName", "==", vendor)
            .limit(1)
            .get();
        if (!ruleSnap.empty) {
            const rule = ruleSnap.docs[0].data();
            if (rule.entityId) {
                return {
                    entityId: rule.entityId,
                    entityName: rule.entityName ?? null,
                    entityType: rule.entityType ?? "business",
                    predictionSource: "vendor_rule",
                };
            }
        }
    }
    // ── 2. Category-frequency fallback ──────────────────────────────────────────
    // Look at the last 40 categorized transactions for this category and return
    // whichever entity appears most often.
    if (category) {
        const txnSnap = await db
            .collection("transactions")
            .where("uid", "==", uid)
            .where("category", "==", category)
            .where("status", "==", "categorized")
            .limit(40)
            .get();
        const counts = new Map();
        for (const d of txnSnap.docs) {
            const data = d.data();
            if (data.entityId) {
                const entry = counts.get(data.entityId);
                if (entry) {
                    entry.count++;
                }
                else {
                    counts.set(data.entityId, {
                        count: 1,
                        entityName: data.entityName ?? null,
                        entityType: data.entityType ??
                            "business",
                    });
                }
            }
        }
        if (counts.size > 0) {
            const [bestId, info] = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
            return {
                entityId: bestId,
                entityName: info.entityName,
                entityType: info.entityType,
                predictionSource: "category_frequency",
            };
        }
    }
    return NONE;
}
//# sourceMappingURL=entityPrediction.js.map