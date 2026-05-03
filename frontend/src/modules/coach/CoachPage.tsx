// Coach (Budget & Spending v2) page — Phase 0.
//
// Mounted at /coach (flag-gated, invisible to default users). Renders the
// CoachSnapshot + DecisionResult produced by useCoachData. All numbers are
// deterministic; LLM rephrasing is a Phase 2+ concern.

import React from "react";
import AppNav from "../../components/AppNav";
import { useCoachData } from "./hooks/useCoachData";
import InsightCard from "./components/InsightCard";
import type { PeriodType } from "./types";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function fmtUsd(n: number): string {
  if (n < 0) return `−$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const PERIODS: PeriodType[] = ["weekly", "monthly", "quarterly", "annual"];

export default function CoachPage() {
  const { state, setPeriodType, suppressInsight, refresh } = useCoachData();
  const { loading, error, snapshot, decision, periodType } = state;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "32px 20px" }}>

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", gap: "12px", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, margin: 0, color: "#111827" }}>
              Money Coach
            </h1>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: "13px" }}>
              Where your money's going, what to do next, and how you're trending.
            </p>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriodType(p)}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: `1px solid ${periodType === p ? "#16A34A" : "#d1d5db"}`,
                  backgroundColor: periodType === p ? "#16A34A" : "#fff",
                  color: periodType === p ? "#fff" : "#374151",
                  borderRadius: "6px",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {p}
              </button>
            ))}
            <button
              onClick={refresh}
              style={{
                padding: "6px 12px", fontSize: "12px", fontWeight: 600,
                border: "1px solid #d1d5db", backgroundColor: "#fff", color: "#374151",
                borderRadius: "6px", cursor: "pointer",
              }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ padding: "60px 24px", textAlign: "center", color: "#9ca3af" }}>
            Loading your money picture…
          </div>
        )}

        {!loading && error && (
          <div style={{
            padding: "16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: "10px", color: "#991b1b", fontSize: "13px",
          }}>
            Couldn't load your data: {error}
          </div>
        )}

        {!loading && !error && snapshot && decision && (
          <>
            {/* ── Data quality bar (only when there's a problem) ────────── */}
            {(snapshot.dataQuality.staleAccounts.length > 0 || snapshot.dataQuality.syncedPct < 1) && (
              <div style={{
                marginBottom: "16px",
                padding: "10px 14px",
                backgroundColor: "#fff7ed",
                border: "1px solid #fed7aa",
                borderRadius: "10px",
                fontSize: "12px",
                color: "#92400e",
              }}>
                <strong>{Math.round(snapshot.dataQuality.syncedPct * 100)}% of accounts synced</strong>
                {snapshot.dataQuality.notes.length > 0 && (
                  <> — {snapshot.dataQuality.notes.join(" · ")}</>
                )}
              </div>
            )}

            {/* ── Today's Brief ─────────────────────────────────────────── */}
            <section style={{
              backgroundColor: "#fff",
              borderRadius: "14px",
              boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
              padding: "20px 24px",
              marginBottom: "20px",
            }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
                Today
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                <Metric label="Safe to spend"   value={fmtUsd(snapshot.brief.safeToSpend)} accent="#16A34A" />
                <Metric label="Leftover"        value={fmtUsd(snapshot.brief.leftover)}    accent={snapshot.brief.leftover >= 0 ? "#111827" : "#dc2626"} />
                <Metric label="Runway"          value={snapshot.brief.runwayDays !== null ? `${snapshot.brief.runwayDays} days` : "Cash-flow positive"} accent="#111827" />
                <Metric label="Due this week"   value={fmtUsd(snapshot.brief.dueThisWeek)} accent="#dc2626" />
              </div>
              <InsightCard insight={decision.primaryAction} emphasis="primary" />
            </section>

            {/* ── Risks ──────────────────────────────────────────────────── */}
            {decision.risks.length > 0 && (
              <Section title="Risks & Due Soon" accent="#dc2626">
                {decision.risks.map((r) => (
                  <InsightCard key={r.id} insight={r} onSnooze={suppressInsight} />
                ))}
              </Section>
            )}

            {/* ── Recommendations (secondary actions only — primary is in brief) ── */}
            {decision.secondaryActions.length > 0 && (
              <Section title="Recommendations" accent="#1d4ed8">
                {decision.secondaryActions.map((r) => (
                  <InsightCard key={r.id} insight={r} onSnooze={suppressInsight} />
                ))}
              </Section>
            )}

            {/* ── Where Your Money Went ─────────────────────────────────── */}
            <Section title="Where Your Money Went" accent="#111827">
              {snapshot.categoryRollup.length === 0 ? (
                <Empty>No expense activity for this period yet.</Empty>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {snapshot.categoryRollup.map((c) => (
                    <CategoryRow key={c.category} rollup={c} />
                  ))}
                </div>
              )}
            </Section>

            {/* ── Savings Opportunities ─────────────────────────────────── */}
            {snapshot.savingsOpportunities.length > 0 && (
              <Section title="Savings Opportunities" accent="#16A34A">
                {snapshot.savingsOpportunities.slice(0, 5).map((o) => (
                  <InsightCard key={o.insight.id} insight={o.insight} onSnooze={suppressInsight} />
                ))}
              </Section>
            )}

            {/* ── Wellness ──────────────────────────────────────────────── */}
            {snapshot.wellness.length > 0 && (
              <Section title="What You're Doing Well" accent="#16A34A">
                {snapshot.wellness.slice(0, 3).map((w) => (
                  <InsightCard key={w.id} insight={w} />
                ))}
              </Section>
            )}

            {/* ── Trends ────────────────────────────────────────────────── */}
            <Section title="Trends" accent="#111827">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
                {snapshot.trends.map((t) => (
                  <TrendTile key={t.metric} series={t} />
                ))}
              </div>
            </Section>

            {/* ── Footer ────────────────────────────────────────────────── */}
            <div style={{ marginTop: "32px", fontSize: "11px", color: "#9ca3af", textAlign: "center" }}>
              Snapshot generated {new Date(snapshot.generatedAt).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ───────────────────────────────────────────

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div>
      <div style={{ fontSize: "10px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: accent }}>{value}</div>
    </div>
  );
}

function Section({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "24px" }}>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: "10px", gap: "10px" }}>
        <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#111827", margin: 0 }}>{title}</h2>
        <div style={{ flex: 1, height: "1px", backgroundColor: accent, opacity: 0.2 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "20px", textAlign: "center", color: "#9ca3af", fontSize: "13px", backgroundColor: "#fff", borderRadius: "10px", border: "1px dashed #e5e7eb" }}>
      {children}
    </div>
  );
}

function CategoryRow({ rollup }: { rollup: import("./types").CategoryRollup }) {
  const change = rollup.changePct;
  return (
    <div style={{
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "10px",
      padding: "12px 14px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 200px" }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>{rollup.category}</div>
        <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
          {rollup.topMerchants.map((m) => m.merchant).slice(0, 3).join(" · ") || "—"}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 700, fontSize: "14px", fontVariantNumeric: "tabular-nums" }}>
          {fmtUsd(rollup.current)}
        </div>
        <div style={{ fontSize: "11px", color: change >= 10 ? "#dc2626" : change <= -10 ? "#16A34A" : "#6b7280" }}>
          {change > 0 ? "+" : ""}{change}% vs prior · {Math.round(rollup.shareOfTotal * 100)}% of spend
        </div>
      </div>
    </div>
  );
}

function TrendTile({ series }: { series: import("./types").TrendSeries }) {
  return (
    <div style={{
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "10px",
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>
        {series.metric.replace("_", " ")}
      </div>
      <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>
        {series.changePct > 0 ? "+" : ""}{series.changePct}%
      </div>
      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
        last {series.windowDays} days
      </div>
      {series.anomalies.length > 0 && (
        <div style={{ marginTop: "6px", fontSize: "10px", color: "#92400e" }}>
          ⚠ {series.anomalies.length} anomal{series.anomalies.length === 1 ? "y" : "ies"}
        </div>
      )}
    </div>
  );
}
