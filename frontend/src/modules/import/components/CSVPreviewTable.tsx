import React from "react";
import { NormalizedRow, TransactionType } from "../hooks/useCSVImport";

const PREVIEW_LIMIT = 50;

interface CSVPreviewTableProps {
  rows: NormalizedRow[];
  totalCount: number;
}

function badgeStyle(type: TransactionType): React.CSSProperties {
  switch (type) {
    case "transfer": return { backgroundColor: "#f3f4f6", color: "#6b7280" };
    case "expense":  return { backgroundColor: "#fef2f2", color: "#dc2626" };
    case "refund":   return { backgroundColor: "#eff6ff", color: "#2563eb" };
    default:         return { backgroundColor: "#f0fdf4", color: "#16A34A" };
  }
}

function amountColor(row: NormalizedRow): string {
  if (row.isTransfer)       return "#9ca3af";
  if (row.type === "expense") return "#dc2626";
  if (row.type === "refund")  return "#2563eb";
  return "#16A34A";
}

function amountPrefix(row: NormalizedRow): string {
  if (row.isTransfer) return "";
  if (row.type === "expense") return "-";
  return "+";
}

export default function CSVPreviewTable({ rows, totalCount }: CSVPreviewTableProps) {
  const preview = rows.slice(0, PREVIEW_LIMIT);
  const transferCount = rows.filter((r) => r.isTransfer).length;
  const refundCount   = rows.filter((r) => r.type === "refund").length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>Preview</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
            {totalCount > PREVIEW_LIMIT ? ` · showing first ${PREVIEW_LIMIT}` : ""}
          </span>
        </div>
      </div>

      <div style={{ overflowX: "auto", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              {["Date", "Description", "Amount", "Type"].map((col) => (
                <th key={col} style={{ padding: "10px 14px", textAlign: col === "Amount" ? "right" : "left", fontWeight: 600, color: "#374151", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr
                key={i}
                style={{
                  borderBottom: i < preview.length - 1 ? "1px solid #f3f4f6" : "none",
                  backgroundColor: row.isTransfer ? "#fafafa" : "transparent",
                  opacity: row.isTransfer ? 0.7 : 1,
                }}
              >
                <td style={{ padding: "10px 14px", color: "#6b7280", whiteSpace: "nowrap" }}>{row.date}</td>
                <td style={{ padding: "10px 14px", color: row.isTransfer ? "#9ca3af" : "#111827", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.description}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: amountColor(row), fontWeight: 500, whiteSpace: "nowrap" }}>
                  {row.isTransfer ? "—" : `${amountPrefix(row)}$${Math.abs(row.amount).toFixed(2)}`}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, ...badgeStyle(row.type) }}>
                    {row.type}
                  </span>
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
