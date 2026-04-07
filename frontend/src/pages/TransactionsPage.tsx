import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "firebase/firestore";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useTaxYear } from "../contexts/TaxYearContext";
import AppNav from "../components/AppNav";
import { useIsMobile } from "../hooks/useIsMobile";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxnRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense" | "transfer" | "refund";
  category: string | null;
  entityName: string | null;
  accountName: string | null;
  status: "categorized" | "needs_review" | "transfer";
}

type TypeFilter   = "all" | "income" | "expense" | "transfer" | "refund";
type StatusFilter = "all" | "categorized" | "needs_review";
type SortCol      = "date" | "description" | "amount" | "category" | null;
type SortDir      = "asc" | "desc";

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

function StatusBadge({ status }: { status: TxnRow["status"] }) {
  const cfg: Record<string, { label: string; bg: string; color: string; border: string }> = {
    categorized:  { label: "Confirmed",    bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
    needs_review: { label: "Needs Review", bg: "#fefce8", color: "#92400e", border: "#fde68a" },
    transfer:     { label: "Transfer",     bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" },
  };
  const c = cfg[status] ?? cfg.needs_review;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: "999px",
      fontSize: "11px",
      fontWeight: 700,
      backgroundColor: c.bg,
      color: c.color,
      border: `1px solid ${c.border}`,
      whiteSpace: "nowrap",
    }}>
      {c.label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransactionHistoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const { selectedYear } = useTaxYear();

  const [rows, setRows]           = useState<TxnRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [categoryPin, setCategoryPin] = useState<string | null>(searchParams.get("category"));
  const [typeFilter, setTypeFilter]     = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sortCol, setSortCol]     = useState<SortCol>("date");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    Promise.all([
      getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", user.uid),
          where("date", ">=", `${selectedYear}-01-01`),
          where("date", "<=", `${selectedYear}-12-31`),
          orderBy("date", "desc")
        )
      ),
      getDocs(query(collection(db, "accounts"), where("uid", "==", user.uid))),
    ]).then(([snap, accountSnap]) => {
      const accountMap = new Map<string, string>();
      accountSnap.docs.forEach((d) =>
        accountMap.set(d.id, (d.data().name as string) ?? d.id)
      );

      const data: TxnRow[] = snap.docs.map((d) => {
        const txn = d.data();
        return {
          id:          d.id,
          date:        (txn.date as string)        ?? "",
          description: (txn.description as string) ?? "",
          amount:      (txn.amount as number)      ?? 0,
          type:        (txn.type as TxnRow["type"]) ?? "expense",
          category:    (txn.category as string)    ?? null,
          entityName:  (txn.entityName as string)  ?? null,
          accountName: txn.accountId
            ? (accountMap.get(txn.accountId as string) ?? null)
            : null,
          status: (txn.status as TxnRow["status"]) ?? "needs_review",
        };
      });

      setRows(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user, selectedYear]);

  // ── Sort handler (3-state: ASC → DESC → reset to date desc) ─────────────────

  function handleSort(col: Exclude<SortCol, null>) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol("date"); setSortDir("desc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function sortIcon(col: Exclude<SortCol, null>): string {
    if (sortCol !== col) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const accountOptions = useMemo(() =>
    Array.from(new Set(rows.map((r) => r.accountName).filter((n): n is string => !!n))).sort(),
  [rows]);

  const filtered = useMemo(() => {
    let list = rows;

    if (categoryPin)
      list = list.filter((r) => r.category === categoryPin);

    if (typeFilter !== "all")
      list = list.filter((r) => r.type === typeFilter);

    if (statusFilter !== "all")
      list = list.filter((r) =>
        statusFilter === "needs_review"
          ? r.status === "needs_review"
          : r.status === "categorized"
      );

    if (accountFilter !== "all")
      list = list.filter((r) => r.accountName === accountFilter);

    if (search.trim())
      list = list.filter((r) =>
        r.description.toLowerCase().includes(search.toLowerCase()) ||
        (r.category ?? "").toLowerCase().includes(search.toLowerCase())
      );

    if (!sortCol) return list;

    return [...list].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortCol === "date")        { av = a.date;                              bv = b.date; }
      if (sortCol === "amount")      { av = a.amount;                            bv = b.amount; }
      if (sortCol === "description") { av = a.description.toLowerCase();         bv = b.description.toLowerCase(); }
      if (sortCol === "category")    { av = (a.category ?? "").toLowerCase();    bv = (b.category ?? "").toLowerCase(); }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [rows, typeFilter, statusFilter, accountFilter, search, sortCol, sortDir]);

  // ── Summary stats (over full unfiltered year) ─────────────────────────────

  const stats = useMemo(() => {
    let income = 0, expenses = 0, needsReview = 0;
    rows.forEach((r) => {
      if (r.type === "income")  income   += r.amount;
      if (r.type === "expense") expenses += Math.abs(r.amount);
      if (r.type === "refund")  expenses -= Math.abs(r.amount);
      if (r.status === "needs_review") needsReview++;
    });
    return { income, expenses, net: income - expenses, needsReview };
  }, [rows]);

  // ── Styles ──────────────────────────────────────────────────────────────────

  const TH: React.CSSProperties = {
    padding: "10px 14px",
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
    padding: "10px 14px",
    fontSize: "13px",
    color: "#374151",
    verticalAlign: "middle",
    borderBottom: "1px solid #f3f4f6",
  };

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    borderRadius: "999px",
    border: "1px solid",
    borderColor: active ? "#16A34A" : "#e5e7eb",
    backgroundColor: active ? "#f0fdf4" : "#fff",
    color: active ? "#15803d" : "#6b7280",
    fontWeight: active ? 700 : 500,
    fontSize: "13px",
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

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>

      <AppNav />

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "16px 12px" : "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Transaction History
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              {loading ? "Loading…" : `${rows.length.toLocaleString()} transactions in ${selectedYear}`}
            </p>
          </div>
          {stats.needsReview > 0 && (
            <button
              onClick={() => navigate("/review")}
              style={{
                padding: "10px 18px",
                backgroundColor: "#fffbeb",
                color: "#92400e",
                border: "1px solid #fde68a",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
                whiteSpace: "nowrap",
              }}
            >
              ⚠ {stats.needsReview} need review →
            </button>
          )}
        </div>

        {/* Summary cards */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "16px", marginBottom: "28px" }}>
            {[
              { label: "Total Income",   value: fmtMoney(stats.income),   color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
              { label: "Total Expenses", value: fmtMoney(stats.expenses),  color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
              { label: "Net",            value: fmtMoney(stats.net),       color: stats.net >= 0 ? "#15803d" : "#dc2626", bg: "#fff", border: "#e5e7eb" },
            ].map((card) => (
              <div key={card.label} style={{
                backgroundColor: card.bg,
                border: `1px solid ${card.border}`,
                borderRadius: "12px",
                padding: "20px 24px",
              }}>
                <div style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: card.color, fontVariantNumeric: "tabular-nums" }}>
                  {card.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filters row */}
        {!loading && rows.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", marginBottom: "16px" }}>

            {/* Type filter */}
            <div style={{ display: "flex", gap: "6px" }}>
              {([
                { key: "all",      label: "All" },
                { key: "income",   label: "Income" },
                { key: "expense",  label: "Expenses" },
                { key: "refund",   label: "Refunds" },
                { key: "transfer", label: "Transfers" },
              ] as const).map(({ key, label }) => (
                <button key={key} style={pillBtn(typeFilter === key)} onClick={() => setTypeFilter(key)}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ width: "1px", height: "24px", backgroundColor: "#e5e7eb" }} />

            {/* Status filter */}
            <div style={{ display: "flex", gap: "6px" }}>
              {([
                { key: "all",         label: "All statuses" },
                { key: "categorized", label: "Confirmed" },
                { key: "needs_review",label: "Needs Review" },
              ] as const).map(({ key, label }) => (
                <button key={key} style={pillBtn(statusFilter === key)} onClick={() => setStatusFilter(key)}>
                  {label}
                </button>
              ))}
            </div>

            {/* Account filter */}
            {accountOptions.length > 0 && (
              <>
                <div style={{ width: "1px", height: "24px", backgroundColor: "#e5e7eb" }} />
                <select
                  value={accountFilter}
                  onChange={(e) => setAccountFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid #e5e7eb",
                    backgroundColor: "#fff",
                    fontSize: "13px",
                    color: "#374151",
                    cursor: "pointer",
                    fontFamily: font,
                    outline: "none",
                  }}
                >
                  <option value="all">All Accounts</option>
                  {accountOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </>
            )}

            {/* Search */}
            <div style={{ flex: 1, minWidth: "180px" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by description or category…"
                style={{
                  width: "100%",
                  padding: "7px 12px",
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  fontSize: "13px",
                  fontFamily: font,
                  outline: "none",
                  color: "#111827",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        )}

        {/* Category pin banner */}
        {categoryPin && !loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "5px 12px", backgroundColor: "#f0fdf4",
              border: "1px solid #bbf7d0", borderRadius: "999px",
              fontSize: "13px", fontWeight: 600, color: "#15803d",
            }}>
              Category: {categoryPin}
              <button
                onClick={() => setCategoryPin(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", fontSize: "14px", padding: 0, lineHeight: 1 }}
                title="Clear category filter"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {/* Result count */}
        {!loading && rows.length > 0 && (
          <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "8px" }}>
            {filtered.length === rows.length
              ? `${rows.length.toLocaleString()} transactions`
              : `${filtered.length.toLocaleString()} of ${rows.length.toLocaleString()} transactions`}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ padding: "60px 24px", textAlign: "center", color: "#9ca3af", fontSize: "14px", backgroundColor: "#fff", borderRadius: "12px" }}>
            Loading your transaction history…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "64px 24px", textAlign: "center", backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)" }}>
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📂</div>
            <div style={{ fontWeight: 700, color: "#111827", fontSize: "16px", marginBottom: "6px" }}>No transactions yet</div>
            <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "20px" }}>Import a CSV file to get started.</div>
            <button
              onClick={() => navigate("/import-csv")}
              style={{ padding: "10px 20px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
            >
              Import CSV
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", backgroundColor: "#fff", borderRadius: "12px", color: "#6b7280", fontSize: "14px" }}>
            No transactions match your filters.{" "}
            <button
              onClick={() => { setTypeFilter("all"); setStatusFilter("all"); setAccountFilter("all"); setSearch(""); setCategoryPin(null); }}
              style={{ background: "none", border: "none", color: "#16A34A", fontWeight: 600, cursor: "pointer", fontFamily: font, fontSize: "14px" }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
              <thead>
                <tr>
                  {sortableTH("date",        "Date",        { width: "80px" })}
                  {sortableTH("description", "Description")}
                  {sortableTH("amount",      "Amount",      { textAlign: "right" })}
                  <th style={{ ...TH, width: "80px" }}>Type</th>
                  {sortableTH("category",    "Category")}
                  <th style={{ ...TH }}>Entity</th>
                  <th style={{ ...TH, width: "110px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr
                    key={row.id}
                    style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#fafafa" }}
                  >
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
                    <td style={{
                      ...TD,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      color: row.type === "income" ? "#15803d" : row.type === "transfer" ? "#9ca3af" : row.type === "refund" ? "#7c3aed" : "#dc2626",
                    }}>
                      {row.type === "income" ? "+" : row.type === "refund" ? "+" : row.type === "expense" ? "−" : ""}
                      {fmtMoney(row.amount)}
                    </td>

                    {/* Type */}
                    <td style={TD}>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: 600,
                        backgroundColor: row.type === "income" ? "#f0fdf4" : row.type === "transfer" ? "#f3f4f6" : row.type === "refund" ? "#f5f3ff" : "#fef2f2",
                        color: row.type === "income" ? "#15803d" : row.type === "transfer" ? "#6b7280" : row.type === "refund" ? "#7c3aed" : "#dc2626",
                      }}>
                        {row.type}
                      </span>
                    </td>

                    {/* Category */}
                    <td style={{ ...TD, color: row.category ? "#374151" : "#d1d5db", fontStyle: row.category ? "normal" : "italic" }}>
                      {row.category ?? "Uncategorized"}
                    </td>

                    {/* Entity */}
                    <td style={{ ...TD, color: row.entityName ? "#374151" : "#d1d5db", fontSize: "12px" }}>
                      {row.entityName ?? "Personal"}
                    </td>

                    {/* Status */}
                    <td style={TD}>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
