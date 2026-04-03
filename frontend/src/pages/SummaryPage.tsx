import React, { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

interface CategoryTotal {
  category: string;
  total: number;
}

interface TaxSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  byCategory: CategoryTotal[];
  answers: Record<string, unknown>;
}

export default function SummaryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    async function load() {
      setLoading(true);
      try {
        const data = await apiClient.call<TaxSummary>("generateTaxSummary", { taxYear: 2025 });
        setSummary(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load summary.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user]);

  function exportJSON() {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diytax-summary-2025.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportCSV() {
    if (!summary) return;
    const rows = [
      ["Category", "Amount"],
      ...summary.byCategory.map((c) => [c.category, c.total.toFixed(2)]),
      [],
      ["Total Income", summary.totalIncome.toFixed(2)],
      ["Total Expenses", summary.totalExpenses.toFixed(2)],
      ["Net Profit", summary.netProfit.toFixed(2)],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diytax-summary-2025.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const navStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderBottom: "1px solid #e5e7eb",
    padding: "0 32px",
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: font,
  };

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: font,
  };

  const contentStyle: React.CSSProperties = {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "40px 24px",
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderRadius: "12px",
    padding: "28px",
    boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
    marginBottom: "20px",
  };

  const statCardStyle: React.CSSProperties = {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: "12px",
    padding: "24px",
    boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
    textAlign: "center",
  };

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
  };

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    fontSize: "12px",
    fontWeight: 700,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "10px 0",
    borderBottom: "1px solid #e5e7eb",
  };

  const tdStyle: React.CSSProperties = {
    padding: "12px 0",
    fontSize: "14px",
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  };

  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A" }}>DIYTax AI</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            onClick={() => signOut(auth).then(() => navigate("/login"))}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={contentStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#111827" }}>Your 2025 Tax Summary</h1>
          <button
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            onClick={() => navigate("/dashboard")}
          >
            ← Back to Dashboard
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px" }}>Loading summary...</div>
        ) : error ? (
          <div style={{ textAlign: "center", color: "#dc2626", padding: "60px" }}>{error}</div>
        ) : summary ? (
          <>
            <div style={{ display: "flex", gap: "20px", marginBottom: "24px" }}>
              <div style={statCardStyle}>
                <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>Total Income</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#059669" }}>
                  ${summary.totalIncome.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div style={statCardStyle}>
                <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>Total Expenses</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: "#dc2626" }}>
                  ${summary.totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div style={statCardStyle}>
                <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>Net Profit</div>
                <div style={{ fontSize: "28px", fontWeight: 700, color: summary.netProfit >= 0 ? "#16A34A" : "#dc2626" }}>
                  ${summary.netProfit.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>
                Breakdown by Category
              </div>
              {summary.byCategory.length === 0 ? (
                <div style={{ color: "#9ca3af", fontSize: "14px" }}>No categorized transactions yet.</div>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Category</th>
                      <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byCategory.map((c) => (
                      <tr key={c.category}>
                        <td style={tdStyle}>{c.category}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                          ${c.total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                style={{ padding: "12px 24px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                onClick={exportJSON}
              >
                Export as JSON
              </button>
              <button
                style={{ padding: "12px 24px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}
                onClick={exportCSV}
              >
                Export as CSV
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
