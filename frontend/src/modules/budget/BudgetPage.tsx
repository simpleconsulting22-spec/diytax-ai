import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import AppNav from "../../components/AppNav";
import { useBudget, PeriodType, BudgetCategory, Insight } from "./hooks/useBudget";
import { TAX_CATEGORIES } from "../review/components/CategoryDropdown";
import { TAX_NOTES } from "./utils/spendingAnalysis";

// ─── Constants ────────────────────────────────────────────────────────────────

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Exclude income from budget categories
const EXPENSE_CATEGORIES = TAX_CATEGORIES.filter((c) => c !== "Income");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function progressColor(pct: number): string {
  if (pct >= 100) return "#dc2626";
  if (pct >= 90)  return "#d97706";
  if (pct >= 70)  return "#f59e0b";
  return "#16A34A";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PeriodTabs({
  value,
  onChange,
}: {
  value: PeriodType;
  onChange: (t: PeriodType) => void;
}) {
  const tabs: { key: PeriodType; label: string }[] = [
    { key: "weekly",   label: "Weekly" },
    { key: "biweekly", label: "Bi-weekly" },
    { key: "monthly",  label: "Monthly" },
  ];
  return (
    <div style={{ display: "flex", gap: "4px", backgroundColor: "#f3f4f6", borderRadius: "10px", padding: "4px" }}>
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            padding: "7px 18px",
            borderRadius: "7px",
            border: "none",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            fontFamily: font,
            backgroundColor: value === key ? "#fff" : "transparent",
            color: value === key ? "#111827" : "#6b7280",
            boxShadow: value === key ? "0 1px 4px rgba(0,0,0,0.10)" : "none",
            transition: "all 0.15s",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const styles: Record<Insight["type"], { bg: string; border: string; icon: string; color: string }> = {
    warning: { bg: "#fffbeb", border: "#fde68a", icon: "⚠️", color: "#92400e" },
    info:    { bg: "#eff6ff", border: "#bfdbfe", icon: "ℹ️", color: "#1e40af" },
    tax:     { bg: "#f0fdf4", border: "#bbf7d0", icon: "🧾", color: "#166534" },
  };
  const s = styles[insight.type];
  return (
    <div style={{
      backgroundColor: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: "10px",
      padding: "14px 16px",
      display: "flex",
      gap: "10px",
      alignItems: "flex-start",
    }}>
      <span style={{ fontSize: "16px", flexShrink: 0 }}>{s.icon}</span>
      <span style={{ fontSize: "13px", color: s.color, lineHeight: 1.5 }}>{insight.message}</span>
    </div>
  );
}

// ─── Budget Editor ────────────────────────────────────────────────────────────

interface BudgetEditorProps {
  initialCategories: BudgetCategory[];
  initialPeriodType: PeriodType;
  saving: boolean;
  onSave: (periodType: PeriodType, categories: BudgetCategory[]) => void;
  onCancel: () => void;
}

function BudgetEditor({
  initialCategories,
  initialPeriodType,
  saving,
  onSave,
  onCancel,
}: BudgetEditorProps) {
  const [periodType, setPeriodType] = useState<PeriodType>(initialPeriodType);
  const [limits, setLimits] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const cat of EXPENSE_CATEGORIES) m[cat] = "";
    for (const { category, limit } of initialCategories) {
      if (limit > 0) m[category] = String(limit);
    }
    return m;
  });

  function handleSave() {
    const categories: BudgetCategory[] = Object.entries(limits)
      .map(([category, val]) => ({ category, limit: parseFloat(val) || 0 }))
      .filter(({ limit }) => limit > 0);
    onSave(periodType, categories);
  }

  const periodLabels: Record<PeriodType, string> = {
    weekly: "per week",
    biweekly: "per 2 weeks",
    monthly: "per month",
  };

  return (
    <div style={{ backgroundColor: "#fff", borderRadius: "14px", border: "1.5px solid #e5e7eb", padding: "28px 32px", marginBottom: "28px" }}>
      <h3 style={{ margin: "0 0 20px", fontSize: "15px", fontWeight: 700, color: "#111827" }}>
        Set Spending Limits
      </h3>

      {/* Period type selector */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
          Period
        </div>
        <PeriodTabs value={periodType} onChange={setPeriodType} />
      </div>

      {/* Category limits grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px", marginBottom: "24px" }}>
        {EXPENSE_CATEGORIES.map((cat) => (
          <div key={cat}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
              {cat}
              {TAX_NOTES[cat] && (
                <span style={{ marginLeft: "4px", fontSize: "10px", color: "#16A34A", fontWeight: 400 }}>● tax</span>
              )}
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "0" }}>
              <span style={{ padding: "8px 10px", backgroundColor: "#f9fafb", border: "1px solid #d1d5db", borderRight: "none", borderRadius: "6px 0 0 6px", fontSize: "13px", color: "#9ca3af" }}>$</span>
              <input
                type="number"
                min="0"
                step="10"
                placeholder={`0  ${periodLabels[periodType]}`}
                value={limits[cat] ?? ""}
                onChange={(e) => setLimits((prev) => ({ ...prev, [cat]: e.target.value }))}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: "0 6px 6px 0",
                  fontSize: "13px",
                  outline: "none",
                  fontFamily: font,
                  color: "#111827",
                  minWidth: 0,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: "10px 24px",
            backgroundColor: "#16A34A",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.65 : 1,
            fontFamily: font,
          }}
        >
          {saving ? "Saving…" : "Save Budget"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            padding: "10px 24px",
            backgroundColor: "#f3f4f6",
            color: "#374151",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: font,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BudgetPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { state, changePeriodType, saveBudget } = useBudget();
  const { budget, budgetStatuses, analysis, insights, debtPayments, currentRange, previousRange, periodType, loading, saving, error } = state;

  const [showEditor, setShowEditor] = useState(false);

  async function handleSave(pt: PeriodType, categories: BudgetCategory[]) {
    await saveBudget(pt, categories);
    setShowEditor(false);
  }

  const hasBudget = (budget?.categories?.filter((c) => c.limit > 0).length ?? 0) > 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      {/* Content */}
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Budget &amp; Spending
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Track your spending limits and get AI-powered insights
            </p>
          </div>
          <button
            onClick={() => setShowEditor((v) => !v)}
            style={{
              padding: "9px 20px",
              backgroundColor: showEditor ? "#f3f4f6" : "#16A34A",
              color: showEditor ? "#374151" : "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            {showEditor ? "Cancel" : hasBudget ? "Edit Budget" : "+ Set Budget"}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "20px" }}>
            {error}
          </div>
        )}

        {/* Budget editor (inline) */}
        {showEditor && (
          <BudgetEditor
            initialCategories={budget?.categories ?? []}
            initialPeriodType={periodType}
            saving={saving}
            onSave={handleSave}
            onCancel={() => setShowEditor(false)}
          />
        )}

        {/* Period selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
          <PeriodTabs value={periodType} onChange={changePeriodType} />
          <div style={{ fontSize: "13px", color: "#9ca3af" }}>
            {currentRange.label}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px", fontSize: "15px" }}>
            Loading budget data…
          </div>
        ) : (
          <>
            {/* ── Section 1: Budget Overview ─────────────────────────────── */}
            {hasBudget ? (
              <section style={{ marginBottom: "32px" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", margin: "0 0 16px" }}>
                  Budget Overview
                </h2>
                {budgetStatuses.length === 0 ? (
                  <div style={{ padding: "24px", backgroundColor: "#fff", borderRadius: "12px", textAlign: "center", color: "#9ca3af", fontSize: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}>
                    No spending recorded this period yet.
                  </div>
                ) : (
                  <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                    {budgetStatuses.map((status, i) => {
                      const pct = Math.min(status.percentageUsed, 100);
                      const color = progressColor(status.percentageUsed);
                      const isLast = i === budgetStatuses.length - 1;
                      return (
                        <div
                          key={status.category}
                          style={{
                            padding: "18px 24px",
                            borderBottom: isLast ? "none" : "1px solid #f3f4f6",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                            <div>
                              <span style={{ fontWeight: 600, fontSize: "14px", color: "#111827" }}>
                                {status.category}
                              </span>
                              {TAX_NOTES[status.category] && (
                                <span style={{ marginLeft: "6px", fontSize: "11px", color: "#16A34A", fontWeight: 500 }}>
                                  ● tax deductible
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                              <span style={{ fontWeight: 700, fontSize: "15px", color }}>
                                {fmt(status.spent)}
                              </span>
                              <span style={{ fontSize: "13px", color: "#9ca3af" }}>
                                / {fmt(status.limit)}
                              </span>
                              <span style={{
                                fontSize: "12px",
                                fontWeight: 700,
                                color,
                                backgroundColor: status.percentageUsed >= 90 ? (status.percentageUsed >= 100 ? "#fef2f2" : "#fffbeb") : "#f9fafb",
                                padding: "2px 7px",
                                borderRadius: "999px",
                                marginLeft: "4px",
                              }}>
                                {status.percentageUsed}%
                              </span>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div style={{ backgroundColor: "#f3f4f6", borderRadius: "999px", height: "8px", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                backgroundColor: color,
                                borderRadius: "999px",
                                transition: "width 0.4s ease",
                              }}
                            />
                          </div>

                          {/* Remaining */}
                          <div style={{ marginTop: "6px", fontSize: "12px", color: "#9ca3af" }}>
                            {status.remaining >= 0
                              ? `${fmt(status.remaining)} remaining`
                              : `${fmt(Math.abs(status.remaining))} over budget`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ) : (
              !showEditor && (
                <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "36px 32px", textAlign: "center", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "28px" }}>
                  <div style={{ fontSize: "36px", marginBottom: "12px" }}>📊</div>
                  <div style={{ fontSize: "16px", fontWeight: 600, color: "#111827", marginBottom: "6px" }}>No budget set yet</div>
                  <div style={{ fontSize: "14px", color: "#9ca3af", marginBottom: "20px" }}>
                    Set spending limits per category to track your budget in real time.
                  </div>
                  <button
                    onClick={() => setShowEditor(true)}
                    style={{ padding: "10px 24px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                  >
                    + Set Budget
                  </button>
                </div>
              )
            )}

            {/* ── Debt Payments ─────────────────────────────────────────── */}
            {debtPayments > 0 && (
              <section style={{ marginBottom: "32px" }}>
                <div style={{
                  backgroundColor: "#fff",
                  borderRadius: "12px",
                  boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
                  padding: "18px 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "14px", color: "#111827" }}>
                      Debt Payments
                    </div>
                    <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "2px" }}>
                      Credit card payments this period — excluded from expense totals
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: "20px", color: "#2563eb" }}>
                    {fmt(debtPayments)}
                  </div>
                </div>
              </section>
            )}

            {/* ── Section 2: Spending Trends ────────────────────────────── */}
            <section style={{ marginBottom: "32px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
                Spending Trends
              </h2>
              <p style={{ fontSize: "13px", color: "#9ca3af", margin: "0 0 16px" }}>
                {currentRange.label} vs {previousRange.label}
              </p>

              {analysis.length === 0 ? (
                <div style={{ padding: "24px", backgroundColor: "#fff", borderRadius: "12px", textAlign: "center", color: "#9ca3af", fontSize: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}>
                  No spending data for this period.
                </div>
              ) : (
                <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  {/* Table header */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 110px 90px", padding: "10px 24px", backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                    {["Category", "This Period", "Last Period", "Change"].map((h) => (
                      <div key={h} style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: h === "Category" ? "left" : "right" }}>
                        {h}
                      </div>
                    ))}
                  </div>

                  {analysis.map((item, i) => {
                    const isIncrease = item.changePercent > 0;
                    const isSignificant = Math.abs(item.changePercent) >= 30;
                    const isLast = i === analysis.length - 1;
                    return (
                      <div
                        key={item.category}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 110px 110px 90px",
                          padding: "14px 24px",
                          borderBottom: isLast ? "none" : "1px solid #f3f4f6",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: 500, fontSize: "14px", color: "#111827" }}>
                          {item.category}
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 600, fontSize: "14px", color: "#111827" }}>
                          {fmt(item.current)}
                        </div>
                        <div style={{ textAlign: "right", fontSize: "14px", color: "#9ca3af" }}>
                          {item.previous > 0 ? fmt(item.previous) : "—"}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          {item.previous === 0 ? (
                            <span style={{ fontSize: "12px", color: "#9ca3af" }}>new</span>
                          ) : (
                            <span style={{
                              fontSize: "13px",
                              fontWeight: 700,
                              color: isSignificant
                                ? (isIncrease ? "#d97706" : "#16A34A")
                                : (isIncrease ? "#374151" : "#374151"),
                            }}>
                              {isIncrease ? "↑" : "↓"}{Math.abs(item.changePercent)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── Section 3: AI Insights ────────────────────────────────── */}
            <section>
              <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", margin: "0 0 16px" }}>
                AI Insights
              </h2>

              {insights.length === 0 ? (
                <div style={{ padding: "24px", backgroundColor: "#fff", borderRadius: "12px", textAlign: "center", color: "#9ca3af", fontSize: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)" }}>
                  {hasBudget
                    ? "No insights yet — keep tracking your spending."
                    : "Set a budget to unlock personalized spending insights."}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {insights.map((insight, i) => (
                    <InsightCard key={i} insight={insight} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
