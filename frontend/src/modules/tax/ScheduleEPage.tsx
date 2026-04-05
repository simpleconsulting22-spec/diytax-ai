import React from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useScheduleE, PropertyScheduleE, ScheduleELine } from "./hooks/useScheduleE";
import YearSelector from "../../components/YearSelector";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function exportCSV(properties: PropertyScheduleE[]) {
  const rows: string[][] = [["Property", "Line", "Description", "Amount"]];

  for (const prop of properties) {
    const { scheduleE } = prop;
    rows.push([prop.entityName, "Income", "Rents received", scheduleE.income.toFixed(2)]);
    for (const line of scheduleE.expensesByLine) {
      rows.push([prop.entityName, line.lineNumber, line.label, line.amount.toFixed(2)]);
    }
    rows.push([prop.entityName, "Total Expenses", "", scheduleE.totalExpenses.toFixed(2)]);
    rows.push([prop.entityName, "Net Income / (Loss)", "", scheduleE.netIncome.toFixed(2)]);
    rows.push([]);
  }

  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "schedule-e-2025.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Style tokens ─────────────────────────────────────────────────────────────

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const card: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "12px",
  boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
  marginBottom: "28px",
  overflow: "hidden",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryBar({
  income,
  totalExpenses,
  netIncome,
}: {
  income: number;
  totalExpenses: number;
  netIncome: number;
}) {
  const netColor = netIncome >= 0 ? "#16A34A" : "#dc2626";
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
      {[
        { label: "Rental Income", value: fmt(income), color: "#16A34A" },
        { label: "Total Expenses", value: `(${fmt(totalExpenses)})`, color: "#dc2626" },
        { label: netIncome >= 0 ? "Net Income" : "Net Loss", value: fmt(netIncome), color: netColor },
      ].map((item, i) => (
        <div
          key={item.label}
          style={{
            flex: 1,
            padding: "20px 28px",
            borderRight: i < 2 ? "1px solid #f3f4f6" : "none",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
            {item.label}
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: item.color, fontVariantNumeric: "tabular-nums" }}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LineTable({ lines }: { lines: ScheduleELine[] }) {
  if (lines.length === 0) {
    return (
      <div style={{ padding: "20px 28px", color: "#9ca3af", fontSize: "14px" }}>
        No deductible expenses recorded.
      </div>
    );
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ backgroundColor: "#f9fafb" }}>
          <th style={{ padding: "10px 28px", textAlign: "left", fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", width: "90px" }}>
            IRS Line
          </th>
          <th style={{ padding: "10px 28px", textAlign: "left", fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Description
          </th>
          <th style={{ padding: "10px 28px", textAlign: "right", fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.lineKey} style={{ borderTop: "1px solid #f3f4f6" }}>
            <td style={{ padding: "11px 28px", fontSize: "13px", fontWeight: 600, color: "#374151", whiteSpace: "nowrap" }}>
              {line.lineNumber}
            </td>
            <td style={{ padding: "11px 28px", fontSize: "13px", color: "#374151" }}>
              {line.label}
              {line.note && (
                <span style={{ display: "block", fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                  {line.note}
                </span>
              )}
            </td>
            <td style={{ padding: "11px 28px", textAlign: "right", fontSize: "13px", fontWeight: 500, color: "#dc2626", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {fmt(line.amount)}
            </td>
          </tr>
        ))}
        <tr style={{ borderTop: "2px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
          <td style={{ padding: "13px 28px" }} />
          <td style={{ padding: "13px 28px", fontSize: "14px", fontWeight: 700, color: "#111827" }}>
            Total Expenses
          </td>
          <td style={{ padding: "13px 28px", textAlign: "right", fontSize: "14px", fontWeight: 700, color: "#dc2626", fontVariantNumeric: "tabular-nums" }}>
            ({fmt(total)})
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function PropertyCard({ property }: { property: PropertyScheduleE }) {
  const isUnassigned = property.entityId === null;
  const { scheduleE } = property;

  return (
    <div style={card}>
      {/* Card header */}
      <div
        style={{
          padding: "18px 28px",
          borderBottom: "1px solid #e5e7eb",
          backgroundColor: isUnassigned ? "#fff7ed" : "#f0f9ff",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: isUnassigned ? "4px" : 0 }}>
            {isUnassigned ? (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#c2410c", backgroundColor: "#ffedd5", padding: "3px 10px", borderRadius: "999px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                ⚠ Unassigned
              </span>
            ) : (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#0369a1", backgroundColor: "#e0f2fe", padding: "3px 10px", borderRadius: "999px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Rental Property
              </span>
            )}
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827", marginTop: "6px" }}>
            Schedule E — {property.entityName}
          </div>
          {isUnassigned && (
            <div style={{ fontSize: "12px", color: "#9a3412", marginTop: "3px" }}>
              These transactions have no property assigned. Assign them in the Review tab for accurate reporting.
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "2px" }}>Net Income</div>
          <div style={{
            fontSize: "20px",
            fontWeight: 700,
            color: scheduleE.netIncome >= 0 ? "#16A34A" : "#dc2626",
            fontVariantNumeric: "tabular-nums",
          }}>
            {fmt(scheduleE.netIncome)}
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <SummaryBar
        income={scheduleE.income}
        totalExpenses={scheduleE.totalExpenses}
        netIncome={scheduleE.netIncome}
      />

      {/* Expense line breakdown */}
      <div style={{ paddingTop: "16px" }}>
        <div style={{ padding: "0 28px 12px", fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Expense Breakdown by IRS Line
        </div>
        <LineTable lines={scheduleE.expensesByLine} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScheduleEPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { properties, loading, error, reload } = useScheduleE();

  const navLink: React.CSSProperties = {
    background: "none",
    border: "none",
    fontSize: "14px",
    color: "#6b7280",
    cursor: "pointer",
    padding: "4px 0",
    fontFamily: font,
  };

  const navLinkActive: React.CSSProperties = {
    ...navLink,
    color: "#16A34A",
    fontWeight: 600,
  };

  const assignedProps = properties.filter((p) => p.entityId !== null);
  const hasUnassigned = properties.some((p) => p.entityId === null);

  const grandIncome = assignedProps.reduce((s, p) => s + p.scheduleE.income, 0);
  const grandExpenses = assignedProps.reduce((s, p) => s + p.scheduleE.totalExpenses, 0);
  const grandNet = grandIncome - grandExpenses;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav
        style={{
          backgroundColor: "#fff",
          borderBottom: "1px solid #e5e7eb",
          padding: "0 32px 10px",
          height: "64px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-end", gap: "32px" }}>
          <div
            style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }}
            onClick={() => navigate("/dashboard")}
          >
            DIYTax AI
          </div>
          <button style={navLink} onClick={() => navigate("/dashboard")}>Dashboard</button>
          <button style={navLink} onClick={() => navigate("/transactions")}>Transactions</button>
          <button style={navLink} onClick={() => navigate("/review")}>Review</button>
          <button style={navLink} onClick={() => navigate("/import-csv")}>Import CSV</button>
          <button style={navLink} onClick={() => navigate("/tax-summary")}>Tax Summary</button>
          <button style={navLinkActive}>Schedule E</button>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "16px" }}>
          <YearSelector variant="nav" />
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
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Page header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              2025 Rental Income Summary
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Schedule E — Supplemental Income and Loss (Rental Real Estate)
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {!loading && properties.length > 0 && (
              <button
                onClick={() => exportCSV(properties)}
                style={{ padding: "9px 18px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
              >
                Export CSV
              </button>
            )}
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
          <div style={{ textAlign: "center", padding: "80px 24px", color: "#9ca3af", fontSize: "15px" }}>
            Loading Schedule E data…
          </div>
        ) : properties.length === 0 ? (
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: "12px",
              padding: "60px 24px",
              textAlign: "center",
              boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>🏠</div>
            <div style={{ fontWeight: 700, fontSize: "16px", color: "#111827", marginBottom: "8px" }}>
              No rental income data yet
            </div>
            <p style={{ color: "#6b7280", fontSize: "14px", maxWidth: "360px", margin: "0 auto 20px" }}>
              Categorize your rental transactions and assign them to a rental property entity to see your Schedule E summary.
            </p>
            <button
              onClick={() => navigate("/review")}
              style={{ padding: "10px 24px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
            >
              Go to Review
            </button>
          </div>
        ) : (
          <>
            {/* Unassigned warning */}
            {hasUnassigned && (
              <div
                style={{
                  backgroundColor: "#fff7ed",
                  border: "1px solid #fed7aa",
                  borderRadius: "12px",
                  padding: "14px 20px",
                  marginBottom: "24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "18px" }}>⚠</span>
                  <span style={{ fontWeight: 600, color: "#9a3412", fontSize: "14px" }}>
                    Some rental transactions are not assigned to a property
                  </span>
                </div>
                <button
                  onClick={() => navigate("/review")}
                  style={{ padding: "8px 18px", backgroundColor: "#ea580c", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: font }}
                >
                  Fix in Review
                </button>
              </div>
            )}

            {/* Multi-property combined totals */}
            {assignedProps.length > 1 && (
              <div
                style={{
                  backgroundColor: "#fff",
                  borderRadius: "12px",
                  padding: "20px 28px",
                  marginBottom: "28px",
                  boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
                  display: "flex",
                  gap: "40px",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                    Combined — All Properties
                  </div>
                  <div style={{ fontSize: "13px", color: "#6b7280" }}>
                    {assignedProps.length} rental properties
                  </div>
                </div>
                {[
                  { label: "Total Rental Income", value: fmt(grandIncome), color: "#16A34A" },
                  { label: "Total Expenses", value: `(${fmt(grandExpenses)})`, color: "#dc2626" },
                  { label: grandNet >= 0 ? "Combined Net Income" : "Combined Net Loss", value: fmt(grandNet), color: grandNet >= 0 ? "#16A34A" : "#dc2626" },
                ].map((item) => (
                  <div key={item.label}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: "20px", fontWeight: 700, color: item.color, fontVariantNumeric: "tabular-nums" }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Per-property cards */}
            {properties.map((property) => (
              <PropertyCard
                key={property.entityId ?? "__unassigned__"}
                property={property}
              />
            ))}

            {/* IRS disclaimer */}
            <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.6, marginTop: "8px" }}>
              <strong>Note:</strong> This summary is for informational purposes only. Depreciation (Line 18) must be
              calculated separately using Form 4562. Passive activity loss rules may limit deductibility of rental
              losses. Consult a tax professional before filing.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
