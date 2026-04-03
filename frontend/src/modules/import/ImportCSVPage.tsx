import React, { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { auth, db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import CSVPreviewTable from "./components/CSVPreviewTable";
import { useCSVImport } from "./hooks/useCSVImport";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Template download ────────────────────────────────────────────────────────

const TEMPLATE_ROWS = [
  ["Date", "Description", "Amount", "Account"],
  ["2025-01-15", "Grocery Store", "-45.23", "Checking"],
  ["2025-01-16", "Direct Deposit Payroll", "2500.00", "Checking"],
  ["2025-01-17", "Electric Company", "-89.50", "Checking"],
  ["2025-01-20", "Office Supplies", "-32.00", "Business Checking"],
  ["2025-01-22", "Client Payment", "1200.00", "Business Checking"],
];

function downloadTemplate() {
  const csv = TEMPLATE_ROWS.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diytax-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Import history ───────────────────────────────────────────────────────────

interface ImportRecord {
  id: string;
  fileName: string;
  importedCount: number;
  skippedCount: number;
  createdAt: { seconds: number } | null;
}

function useImportHistory(refreshKey: number) {
  const { user } = useAuth();
  const [history, setHistory] = useState<ImportRecord[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "imports"),
          where("userId", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(10)
        )
      );
      setHistory(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImportRecord))
      );
    } catch {
      // index may not exist yet — fail silently
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return history;
}

function fmtDate(record: ImportRecord): string {
  if (!record.createdAt) return "";
  return new Date(record.createdAt.seconds * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportCSVPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { state, handleFileChange, handleImport, resetImport, deleteImport } = useCSVImport();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { fileName, parseError, rows, importing, importError, importResult } = state;

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const importHistory = useImportHistory(historyRefreshKey);

  // Refresh history after a successful import
  useEffect(() => {
    if (importResult) setHistoryRefreshKey((k) => k + 1);
  }, [importResult]);

  const hasParsed = rows.length > 0;

  const navLink: React.CSSProperties = {
    background: "none", border: "none", fontSize: "14px",
    color: "#6b7280", cursor: "pointer", padding: "4px 0", fontFamily: font,
  };
  const navLinkActive: React.CSSProperties = { ...navLink, color: "#16A34A", fontWeight: 600 };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav style={{ backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }} onClick={() => navigate("/dashboard")}>
            DIYTax AI
          </div>
          <button style={navLink} onClick={() => navigate("/dashboard")}>Dashboard</button>
          <button style={navLink} onClick={() => navigate("/transactions")}>Transactions</button>
          <button style={navLink} onClick={() => navigate("/review")}>Review</button>
          <button style={navLinkActive}>Import CSV</button>
          <button style={navLink} onClick={() => navigate("/tax-summary")}>Business Income & Expenses (Sch. C)</button>
          <button style={navLink} onClick={() => navigate("/schedule-e")}>Rental Properties (Sch. E)</button>
          <button style={navLink} onClick={() => navigate("/schedule-a")}>Deductions (Sch. A)</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
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

      {/* Content */}
      <div style={{ maxWidth: hasParsed ? "820px" : "560px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Page header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>Import CSV</h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Upload a bank or credit card export — you can import multiple files
            </p>
          </div>
          <button
            onClick={downloadTemplate}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "9px 16px", backgroundColor: "#f0fdf4", color: "#16A34A",
              border: "1.5px solid #bbf7d0", borderRadius: "8px",
              fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font,
              whiteSpace: "nowrap",
            }}
          >
            ⬇ Download Template
          </button>
        </div>

        {/* ── Success state ──────────────────────────────────────────────── */}
        {importResult && (
          <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "14px", padding: "28px 32px", marginBottom: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <span style={{ fontSize: "28px" }}>✅</span>
              <div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "#166534" }}>Import complete</div>
                <div style={{ fontSize: "13px", color: "#4ade80", marginTop: "2px" }}>{importResult.fileName}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "24px", marginBottom: "20px" }}>
              {[
                { label: "Imported", value: importResult.importedCount, color: "#16A34A" },
                { label: "Transfers (excluded)", value: importResult.transferCount, color: "#6b7280" },
                { label: "Duplicates skipped", value: importResult.duplicateCount, color: "#6b7280" },
                { label: "Rows with errors", value: importResult.skippedCount, color: importResult.skippedCount > 0 ? "#d97706" : "#6b7280" },
              ].map((stat) => (
                <div key={stat.label}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{stat.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={resetImport}
                style={{ padding: "10px 20px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
              >
                Import Another File
              </button>
              <button
                onClick={() => navigate("/review")}
                style={{ padding: "10px 20px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
              >
                Review Transactions →
              </button>
            </div>
          </div>
        )}

        {/* ── Upload card ────────────────────────────────────────────────── */}
        {!importResult && (
          <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "32px 36px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "28px" }}>
            {/* Drop zone */}
            <div style={{ marginBottom: hasParsed ? "28px" : "0" }}>
              <div
                style={{ border: "2px dashed #d1d5db", borderRadius: "12px", padding: "32px 24px", textAlign: "center", backgroundColor: "#fafafa", cursor: "pointer" }}
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
                onChange={(e) => {
                  handleFileChange(e.target.files?.[0] ?? null);
                  e.target.value = "";        // allow re-selecting same file
                }}
              />

              {fileName && !hasParsed && !parseError && (
                <div style={{ marginTop: "12px", padding: "12px 16px", backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", fontSize: "14px", color: "#166534" }}>
                  Parsing <strong>{fileName}</strong>…
                </div>
              )}

              {parseError && (
                <div style={{ marginTop: "12px", padding: "12px 16px", backgroundColor: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca", fontSize: "14px", color: "#dc2626" }}>
                  {parseError}
                </div>
              )}
            </div>

            {/* Preview + import */}
            {hasParsed && (
              <>
                <CSVPreviewTable rows={rows} totalCount={rows.length} />

                <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
                  <button
                    onClick={handleImport}
                    disabled={importing}
                    style={{ flex: 1, padding: "14px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 600, cursor: importing ? "not-allowed" : "pointer", opacity: importing ? 0.65 : 1, fontFamily: font }}
                  >
                    {importing
                      ? `Importing ${rows.length} transaction${rows.length !== 1 ? "s" : ""}…`
                      : `Import ${rows.length} transaction${rows.length !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    style={{ padding: "14px 20px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 600, cursor: importing ? "not-allowed" : "pointer", fontFamily: font }}
                  >
                    Change file
                  </button>
                </div>

                {importError && (
                  <div style={{ color: "#dc2626", fontSize: "14px", marginTop: "12px" }}>{importError}</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Column hint / template info ────────────────────────────────── */}
        {!hasParsed && !importResult && (
          <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.7, marginBottom: "32px" }}>
            <strong>Expected columns:</strong> Date, Description, Amount, Account (optional).<br />
            Amount: negative = expense, positive = income. Column names are flexible.<br />
            Duplicate transactions are automatically detected and skipped.
          </div>
        )}

        {/* ── Import history ──────────────────────────────────────────────── */}
        {importHistory.length > 0 && (
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", fontWeight: 700, fontSize: "14px", color: "#111827" }}>
              Import History
            </div>
            {importHistory.map((record) => (
              <div
                key={record.id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", borderBottom: "1px solid #f9fafb", fontSize: "14px" }}
              >
                <div>
                  <div style={{ fontWeight: 500, color: "#111827" }}>{record.fileName}</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>{fmtDate(record)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontWeight: 600, color: "#16A34A" }}>{record.importedCount} imported</span>
                    {record.skippedCount > 0 && (
                      <span style={{ color: "#9ca3af", marginLeft: "10px" }}>{record.skippedCount} skipped</span>
                    )}
                  </div>
                  {deletingId === record.id ? (
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        onClick={async () => {
                          await deleteImport(record.id);
                          setDeletingId(null);
                          setHistoryRefreshKey((k) => k + 1);
                        }}
                        style={{ padding: "5px 12px", backgroundColor: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        style={{ padding: "5px 10px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingId(record.id)}
                      style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "13px", fontFamily: font, padding: "4px 8px", borderRadius: "4px" }}
                      title="Delete import"
                    >
                      🗑 Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
