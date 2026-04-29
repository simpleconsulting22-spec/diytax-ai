import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { useTaxCalculator } from "./useTaxCalculator";
import type { TaxEstimate } from "./taxCalculator";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtExact(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div
      style={{
        backgroundColor: "#f3f4f6",
        borderRadius: "16px",
        padding: "28px",
        marginBottom: "24px",
        border: "1px solid #e5e7eb",
      }}
    >
      <div style={{ height: "13px", width: "160px", backgroundColor: "#e5e7eb", borderRadius: "4px", marginBottom: "20px" }} />
      <div style={{ height: "52px", width: "220px", backgroundColor: "#e5e7eb", borderRadius: "6px", marginBottom: "12px" }} />
      <div style={{ height: "14px", width: "300px", backgroundColor: "#e5e7eb", borderRadius: "4px", marginBottom: "20px" }} />
      <div style={{ display: "flex", gap: "20px" }}>
        {[120, 150, 140].map((w, i) => (
          <div key={i} style={{ height: "40px", width: `${w}px`, backgroundColor: "#e5e7eb", borderRadius: "6px" }} />
        ))}
      </div>
    </div>
  );
}

// ─── How-is-this-calculated panel ─────────────────────────────────────────────

function HowCalcPanel({ e }: { e: TaxEstimate }) {
  return (
    <div
      style={{
        marginTop: "16px",
        padding: "16px 20px",
        backgroundColor: "rgba(255,255,255,0.75)",
        borderRadius: "10px",
        fontSize: "13px",
        color: "#374151",
        lineHeight: "1.8",
      }}
    >
      <strong style={{ display: "block", marginBottom: "10px", fontSize: "14px" }}>
        How this estimate is calculated (2024 IRS rules):
      </strong>
      <ol style={{ margin: 0, paddingLeft: "20px" }}>
        <li>
          <strong>Schedule C net profit:</strong> Business income{" "}
          {fmtExact(e.scheduleCIncome)} − expenses {fmtExact(e.scheduleCExpenses)}{" "}
          = <strong>{fmtExact(e.scheduleCNet)}</strong>
        </li>
        <li>
          <strong>Self-employment tax (15.3%):</strong> 92.35% of net profit ×
          15.3% = <strong>{fmtExact(e.seTax)}</strong>
          {" "}(Social Security capped at $168,600)
        </li>
        <li>
          <strong>SE deduction:</strong> Half of SE tax deducted from income ={" "}
          <strong>{fmtExact(e.seDeduction)}</strong>
        </li>
        <li>
          <strong>AGI:</strong> W-2 {fmtExact(e.w2Income)} + Schedule C{" "}
          {fmtExact(e.scheduleCNet)} − SE deduction {fmtExact(e.seDeduction)} ={" "}
          <strong>{fmtExact(e.agi)}</strong>
        </li>
        <li>
          <strong>Deduction used ({e.usingItemized ? "Itemized" : "Standard"}):</strong>{" "}
          Standard {fmtExact(e.standardDeduction)} vs. Itemized{" "}
          {fmtExact(e.itemizedDeduction)} →{" "}
          <strong>{fmtExact(e.deductionUsed)}</strong> used
        </li>
        {e.qbiDeduction > 0 && (
          <li>
            <strong>QBI deduction (Section 199A):</strong> 20% of self-employment
            income = <strong>{fmtExact(e.qbiDeduction)}</strong>
          </li>
        )}
        <li>
          <strong>Taxable income:</strong> AGI − deductions
          {e.qbiDeduction > 0 ? " − QBI" : ""} ={" "}
          <strong>{fmtExact(e.taxableIncome)}</strong>
        </li>
        <li>
          <strong>Federal income tax:</strong> 2024 brackets applied ={" "}
          <strong>{fmtExact(e.federalTax)}</strong>
        </li>
        <li>
          <strong>Total estimated tax:</strong> Federal {fmtExact(e.federalTax)} +
          SE tax {fmtExact(e.seTax)} ={" "}
          <strong>{fmtExact(e.totalTax)}</strong>
        </li>
      </ol>
      <p
        style={{
          margin: "12px 0 0",
          fontSize: "11px",
          color: "#9ca3af",
          lineHeight: "1.5",
        }}
      >
        Estimate uses 2024 IRS rates. State taxes, credits, and carryforwards not
        included. Consult a tax professional for advice specific to your situation.
      </p>
    </div>
  );
}

// ─── W-2 / IRA inline editor ───────────────────────────────────────────────────

function InlineNumberEditor({
  label,
  currentValue,
  onSave,
  onCancel,
}: {
  label: string;
  currentValue: number;
  onSave: (v: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(currentValue > 0 ? String(currentValue) : "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = parseFloat(draft.replace(/,/g, ""));
    if (isNaN(val) || val < 0) return;
    setSaving(true);
    await onSave(val);
    setSaving(false);
    onCancel();
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <span style={{ fontSize: "13px", color: "#374151" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <span style={{ color: "#6b7280", fontSize: "14px" }}>$</span>
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
          placeholder="0"
          style={{
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            padding: "6px 10px",
            fontSize: "14px",
            width: "130px",
            fontFamily: font,
            outline: "none",
          }}
        />
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "6px 14px",
          backgroundColor: "#16A34A",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: font,
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        onClick={onCancel}
        style={{
          background: "none",
          border: "none",
          color: "#9ca3af",
          fontSize: "13px",
          cursor: "pointer",
          fontFamily: font,
        }}
      >
        Cancel
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface LiveTaxMeterProps {
  needsReviewCount?: number;
}

export default function LiveTaxMeter({ needsReviewCount = 0 }: LiveTaxMeterProps) {
  const navigate = useNavigate();
  const { selectedYear } = useTaxYear();
  const { estimate, loading, profile, trend, saveW2Income, saveIraContributions } =
    useTaxCalculator(selectedYear);

  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showHowCalc, setShowHowCalc] = useState(false);
  const [editingW2, setEditingW2] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Keep sync with profile changes
  useEffect(() => {
    if (!editingW2) return;
    setEditingW2(false);
  }, [profile.w2Income]);

  if (loading) return <Skeleton />;

  // Incomplete onboarding — shouldn't happen post-onboarding but handle gracefully
  if (!profile.filingStatus) {
    return (
      <div
        style={{
          backgroundColor: "#f9fafb",
          borderRadius: "16px",
          padding: "28px",
          marginBottom: "24px",
          border: "1px solid #e5e7eb",
          fontFamily: font,
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "#6b7280",
            marginBottom: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Live Tax Meter
        </div>
        <p style={{ color: "#374151", margin: "0 0 16px", fontSize: "14px" }}>
          Complete your tax profile to see your estimated liability.
        </p>
        <button
          onClick={() => navigate("/onboarding")}
          style={{
            padding: "10px 20px",
            backgroundColor: "#16A34A",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: font,
          }}
        >
          Complete Profile →
        </button>
      </div>
    );
  }

  const e = estimate!;

  // Color theme based on effective rate
  const isGreen = e.effectiveRate < 15;
  const isYellow = e.effectiveRate >= 15 && e.effectiveRate < 25;
  const meterColor = isGreen ? "#16A34A" : isYellow ? "#d97706" : "#dc2626";
  const cardBg = isGreen ? "#f0fdf4" : isYellow ? "#fffbeb" : "#fef2f2";
  const cardBorder = isGreen ? "#bbf7d0" : isYellow ? "#fde68a" : "#fecaca";
  const dividerColor = isGreen ? "#dcfce7" : isYellow ? "#fef9c3" : "#fde8e8";

  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : null;
  const trendColor = trend === "up" ? "#dc2626" : "#16A34A";

  const secondaryStats = [
    { label: "YTD Income", value: fmt(e.grossIncome) },
    { label: "Taxable Income", value: fmt(e.taxableIncome) },
    {
      label: `Deductions (${e.usingItemized ? "Itemized" : "Standard"})`,
      value: fmt(e.deductionUsed),
    },
    e.scheduleCNet !== 0
      ? { label: "SE Net Profit", value: fmt(e.scheduleCNet) }
      : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div
      style={{
        backgroundColor: cardBg,
        borderRadius: "16px",
        padding: "28px",
        marginBottom: "24px",
        border: `1px solid ${cardBorder}`,
        fontFamily: font,
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "18px",
        }}
      >
        <div
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Live Tax Meter — {selectedYear}
        </div>
        <button
          onClick={() => setShowHowCalc((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: "#6b7280",
            fontSize: "12px",
            cursor: "pointer",
            fontFamily: font,
            textDecoration: "underline",
            textDecorationStyle: "dotted",
          }}
        >
          {showHowCalc ? "Hide calculation" : "How is this calculated?"}
        </button>
      </div>

      {/* ── Primary number — dramatically scaled hero ── */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "12px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: "clamp(56px, 14vw, 88px)",
            fontWeight: 800,
            color: meterColor,
            letterSpacing: "-0.03em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {fmt(e.totalTax)}
        </div>
        {trendIcon && (
          <div
            style={{
              fontSize: "clamp(22px, 4vw, 32px)",
              fontWeight: 700,
              color: trendColor,
              lineHeight: 1,
              marginBottom: "6px",
            }}
          >
            {trendIcon}
          </div>
        )}
      </div>

      <div style={{ fontSize: "15px", lineHeight: 1.5, color: "#4b5563", marginBottom: needsReviewCount > 0 ? "16px" : "22px" }}>
        Estimated tax owed for {selectedYear}
        {" · "}
        <span style={{ fontWeight: 700, color: meterColor }}>
          {e.effectiveRate.toFixed(1)}% effective rate
        </span>
        {" · "}
        <span style={{ color: "#6b7280" }}>{e.marginalRate}% marginal</span>
      </div>

      {/* ── Action chip: review prompt ── */}
      {needsReviewCount > 0 && (
        <button
          onClick={() => navigate("/review")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: "#fff",
            border: `1px solid ${cardBorder}`,
            borderRadius: "999px",
            padding: "8px 14px 8px 16px",
            fontSize: "13px",
            fontWeight: 600,
            color: "#111827",
            cursor: "pointer",
            fontFamily: font,
            marginBottom: "22px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            transition: "transform 0.1s ease, box-shadow 0.1s ease",
          }}
          onMouseEnter={(ev) => {
            (ev.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
            (ev.currentTarget as HTMLButtonElement).style.boxShadow = "0 3px 8px rgba(0,0,0,0.08)";
          }}
          onMouseLeave={(ev) => {
            (ev.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            (ev.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)";
          }}
        >
          <span style={{
            backgroundColor: meterColor,
            color: "#fff",
            borderRadius: "999px",
            padding: "1px 8px",
            fontSize: "12px",
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}>
            {needsReviewCount}
          </span>
          <span>{needsReviewCount === 1 ? "transaction needs your eye" : "transactions need your eye"}</span>
          <ArrowRight size={14} strokeWidth={2.4} color="#6b7280" />
        </button>
      )}

      {/* ── Show / hide details toggle ── */}
      <button
        onClick={() => setShowDetails((v) => !v)}
        style={{
          background: "none",
          border: "none",
          color: meterColor,
          fontSize: "13px",
          fontWeight: 600,
          cursor: "pointer",
          padding: "4px 0",
          fontFamily: font,
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          marginBottom: showDetails ? "16px" : "0",
        }}
      >
        {showDetails ? <ChevronUp size={14} strokeWidth={2.4} /> : <ChevronDown size={14} strokeWidth={2.4} />}
        <span>{showDetails ? "Hide details" : "Show details"}</span>
      </button>

      {/* ── Secondary stats grid (collapsed by default) ── */}
      {showDetails && (
      <div
        style={{
          display: "flex",
          gap: "28px",
          flexWrap: "wrap",
          marginBottom: "22px",
        }}
      >
        {secondaryStats.map((stat) => (
          <div key={stat.label}>
            <div
              style={{
                fontSize: "11px",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: "4px",
              }}
            >
              {stat.label}
            </div>
            <div
              style={{
                fontSize: "17px",
                fontWeight: 700,
                color: "#111827",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {stat.value}
            </div>
          </div>
        ))}
      </div>
      )}

      {/* ── Tax Breakdown toggle (collapsed by default) ── */}
      {showDetails && (
      <div style={{ marginBottom: "16px" }}>
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          style={{
            background: "none",
            border: "none",
            color: meterColor,
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
            padding: 0,
            fontFamily: font,
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <span>{showBreakdown ? "▾" : "▸"}</span>
          <span>Tax Breakdown</span>
        </button>

        {showBreakdown && (
          <div
            style={{
              marginTop: "12px",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            {[
              {
                label: "Federal Income Tax",
                amount: e.breakdown.federal,
                color: "#dc2626",
                placeholder: false,
              },
              {
                label: "Self-Employment Tax",
                amount: e.breakdown.selfEmployment,
                color: "#d97706",
                placeholder: false,
              },
              {
                label: "State Tax",
                amount: 0,
                color: "#6b7280",
                placeholder: true,
              },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  backgroundColor: "rgba(255,255,255,0.65)",
                  borderRadius: "10px",
                  padding: "12px 16px",
                  flex: 1,
                  minWidth: "130px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#6b7280",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: "6px",
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    color: item.placeholder ? "#d1d5db" : item.color,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {item.placeholder ? "—" : fmtExact(item.amount)}
                </div>
                {item.placeholder && (
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                    coming soon
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── How is this calculated? ── */}
      {showHowCalc && <HowCalcPanel e={e} />}

      {/* ── W-2 / IRA income row ──
          Always shown when W-2 is missing (value prompt) or being edited;
          otherwise hidden behind the "Show details" toggle. */}
      {(profile.w2Income === 0 || editingW2 || showDetails) && (
      <div
        style={{
          borderTop: `1px solid ${dividerColor}`,
          paddingTop: "14px",
          marginTop: "4px",
        }}
      >
        {!editingW2 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            {profile.w2Income === 0 ? (
              <button
                onClick={() => setEditingW2(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6b7280",
                  fontSize: "13px",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: font,
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                }}
              >
                <span
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    border: "1.5px solid #9ca3af",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    color: "#9ca3af",
                    flexShrink: 0,
                  }}
                >
                  +
                </span>
                <span
                  style={{
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                  }}
                >
                  Add W-2 income to improve accuracy
                </span>
              </button>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  color: "#6b7280",
                }}
              >
                <span>
                  W-2 income:{" "}
                  <strong style={{ color: "#374151" }}>{fmt(profile.w2Income)}</strong>
                </span>
                <button
                  onClick={() => setEditingW2(true)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#9ca3af",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontFamily: font,
                    textDecoration: "underline",
                  }}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        ) : (
          <InlineNumberEditor
            label={profile.w2Income === 0 ? "Annual W-2 income:" : "Update W-2 income:"}
            currentValue={profile.w2Income}
            onSave={saveW2Income}
            onCancel={() => setEditingW2(false)}
          />
        )}
      </div>
      )}
    </div>
  );
}
