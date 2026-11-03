// Manage Categories — owner-only housekeeping page.
//
// Two surfaces:
//   1. Your Categories: lists every category that appears on the user's
//      transactions (with row counts) and lets the user merge a "from"
//      category into a "to" category. Calls the existing mergeCategories
//      Cloud Function which atomically rewrites every txn + adds an alias
//      on the target category doc + removes the source from the user's
//      customCategories list.
//
//   2. Saved Rules: lists categoryRules docs (vendor → category) and lets
//      the user delete bad ones surgically. Used to fix poisoned rules
//      that keep firing on imports (e.g. an "ach debit nsf fee" → "Laundry"
//      rule saved by accident).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection, query, where, getDocs, deleteDoc, doc, type DocumentData,
} from "firebase/firestore";
import { Trash2 } from "lucide-react";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import AppNav from "../../components/AppNav";
import { apiClient } from "../../services/apiClient";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface CategoryRow {
  name:     string;
  /** Count of transactions currently using this exact category string */
  txnCount: number;
}

interface RuleRow {
  id:           string;
  vendorName:   string;
  category?:    string;
  taxCategory?: string;
  taxSchedule?: string;
  entityName?:  string;
  usageCount?:  number;
  updatedAt?:   { seconds: number } | null;
}

export default function CategoriesPage() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";

  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [rules,      setRules]      = useState<RuleRow[]>([]);

  // Merge UI state
  const [sourceCat, setSourceCat] = useState<string>("");
  const [targetCat, setTargetCat] = useState<string>("");
  const [merging,   setMerging]   = useState(false);
  const [mergeMsg,  setMergeMsg]  = useState<string | null>(null);

  // Per-rule deletion state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ownerUid) return;
    setLoading(true);
    setError("");
    try {
      const [txnSnap, rulesSnap] = await Promise.all([
        getDocs(query(collection(db, "transactions"), where("uid", "==", ownerUid))),
        getDocs(query(collection(db, "categoryRules"), where("uid", "==", ownerUid))),
      ]);

      // Aggregate categories from transactions
      const counts = new Map<string, number>();
      txnSnap.docs.forEach((d) => {
        const data = d.data() as DocumentData;
        const cat = (data.category as string | undefined)?.trim();
        if (!cat) return;
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
      });
      const cats: CategoryRow[] = Array.from(counts.entries())
        .map(([name, txnCount]) => ({ name, txnCount }))
        .sort((a, b) => b.txnCount - a.txnCount);
      setCategories(cats);

      // Rules
      const ruleRows: RuleRow[] = rulesSnap.docs.map((d) => {
        const x = d.data() as DocumentData;
        return {
          id:           d.id,
          vendorName:   (x.vendorName as string) ?? "(no vendor)",
          category:     x.category as string | undefined,
          taxCategory:  x.taxCategory as string | undefined,
          taxSchedule:  x.taxSchedule as string | undefined,
          entityName:   x.entityName as string | undefined,
          usageCount:   typeof x.usageCount === "number" ? x.usageCount : undefined,
          updatedAt:    (x.updatedAt as { seconds: number } | null) ?? null,
        };
      }).sort((a, b) =>
        (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0)
      );
      setRules(ruleRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  }, [ownerUid]);

  useEffect(() => { load(); }, [load]);

  const canMerge = useMemo(
    () => !!sourceCat && !!targetCat && sourceCat !== targetCat && !merging,
    [sourceCat, targetCat, merging],
  );

  const sourceTxnCount = useMemo(
    () => categories.find((c) => c.name === sourceCat)?.txnCount ?? 0,
    [categories, sourceCat],
  );

  async function doMerge() {
    if (!canMerge) return;
    const ok = window.confirm(
      `Merge "${sourceCat}" into "${targetCat}"?\n\n` +
      `This will rewrite ${sourceTxnCount} transaction${sourceTxnCount !== 1 ? "s" : ""} ` +
      `and remove "${sourceCat}" from your category list. This cannot be undone.`
    );
    if (!ok) return;
    setMerging(true);
    setMergeMsg(null);
    try {
      const res = await apiClient.call<{ updatedCount: number }>(
        "mergeCategories",
        { sourceCategory: sourceCat, targetCategory: targetCat },
      );
      setMergeMsg(`Merged ${res.updatedCount} transaction${res.updatedCount !== 1 ? "s" : ""}.`);
      setSourceCat("");
      setTargetCat("");
      await load();
    } catch (e) {
      setMergeMsg(e instanceof Error ? `Failed: ${e.message}` : "Merge failed.");
    } finally {
      setMerging(false);
    }
  }

  async function deleteRule(rule: RuleRow) {
    const ok = window.confirm(
      `Delete the rule for "${rule.vendorName}"?\n\n` +
      `Existing transactions stay categorized as ${rule.category || "(no category)"}, but ` +
      `future imports will not auto-apply this rule.`
    );
    if (!ok) return;
    setDeletingId(rule.id);
    try {
      await deleteDoc(doc(db, "categoryRules", rule.id));
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "32px 20px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Manage Categories
        </h1>
        <p style={{ color: "#6b7280", margin: "0 0 24px", fontSize: "13px" }}>
          Merge duplicate categories and clean up saved rules that came from past mistakes.
        </p>

        {error && (
          <div style={{
            padding: "12px 14px", marginBottom: "16px",
            backgroundColor: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: "8px", fontSize: "13px", color: "#991b1b",
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af" }}>Loading…</div>
        ) : (
          <>
            {/* ── Section 1: Your Categories + Merge ─────────────────────── */}
            <section style={Section}>
              <h2 style={H2}>Your Categories</h2>
              <p style={Sub}>
                Pick a "merge from" category and a "merge into" target. We'll rewrite
                every matching transaction and remove the source category.
              </p>

              {categories.length === 0 ? (
                <div style={Empty}>No categorized transactions yet.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: "12px", marginBottom: "12px", flexWrap: "wrap" }}>
                    <Select
                      label="Merge from"
                      value={sourceCat}
                      onChange={setSourceCat}
                      options={categories.map((c) => ({ value: c.name, label: `${c.name} (${c.txnCount})` }))}
                    />
                    <Select
                      label="Merge into"
                      value={targetCat}
                      onChange={setTargetCat}
                      options={categories.filter((c) => c.name !== sourceCat).map((c) => ({ value: c.name, label: `${c.name} (${c.txnCount})` }))}
                      disabled={!sourceCat}
                    />
                    <button
                      onClick={doMerge}
                      disabled={!canMerge}
                      style={{
                        alignSelf: "flex-end",
                        padding: "9px 18px",
                        backgroundColor: canMerge ? "#16A34A" : "#d1d5db",
                        color: "#fff",
                        border: "none",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: canMerge ? "pointer" : "not-allowed",
                        fontFamily: font,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {merging ? "Merging…" : "Merge"}
                    </button>
                  </div>
                  {mergeMsg && (
                    <div style={{
                      padding: "8px 12px", marginBottom: "12px",
                      backgroundColor: "#eff6ff", border: "1px solid #bfdbfe",
                      borderRadius: "8px", fontSize: "12px", color: "#1d4ed8",
                    }}>
                      ✓ {mergeMsg}
                    </div>
                  )}
                  <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f9fafb" }}>
                          <th style={TH}>Category</th>
                          <th style={{ ...TH, textAlign: "right" }}>Transactions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categories.map((c) => (
                          <tr key={c.name} style={{ borderTop: "1px solid #f3f4f6" }}>
                            <td style={TD}>{c.name}</td>
                            <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {c.txnCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            {/* ── Section 2: Saved Rules ─────────────────────────────────── */}
            <section style={Section}>
              <h2 style={H2}>Saved Rules</h2>
              <p style={Sub}>
                Rules learned from your past corrections. They auto-categorize matching
                vendors on future imports. Delete a rule if it was saved by mistake — existing
                transactions are not affected.
              </p>

              {rules.length === 0 ? (
                <div style={Empty}>No saved rules yet.</div>
              ) : (
                <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#f9fafb" }}>
                        <th style={TH}>Vendor</th>
                        <th style={TH}>Category</th>
                        <th style={TH}>Tax / Entity</th>
                        <th style={{ ...TH, textAlign: "right" }}>Used</th>
                        <th style={{ ...TH, textAlign: "right", width: "80px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((r) => {
                        const isDeleting = deletingId === r.id;
                        return (
                          <tr key={r.id} style={{ borderTop: "1px solid #f3f4f6", opacity: isDeleting ? 0.5 : 1 }}>
                            <td style={TD}><strong>{r.vendorName}</strong></td>
                            <td style={TD}>{r.category || <span style={{ color: "#9ca3af" }}>—</span>}</td>
                            <td style={{ ...TD, fontSize: "11px", color: "#6b7280" }}>
                              {[r.taxSchedule, r.taxCategory, r.entityName].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {r.usageCount ?? 0}
                            </td>
                            <td style={{ ...TD, textAlign: "right" }}>
                              <button
                                onClick={() => deleteRule(r)}
                                disabled={isDeleting}
                                title={`Delete the saved rule for "${r.vendorName}"`}
                                style={{
                                  background: "none",
                                  border: "1px solid #fecaca",
                                  color: "#991b1b",
                                  borderRadius: "6px",
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  cursor: isDeleting ? "not-allowed" : "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                <Trash2 size={12} strokeWidth={2.2} />
                                {isDeleting ? "Deleting…" : "Delete"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ────────────────────────────────────────────

function Select({
  label, value, onChange, options, disabled,
}: {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  options:  Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <div style={{ flex: "1 1 220px", minWidth: "220px" }}>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: "13px",
          borderRadius: "8px",
          border: "1px solid #d1d5db",
          backgroundColor: disabled ? "#f9fafb" : "#fff",
          color: "#111827",
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: font,
        }}
      >
        <option value="">— select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

const Section: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "12px",
  boxShadow: "0 1px 8px rgba(0,0,0,0.05)",
  padding: "20px 22px",
  marginBottom: "20px",
};
const H2: React.CSSProperties = { fontSize: "16px", fontWeight: 700, color: "#111827", margin: "0 0 4px" };
const Sub: React.CSSProperties = { color: "#6b7280", fontSize: "12px", margin: "0 0 14px" };
const Empty: React.CSSProperties = { padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" };
const TH: React.CSSProperties = {
  padding: "8px 12px", textAlign: "left", fontWeight: 600,
  fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: "1px solid #e5e7eb",
};
const TD: React.CSSProperties = { padding: "8px 12px", color: "#111827" };
