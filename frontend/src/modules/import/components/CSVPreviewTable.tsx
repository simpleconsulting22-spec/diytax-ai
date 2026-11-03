import React, { useState, useRef, useEffect, useMemo } from "react";
import { NormalizedRow, TransactionType, TransactionSubType } from "../hooks/useCSVImport";

// Option keys shown in the dropdown. "cc_payment" is a virtual option that
// maps to type=transfer + subType=credit_card_payment when selected.
type TypeOption = TransactionType | "cc_payment";

const ALL_TYPE_OPTIONS: TypeOption[] = [
  "income",
  "expense",
  "transfer",
  "cc_payment",
  "refund",
];

function optionLabel(opt: TypeOption): string {
  return opt === "cc_payment" ? "credit card payment" : opt;
}

interface CSVPreviewTableProps {
  rows: NormalizedRow[];
  totalCount: number;
  onTypeChange?: (
    index: number,
    newType: TransactionType,
    newSubType?: TransactionSubType,
  ) => void;
  /** Hashes the user has clicked "import anyway" on. UI-only — backend reads
   *  this list directly from useCSVImport state. */
  forceImportHashes?: string[];
  /** Toggle the override on a row. Only callable for hard / intra-csv matches. */
  onToggleForceImport?: (rowIndex: number) => void;
}

function badgeStyle(opt: TypeOption | TransactionType): React.CSSProperties {
  switch (opt) {
    case "transfer":   return { backgroundColor: "#f3f4f6", color: "#6b7280" };
    case "cc_payment": return { backgroundColor: "#fef3c7", color: "#92400e" };
    case "expense":    return { backgroundColor: "#fef2f2", color: "#dc2626" };
    case "refund":     return { backgroundColor: "#eff6ff", color: "#2563eb" };
    default:           return { backgroundColor: "#f0fdf4", color: "#16A34A" };
  }
}

// Map a (type, subType) pair from a row into the dropdown's TypeOption value.
function rowOption(row: NormalizedRow): TypeOption {
  if (row.type === "transfer" && row.subType === "credit_card_payment") return "cc_payment";
  return row.type;
}

function amountColor(row: NormalizedRow): string {
  if (row.isTransfer)        return "#9ca3af";
  if (row.type === "expense") return "#dc2626";
  if (row.type === "refund")  return "#2563eb";
  return "#16A34A";
}

function amountPrefix(row: NormalizedRow): string {
  if (row.isTransfer)        return "";
  if (row.type === "expense") return "-";
  return "+";
}

// ─── Editable type badge ──────────────────────────────────────────────────────

function TypeBadge({
  option,
  index,
  userModified,
  onTypeChange,
}: {
  option: TypeOption;
  index: number;
  userModified?: boolean;
  onTypeChange?: (
    index: number,
    newType: TransactionType,
    newSubType?: TransactionSubType,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const label = optionLabel(option);

  const badge = (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        ...badgeStyle(option),
      }}
    >
      {label}
    </span>
  );

  if (!onTypeChange) return badge;

  function handlePick(opt: TypeOption) {
    if (opt === "cc_payment") {
      onTypeChange?.(index, "transfer", "credit_card_payment");
    } else {
      onTypeChange?.(index, opt);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Click to change type"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "3px",
          padding: "2px 8px",
          borderRadius: "999px",
          fontSize: "11px",
          fontWeight: 600,
          cursor: "pointer",
          border: userModified ? "1.5px solid #3b82f6" : "1.5px solid transparent",
          outline: "none",
          ...badgeStyle(option),
        }}
      >
        {label}
        <span style={{ fontSize: "9px", opacity: 0.7 }}>{userModified ? "✏" : "▾"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 200,
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.13)",
            padding: "4px",
            minWidth: "160px",
          }}
        >
          {ALL_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => handlePick(opt)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                border: "none",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: opt === option ? 700 : 500,
                cursor: "pointer",
                backgroundColor: opt === option ? "#f3f4f6" : "transparent",
                color: opt === option ? "#111827" : "#374151",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: badgeStyle(opt).color as string,
                  flexShrink: 0,
                }}
              />
              {optionLabel(opt)}
              {opt === option && <span style={{ marginLeft: "auto", fontSize: "10px" }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

type SortCol = "date" | "description" | "amount" | "type";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortCol; label: string; align: "left" | "right" }[] = [
  { key: "date",        label: "Date",        align: "left"  },
  { key: "description", label: "Description", align: "left"  },
  { key: "amount",      label: "Amount",      align: "right" },
  { key: "type",        label: "Type",        align: "left"  },
];

// ─── Duplicate badge ────────────────────────────────────────────────────────
// Hard / intra-csv → amber by default (will be skipped); turns green when the
// user clicks (force-import override). Soft → yellow informational, not clickable.

function DuplicateBadge({
  row,
  rowIndex,
  isOverridden,
  onToggleForceImport,
}: {
  row: NormalizedRow;
  rowIndex: number;
  isOverridden: boolean;
  onToggleForceImport?: (rowIndex: number) => void;
}) {
  const dup = row.possibleDuplicate;
  if (!dup) return null;

  const togglable = dup.kind !== "soft" && !!onToggleForceImport;

  let label: string;
  let bg: string;
  let color: string;
  let border: string;

  if (dup.kind === "soft") {
    label  = "Possible duplicate 🔍";
    bg     = "#fef9c3"; color = "#854d0e"; border = "#fde68a";
  } else if (isOverridden) {
    label  = "Will import ✓";
    bg     = "#dcfce7"; color = "#166534"; border = "#86efac";
  } else if (dup.kind === "intra-csv") {
    label  = "Same row in CSV ⚠";
    bg     = "#fff7ed"; color = "#9a3412"; border = "#fed7aa";
  } else {
    label  = "Already imported ⚠";
    bg     = "#fff7ed"; color = "#9a3412"; border = "#fed7aa";
  }

  return (
    <span
      onClick={() => togglable && onToggleForceImport?.(rowIndex)}
      title={`${dup.matchSummary}${togglable ? "  (click to toggle import-anyway override)" : ""}`}
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: "999px",
        fontSize: "10px",
        fontWeight: 700,
        backgroundColor: bg,
        color,
        border: `1px solid ${border}`,
        cursor: togglable ? "pointer" : "default",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
    >
      {label}
    </span>
  );
}

// ─── Clickable summary chip ─────────────────────────────────────────────────
// Used for the badge counters above and inside the duplicate summary line.
// Click toggles a preview filter to that subset; click again or click "Clear
// filter" to return to all rows.

function FilterChip({
  label,
  active,
  baseBg,
  baseColor,
  baseBorder,
  onClick,
  size = "md",
}: {
  label:      string;
  active:     boolean;
  baseBg:     string;
  baseColor:  string;
  baseBorder: string;
  onClick:    () => void;
  size?:      "sm" | "md";
}) {
  const fontSize = size === "sm" ? "11px" : "12px";
  return (
    <button
      onClick={onClick}
      title={active ? "Click again to clear filter" : "Click to filter preview"}
      style={{
        fontSize,
        backgroundColor: active ? baseColor : baseBg,
        color:           active ? "#fff"     : baseColor,
        padding: "2px 10px",
        borderRadius: "999px",
        fontWeight: 600,
        border: `1px solid ${active ? baseColor : baseBorder}`,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

type FilterMode =
  | "all"
  | "corrected"
  | "transfers"
  | "refunds"
  | "already-imported"
  | "intra-csv-dup"
  | "possible-dup";

const FILTER_LABEL: Record<Exclude<FilterMode, "all">, string> = {
  "corrected":         "user-corrected",
  "transfers":         "transfers",
  "refunds":           "refunds",
  "already-imported":  "already imported",
  "intra-csv-dup":     "duplicates within this CSV",
  "possible-dup":      "possible duplicates",
};

function rowMatchesFilter(row: NormalizedRow, mode: FilterMode): boolean {
  switch (mode) {
    case "all":              return true;
    case "corrected":        return !!row.userModified;
    case "transfers":        return !!row.isTransfer;
    case "refunds":          return row.type === "refund";
    case "already-imported": return row.possibleDuplicate?.kind === "exact";
    case "intra-csv-dup":    return row.possibleDuplicate?.kind === "intra-csv";
    case "possible-dup":     return row.possibleDuplicate?.kind === "soft";
  }
}

export default function CSVPreviewTable({ rows, totalCount, onTypeChange, forceImportHashes, onToggleForceImport }: CSVPreviewTableProps) {
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  // Reset filter when the upstream rows array identity changes (new file / re-parse).
  // Using rows.length as the cheap signal; if user just re-parses the same CSV
  // we don't need to clear because the filter is still meaningful.
  useEffect(() => {
    if (rows.length === 0) setFilterMode("all");
  }, [rows.length]);

  const toggleFilter = (mode: Exclude<FilterMode, "all">) => {
    setFilterMode((prev) => (prev === mode ? "all" : mode));
  };

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sortedIndices = useMemo(() => {
    const indices = rows.map((_, i) => i);
    if (!sortCol) return indices;
    return [...indices].sort((a, b) => {
      const ra = rows[a], rb = rows[b];
      let cmp = 0;
      if (sortCol === "date")        cmp = ra.date.localeCompare(rb.date);
      if (sortCol === "description") cmp = ra.description.localeCompare(rb.description);
      if (sortCol === "amount")      cmp = ra.amount - rb.amount;
      if (sortCol === "type")        cmp = ra.type.localeCompare(rb.type);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  const visibleIndices = sortedIndices.filter((i) => rowMatchesFilter(rows[i], filterMode));
  const preview = visibleIndices.map((i) => ({ row: rows[i], originalIndex: i }));
  const transferCount = rows.filter((r) => r.isTransfer).length;
  const refundCount   = rows.filter((r) => r.type === "refund").length;
  const modifiedCount = rows.filter((r) => r.userModified).length;

  // ── Duplicate summary counts ───────────────────────────────────────────
  const overrideSet  = new Set(forceImportHashes ?? []);
  const dupExact     = rows.filter((r) => r.possibleDuplicate?.kind === "exact").length;
  const dupIntra     = rows.filter((r) => r.possibleDuplicate?.kind === "intra-csv").length;
  const dupSoft      = rows.filter((r) => r.possibleDuplicate?.kind === "soft").length;
  // "Will import" = rows with date+amount minus exact/intra-csv that were NOT overridden.
  const willImport   = rows.reduce((acc, r) => {
    if (!r.date || isNaN(r.amount)) return acc;
    const dup = r.possibleDuplicate;
    const blockingDup = dup && (dup.kind === "exact" || dup.kind === "intra-csv");
    if (blockingDup && (!r.dedupeHash || !overrideSet.has(r.dedupeHash))) return acc;
    return acc + 1;
  }, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>Preview</span>
          {onTypeChange && (
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>
              — click any <strong>Type</strong> badge to correct it
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {modifiedCount > 0 && (
            <FilterChip
              label={`${modifiedCount} corrected`}
              active={filterMode === "corrected"}
              baseBg="#eff6ff" baseColor="#2563eb" baseBorder="#bfdbfe"
              onClick={() => toggleFilter("corrected")}
            />
          )}
          {transferCount > 0 && (
            <FilterChip
              label={`${transferCount} transfer${transferCount !== 1 ? "s" : ""}`}
              active={filterMode === "transfers"}
              baseBg="#f3f4f6" baseColor="#6b7280" baseBorder="#e5e7eb"
              onClick={() => toggleFilter("transfers")}
            />
          )}
          {refundCount > 0 && (
            <FilterChip
              label={`${refundCount} refund${refundCount !== 1 ? "s" : ""}`}
              active={filterMode === "refunds"}
              baseBg="#eff6ff" baseColor="#2563eb" baseBorder="#bfdbfe"
              onClick={() => toggleFilter("refunds")}
            />
          )}
          <span style={{ fontSize: "13px", color: "#6b7280" }}>
            {totalCount} row{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Duplicate summary line — separate chips for "already imported" vs
         "duplicates within this CSV", each filterable independently. */}
      {(dupExact + dupIntra + dupSoft > 0) && (
        <div style={{
          marginBottom: "10px",
          padding: "8px 12px",
          backgroundColor: "#fff7ed",
          border: "1px solid #fed7aa",
          borderRadius: "8px",
          fontSize: "12px",
          color: "#9a3412",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px",
        }}>
          {dupExact > 0 && (
            <>
              <FilterChip
                label={`${dupExact} already imported`}
                active={filterMode === "already-imported"}
                baseBg="#fff7ed" baseColor="#9a3412" baseBorder="#fed7aa"
                onClick={() => toggleFilter("already-imported")}
                size="sm"
              />
              <span style={{ color: "#d4d4d8" }}>·</span>
            </>
          )}
          {dupIntra > 0 && (
            <>
              <FilterChip
                label={`${dupIntra} duplicate${dupIntra !== 1 ? "s" : ""} in this CSV`}
                active={filterMode === "intra-csv-dup"}
                baseBg="#fff7ed" baseColor="#9a3412" baseBorder="#fed7aa"
                onClick={() => toggleFilter("intra-csv-dup")}
                size="sm"
              />
              <span style={{ color: "#d4d4d8" }}>·</span>
            </>
          )}
          {dupSoft > 0 && (
            <>
              <FilterChip
                label={`${dupSoft} possible duplicate${dupSoft !== 1 ? "s" : ""}`}
                active={filterMode === "possible-dup"}
                baseBg="#fef9c3" baseColor="#854d0e" baseBorder="#fde68a"
                onClick={() => toggleFilter("possible-dup")}
                size="sm"
              />
              <span style={{ color: "#d4d4d8" }}>·</span>
            </>
          )}
          <span style={{ color: "#166534", fontWeight: 600 }}>
            {willImport} will import
          </span>
          {(dupExact + dupIntra > 0) && onToggleForceImport && (
            <span style={{ color: "#9a3412", marginLeft: "4px" }}>
              — click any <strong>Duplicate</strong> badge to override and import anyway.
            </span>
          )}
        </div>
      )}

      {/* Clear-filter strip — only when a filter is active. */}
      {filterMode !== "all" && (
        <div style={{
          marginBottom: "8px",
          padding: "6px 12px",
          backgroundColor: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: "8px",
          fontSize: "12px",
          color: "#1d4ed8",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}>
          <span>
            Showing <strong>{preview.length}</strong> of {totalCount} rows · filtering by <strong>{FILTER_LABEL[filterMode]}</strong>
          </span>
          <button
            onClick={() => setFilterMode("all")}
            style={{
              fontSize: "11px",
              padding: "3px 10px",
              backgroundColor: "#fff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
              borderRadius: "999px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="Clear filter and show all rows"
          >
            ✕ Clear filter
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "480px", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              {COLUMNS.map(({ key, label, align }) => {
                const active = sortCol === key;
                return (
                  <th
                    key={key}
                    style={{
                      padding: "10px 14px",
                      textAlign: align,
                      fontWeight: 600,
                      color: active ? "#111827" : "#374151",
                      borderBottom: "1px solid #e5e7eb",
                      whiteSpace: "nowrap",
                      position: "sticky",
                      top: 0,
                      backgroundColor: "#f9fafb",
                      zIndex: 1,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    onClick={() => handleSort(key)}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      {label}
                      <span style={{ fontSize: "10px", color: active ? "#16A34A" : "#d1d5db" }}>
                        {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {preview.map(({ row, originalIndex }, i) => (
              <tr
                key={originalIndex}
                style={{
                  borderBottom: i < preview.length - 1 ? "1px solid #f3f4f6" : "none",
                  backgroundColor: row.userModified
                    ? "#f0f6ff"
                    : row.isTransfer
                    ? "#fafafa"
                    : "transparent",
                }}
              >
                <td style={{ padding: "10px 14px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date}</td>
                <td
                  style={{
                    padding: "10px 14px",
                    color: row.isTransfer ? "#9ca3af" : "#111827",
                    maxWidth: "420px",
                  }}
                >
                  {/* Badge stacks ABOVE the description so a long description
                     never clips it and we don't need to truncate. */}
                  {row.possibleDuplicate && (
                    <div style={{ marginBottom: "3px" }}>
                      <DuplicateBadge
                        row={row}
                        rowIndex={originalIndex}
                        isOverridden={!!row.dedupeHash && (forceImportHashes ?? []).includes(row.dedupeHash)}
                        onToggleForceImport={onToggleForceImport}
                      />
                    </div>
                  )}
                  <div style={{ wordBreak: "break-word" }}>
                    {row.description}
                  </div>
                </td>
                <td
                  style={{
                    padding: "10px 14px",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    color: amountColor(row),
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.isTransfer ? "—" : `${amountPrefix(row)}$${Math.abs(row.amount).toFixed(2)}`}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <TypeBadge
                    option={rowOption(row)}
                    index={originalIndex}
                    userModified={row.userModified}
                    onTypeChange={onTypeChange}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(transferCount > 0 || refundCount > 0) && (
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#6b7280", display: "flex", flexDirection: "column", gap: "4px" }}>
          {transferCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span>↔</span>
              <span>Transfers are stored for reference but excluded from income and expense calculations.</span>
            </div>
          )}
          {refundCount > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: "#2563eb" }}>↩</span>
              <span>Refunds are credits back to your card — they reduce your expenses, not count as income.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
