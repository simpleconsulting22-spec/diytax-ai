// Shared atom that renders any Insight uniformly: fact / why / action +
// confidence pill + optional snooze. Used by every section.

import React, { useState } from "react";
import type { Insight, Confidence } from "../types";

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function driverNoun(insight: Insight): string {
  switch (insight.kind) {
    case "due-soon":
    case "risk":     return insight.trust.drivers.length === 1 ? "bill" : "bills";
    case "savings":  return insight.trust.drivers.length === 1 ? "merchant" : "merchants";
    default:         return insight.trust.drivers.length === 1 ? "item" : "items";
  }
}

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
  const [showDrivers, setShowDrivers] = useState(false);
  const driverCount = insight.trust.drivers.length;
  const canExpand   = driverCount > 0;

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
      {canExpand && (
        <div style={{ marginTop: "8px" }}>
          <button
            onClick={() => setShowDrivers((v) => !v)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              color: "#1d4ed8", fontSize: "11px", fontWeight: 600,
              textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px",
            }}
          >
            <span style={{ fontSize: "10px" }}>{showDrivers ? "▾" : "▸"}</span>
            {showDrivers ? "Hide" : "View"} {driverCount} {driverNoun(insight)}
          </button>
          {showDrivers && (
            <div style={{
              marginTop: "6px",
              backgroundColor: "rgba(255,255,255,0.7)",
              borderRadius: "8px",
              border: "1px solid rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}>
              {insight.trust.drivers.map((d, idx) => (
                <div
                  key={`${d.label}-${idx}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                    padding: "6px 10px",
                    borderTop: idx > 0 ? "1px solid rgba(0,0,0,0.05)" : "none",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.label}
                  </span>
                  <span style={{ color: "#6b7280", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {fmtUsd(Math.abs(d.amount))}
                  </span>
                </div>
              ))}
            </div>
          )}
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
