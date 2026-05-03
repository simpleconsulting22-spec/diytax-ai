// Shared atom that renders any Insight uniformly: fact / why / action +
// confidence pill + optional snooze. Used by every section.

import React from "react";
import type { Insight, Confidence } from "../types";

const PILL: Record<Confidence, { bg: string; color: string; border: string }> = {
  high:   { bg: "#dcfce7", color: "#166534", border: "#86efac" },
  medium: { bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
  low:    { bg: "#fee2e2", color: "#991b1b", border: "#fecaca" },
};

const KIND_ACCENT: Record<Insight["kind"], { bg: string; border: string }> = {
  risk:       { bg: "#fef2f2", border: "#fecaca" },
  "due-soon": { bg: "#fff7ed", border: "#fed7aa" },
  savings:    { bg: "#eff6ff", border: "#bfdbfe" },
  wellness:   { bg: "#f0fdf4", border: "#bbf7d0" },
  runway:     { bg: "#fafafa", border: "#e5e7eb" },
  trend:      { bg: "#fafafa", border: "#e5e7eb" },
};

interface InsightCardProps {
  insight:     Insight;
  emphasis?:   "primary" | "default";
  onSnooze?:   (id: string) => void;
}

export default function InsightCard({ insight, emphasis = "default", onSnooze }: InsightCardProps) {
  const accent  = KIND_ACCENT[insight.kind];
  const conf    = PILL[insight.trust.confidence];
  const isPrimary = emphasis === "primary";

  return (
    <div style={{
      backgroundColor: accent.bg,
      border: `1px solid ${accent.border}`,
      borderRadius: "12px",
      padding: isPrimary ? "16px 18px" : "12px 14px",
      boxShadow: isPrimary ? "0 2px 8px rgba(0,0,0,0.05)" : "none",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "10px",
        marginBottom: "6px",
        flexWrap: "wrap",
      }}>
        <div style={{
          fontWeight: 700,
          fontSize: isPrimary ? "15px" : "13px",
          color: "#111827",
        }}>
          {insight.fact}
        </div>
        <span
          title={insight.trust.confidenceReasons?.join(" · ")}
          style={{
            padding: "2px 8px",
            borderRadius: "999px",
            fontSize: "10px",
            fontWeight: 700,
            backgroundColor: conf.bg,
            color: conf.color,
            border: `1px solid ${conf.border}`,
            whiteSpace: "nowrap",
            height: "min-content",
          }}
        >
          {insight.trust.confidence}
        </span>
      </div>
      <div style={{ fontSize: "12px", color: "#4b5563", marginBottom: "8px" }}>
        {insight.why}
      </div>
      <div style={{
        fontSize: "12px",
        color: "#111827",
        fontWeight: 600,
        backgroundColor: "rgba(255,255,255,0.6)",
        padding: "6px 10px",
        borderRadius: "8px",
      }}>
        → {insight.action}
      </div>
      {insight.monthlyImpact !== null && insight.monthlyImpact > 0 && (
        <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "6px" }}>
          Estimated impact: <strong style={{ color: "#16A34A" }}>${Math.round(insight.monthlyImpact)}/mo</strong>
          {insight.effort && <> · effort: {insight.effort}</>}
        </div>
      )}
      <div style={{
        marginTop: "8px",
        fontSize: "10px",
        color: "#9ca3af",
        display: "flex",
        gap: "10px",
        flexWrap: "wrap",
      }}>
        <span>{insight.trust.windowLabel}</span>
        <span>·</span>
        <span>{insight.trust.baselineLabel}</span>
        {onSnooze && (
          <>
            <span>·</span>
            <button
              onClick={() => onSnooze(insight.id)}
              style={{
                background: "none", border: "none", color: "#6b7280",
                cursor: "pointer", padding: 0, fontSize: "10px",
                textDecoration: "underline",
              }}
            >
              Snooze for 7 days
            </button>
          </>
        )}
      </div>
    </div>
  );
}
