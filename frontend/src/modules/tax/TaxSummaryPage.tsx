import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { useScheduleC, EntityScheduleC, ScheduleCLine } from "./hooks/useScheduleC";
import { useScheduleE } from "./hooks/useScheduleE";
import { useSSAData } from "../income/hooks/useSSAData";
import { useRetirementData } from "../income/hooks/useRetirementData";
import AppNav from "../../components/AppNav";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function exportCSV(entities: EntityScheduleC[]) {
  const rows: string[][] = [["Entity", "Line", "Description", "Amount"]];

  for (const entity of entities) {
    const { scheduleC } = entity;
    rows.push([entity.entityName, "Income", "Gross receipts or sales", scheduleC.income.toFixed(2)]);
    for (const line of scheduleC.expensesByLine) {
      rows.push([entity.entityName, line.lineNumber, line.label, line.amount.toFixed(2)]);
    }
    rows.push([entity.entityName, "Total Expenses", "", scheduleC.totalExpenses.toFixed(2)]);
    rows.push([entity.entityName, "Net Profit / (Loss)", "", scheduleC.netProfit.toFixed(2)]);
    rows.push([]);
  }

  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "schedule-c-2025.csv";
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

const rowBase: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "11px 28px",
  borderBottom: "1px solid #f3f4f6",
  fontSize: "14px",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryBar({
  income,
  totalExpenses,
  netProfit,
}: {
  income: number;
  totalExpenses: number;
  netProfit: number;
}) {
  const netColor = netProfit >= 0 ? "#16A34A" : "#dc2626";
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid #e5e7eb",
      }}
    >
      {[
        { label: "Gross Income", value: fmt(income), color: "#16A34A" },
        { label: "Total Expenses", value: `(${fmt(totalExpenses)})`, color: "#dc2626" },
        { label: netProfit >= 0 ? "Net Profit" : "Net Loss", value: fmt(netProfit), color: netColor },
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

function LineTable({ lines }: { lines: ScheduleCLine[] }) {
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
        {/* Total row */}
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

function EntityCard({ entity }: { entity: EntityScheduleC }) {
  const isUnassigned = entity.entityId === null;

  return (
    <div style={card}>
      {/* Card header */}
      <div
        style={{
          padding: "18px 28px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          backgroundColor: isUnassigned ? "#fff7ed" : "#fff",
        }}
      >
        {isUnassigned && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "11px",
              fontWeight: 700,
              color: "#c2410c",
              backgroundColor: "#ffedd5",
              padding: "3px 10px",
              borderRadius: "999px",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            ⚠ Unassigned
          </span>
        )}
        <div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: "#111827" }}>
            Schedule C — {entity.entityName}
          </div>
          {isUnassigned && (
            <div style={{ fontSize: "12px", color: "#9a3412", marginTop: "3px" }}>
              These transactions have no entity assigned. Assign them in the Review tab for accurate reporting.
            </div>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <SummaryBar
        income={entity.scheduleC.income}
        totalExpenses={entity.scheduleC.totalExpenses}
        netProfit={entity.scheduleC.netProfit}
      />

      {/* Expense line breakdown */}
      <div style={{ padding: "16px 0 0" }}>
        <div style={{ padding: "0 28px 12px", fontSize: "12px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Expense Breakdown by IRS Line
        </div>
        <LineTable lines={entity.scheduleC.expensesByLine} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaxSummaryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { selectedYear } = useTaxYear();
  const { entities, loading, error, reload } = useScheduleC();
  const { properties } = useScheduleE();
  const { ssaTotal } = useSSAData();
  const { retirementTotal } = useRetirementData();

  // Grand totals across all entities
  const grandIncome = entities.reduce((s, e) => s + e.scheduleC.income, 0);
  const grandExpenses = entities.reduce((s, e) => s + e.scheduleC.totalExpenses, 0);
  const grandProfit = grandIncome - grandExpenses;

  const hasUnassigned = entities.some((e) => e.entityId === null);

  // Schedule E net income (assigned properties only)
  const scheduleENet = properties
    .filter((p) => p.entityId !== null)
    .reduce((s, p) => s + p.scheduleE.netIncome, 0);

  // Total income across all sources
  const totalIncome = grandProfit + scheduleENet + ssaTotal + retirementTotal;
  const hasOtherIncome = scheduleENet !== 0 || ssaTotal > 0 || retirementTotal > 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      {/* Content */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Page header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Your Business Income &amp; Expenses (Schedule C)
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              {selectedYear} · Self-Employment Income &amp; Deductions
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {!loading && entities.length > 0 && (
              <>
                <button
                  onClick={() => exportCSV(entities)}
                  className="no-print"
                  style={{ padding: "9px 18px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                >
                  Export CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="no-print"
                  style={{ padding: "9px 18px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                >
                  Print / PDF
                </button>
              </>
            )}
            <button
              onClick={reload}
              className="no-print"
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

        {/* ── Total Income Summary ─────────────────────────────────────────── */}
        {(hasOtherIncome || (!loading && entities.length > 0)) && (
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: "32px" }}>
            <div style={{ padding: "16px 28px", borderBottom: "1px solid #e5e7eb", backgroundColor: "#f9fafb", fontWeight: 700, fontSize: "15px", color: "#111827" }}>
              Total Income Summary
            </div>
            {[
              { label: "Business Income (Sch. C Net)", amount: grandProfit, link: null },
              { label: "Rental Income (Sch. E Net)", amount: scheduleENet, link: "/schedule-e" },
              { label: "Social Security (SSA-1099)", amount: ssaTotal, link: "/income/ssa" },
              { label: "Retirement / Pension (1099-R)", amount: retirementTotal, link: "/income/retirement" },
            ]
              .filter((row) => row.amount !== 0)
              .map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 28px", borderBottom: "1px solid #f3f4f6", fontSize: "14px" }}>
                  <span style={{ color: "#374151" }}>{row.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ fontWeight: 600, color: row.amount >= 0 ? "#16A34A" : "#dc2626", fontVariantNumeric: "tabular-nums" }}>
                      {fmt(row.amount)}
                    </span>
                    {row.link && (
                      <button onClick={() => navigate(row.link!)} style={{ background: "none", border: "none", color: "#16A34A", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                        Edit →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 28px", backgroundColor: "#f0fdf4" }}>
              <span style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>Estimated Total Income</span>
              <span style={{ fontWeight: 700, fontSize: "20px", color: totalIncome >= 0 ? "#16A34A" : "#dc2626", fontVariantNumeric: "tabular-nums" }}>
                {fmt(totalIncome)}
              </span>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 24px", color: "#9ca3af", fontSize: "15px" }}>
            Loading Schedule C data…
          </div>
        ) : entities.length === 0 ? (
          <div
            style={{
              backgroundColor: "#fff",
              borderRadius: "12px",
              padding: "60px 24px",
              textAlign: "center",
              boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: "40px", marginBottom: "12px" }}>📋</div>
            <div style={{ fontWeight: 700, fontSize: "16px", color: "#111827", marginBottom: "8px" }}>
              No Schedule C data yet
            </div>
            <p style={{ color: "#6b7280", fontSize: "14px", maxWidth: "360px", margin: "0 auto 20px" }}>
              Categorize your transactions and assign them to a business entity to see your Schedule C summary.
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
                    Some Schedule C transactions are not assigned to a business entity
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

            {/* Grand total banner (only shown when multiple entities) */}
            {entities.filter((e) => e.entityId !== null).length > 1 && (
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
                    Combined — All Entities
                  </div>
                  <div style={{ fontSize: "13px", color: "#6b7280" }}>
                    {entities.filter((e) => e.entityId !== null).length} Schedule C businesses
                  </div>
                </div>
                {[
                  { label: "Total Income", value: fmt(grandIncome), color: "#16A34A" },
                  { label: "Total Expenses", value: `(${fmt(grandExpenses)})`, color: "#dc2626" },
                  { label: grandProfit >= 0 ? "Combined Net Profit" : "Combined Net Loss", value: fmt(grandProfit), color: grandProfit >= 0 ? "#16A34A" : "#dc2626" },
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

            {/* Per-entity cards */}
            {entities.map((entity) => (
              <EntityCard
                key={entity.entityId ?? "__unassigned__"}
                entity={entity}
              />
            ))}

            {/* IRS disclaimer */}
            <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.6, marginTop: "8px" }}>
              <strong>Note:</strong> This summary is for informational purposes only. Meals expenses (Line 24b) are
              generally only 50% deductible on Form 1040 Schedule C. Consult a tax professional before filing.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
