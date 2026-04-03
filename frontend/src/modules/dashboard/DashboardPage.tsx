import React from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useDashboardData, CategoryTotal, ScheduleARow, EntityTotal, ScheduleEProperty } from "./useDashboardData";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Shared style tokens ──────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "12px",
  padding: "24px",
  boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
  marginBottom: "24px",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 700,
  color: "#111827",
  marginBottom: "16px",
};

const rowBase: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: "1px solid #f3f4f6",
  fontSize: "14px",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: "12px",
        padding: "20px 24px",
        flex: 1,
        boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "28px", fontWeight: 700, color: valueColor ?? "#111827" }}>
        {value}
      </div>
    </div>
  );
}

function CategoryRow({
  row,
  onClick,
}: {
  row: CategoryTotal;
  onClick: () => void;
}) {
  return (
    <div
      style={{ ...rowBase, cursor: "pointer" }}
      onClick={onClick}
    >
      <span style={{ color: "#374151" }}>{row.category}</span>
      <span style={{ fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums" }}>
        {fmt(row.amount)}
      </span>
    </div>
  );
}

function EntitySection({
  entity,
  onGoToReview,
}: {
  entity: EntityTotal;
  onGoToReview: () => void;
}) {
  const sortedCategories = Object.entries(entity.categories).sort(
    ([, a], [, b]) => b - a
  );

  return (
    <div style={{ marginBottom: "24px" }}>
      <div
        style={{
          fontSize: "13px",
          fontWeight: 700,
          color: "#6b7280",
          marginBottom: "10px",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        {entity.entityId === null ? (
          <>
            <span style={{ color: "#d97706" }}>⚠</span>
            <span style={{ color: "#d97706" }}>Unassigned</span>
            <button
              onClick={onGoToReview}
              style={{
                background: "none",
                border: "none",
                color: "#16A34A",
                fontWeight: 600,
                fontSize: "12px",
                cursor: "pointer",
                padding: 0,
                fontFamily: font,
              }}
            >
              → Go to Review
            </button>
          </>
        ) : (
          entity.entityName
        )}
      </div>
      {sortedCategories.map(([category, amount]) => (
        <div key={category} style={rowBase}>
          <span style={{ color: "#374151", paddingLeft: "8px" }}>{category}</span>
          <span style={{ fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums" }}>
            {fmt(amount)}
          </span>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: "10px",
          fontWeight: 700,
          fontSize: "13px",
          color: "#111827",
        }}
      >
        <span>Total</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(entity.total)}</span>
      </div>
    </div>
  );
}

function RentalPropertyRow({
  property,
  onClick,
}: {
  property: ScheduleEProperty;
  onClick: () => void;
}) {
  const netColor = property.netIncome >= 0 ? "#16A34A" : "#dc2626";
  return (
    <div style={{ ...rowBase, cursor: "pointer" }} onClick={onClick}>
      <span style={{ color: "#374151" }}>{property.entityName}</span>
      <span style={{ fontWeight: 600, color: netColor, fontVariantNumeric: "tabular-nums" }}>
        {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(property.netIncome)}
      </span>
    </div>
  );
}

function ScheduleCSection({
  income,
  expenses,
  netProfit,
}: {
  income: number;
  expenses: number;
  netProfit: number;
}) {
  const netColor = netProfit >= 0 ? "#16A34A" : "#dc2626";
  return (
    <div style={{ marginBottom: "24px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#6b7280", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Schedule C — Self-Employment
      </div>
      <div style={rowBase}>
        <span style={{ color: "#374151" }}>Income</span>
        <span style={{ fontWeight: 600, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>{fmt(income)}</span>
      </div>
      <div style={rowBase}>
        <span style={{ color: "#374151" }}>Expenses</span>
        <span style={{ fontWeight: 600, color: "#dc2626", fontVariantNumeric: "tabular-nums" }}>({fmt(expenses)})</span>
      </div>
      <div style={{ ...rowBase, borderBottom: "none", paddingTop: "12px" }}>
        <span style={{ fontWeight: 700, color: "#111827" }}>Net Profit</span>
        <span style={{ fontWeight: 700, fontSize: "15px", color: netColor, fontVariantNumeric: "tabular-nums" }}>
          {fmt(netProfit)}
        </span>
      </div>
    </div>
  );
}

function ScheduleASection({ rows }: { rows: ScheduleARow[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#6b7280", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Schedule A — Itemized Deductions
      </div>
      {rows.map((row) => (
        <div key={row.taxCategory} style={rowBase}>
          <span style={{ color: "#374151" }}>{row.taxCategory}</span>
          <span style={{ fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums" }}>{fmt(row.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useDashboardData();

  const progress =
    data.total > 0 ? Math.round((data.categorized / data.total) * 100) : 0;

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

  const hasScheduleC =
    data.scheduleC.income > 0 || data.scheduleC.expenses > 0;
  const hasScheduleA = data.scheduleA.length > 0;
  const hasEntityTotals = data.entityTotals.length > 0;
  const hasRentalProperties = data.scheduleE.properties.filter((p) => p.entityId !== null).length > 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav
        style={{
          backgroundColor: "#fff",
          borderBottom: "1px solid #e5e7eb",
          padding: "0 32px",
          height: "64px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <div
            style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }}
            onClick={() => navigate("/dashboard")}
          >
            DIYTax AI
          </div>
          <button style={navLinkActive}>Dashboard</button>
          <button style={navLink} onClick={() => navigate("/transactions")}>Transactions</button>
          <button style={navLink} onClick={() => navigate("/review")}>Review</button>
          <button style={navLink} onClick={() => navigate("/import-csv")}>Import CSV</button>
          <button style={navLink} onClick={() => navigate("/tax-summary")}>Tax Summary</button>
          <button style={navLink} onClick={() => navigate("/schedule-e")}>Schedule E</button>
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
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Tax Year 2025
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Welcome back, {user?.email?.split("@")[0]}
            </p>
          </div>
          <button
            onClick={reload}
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            Refresh
          </button>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "24px" }}>
            {error}
          </div>
        )}

        {/* ── Section 1: Overview ──────────────────────────────────────────── */}

        {/* Needs Review alert */}
        {!loading && data.needsReviewCount > 0 && (
          <div
            style={{
              backgroundColor: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: "12px",
              padding: "16px 20px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "20px" }}>⚠️</span>
              <div>
                <span style={{ fontWeight: 700, color: "#92400e", fontSize: "15px" }}>
                  {fmt(data.needsReviewAmount)} needs review
                </span>
                <span style={{ color: "#b45309", fontSize: "13px", marginLeft: "8px" }}>
                  ({data.needsReviewCount} transaction{data.needsReviewCount !== 1 ? "s" : ""})
                </span>
              </div>
            </div>
            <button
              onClick={() => navigate("/review")}
              style={{ padding: "8px 18px", backgroundColor: "#d97706", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: font }}
            >
              Go to Review
            </button>
          </div>
        )}

        {/* Unassigned transactions warning */}
        {!loading && data.hasUnassigned && (
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
                Some transactions are not assigned to a business
              </span>
            </div>
            <button
              onClick={() => navigate("/review")}
              style={{ padding: "8px 18px", backgroundColor: "#ea580c", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", fontFamily: font }}
            >
              Go to Review
            </button>
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
          <StatCard label="Total Transactions" value={loading ? "—" : data.total} />
          <StatCard
            label="Categorized"
            value={loading ? "—" : data.categorized}
            valueColor="#16A34A"
          />
          <StatCard
            label="Needs Review"
            value={loading ? "—" : data.needsReviewCount}
            valueColor={data.needsReviewCount > 0 ? "#d97706" : "#111827"}
          />
        </div>

        {/* Progress bar */}
        <div style={{ ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>Categorization Progress</span>
            <span style={{ fontSize: "13px", color: "#6b7280" }}>{loading ? "—" : `${progress}%`}</span>
          </div>
          <div style={{ backgroundColor: "#e5e7eb", borderRadius: "999px", height: "8px", overflow: "hidden" }}>
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: "#16A34A",
                borderRadius: "999px",
                transition: "width 0.5s",
              }}
            />
          </div>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#9ca3af" }}>
            {loading ? "Loading…" : `${data.categorized} of ${data.total} transactions categorized`}
          </div>
        </div>

        {/* ── Section 2: By Entity ──────────────────────────────────────────── */}
        {!loading && hasEntityTotals && (
          <div style={card}>
            <div style={sectionTitle}>Expenses by Business</div>
            {data.entityTotals.map((entity, i) => (
              <React.Fragment key={entity.entityId ?? "__unassigned__"}>
                {i > 0 && (
                  <div style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
                )}
                <EntitySection
                  entity={entity}
                  onGoToReview={() => navigate("/review")}
                />
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Section 3: Business Expenses (flat, fallback for no entities) ── */}
        {!loading && !hasEntityTotals && data.categoryTotals.length > 0 && (
          <div style={card}>
            <div style={sectionTitle}>Business Expenses</div>
            {data.categoryTotals.map((row) => (
              <CategoryRow
                key={row.category}
                row={row}
                onClick={() => navigate("/transactions")}
              />
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "14px", fontWeight: 700, fontSize: "14px", color: "#111827" }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(data.categoryTotals.reduce((s, r) => s + r.amount, 0))}
              </span>
            </div>
          </div>
        )}

        {!loading && !hasEntityTotals && data.categoryTotals.length === 0 && data.total > 0 && (
          <div style={{ ...card, color: "#9ca3af", fontSize: "14px", textAlign: "center" }}>
            No categorized expenses yet.{" "}
            <button
              onClick={() => navigate("/review")}
              style={{ background: "none", border: "none", color: "#16A34A", fontWeight: 600, cursor: "pointer", fontSize: "14px", fontFamily: font }}
            >
              Review transactions →
            </button>
          </div>
        )}

        {/* ── Section 3b: Rental Properties (Schedule E) ───────────────────── */}
        {!loading && hasRentalProperties && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={sectionTitle}>Rental Properties</div>
              <button
                onClick={() => navigate("/schedule-e")}
                style={{ background: "none", border: "none", color: "#16A34A", fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: font }}
              >
                View Schedule E →
              </button>
            </div>
            {data.scheduleE.properties
              .filter((p) => p.entityId !== null)
              .map((prop) => (
                <RentalPropertyRow
                  key={prop.entityId}
                  property={prop}
                  onClick={() => navigate("/schedule-e")}
                />
              ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "14px", fontWeight: 700, fontSize: "14px", color: "#111827" }}>
              <span>Total Net Income</span>
              <span style={{
                fontVariantNumeric: "tabular-nums",
                color: data.scheduleE.totalNetIncome >= 0 ? "#16A34A" : "#dc2626",
              }}>
                {fmt(data.scheduleE.totalNetIncome)}
              </span>
            </div>
          </div>
        )}

        {/* ── Section 4: Tax Summary ────────────────────────────────────────── */}
        {!loading && (hasScheduleC || hasScheduleA) && (
          <div style={card}>
            <div style={sectionTitle}>Tax Summary</div>
            {hasScheduleC && (
              <ScheduleCSection
                income={data.scheduleC.income}
                expenses={data.scheduleC.expenses}
                netProfit={data.scheduleC.netProfit}
              />
            )}
            {hasScheduleC && hasScheduleA && (
              <div style={{ borderTop: "1px solid #e5e7eb", margin: "16px 0" }} />
            )}
            {hasScheduleA && <ScheduleASection rows={data.scheduleA} />}
          </div>
        )}

        {!loading && !hasScheduleC && !hasScheduleA && data.categorized > 0 && (
          <div style={{ ...card, color: "#9ca3af", fontSize: "14px", textAlign: "center" }}>
            No Schedule C or A activity to summarize yet.
          </div>
        )}

        {/* Quick actions */}
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <button
            onClick={() => navigate("/tax-summary")}
            style={{ padding: "12px 28px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            View Tax Summary
          </button>
          <button
            onClick={() => navigate("/transactions")}
            style={{ padding: "12px 28px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            View Transactions
          </button>
        </div>
      </div>
    </div>
  );
}
