import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import ReviewTable from "./components/ReviewTable";
import { TAX_CATEGORIES } from "./components/CategoryDropdown";
import { useReviewTransactions } from "./hooks/useReviewTransactions";
import YearSelector from "../../components/YearSelector";
import { normalizeCategoryName } from "../../utils/normalizeCategory";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── BulkCategoryPicker ───────────────────────────────────────────────────────
// Replaces the plain <select> in the bulk toolbar.
// Opens upward (above the toolbar), supports search + custom category creation.

interface BulkCategoryPickerProps {
  categoryPool: string[];
  onSelect: (category: string) => void;
  onCustomCategoryAdded: (category: string) => void;
}

function BulkCategoryPicker({ categoryPool, onSelect, onCustomCategoryAdded }: BulkCategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const trimmedSearch = search.trim();
  const filtered = trimmedSearch
    ? categoryPool.filter((c) => c.toLowerCase().includes(trimmedSearch.toLowerCase()))
    : categoryPool;

  const isExact = trimmedSearch
    ? categoryPool.some((c) => normalizeCategoryName(c) === normalizeCategoryName(trimmedSearch))
    : false;
  const showCreate = trimmedSearch !== "" && !isExact;

  function handleSelect(cat: string) {
    onSelect(cat);
    setOpen(false);
    setSearch("");
  }

  function handleCreate() {
    if (!trimmedSearch) return;
    // Resolve to canonical if a normalized match already exists
    const existing = categoryPool.find(
      (c) => normalizeCategoryName(c) === normalizeCategoryName(trimmedSearch)
    );
    const canonical = existing ?? trimmedSearch;
    onSelect(canonical);
    if (!existing) onCustomCategoryAdded(canonical);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: "6px 10px",
          borderRadius: "6px",
          border: "1px solid #334155",
          backgroundColor: open ? "#334155" : "#1e293b",
          color: "#f1f5f9",
          fontSize: "13px",
          cursor: "pointer",
          fontFamily: font,
          outline: "none",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          whiteSpace: "nowrap",
        }}
      >
        Assign category…
        <span style={{ fontSize: "10px", opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          bottom: "calc(100% + 8px)",
          left: 0,
          width: "260px",
          backgroundColor: "#1e293b",
          border: "1px solid #334155",
          borderRadius: "8px",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.45)",
          overflow: "hidden",
          zIndex: 200,
        }}>
          {/* Search input */}
          <div style={{ padding: "8px" }}>
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setSearch(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
                if (e.key === "Enter" && showCreate && filtered.length === 0) handleCreate();
              }}
              placeholder="Search or create category…"
              style={{
                width: "100%",
                padding: "7px 10px",
                borderRadius: "6px",
                border: "1px solid #475569",
                backgroundColor: "#0f172a",
                color: "#f1f5f9",
                fontSize: "13px",
                outline: "none",
                fontFamily: font,
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Results */}
          <div style={{ maxHeight: "240px", overflowY: "auto" }}>
            {filtered.length === 0 && !showCreate && (
              <div style={{ padding: "10px 12px", color: "#64748b", fontSize: "12px" }}>
                No matching categories
              </div>
            )}

            {filtered.map((cat) => (
              <div
                key={cat}
                onMouseDown={() => handleSelect(cat)}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  color: "#f1f5f9",
                  cursor: "pointer",
                  borderBottom: "1px solid #1e2d3d",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#334155")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                {cat}
              </div>
            ))}

            {/* Create new custom category */}
            {showCreate && (
              <div
                onMouseDown={handleCreate}
                style={{
                  padding: "8px 12px",
                  fontSize: "13px",
                  color: "#34d399",
                  cursor: "pointer",
                  borderTop: filtered.length > 0 ? "1px solid #334155" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: 500,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#0f2d1e")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span style={{ fontSize: "14px" }}>+</span>
                Create &ldquo;{trimmedSearch}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ReviewPage ───────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    state,
    allSelected,
    handleEntityChange,
    handleCategoryChange,
    handleTypeChange,
    handleConfirm,
    handleBulkConfirm,
    handleBulkCategoryAssign,
    handleBulkEntityAssign,
    handleAutoCategorizeBatch,
    handleCustomCategoryAdded,
    clearSelection,
    toggleSelect,
    toggleSelectAll,
    reload,
  } = useReviewTransactions();

  const { transactions, entities, customCategories, loading, error, selectedIds, updating } = state;

  const [bulkEntityKey, setBulkEntityKey] = useState(0);
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [autoProgress, setAutoProgress] = useState<{ processed: number; total: number } | null>(null);

  const handleAutoAll = useCallback(async () => {
    setAutoProgress({ processed: 0, total: transactions.length });
    await handleAutoCategorizeBatch("all", (processed, total) =>
      setAutoProgress({ processed, total })
    );
    setAutoProgress(null);
  }, [handleAutoCategorizeBatch, transactions.length]);

  const handleAutoSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setAutoProgress({ processed: 0, total: ids.length });
    await handleAutoCategorizeBatch(ids, (processed, total) =>
      setAutoProgress({ processed, total })
    );
    setAutoProgress(null);
    clearSelection();
  }, [handleAutoCategorizeBatch, selectedIds, clearSelection]);

  const navLink: React.CSSProperties = {
    background: "none", border: "none", fontSize: "14px",
    color: "#6b7280", cursor: "pointer", padding: "4px 0", fontFamily: font,
  };
  const navLinkActive: React.CSSProperties = { ...navLink, color: "#16A34A", fontWeight: 700 };

  const hasSelection = selectedIds.size > 0;

  const accountOptions = Array.from(
    new Set(transactions.map((t) => t.accountName).filter((n): n is string => !!n))
  ).sort();

  const filteredTransactions =
    accountFilter === "all"
      ? transactions
      : transactions.filter((t) => t.accountName === accountFilter);

  // allSelected and toggleSelectAll must reflect the filtered view only.
  const filteredAllSelected = useMemo(
    () =>
      filteredTransactions.length > 0 &&
      filteredTransactions.every((t) => selectedIds.has(t.id)),
    [filteredTransactions, selectedIds]
  );
  const handleToggleSelectAllFiltered = useCallback(() => {
    toggleSelectAll(filteredTransactions.map((t) => t.id));
  }, [toggleSelectAll, filteredTransactions]);

  // Full category pool for the bulk toolbar (no entity-type filtering —
  // bulk assign applies to mixed transactions).
  const bulkCategoryPool = useMemo(() => {
    const predefinedNorms = new Set(TAX_CATEGORIES.map(normalizeCategoryName));
    const extras = customCategories.filter(
      (c) => !predefinedNorms.has(normalizeCategoryName(c))
    );
    return [...TAX_CATEGORIES, ...extras];
  }, [customCategories]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font, paddingBottom: hasSelection ? "80px" : "0" }}>

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e5e7eb",
        padding: "0 32px 10px",
        height: "64px",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "28px" }}>
          <div
            style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }}
            onClick={() => navigate("/dashboard")}
          >
            DIYTax AI
          </div>
          <button style={navLink}       onClick={() => navigate("/dashboard")}>Dashboard</button>
          <button style={navLink}       onClick={() => navigate("/transactions")}>Transaction History</button>
          <button style={navLinkActive}>Review</button>
          <button style={navLink}       onClick={() => navigate("/import-csv")}>Import CSV</button>
          <button style={navLink}       onClick={() => navigate("/tax-summary")}>Business Income & Expenses (Sch. C)</button>
          <button style={navLink}       onClick={() => navigate("/schedule-e")}>Rental Properties (Sch. E)</button>
          <button style={navLink}       onClick={() => navigate("/schedule-a")}>Deductions (Sch. A)</button>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "16px" }}>
          <YearSelector variant="nav" />
          <button style={navLink} onClick={() => navigate("/onboarding")}>Settings</button>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            onClick={() => signOut(auth).then(() => navigate("/login"))}
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* ── Page content ─────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Review Transactions
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              {loading
                ? "Loading…"
                : `${transactions.length} transaction${transactions.length !== 1 ? "s" : ""} need review`}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {!loading && transactions.length > 0 && (
              <button
                onClick={handleAutoAll}
                disabled={!!autoProgress}
                style={{
                  padding: "10px 18px",
                  backgroundColor: autoProgress ? "#d1fae5" : "#16A34A",
                  color: autoProgress ? "#065f46" : "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: autoProgress ? "not-allowed" : "pointer",
                  fontFamily: font,
                  whiteSpace: "nowrap",
                }}
              >
                {autoProgress
                  ? `Processing… ${autoProgress.processed} / ${autoProgress.total}`
                  : "✦ Auto Categorize All"}
              </button>
            )}
            <button
              onClick={reload}
              style={{ padding: "10px 18px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Legend */}
        {!loading && transactions.length > 0 && (
          <div style={{ display: "flex", gap: "20px", marginBottom: "16px", fontSize: "12px", color: "#6b7280", flexWrap: "wrap", alignItems: "center" }}>
            <span>Click any category cell to edit inline</span>
            <span style={{ color: "#d1d5db" }}>·</span>
            <span>
              <span style={{ fontSize: "10px", padding: "1px 6px", backgroundColor: "#fff7ed", color: "#c2410c", borderRadius: "999px", fontWeight: 700, marginRight: "4px" }}>AI</span>
              AI-suggested — review and accept or override
            </span>
            <span style={{ color: "#d1d5db" }}>·</span>
            <span>
              <span style={{ fontSize: "10px", padding: "1px 6px", backgroundColor: "#eff6ff", color: "#1d4ed8", borderRadius: "999px", fontWeight: 700, marginRight: "4px" }}>learned</span>
              Matched a rule from your past edits
            </span>
            <span style={{ color: "#d1d5db" }}>·</span>
            <span>
              <span style={{ fontSize: "10px", padding: "1px 6px", backgroundColor: "#f0fdf4", color: "#15803d", borderRadius: "999px", fontWeight: 700, marginRight: "4px" }}>rule</span>
              Matched a built-in keyword rule
            </span>
          </div>
        )}

        {/* Account filter */}
        {!loading && accountOptions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
            <span style={{ fontSize: "13px", color: "#6b7280", fontWeight: 500 }}>Account:</span>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #d1d5db",
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
            {accountFilter !== "all" && (
              <button
                onClick={() => setAccountFilter("all")}
                style={{ background: "none", border: "none", fontSize: "12px", color: "#9ca3af", cursor: "pointer", fontFamily: font }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {/* Table card */}
        <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)" }}>
          {loading ? (
            <div style={{ padding: "60px 24px", textAlign: "center", color: "#9ca3af", fontSize: "14px" }}>
              Loading transactions…
            </div>
          ) : (
            <ReviewTable
              transactions={filteredTransactions}
              entities={entities}
              customCategories={customCategories}
              selectedIds={selectedIds}
              updating={updating}
              allSelected={filteredAllSelected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={handleToggleSelectAllFiltered}
              onCategoryChange={handleCategoryChange}
              onEntityChange={handleEntityChange}
              onTypeChange={handleTypeChange}
              onConfirm={handleConfirm}
              onCustomCategoryAdded={handleCustomCategoryAdded}
            />
          )}
        </div>

        {/* Footer count */}
        {!loading && filteredTransactions.length > 0 && (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#9ca3af", textAlign: "right" }}>
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${filteredTransactions.length} selected`
              : accountFilter !== "all"
              ? `${filteredTransactions.length} of ${transactions.length} total`
              : `${transactions.length} total`}
          </div>
        )}
      </div>

      {/* ── Bulk action toolbar ────────────────────────────────────────────────── */}
      {hasSelection && (
        <div style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: "#1e293b",
          color: "#f1f5f9",
          padding: "14px 32px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          zIndex: 50,
          boxShadow: "0 -4px 32px rgba(0,0,0,0.25)",
          fontFamily: font,
        }}>

          {/* Selection count */}
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#f1f5f9", marginRight: "4px" }}>
            {selectedIds.size} selected
          </span>

          <div style={{ width: "1px", height: "20px", backgroundColor: "#334155" }} />

          {/* Bulk category assign — now supports predefined + custom + inline creation */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "#94a3b8" }}>Assign category:</span>
            <BulkCategoryPicker
              categoryPool={bulkCategoryPool}
              onSelect={(cat) => handleBulkCategoryAssign([...selectedIds], cat)}
              onCustomCategoryAdded={handleCustomCategoryAdded}
            />
          </div>

          {/* Bulk entity assign */}
          {entities.length > 0 && (
            <>
              <div style={{ width: "1px", height: "20px", backgroundColor: "#334155" }} />
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px", color: "#94a3b8" }}>Assign to:</span>
                <select
                  key={bulkEntityKey}
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    if (val === "__personal__") {
                      handleBulkEntityAssign([...selectedIds], null, "personal");
                    } else {
                      const entity = entities.find((en) => en.id === val);
                      if (entity) handleBulkEntityAssign([...selectedIds], entity.id, entity.type, entity.name);
                    }
                    setBulkEntityKey((k) => k + 1);
                  }}
                  style={{
                    padding: "6px 10px", borderRadius: "6px",
                    border: "1px solid #334155", backgroundColor: "#334155",
                    color: "#f1f5f9", fontSize: "13px", cursor: "pointer",
                    fontFamily: font, outline: "none",
                  }}
                >
                  <option value="" disabled>Assign to…</option>
                  <option value="__personal__">Personal</option>
                  {entities.map((en) => (
                    <option key={en.id} value={en.id}>{en.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Auto Categorize Selected */}
          <div style={{ width: "1px", height: "20px", backgroundColor: "#334155" }} />
          <button
            onClick={handleAutoSelected}
            disabled={!!autoProgress}
            style={{
              padding: "8px 16px", backgroundColor: "#0f172a",
              color: "#94a3b8", border: "1px solid #334155",
              borderRadius: "8px", fontSize: "13px", fontWeight: 600,
              cursor: autoProgress ? "not-allowed" : "pointer", fontFamily: font, whiteSpace: "nowrap",
            }}
          >
            {autoProgress ? `${autoProgress.processed}/${autoProgress.total}…` : "✦ AI Categorize"}
          </button>

          <div style={{ flex: 1 }} />

          {/* Mark as reviewed */}
          <button
            onClick={handleBulkConfirm}
            style={{
              padding: "8px 20px",
              backgroundColor: "#16A34A",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: font,
              whiteSpace: "nowrap",
            }}
          >
            ✓ Mark {selectedIds.size} as Reviewed
          </button>

          {/* Clear selection */}
          <button
            onClick={clearSelection}
            style={{
              padding: "8px 14px",
              backgroundColor: "transparent",
              color: "#94a3b8",
              border: "1px solid #334155",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
