import React from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useScheduleA, SALT_CAP } from "./hooks/useScheduleA";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScheduleAPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useScheduleA();

  const navLink: React.CSSProperties = {
    background: "none", border: "none", fontSize: "14px",
    color: "#6b7280", cursor: "pointer", padding: "4px 0", fontFamily: font,
  };
  const navLinkActive: React.CSSProperties = { ...navLink, color: "#16A34A", fontWeight: 600 };

  const lines = [
    {
      label: "Medical Expenses",
      irsLine: "Line 1",
      amount: data.medicalTotal,
      breakdown: data.medicalFromTxns > 0
        ? `Includes ${fmt(data.medicalFromTxns)} from categorized transactions`
        : undefined,
      note: "Note: AGI threshold (7.5%) not yet applied — consult your tax professional.",
    },
    {
      label: "Taxes Paid (SALT)",
      irsLine: "Line 5",
      amount: data.taxesTotal,
      breakdown: data.saltCapApplied
        ? `Actual total ${fmt(data.taxesUncapped)} — capped at ${fmt(SALT_CAP)} federal limit`
        : undefined,
      capApplied: data.saltCapApplied,
    },
    {
      label: "Mortgage Interest",
      irsLine: "Line 8",
      amount: data.mortgageTotal,
    },
    {
      label: "Charitable Contributions",
      irsLine: "Line 12",
      amount: data.charityTotal,
      breakdown: data.charityFromTxns > 0
        ? `Includes ${fmt(data.charityFromTxns)} from categorized transactions`
        : undefined,
    },
  ];

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
          <button style={navLink} onClick={() => navigate("/import-csv")}>Import CSV</button>
          <button style={navLink} onClick={() => navigate("/tax-summary")}>Business Income & Expenses (Sch. C)</button>
          <button style={navLink} onClick={() => navigate("/schedule-e")}>Rental Properties (Sch. E)</button>
          <button style={navLinkActive}>Deductions (Sch. A)</button>
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
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Itemized Deductions Summary
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Schedule A — Form 1040
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => navigate("/deductions")}
              style={{ padding: "9px 18px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
            >
              + Add Deductions
            </button>
            <button
              onClick={reload}
              style={{ padding: "9px 18px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "24px" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px", color: "#9ca3af" }}>Loading…</div>
        ) : (
          <>
            {/* Summary card */}
            <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: "24px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb" }}>
                    <th style={{ padding: "12px 28px", textAlign: "left", fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", width: "100px" }}>
                      IRS Line
                    </th>
                    <th style={{ padding: "12px 28px", textAlign: "left", fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Deduction
                    </th>
                    <th style={{ padding: "12px 28px", textAlign: "right", fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.irsLine} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "14px 28px", fontSize: "13px", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
                        {line.irsLine}
                      </td>
                      <td style={{ padding: "14px 28px", fontSize: "14px", color: "#111827" }}>
                        <div>{line.label}</div>
                        {line.capApplied && (
                          <div style={{ fontSize: "11px", color: "#d97706", marginTop: "2px", fontWeight: 500 }}>
                            ⚠ SALT cap applied — {line.breakdown}
                          </div>
                        )}
                        {!line.capApplied && line.breakdown && (
                          <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                            {line.breakdown}
                          </div>
                        )}
                        {line.note && (
                          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                            {line.note}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "14px 28px", textAlign: "right", fontSize: "15px", fontWeight: 600, color: line.amount > 0 ? "#16A34A" : "#9ca3af", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {line.amount > 0 ? fmt(line.amount) : "—"}
                      </td>
                    </tr>
                  ))}

                  {/* Total row */}
                  <tr style={{ borderTop: "2px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
                    <td style={{ padding: "16px 28px" }} />
                    <td style={{ padding: "16px 28px", fontSize: "15px", fontWeight: 700, color: "#111827" }}>
                      Total Itemized Deductions
                    </td>
                    <td style={{ padding: "16px 28px", textAlign: "right", fontSize: "18px", fontWeight: 700, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>
                      {fmt(data.totalDeductions)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* No data prompt */}
            {data.totalDeductions === 0 && (
              <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "40px 24px", textAlign: "center", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "24px" }}>
                <div style={{ fontSize: "36px", marginBottom: "10px" }}>📋</div>
                <div style={{ fontWeight: 700, fontSize: "15px", color: "#111827", marginBottom: "8px" }}>
                  No deductions recorded yet
                </div>
                <p style={{ color: "#6b7280", fontSize: "14px", maxWidth: "380px", margin: "0 auto 20px" }}>
                  Categorize transactions as Charitable Contribution or Medical Expense, or add manual deductions.
                </p>
                <button
                  onClick={() => navigate("/deductions")}
                  style={{ padding: "10px 24px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                >
                  Add Deductions
                </button>
              </div>
            )}

            {/* Disclaimer */}
            <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.6 }}>
              <strong>Note:</strong> This summary is for organizational purposes only. Medical expenses
              are subject to a 7.5% AGI threshold before they become deductible. Charitable deductions
              may be subject to AGI limits. Consult a licensed tax professional before filing.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
