import React from "react";
import { NormalizedRow } from "../hooks/useCSVImport";

const PREVIEW_LIMIT = 50;

interface CSVPreviewTableProps {
  rows: NormalizedRow[];
  totalCount: number;
}

export default function CSVPreviewTable({ rows, totalCount }: CSVPreviewTableProps) {
  const preview = rows.slice(0, PREVIEW_LIMIT);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
          Preview
        </span>
        <span style={{ fontSize: "13px", color: "#6b7280" }}>
          {totalCount} row{totalCount !== 1 ? "s" : ""} detected
          {totalCount > PREVIEW_LIMIT ? ` · showing first ${PREVIEW_LIMIT}` : ""}
        </span>
      </div>

      <div style={{ overflowX: "auto", borderRadius: "10px", border: "1px solid #e5e7eb" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead>
            <tr style={{ backgroundColor: "#f9fafb" }}>
              {["Date", "Description", "Amount", "Type"].map((col) => (
                <th
                  key={col}
                  style={{
                    padding: "10px 14px",
                    textAlign: col === "Amount" ? "right" : "left",
                    fontWeight: 600,
                    color: "#374151",
                    borderBottom: "1px solid #e5e7eb",
                    whiteSpace: "nowrap",
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr
                key={i}
                style={{ borderBottom: i < preview.length - 1 ? "1px solid #f3f4f6" : "none" }}
              >
                <td
                  style={{
                    padding: "10px 14px",
                    color: "#6b7280",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.date}
                </td>
                <td
                  style={{
                    padding: "10px 14px",
                    color: "#111827",
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
                    color: row.type === "expense" ? "#dc2626" : "#16A34A",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.type === "expense" ? "-" : "+"}$
                  {Math.abs(row.amount).toFixed(2)}
                </td>
                <td style={{ padding: "10px 14px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 600,
                      backgroundColor: row.type === "expense" ? "#fef2f2" : "#f0fdf4",
                      color: row.type === "expense" ? "#dc2626" : "#16A34A",
                    }}
                  >
                    {row.type}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
