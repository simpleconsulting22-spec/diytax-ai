import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import ReviewTable from "./components/ReviewTable";
import { TAX_CATEGORIES } from "./components/CategoryDropdown";
import { useReviewTransactions } from "./hooks/useReviewTransactions";
import AppNav from "../../components/AppNav";
import { normalizeCategoryName } from "../../utils/normalizeCategory";
import { useIsMobile } from "../../hooks/useIsMobile";

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

  const [statusFilter, setStatusFilter] = useState<"needs_review" | "categorized">("needs_review");

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
    handleBulkAccountAssign,
    handleAutoCategorizeBatch,
    handleApplySimilar,
    handleCustomCategoryAdded,
    clearSelection,
    toggleSelect,
    toggleSelectAll,
    acceptCategoryPrompt,
    dismissCategoryPrompt,
    reload,
  } = useReviewTransactions(statusFilter);

  const { transactions, entities, customCategories, loading, error, selectedIds, updating, pendingCategoryPrompt } = state;

  const isMobile = useIsMobile();
  const isCategorizedView = statusFilter === "categorized";

  const [bulkEntityKey, setBulkEntityKey] = useState(0);
  const [bulkAccountName, setBulkAccountName] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [filterAccountInput, setFilterAccountInput] = useState("");
  const [applyingFilterAccount, setApplyingFilterAccount] = useState(false);
  const [autoProgress, setAutoProgress] = useState<{ processed: number; total: number } | null>(null);
  const [autoToast, setAutoToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string, isError = false) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAutoToast({ message, isError });
    toastTimerRef.current = setTimeout(() => setAutoToast(null), 6000);
  }

  // Pre-fill the account name input when the filter changes to a named account
  useEffect(() => {
    if (accountFilter !== "all" && accountFilter !== "__blank__") {
      setFilterAccountInput(accountFilter);
    } else {
      setFilterAccountInput("");
    }
  }, [accountFilter]);

  const handleAutoAll = useCallback(async () => {
    setAutoProgress({ processed: 0, total: transactions.length });
    const result = await handleAutoCategorizeBatch("all", (processed, total) =>
      setAutoProgress({ processed, total })
    );
    setAutoProgress(null);
    if (result.error) {
      showToast(`Error: ${result.error}`, true);
    } else if (result.categorized === 0 && result.skipped === 0) {
      showToast("No transactions to categorize.");
    } else {
      showToast(`Categorized ${result.categorized} transaction${result.categorized !== 1 ? "s" : ""}. ${result.skipped > 0 ? `${result.skipped} skipped.` : ""}`);
    }
  }, [handleAutoCategorizeBatch, transactions.length]);

  const handleAutoSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setAutoProgress({ processed: 0, total: ids.length });
    const result = await handleAutoCategorizeBatch(ids, (processed, total) =>
      setAutoProgress({ processed, total })
    );
    setAutoProgress(null);
    clearSelection();
    if (result.error) {
      showToast(`Error: ${result.error}`, true);
    } else {
      showToast(`Categorized ${result.categorized} transaction${result.categorized !== 1 ? "s" : ""}. ${result.skipped > 0 ? `${result.skipped} skipped.` : ""}`);
    }
  }, [handleAutoCategorizeBatch, selectedIds, clearSelection]);

  const hasSelection = selectedIds.size > 0;

  const accountOptions = Array.from(
    new Set(transactions.map((t) => t.accountName).filter((n): n is string => !!n))
  ).sort();

  const hasBlankAccounts = transactions.some((t) => !t.accountName?.trim());

  const filteredTransactions =
    accountFilter === "all"
      ? transactions
      : accountFilter === "__blank__"
      ? transactions.filter((t) => !t.accountName?.trim())
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

  const handleApplyFilterAccount = useCallback(async () => {
    const name = filterAccountInput.trim();
    if (!name || filteredTransactions.length === 0) return;
    setApplyingFilterAccount(true);
    await handleBulkAccountAssign(filteredTransactions.map((t) => t.id), name);
    setApplyingFilterAccount(false);
  }, [filterAccountInput, filteredTransactions, handleBulkAccountAssign]);

  // Full category pool for the bulk toolbar (no entity-type filtering —
  // bulk assign applies to mixed transactions).
  const bulkCategoryPool = useMemo(() => {
    const predefinedNorms = new Set(TAX_CATEGORIES.map(normalizeCategoryName));
    const extras = customCategories.filter(
      (c) => !predefinedNorms.has(normalizeCategoryName(c))
    );
    return [...TAX_CATEGORIES, ...extras];
  }, [customCategories]);

  // Compute vendor groups for "Apply to Similar" panel.
  // Shows groups with 2+ transactions where a majority share the same category suggestion.
  const similarGroups = useMemo(() => {
    if (loading) return [];

    const groups = new Map<string, typeof filteredTransactions>();
    for (const txn of filteredTransactions) {
      const key = txn.vendor?.trim().toLowerCase();
      if (!key || key.length < 2) continue;
      const arr = groups.get(key) ?? [];
      arr.push(txn);
      groups.set(key, arr);
    }

    const result: Array<{
      vendor: string;
      ids: string[];
      suggestedCategory: string;
      suggestedEntityId: string | null;
      suggestedEntityType: "business" | "rental" | "personal";
      suggestedEntityName: string | undefined;
      totalCount: number;
    }> = [];

    for (const [vendor, txns] of groups) {
      if (txns.length < 2) continue;

      // Derive suggestion from transactions that already have a category
      const withCat = txns.filter((t) => t.category);
      if (withCat.length === 0) continue;

      // Most common category
      const catCounts = new Map<string, number>();
      for (const t of withCat) {
        if (t.category) catCounts.set(t.category, (catCounts.get(t.category) ?? 0) + 1);
      }
      const topCat = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!topCat || topCat[1] < withCat.length * 0.5) continue;

      // Most common entity
      const entityCounts = new Map<string, number>();
      for (const t of withCat) {
        const ek = t.entityId ?? "__personal__";
        entityCounts.set(ek, (entityCounts.get(ek) ?? 0) + 1);
      }
      const topEntityKey = [...entityCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const topEntityObj = (topEntityKey && topEntityKey !== "__personal__")
        ? entities.find((e) => e.id === topEntityKey) ?? null
        : null;

      // Surface rows missing a category, or whose entity doesn't match the majority entity
      const needsAction = txns.filter((t) => {
        if (!t.category) return true;
        if (topEntityObj && t.entityId !== topEntityObj.id) return true;
        return false;
      });
      if (needsAction.length === 0) continue;

      result.push({
        vendor,
        ids: needsAction.map((t) => t.id),
        suggestedCategory: topCat[0],
        suggestedEntityId: topEntityObj?.id ?? null,
        suggestedEntityType: topEntityObj?.type ?? "personal",
        suggestedEntityName: topEntityObj?.name,
        totalCount: txns.length,
      });
    }

    return result.sort((a, b) => b.ids.length - a.ids.length).slice(0, 8);
  }, [filteredTransactions, entities, isCategorizedView, loading]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font, paddingBottom: hasSelection ? (isMobile ? "160px" : "80px") : "0" }}>

      <AppNav />

      {/* ── Page content ─────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: isMobile ? "16px 12px" : "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Review Transactions
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              {loading
                ? "Loading…"
                : isCategorizedView
                ? `${transactions.length} categorized transaction${transactions.length !== 1 ? "s" : ""} — click any category to edit`
                : `${transactions.length} transaction${transactions.length !== 1 ? "s" : ""} need review`}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {/* Toggle pills */}
            <div style={{ display: "flex", backgroundColor: "#f3f4f6", borderRadius: "8px", padding: "3px", gap: "2px" }}>
              {(["needs_review", "categorized"] as const).map((val) => (
                <button
                  key={val}
                  onClick={() => { setStatusFilter(val); clearSelection(); }}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: font,
                    backgroundColor: statusFilter === val ? "#fff" : "transparent",
                    color: statusFilter === val ? "#111827" : "#6b7280",
                    boxShadow: statusFilter === val ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {val === "needs_review" ? "Uncategorized" : "Categorized"}
                </button>
              ))}
            </div>

            {!isCategorizedView && !loading && transactions.length > 0 && (
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

        {/* Auto-categorize result toast */}
        {autoToast && (
          <div style={{
            marginBottom: "12px",
            padding: "12px 16px",
            borderRadius: "8px",
            backgroundColor: autoToast.isError ? "#fef2f2" : "#f0fdf4",
            border: `1px solid ${autoToast.isError ? "#fca5a5" : "#86efac"}`,
            color: autoToast.isError ? "#b91c1c" : "#15803d",
            fontSize: "14px",
            fontWeight: 500,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: font,
          }}>
            <span>{autoToast.message}</span>
            <button
              onClick={() => setAutoToast(null)}
              aria-label="Dismiss"
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", lineHeight: 1, padding: "4px 0 4px 12px", display: "flex", alignItems: "center" }}
            >
              <X size={16} strokeWidth={2.4} />
            </button>
          </div>
        )}

        {/* Legend */}
        {!loading && !isCategorizedView && transactions.length > 0 && (
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
        {!loading && (accountOptions.length > 0 || hasBlankAccounts) && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
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
              {hasBlankAccounts && (
                <option value="__blank__">— No Account —</option>
              )}
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

            {/* Set account for all filtered */}
            {accountFilter !== "all" && filteredTransactions.length > 0 && (
              <>
                <div style={{ width: "1px", height: "20px", backgroundColor: "#e5e7eb" }} />
                <span style={{ fontSize: "13px", color: "#6b7280", whiteSpace: "nowrap" }}>
                  Set account for {filteredTransactions.length}:
                </span>
                <input
                  type="text"
                  value={filterAccountInput}
                  onChange={(e) => setFilterAccountInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleApplyFilterAccount(); }}
                  placeholder="Account name…"
                  style={{
                    padding: "5px 10px",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    fontSize: "13px",
                    fontFamily: font,
                    outline: "none",
                    width: "160px",
                  }}
                />
                <button
                  onClick={handleApplyFilterAccount}
                  disabled={!filterAccountInput.trim() || applyingFilterAccount}
                  style={{
                    padding: "5px 14px",
                    backgroundColor: filterAccountInput.trim() && !applyingFilterAccount ? "#16A34A" : "#d1d5db",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: filterAccountInput.trim() && !applyingFilterAccount ? "pointer" : "not-allowed",
                    fontFamily: font,
                    whiteSpace: "nowrap",
                  }}
                >
                  {applyingFilterAccount ? "Applying…" : "Apply to all"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {/* Apply to Similar panel */}
        {similarGroups.length > 0 && (
          <div style={{
            backgroundColor: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "16px",
          }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e40af", marginBottom: "10px" }}>
              Apply to similar — one click to confirm matching transactions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {similarGroups.map((group) => (
                <div key={group.vendor} style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", color: "#1e3a5f", fontWeight: 700, minWidth: "90px" }}>
                    {group.vendor}
                  </span>
                  <span style={{ fontSize: "11px", color: "#6b7280" }}>
                    {group.ids.length} of {group.totalCount} transactions
                  </span>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>→</span>
                  <span style={{
                    fontSize: "11px", color: "#374151",
                    backgroundColor: "#fff", padding: "2px 9px",
                    borderRadius: "5px", border: "1px solid #e5e7eb", fontWeight: 500,
                  }}>
                    {group.suggestedCategory}
                  </span>
                  {entities.length > 0 && (
                    <>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>|</span>
                      <span style={{
                        fontSize: "11px", color: "#374151",
                        backgroundColor: "#fff", padding: "2px 9px",
                        borderRadius: "5px", border: "1px solid #e5e7eb", fontWeight: 500,
                      }}>
                        {group.suggestedEntityName ?? "Personal"}
                      </span>
                    </>
                  )}
                  <button
                    onClick={() => handleApplySimilar(
                      group.ids,
                      group.suggestedCategory,
                      group.suggestedEntityId,
                      group.suggestedEntityType,
                      group.suggestedEntityName
                    )}
                    style={{
                      fontSize: "11px", padding: "4px 12px",
                      backgroundColor: "#1d4ed8", color: "#fff",
                      border: "none", borderRadius: "6px",
                      cursor: "pointer", fontWeight: 600, fontFamily: font,
                    }}
                  >
                    Apply to all
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending category prompt — appears after a single-row category edit
           when other same-vendor rows have a different category. The user
           confirms before any cascade fires. */}
        {pendingCategoryPrompt && (
          <div style={{
            marginBottom: "12px",
            padding: "12px 16px",
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "10px",
            fontSize: "13px",
            color: "#78350f",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}>
            <div style={{ flex: "1 1 320px" }}>
              <div style={{ fontWeight: 700, marginBottom: "2px" }}>
                Apply this category to similar transactions?
              </div>
              <div style={{ color: "#92400e" }}>
                You categorized a &ldquo;{pendingCategoryPrompt.vendor}&rdquo; transaction as{" "}
                <strong>{pendingCategoryPrompt.category}</strong>. Apply this to the
                remaining {pendingCategoryPrompt.affectedRowIds.length} similar transaction
                {pendingCategoryPrompt.affectedRowIds.length !== 1 ? "s" : ""}?
              </div>
              <div style={{
                marginTop: "4px",
                fontSize: "11px",
                color: "#a16207",
                fontStyle: "italic",
              }}>
                {pendingCategoryPrompt.vendor} • {pendingCategoryPrompt.affectedRowIds.length} match
                {pendingCategoryPrompt.affectedRowIds.length !== 1 ? "es" : ""}. Applies category,
                tax treatment, and entity assignment.
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <button
                onClick={acceptCategoryPrompt}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#16A34A",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Apply to all
              </button>
              <button
                onClick={dismissCategoryPrompt}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#fff",
                  color: "#78350f",
                  border: "1px solid #fcd34d",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Just this one
              </button>
            </div>
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
      {hasSelection && !isCategorizedView && (
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

          {/* Set Account */}
          <div style={{ width: "1px", height: "20px", backgroundColor: "#334155" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "#94a3b8", whiteSpace: "nowrap" }}>Set account:</span>
            <input
              type="text"
              value={bulkAccountName}
              onChange={(e) => setBulkAccountName(e.target.value)}
              placeholder="Account name…"
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid #334155",
                backgroundColor: "#0f172a",
                color: "#f1f5f9",
                fontSize: "13px",
                fontFamily: font,
                outline: "none",
                width: "140px",
              }}
            />
            <button
              onClick={() => {
                if (!bulkAccountName.trim()) return;
                handleBulkAccountAssign([...selectedIds], bulkAccountName.trim());
                setBulkAccountName("");
              }}
              disabled={!bulkAccountName.trim()}
              style={{
                padding: "6px 14px",
                backgroundColor: bulkAccountName.trim() ? "#334155" : "#1e293b",
                color: bulkAccountName.trim() ? "#f1f5f9" : "#475569",
                border: "1px solid #334155",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: bulkAccountName.trim() ? "pointer" : "not-allowed",
                fontFamily: font,
                whiteSpace: "nowrap",
              }}
            >
              Apply
            </button>
          </div>

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
