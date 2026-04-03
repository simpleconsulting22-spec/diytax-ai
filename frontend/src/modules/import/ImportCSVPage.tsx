import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import CSVPreviewTable from "./components/CSVPreviewTable";
import { useCSVImport } from "./hooks/useCSVImport";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function ImportCSVPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { state, handleFileChange, handleImport } = useCSVImport();
  const { fileName, parseError, rows, importing, importError } = state;

  const hasParsed = rows.length > 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f9fafb",
        fontFamily: font,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
      }}
    >
      {/* Header */}
      <div
        style={{
          width: "100%",
          maxWidth: hasParsed ? "780px" : "500px",
          marginBottom: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#111827" }}>
            Import CSV
          </div>
          <div style={{ fontSize: "14px", color: "#6b7280", marginTop: "4px" }}>
            Upload a bank or credit card export
          </div>
        </div>
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            background: "none",
            border: "none",
            fontSize: "14px",
            color: "#6b7280",
            cursor: "pointer",
            padding: "6px 0",
          }}
        >
          ← Back to dashboard
        </button>
      </div>

      {/* Upload card */}
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: "16px",
          padding: "40px 48px",
          width: "100%",
          maxWidth: hasParsed ? "780px" : "500px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        }}
      >
        {/* File picker */}
        <div style={{ marginBottom: hasParsed ? "32px" : "0" }}>
          <div
            style={{
              border: "2px dashed #d1d5db",
              borderRadius: "12px",
              padding: "32px 24px",
              textAlign: "center",
              backgroundColor: "#fafafa",
              cursor: "pointer",
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>📂</div>
            <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
              {fileName || "Choose a CSV file"}
            </div>
            <div style={{ fontSize: "13px", color: "#9ca3af" }}>
              {fileName ? "Click to change file" : "Supports exports from most banks and credit cards"}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />

          {fileName && !hasParsed && !parseError && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px 16px",
                backgroundColor: "#f0fdf4",
                borderRadius: "8px",
                border: "1px solid #bbf7d0",
                fontSize: "14px",
                color: "#166534",
              }}
            >
              Parsing <strong>{fileName}</strong>…
            </div>
          )}

          {parseError && (
            <div
              style={{
                marginTop: "12px",
                padding: "12px 16px",
                backgroundColor: "#fef2f2",
                borderRadius: "8px",
                border: "1px solid #fecaca",
                fontSize: "14px",
                color: "#dc2626",
              }}
            >
              {parseError}
            </div>
          )}
        </div>

        {/* Preview table */}
        {hasParsed && (
          <>
            <CSVPreviewTable rows={rows} totalCount={rows.length} />

            <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
              <button
                onClick={handleImport}
                disabled={importing}
                style={{
                  flex: 1,
                  padding: "14px",
                  backgroundColor: "#16A34A",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: importing ? "not-allowed" : "pointer",
                  opacity: importing ? 0.65 : 1,
                }}
              >
                {importing
                  ? `Importing ${rows.length} transaction${rows.length !== 1 ? "s" : ""}…`
                  : `Import ${rows.length} transaction${rows.length !== 1 ? "s" : ""}`}
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                style={{
                  padding: "14px 20px",
                  backgroundColor: "#f3f4f6",
                  color: "#374151",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "15px",
                  fontWeight: 600,
                  cursor: importing ? "not-allowed" : "pointer",
                }}
              >
                Change file
              </button>
            </div>

            {importError && (
              <div style={{ color: "#dc2626", fontSize: "14px", marginTop: "12px" }}>
                {importError}
              </div>
            )}
          </>
        )}
      </div>

      {/* Column hint */}
      {!hasParsed && (
        <div
          style={{
            marginTop: "20px",
            width: "100%",
            maxWidth: "500px",
            fontSize: "12px",
            color: "#9ca3af",
            lineHeight: "1.6",
          }}
        >
          Expected columns: <strong>Date</strong>, <strong>Description</strong>,{" "}
          <strong>Amount</strong>, Account (optional). Column names are flexible.
        </div>
      )}
    </div>
  );
}
