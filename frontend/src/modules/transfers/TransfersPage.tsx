import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../contexts/TaxYearContext";
import AppNav from "../../components/AppNav";
import { useIsMobile } from "../../hooks/useIsMobile";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Transfer categories ───────────────────────────────────────────────────────

export type TransferCategory =
  | "bank_transfer"
  | "loan_payment"
  | "credit_card_payment"
  | "investment"
  | "education_savings"
  | null;

const TRANSFER_CATEGORIES: Array<{ value: TransferCategory; label: string; color: string; bg: string }> = [
  { value: "bank_transfer",       label: "Bank to Bank",          color: "#2563eb", bg: "#eff6ff" },
  { value: "loan_payment",        label: "Loan Payment",          color: "#7c3aed", bg: "#f5f3ff" },
  { value: "credit_card_payment", label: "Credit Card Payment",   color: "#0891b2", bg: "#ecfeff" },
  { value: "investment",          label: "Investment",            color: "#16A34A", bg: "#f0fdf4" },
  { value: "education_savings",   label: "Education Savings",     color: "#d97706", bg: "#fffbeb" },
];

function categoryMeta(val: TransferCategory) {
  return TRANSFER_CATEGORIES.find((c) => c.value === val) ?? null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransferRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountName: string | null;
  transferCategory: TransferCategory;
  taxYear?: number | null;
}

type SortCol = "date" | "description" | "amount" | "category" | null;
type SortDir = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  if (!d) return "—";
  const [year, m, day] = d.split("-");
  if (!m || !day || !year) return d;
  return `${parseInt(m)}/${parseInt(day)}/${year.slice(2)}`;
}

function fmtMoney(n: number): string {
  return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Category badge ───────────────────────────────────────────────────────────

function CategoryBadge({ value }: { value: TransferCategory }) {
  const meta = categoryMeta(value);
  if (!meta) {
    return (
      <span style={{
        display: "inline-block", padding: "2px 10px", borderRadius: "999px",
        fontSize: "11px", fontWeight: 600,
        backgroundColor: "#f3f4f6", color: "#9ca3af",
      }}>
        Unclassified
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: "999px",
      fontSize: "11px", fontWeight: 600,
      backgroundColor: meta.bg, color: meta.color,
    }}>
      {meta.label}
    </span>
  );
}

// ─── Inline category selector ─────────────────────────────────────────────────

function CategorySelect({
  value,
  disabled,
  onChange,
}: {
  value: TransferCategory;
  disabled: boolean;
  onChange: (val: TransferCategory) => void;
}) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as TransferCategory)}
      style={{
        fontSize: "12px",
        padding: "4px 8px",
        borderRadius: "6px",
        border: "1px solid #d1d5db",
        backgroundColor: disabled ? "#f9fafb" : "#fff",
        color: value ? "#111827" : "#9ca3af",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: font,
        minWidth: "160px",
      }}
    >
      <option value="">Unclassified</option>
      {TRANSFER_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value ?? ""}>{c.label}</option>
      ))}
    </select>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransfersPage() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const { selectedYear } = useTaxYear();
  const isMobile = useIsMobile();

  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterCat, setFilterCat] = useState<TransferCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    Promise.all([
      getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("type", "==", "transfer"),
          orderBy("date", "desc")
        )
      ),
      getDocs(query(collection(db, "accounts"), where("uid", "==", ownerUid))),
    ]).then(([snap, accountSnap]) => {
      const accountMap = new Map<string, string>();
      accountSnap.docs.forEach((d) => {
        const data = d.data();
        const display = (data.name as string)
          ?? (data.accountName as string)
          ?? d.id;
        accountMap.set(d.id, display);
      });

      const data: TransferRow[] = snap.docs
        .map((d) => {
          const txn = d.data();
          return {
            id: d.id,
            date: (txn.date as string) ?? "",
            description: (txn.description as string) ?? "",
            amount: (txn.amount as number) ?? 0,
            accountName: txn.accountId
              ? (accountMap.get(txn.accountId as string) ?? null)
              : null,
            transferCategory: (txn.transferCategory as TransferCategory) ?? null,
            taxYear: txn.taxYear ?? null,
          };
        })
        .filter((t) => matchesTaxYear({ taxYear: t.taxYear, date: t.date }, selectedYear));

      setRows(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user, selectedYear]);

  // ── Sort ────────────────────────────────────────────────────────────────────

  function handleSort(col: Exclude<SortCol, null>) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol("date"); setSortDir("desc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function sortIcon(col: Exclude<SortCol, null>) {
    if (sortCol !== col) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // ── Filtered + sorted rows ──────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = rows;

    if (filterCat !== "all")
      list = list.filter((r) =>
        filterCat === null ? r.transferCategory === null : r.transferCategory === filterCat
      );

    if (search.trim())
      list = list.filter((r) =>
        r.description.toLowerCase().includes(search.toLowerCase())
      );

    if (!sortCol) return list;
    return [...list].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortCol === "date")        { av = a.date;                        bv = b.date; }
      if (sortCol === "amount")      { av = Math.abs(a.amount);            bv = Math.abs(b.amount); }
      if (sortCol === "description") { av = a.description.toLowerCase();   bv = b.description.toLowerCase(); }
      if (sortCol === "category")    { av = a.transferCategory ?? "";       bv = b.transferCategory ?? ""; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, filterCat, search, sortCol, sortDir]);

  // ── Summary counts ──────────────────────────────────────────────────────────

  const unclassifiedCount = rows.filter((r) => !r.transferCategory).length;

  const categoryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const key = r.transferCategory ?? "__none__";
      m[key] = (m[key] ?? 0) + 1;
    }
    return m;
  }, [rows]);

  // ── Single update ───────────────────────────────────────────────────────────

  async function handleCategoryChange(id: string, val: TransferCategory) {
    setUpdating((prev) => new Set([...prev, id]));
    try {
      await updateDoc(doc(db, "transactions", id), {
        transferCategory: val ?? null,
        updatedAt: serverTimestamp(),
      });
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, transferCategory: val } : r))
      );
    } finally {
      setUpdating((prev) => {
        const n = new Set(prev); n.delete(id); return n;
      });
    }
  }

  // ── Bulk update ─────────────────────────────────────────────────────────────

  async function handleBulkAssign(val: TransferCategory) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setUpdating((prev) => new Set([...prev, ...ids]));
    try {
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", id), {
            transferCategory: val ?? null,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      setRows((prev) =>
        prev.map((r) => (ids.includes(r.id) ? { ...r, transferCategory: val } : r))
      );
      setSelectedIds(new Set());
    } finally {
      setUpdating((prev) => {
        const n = new Set(prev);
        ids.forEach((id) => n.delete(id));
        return n;
      });
    }
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  const filteredIds = filtered.map((r) => r.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const TH: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    fontWeight: 600,
    fontSize: "11px",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid #e5e7eb",
    whiteSpace: "nowrap",
    backgroundColor: "#f9fafb",
  };

  const TD: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: "13px",
    color: "#374151",
    verticalAlign: "middle",
    borderBottom: "1px solid #f3f4f6",
  };

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px",
    borderRadius: "999px",
    border: "1px solid",
    borderColor: active ? "#6b7280" : "#e5e7eb",
    backgroundColor: active ? "#f3f4f6" : "#fff",
    color: active ? "#111827" : "#6b7280",
    fontWeight: active ? 700 : 500,
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: font,
    whiteSpace: "nowrap" as const,
  });

  const sortableTH = (col: Exclude<SortCol, null>, label: string, extra?: React.CSSProperties) => (
    <th
      style={{ ...TH, ...extra, cursor: "pointer", userSelect: "none" }}
      onClick={() => handleSort(col)}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ opacity: sortCol === col ? 1 : 0.3, fontSize: "10px" }}>{sortIcon(col)}</span>
    </th>
  );

  const hasSelection = selectedIds.size > 0;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font, paddingBottom: hasSelection ? "80px" : "0" }}>
      <AppNav />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: isMobile ? "16px 12px" : "40px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
            Transfers
          </h1>
          <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
            {loading ? "Loading…" : `${rows.length} transfers in ${selectedYear}${unclassifiedCount > 0 ? ` · ${unclassifiedCount} unclassified` : ""}`}
          </p>
        </div>

        {/* Summary pills */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "20px" }}>
            {/* Totals by category */}
            {TRANSFER_CATEGORIES.map((cat) => {
              const count = categoryCounts[cat.value ?? ""] ?? 0;
              if (count === 0) return null;
              return (
                <div key={cat.value} style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 14px", borderRadius: "999px",
                  backgroundColor: cat.bg, border: `1px solid ${cat.color}22`,
                  fontSize: "12px", fontWeight: 600, color: cat.color,
                }}>
                  {cat.label}
                  <span style={{ backgroundColor: cat.color, color: "#fff", borderRadius: "999px", padding: "0 6px", fontSize: "11px" }}>
                    {count}
                  </span>
                </div>
              );
            })}
            {unclassifiedCount > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "6px 14px", borderRadius: "999px",
                backgroundColor: "#f3f4f6", border: "1px solid #e5e7eb",
                fontSize: "12px", fontWeight: 600, color: "#6b7280",
              }}>
                Unclassified
                <span style={{ backgroundColor: "#9ca3af", color: "#fff", borderRadius: "999px", padding: "0 6px", fontSize: "11px" }}>
                  {unclassifiedCount}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
            <button style={pillBtn(filterCat === "all")} onClick={() => setFilterCat("all")}>All</button>
            <button style={pillBtn(filterCat === null)} onClick={() => setFilterCat(null)}>Unclassified</button>
            {TRANSFER_CATEGORIES.map((cat) => (
              <button key={cat.value} style={pillBtn(filterCat === cat.value)} onClick={() => setFilterCat(cat.value)}>
                {cat.label}
              </button>
            ))}
            <div style={{ flex: 1, minWidth: "180px" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description…"
                style={{
                  width: "100%", padding: "6px 12px", borderRadius: "8px",
                  border: "1px solid #e5e7eb", fontSize: "13px",
                  fontFamily: font, outline: "none", color: "#111827",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        )}

        {/* Result count */}
        {!loading && rows.length > 0 && (
          <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "8px" }}>
            {filtered.length === rows.length
              ? `${rows.length} transfers`
              : `${filtered.length} of ${rows.length} transfers`}
            {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ padding: "60px 24px", textAlign: "center", color: "#9ca3af", fontSize: "14px", backgroundColor: "#fff", borderRadius: "12px" }}>
            Loading transfers…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "64px 24px", textAlign: "center", backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>↔️</div>
            <div style={{ fontWeight: 700, color: "#111827", fontSize: "16px", marginBottom: "6px" }}>No transfers yet</div>
            <div style={{ fontSize: "14px", color: "#6b7280" }}>
              Transactions marked as transfers will appear here.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", backgroundColor: "#fff", borderRadius: "12px", color: "#6b7280", fontSize: "14px" }}>
            No transfers match your filters.{" "}
            <button
              onClick={() => { setFilterCat("all"); setSearch(""); }}
              style={{ background: "none", border: "none", color: "#16A34A", fontWeight: 600, cursor: "pointer", fontFamily: font, fontSize: "14px" }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width: "36px", textAlign: "center" }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                  </th>
                  {sortableTH("date", "Date", { width: "70px" })}
                  {sortableTH("description", "Description")}
                  {sortableTH("amount", "Amount", { textAlign: "right", width: "100px" })}
                  <th style={{ ...TH, width: "130px" }}>Account</th>
                  {sortableTH("category", "Transfer Type", { minWidth: "180px" })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const isUpdating = updating.has(row.id);
                  const isSelected = selectedIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      style={{
                        backgroundColor: isSelected ? "#f0fdf4" : idx % 2 === 0 ? "#fff" : "#fafafa",
                        opacity: isUpdating ? 0.5 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ ...TD, textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isUpdating}
                          onChange={() => toggleSelect(row.id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>

                      {/* Date */}
                      <td style={{ ...TD, color: "#9ca3af", whiteSpace: "nowrap", fontSize: "12px" }}>
                        {fmtDate(row.date)}
                      </td>

                      {/* Description */}
                      <td style={{ ...TD, maxWidth: "300px" }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827", fontWeight: 500 }} title={row.description}>
                          {row.description || "—"}
                        </div>
                      </td>

                      {/* Amount */}
                      <td style={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap", color: "#6b7280" }}>
                        {fmtMoney(row.amount)}
                      </td>

                      {/* Account */}
                      <td style={{ ...TD, fontSize: "12px", color: "#9ca3af" }}>
                        {row.accountName ?? "—"}
                      </td>

                      {/* Transfer type */}
                      <td style={TD}>
                        <CategorySelect
                          value={row.transferCategory}
                          disabled={isUpdating}
                          onChange={(val) => handleCategoryChange(row.id, val)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk action toolbar */}
      {hasSelection && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          backgroundColor: "#1e293b", color: "#f1f5f9",
          padding: "14px 32px",
          display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
          zIndex: 50, boxShadow: "0 -4px 32px rgba(0,0,0,0.25)", fontFamily: font,
        }}>
          <span style={{ fontSize: "14px", fontWeight: 700 }}>{selectedIds.size} selected</span>
          <div style={{ width: "1px", height: "20px", backgroundColor: "#334155" }} />
          <span style={{ fontSize: "13px", color: "#94a3b8" }}>Assign as:</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {TRANSFER_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleBulkAssign(cat.value)}
                style={{
                  padding: "6px 14px", borderRadius: "6px",
                  border: "1px solid #334155", backgroundColor: "#334155",
                  color: "#f1f5f9", fontSize: "12px", fontWeight: 600,
                  cursor: "pointer", fontFamily: font, whiteSpace: "nowrap",
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setSelectedIds(new Set())}
            style={{
              padding: "8px 14px", backgroundColor: "transparent",
              color: "#94a3b8", border: "1px solid #334155",
              borderRadius: "8px", fontSize: "13px", fontWeight: 600,
              cursor: "pointer", fontFamily: font,
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
