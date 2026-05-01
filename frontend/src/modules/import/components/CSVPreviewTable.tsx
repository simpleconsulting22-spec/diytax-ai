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

export default function CSVPreviewTable({ rows, totalCount, onTypeChange }: CSVPreviewTableProps) {
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

  const preview = sortedIndices.map((i) => ({ row: rows[i], originalIndex: i }));
  const transferCount = rows.filter((r) => r.isTransfer).length;
  const refundCount   = rows.filter((r) => r.type === "refund").length;
  const modifiedCount = rows.filter((r) => r.userModified).length;

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
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {modifiedCount > 0 && (
            <span style={{ fontSize: "12px", backgroundColor: "#eff6ff", color: "#2563eb", padding: "2px 10px", borderRadius: "999px", fontWeight: 600 }}>
              {modifiedCount} corrected
            </span>
          )}
          {transferCount > 0 && (
            <span style={{ fontSize: "12px", backgroundColor: "#f3f4f6", color: "#6b7280", padding: "2px 10px", borderRadius: "999px", fontWeight: 600 }}>
              {transferCount} transfer{transferCount !== 1 ? "s" : ""}
            </span>
          )}
          {refundCount > 0 && (
            <span style={{ fontSize: "12px", backgroundColor: "#eff6ff", color: "#2563eb", padding: "2px 10px", borderRadius: "999px", fontWeight: 600 }}>
              {refundCount} refund{refundCount !== 1 ? "s" : ""}
            </span>
          )}
          <span style={{ fontSize: "13px", color: "#6b7280" }}>
            {totalCount} row{totalCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

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
                  opacity: row.isTransfer && !row.userModified ? 0.7 : 1,
                }}
              >
                <td style={{ padding: "10px 14px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date}</td>
                <td
                  style={{
                    padding: "10px 14px",
                    color: row.isTransfer ? "#9ca3af" : "#111827",
                    maxWidth: "220px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.description}
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
