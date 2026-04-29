import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { useDashboardData, CategoryTotal, ScheduleARow, EntityTotal, ScheduleEProperty } from "./useDashboardData";
import { useScheduleA } from "../tax/hooks/useScheduleA";
import AppNav from "../../components/AppNav";
import LiveTaxMeter from "./LiveTaxMeter";
import { useNotifications } from "../../hooks/useNotifications";
import { db } from "../../firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { apiClient } from "../../services/apiClient";

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
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
    >
      <span style={{ color: "#374151" }}>{row.category}</span>
      <span style={{
        fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums",
        textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "2px",
      }}>
        {fmt(row.amount)}
      </span>
    </div>
  );
}

function EntitySection({
  entity,
  onGoToReview,
  onCategoryClick,
}: {
  entity: EntityTotal;
  onGoToReview: () => void;
  onCategoryClick: (category: string) => void;
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
        <div
          key={category}
          style={{ ...rowBase, cursor: "pointer" }}
          onClick={() => onCategoryClick(category)}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <span style={{ color: "#374151", paddingLeft: "8px" }}>{category}</span>
          <span style={{
            fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums",
            textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "2px",
          }}>
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

function ScheduleASection({ rows, onCategoryClick }: { rows: ScheduleARow[]; onCategoryClick: (cat: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#6b7280", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Schedule A — Itemized Deductions
      </div>
      {rows.map((row) => (
        <div
          key={row.taxCategory}
          style={{ ...rowBase, cursor: "pointer" }}
          onClick={() => onCategoryClick(row.taxCategory)}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <span style={{ color: "#374151" }}>{row.taxCategory}</span>
          <span style={{
            fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums",
            textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "2px",
          }}>
            {fmt(row.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, effectiveOwnerUid } = useAuth();
  const navigate = useNavigate();
  const { selectedYear } = useTaxYear();
  const { data, loading, error, reload } = useDashboardData();
  const { data: scheduleAData, loading: scheduleALoading } = useScheduleA();
  const { permission, requestPermission } = useNotifications();
  const [notifDismissed, setNotifDismissed] = useState(
    () => localStorage.getItem("notif_prompt_dismissed") === "1"
  );

  // ── Spending forecast data ────────────────────────────────────────────────
  const [sfTransactions, setSfTransactions] = useState<any[]>([]);
  const [sfRecurring, setSfRecurring]       = useState<any[]>([]);
  const [sfLoaded, setSfLoaded]             = useState(false);

  // Auto-scan recurring transactions once per day, silently in the background
  useEffect(() => {
    if (!effectiveOwnerUid) return;
    const SCAN_KEY = `recurring_scan_${effectiveOwnerUid}`;
    const lastScan = Number(localStorage.getItem(SCAN_KEY) ?? 0);
    if (Date.now() - lastScan < 24 * 60 * 60 * 1000) return;
    apiClient.call("detectRecurring").then(() => {
      localStorage.setItem(SCAN_KEY, String(Date.now()));
    }).catch(() => {/* silent — don't surface background errors */});
  }, [effectiveOwnerUid]);

  useEffect(() => {
    if (!effectiveOwnerUid) return;
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
    const txQ = query(
      collection(db, "transactions"),
      where("uid", "==", effectiveOwnerUid),
      where("date", ">=", cutoff)
    );
    const unsubTx = onSnapshot(txQ, (snap) => {
      setSfTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setSfLoaded(true);
    });
    const recQ = query(collection(db, "recurringItems"), where("uid", "==", effectiveOwnerUid));
    const unsubRec = onSnapshot(recQ, (snap) => {
      setSfRecurring(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubTx(); unsubRec(); };
  }, [effectiveOwnerUid]);

  const sf = useMemo(() => {
    const now    = new Date();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lmDate       = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthKey = `${lmDate.getFullYear()}-${String(lmDate.getMonth() + 1).padStart(2, "0")}`;

    const thisM  = { income: 0, expenses: 0, deductible: 0 };
    const lastM  = { income: 0, expenses: 0 };
    const catMap: Record<string, number> = {};

    for (const t of sfTransactions) {
      const amt = Math.abs((t.amount as number) ?? 0);
      const dk  = typeof t.date === "string" ? t.date.substring(0, 7) : "";
      if (dk === thisMonthKey) {
        if (t.type === "income") {
          thisM.income += amt;
        } else {
          thisM.expenses += amt;
          if (t.taxCategory && t.taxCategory !== "Personal" && t.taxCategory !== "") {
            thisM.deductible += amt;
            catMap[t.taxCategory as string] = (catMap[t.taxCategory as string] ?? 0) + amt;
          }
        }
      } else if (dk === lastMonthKey) {
        if (t.type === "income") lastM.income += amt;
        else                     lastM.expenses += amt;
      }
    }

    const topCategories = Object.entries(catMap).sort(([, a], [, b]) => b - a).slice(0, 4);
    const maxCat        = topCategories[0]?.[1] ?? 1;

    const today    = now.toISOString().split("T")[0];
    const twoWeeks = new Date(now.getTime() + 14 * 86400000).toISOString().split("T")[0];
    const upcomingBills = sfRecurring
      .filter((r) => typeof r.nextExpectedDate === "string" && r.nextExpectedDate >= today && r.nextExpectedDate <= twoWeeks)
      .sort((a, b) => (a.nextExpectedDate as string).localeCompare(b.nextExpectedDate as string))
      .slice(0, 5);

    return { thisM, lastM, topCategories, maxCat, upcomingBills };
  }, [sfTransactions, sfRecurring]);

  const progress =
    data.total > 0 ? Math.round((data.categorized / data.total) * 100) : 0;

  const hasScheduleC =
    data.scheduleC.income > 0 || data.scheduleC.expenses > 0;
  const hasScheduleA = data.scheduleA.length > 0;
  const hasEntityTotals = data.entityTotals.length > 0;
  const hasRentalProperties = data.scheduleE.properties.filter((p) => p.entityId !== null).length > 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      {/* Content */}
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Tax Year {selectedYear}
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

        {/* ── Live Tax Meter ───────────────────────────────────────────────── */}
        <LiveTaxMeter needsReviewCount={loading ? 0 : data.needsReviewCount} />

        {/* ── Notification prompt ──────────────────────────────────────────── */}
        {permission === "default" && !notifDismissed && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
            padding: "12px 16px", backgroundColor: "#f0fdf4", border: "1px solid #86efac",
            borderRadius: "10px", marginBottom: "20px",
          }}>
            <span style={{ fontSize: "13px", color: "#15803d" }}>
              Get morning tax snapshots, expense reminders & quarterly deadline alerts.
            </span>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <button
                onClick={requestPermission}
                style={{ padding: "6px 14px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: font }}
              >
                Enable
              </button>
              <button
                onClick={() => { setNotifDismissed(true); localStorage.setItem("notif_prompt_dismissed", "1"); }}
                style={{ padding: "6px 10px", backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", cursor: "pointer", fontFamily: font }}
              >
                Later
              </button>
            </div>
          </div>
        )}

        {/* ── Spending Forecast Cards ──────────────────────────────────────── */}
        {sfLoaded && (
          <>
            {/* Row: This Month Cash Flow + Upcoming Bills */}
            <div style={{ display: "flex", gap: "16px", marginBottom: "16px", flexWrap: "wrap" }}>

              {/* This Month Cash Flow */}
              <div style={{
                backgroundColor: "#fff",
                borderRadius: "12px",
                padding: "20px 24px",
                flex: "1 1 260px",
                boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>This Month</span>
                  <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                    {new Date().toLocaleString("en-US", { month: "long", year: "numeric" })}
                  </span>
                </div>
                {[
                  { label: "Income",   val: sf.thisM.income,   lastVal: sf.lastM.income,   color: "#16A34A" },
                  { label: "Expenses", val: sf.thisM.expenses, lastVal: sf.lastM.expenses, color: "#dc2626" },
                ].map(({ label, val, lastVal, color }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #f3f4f6", fontSize: "13px" }}>
                    <span style={{ color: "#6b7280" }}>{label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {lastVal > 0 && (
                        <span style={{ fontSize: "10px", color: (label === "Income" ? val >= lastVal : val <= lastVal) ? "#16A34A" : "#dc2626" }}>
                          {(label === "Income" ? val >= lastVal : val <= lastVal) ? "▲" : "▼"}
                        </span>
                      )}
                      <span style={{ fontWeight: 600, color }}>{fmt(val)}</span>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0 2px", fontSize: "13px" }}>
                  <span style={{ fontWeight: 700, color: "#111827" }}>Net</span>
                  <span style={{ fontWeight: 700, color: (sf.thisM.income - sf.thisM.expenses) >= 0 ? "#16A34A" : "#dc2626" }}>
                    {fmt(sf.thisM.income - sf.thisM.expenses)}
                  </span>
                </div>
                {sf.thisM.deductible > 0 && (
                  <div style={{ marginTop: "10px", fontSize: "12px", color: "#15803d", backgroundColor: "#f0fdf4", borderRadius: "6px", padding: "6px 10px", lineHeight: 1.5 }}>
                    {fmt(sf.thisM.deductible)} of expenses are tax-deductible
                  </div>
                )}
              </div>

              {/* Upcoming Bills */}
              <div style={{
                backgroundColor: "#fff",
                borderRadius: "12px",
                padding: "20px 24px",
                flex: "1 1 260px",
                boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
              }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "14px" }}>
                  Upcoming Bills{" "}
                  <span style={{ fontSize: "11px", color: "#9ca3af", fontWeight: 400 }}>next 14 days</span>
                </div>
                {sf.upcomingBills.length === 0 ? (
                  <div style={{ fontSize: "13px", color: "#6b7280", lineHeight: 1.5 }}>No bills due in the next 14 days</div>
                ) : (
                  sf.upcomingBills.map((bill: any) => {
                    const dueDate  = new Date(bill.nextExpectedDate + "T00:00:00");
                    const daysLeft = Math.round((dueDate.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
                    return (
                      <div key={bill.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f3f4f6", fontSize: "13px" }}>
                        <div>
                          <div style={{ color: "#374151", fontWeight: 500 }}>{bill.description}</div>
                          <div style={{ fontSize: "12px", fontWeight: 500, color: daysLeft <= 3 ? "#dc2626" : "#6b7280" }}>
                            {daysLeft === 0 ? "Today" : daysLeft === 1 ? "Tomorrow" : `in ${daysLeft} days`}
                          </div>
                        </div>
                        <span style={{ fontWeight: 600, color: "#dc2626" }}>
                          {fmt(Math.abs((bill.amount as number) ?? 0))}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Top Spending Categories */}
            {sf.topCategories.length > 0 && (
              <div style={{ ...card }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>Top Spending This Month</span>
                  <button
                    onClick={() => navigate("/spending-forecast")}
                    style={{ background: "none", border: "none", color: "#16A34A", fontWeight: 600, fontSize: "12px", cursor: "pointer", fontFamily: font }}
                  >
                    Full Forecast →
                  </button>
                </div>
                {sf.topCategories.map(([category, amount]) => (
                  <div key={category} style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#374151", marginBottom: "4px" }}>
                      <span>{category}</span>
                      <span style={{ fontWeight: 600 }}>{fmt(amount)}</span>
                    </div>
                    <div style={{ backgroundColor: "#e5e7eb", borderRadius: "999px", height: "5px", overflow: "hidden" }}>
                      <div style={{ width: `${Math.round((amount / sf.maxCat) * 100)}%`, height: "100%", backgroundColor: "#16A34A", borderRadius: "999px" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Section 1: Overview ──────────────────────────────────────────── */}
        {/* Note: the "needs review" callout now lives inside the LiveTaxMeter
            as an action chip — duplicate banner removed. */}

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
              <AlertTriangle size={20} strokeWidth={2.2} color="#ea580c" />
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

        {/* YTD stat cards */}
        <div style={{ display: "flex", gap: "16px", marginBottom: "16px" }}>
          <StatCard
            label={`${selectedYear} Income`}
            value={loading ? "—" : fmt(data.ytd.income)}
            valueColor="#16A34A"
          />
          <StatCard
            label={`${selectedYear} Expenses`}
            value={loading ? "—" : fmt(data.ytd.expenses)}
            valueColor="#dc2626"
          />
          <StatCard
            label="Net"
            value={loading ? "—" : fmt(data.ytd.net)}
            valueColor={data.ytd.net >= 0 ? "#16A34A" : "#dc2626"}
          />
        </div>

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
                  onCategoryClick={(cat) => navigate(`/transactions?category=${encodeURIComponent(cat)}`)}
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
                onClick={() => navigate(`/transactions?category=${encodeURIComponent(row.category)}`)}
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
                View Rental Properties (Sch. E) →
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
            {hasScheduleA && (
              <ScheduleASection
                rows={data.scheduleA}
                onCategoryClick={(cat) => navigate(`/transactions?category=${encodeURIComponent(cat)}`)}
              />
            )}
          </div>
        )}

        {!loading && !hasScheduleC && !hasScheduleA && data.categorized > 0 && (
          <div style={{ ...card, color: "#9ca3af", fontSize: "14px", textAlign: "center" }}>
            No Schedule C or A activity to summarize yet.
          </div>
        )}

        {/* ── Section 5: Deductions (Schedule A) ───────────────────────────── */}
        {!scheduleALoading && scheduleAData.totalDeductions > 0 && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={sectionTitle}>Itemized Deductions (Sch. A)</div>
              <button
                onClick={() => navigate("/schedule-a")}
                style={{ background: "none", border: "none", color: "#16A34A", fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: font }}
              >
                View Schedule A →
              </button>
            </div>
            {[
              { label: "Medical Expenses", amount: scheduleAData.medicalTotal },
              { label: "Taxes Paid (SALT)", amount: scheduleAData.taxesTotal, cap: scheduleAData.saltCapApplied },
              { label: "Mortgage Interest", amount: scheduleAData.mortgageTotal },
              { label: "Charitable Contributions", amount: scheduleAData.charityTotal },
            ]
              .filter((r) => r.amount > 0)
              .map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f4f6", fontSize: "14px" }}>
                  <span style={{ color: "#374151" }}>
                    {row.label}
                    {row.cap && <span style={{ marginLeft: "6px", fontSize: "11px", color: "#d97706", fontWeight: 500 }}>SALT cap applied</span>}
                  </span>
                  <span style={{ fontWeight: 600, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>
                    {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(row.amount)}
                  </span>
                </div>
              ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "14px", fontWeight: 700, fontSize: "15px", color: "#111827" }}>
              <span>Total Deductions</span>
              <span style={{ color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(scheduleAData.totalDeductions)}
              </span>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <button
            onClick={() => navigate("/tax-summary")}
            style={{ padding: "12px 28px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            Business Income & Expenses (Sch. C)
          </button>
          <button
            onClick={() => navigate("/deductions")}
            style={{ padding: "12px 28px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            Deductions (Sch. A)
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
