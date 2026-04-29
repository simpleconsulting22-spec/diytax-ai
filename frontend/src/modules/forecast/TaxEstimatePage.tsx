import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { apiClient } from "../../services/apiClient";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface TaxForecast {
  taxYear: number;
  filingStatus: string;
  ytdIncome: number;
  ytdDeductible: number;
  ytdNetProfit: number;
  projectedAnnualIncome: number;
  projectedAnnualDeductible: number;
  projectedNetProfit: number;
  projectedSETax: number;
  projectedSEDeduction: number;
  projectedAGI: number;
  projectedTaxableIncome: number;
  projectedIncomeTax: number;
  projectedTotalTax: number;
  effectiveTaxRate: number;
  quarterlyPayment: number;
  remainingQuarters: number;
  nextQuarterlyDue: string;
  nextQuarterLabel: string;
  progressPercent: number;
  transactionCount: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function daysUntil(d: string) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function TaxEstimatePage() {
  const { user } = useAuth();
  const { selectedYear: taxYear } = useTaxYear();
  const uid = user?.uid;

  const [forecast,      setForecast]      = useState<TaxForecast | null>(null);
  const [filingStatus,  setFilingStatus]  = useState<"single" | "married_filing_jointly">("single");
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  const runForecast = useCallback(async (status = filingStatus) => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.call<TaxForecast>("getTaxForecast", { taxYear, filingStatus: status });
      setForecast(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate estimate.");
    } finally {
      setLoading(false);
    }
  }, [taxYear, filingStatus]);

  useEffect(() => { if (uid) runForecast(); }, [uid, taxYear]); // eslint-disable-line

  const days = forecast ? daysUntil(forecast.nextQuarterlyDue) : null;
  const stdDed = filingStatus === "married_filing_jointly" ? 29200 : 14600;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
              Tax Estimate {taxYear}
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
              Projected full-year liability based on your {taxYear} transactions.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={filingStatus}
              onChange={(e) => { const s = e.target.value as "single" | "married_filing_jointly"; setFilingStatus(s); runForecast(s); }}
              style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "12px", color: "#374151", fontFamily: font, backgroundColor: "#fff" }}
            >
              <option value="single">Single</option>
              <option value="married_filing_jointly">Married Filing Jointly</option>
            </select>
            <button
              onClick={() => runForecast()}
              disabled={loading}
              style={{ padding: "7px 14px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: loading ? "default" : "pointer", fontFamily: font }}
            >
              {loading ? "Calculating…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
            {error}
          </div>
        )}

        {loading && !forecast ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "80px 0", fontSize: "14px" }}>Calculating…</div>
        ) : forecast ? (
          <>
            {/* Year progress */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", padding: "20px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", color: "#374151", fontWeight: 600 }}>{taxYear} Progress</span>
                <span style={{ fontSize: "13px", color: "#6b7280" }}>{forecast.progressPercent}% of year elapsed</span>
              </div>
              <div style={{ height: "8px", backgroundColor: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${forecast.progressPercent}%`, backgroundColor: "#16A34A", borderRadius: "99px" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginTop: "20px" }}>
                {[
                  { label: "Income", ytd: forecast.ytdIncome, proj: forecast.projectedAnnualIncome, color: "#16A34A" },
                  { label: "Deductible Exp.", ytd: forecast.ytdDeductible, proj: forecast.projectedAnnualDeductible, color: "#f59e0b" },
                  { label: "Net Profit", ytd: forecast.ytdNetProfit, proj: forecast.projectedNetProfit, color: "#6366f1" },
                ].map(({ label, ytd, proj, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                    <div style={{ fontSize: "17px", fontWeight: 700, color }}>{fmt(proj)}</div>
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>YTD {fmt(ytd)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Next quarterly — prominent */}
            <div style={{
              padding: "20px 24px",
              backgroundColor: days !== null && days <= 14 ? "#fef2f2" : days !== null && days <= 30 ? "#fffbeb" : "#f0fdf4",
              border: `1.5px solid ${days !== null && days <= 14 ? "#fecaca" : days !== null && days <= 30 ? "#fde68a" : "#bbf7d0"}`,
              borderRadius: "16px", marginBottom: "16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "2px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {forecast.nextQuarterLabel} Estimated Tax Payment
                  </div>
                  <div style={{ fontSize: "32px", fontWeight: 800, color: "#111827", lineHeight: 1 }}>{fmt(forecast.quarterlyPayment)}</div>
                  <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "6px" }}>
                    Due {formatDate(forecast.nextQuarterlyDue)}
                    {days !== null && (
                      <span style={{ marginLeft: "8px", fontWeight: 700, color: days <= 0 ? "#dc2626" : days <= 14 ? "#dc2626" : days <= 30 ? "#d97706" : "#16A34A" }}>
                        · {days < 0 ? `${Math.abs(days)} days overdue` : days === 0 ? "Due today" : `${days} days`}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em" }}>Full-year total</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#374151" }}>{fmt(forecast.projectedTotalTax)}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>at {forecast.effectiveTaxRate}% effective rate</div>
                </div>
              </div>
            </div>

            {/* Tax breakdown */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", padding: "20px 24px", marginBottom: "16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827", marginBottom: "16px" }}>How Your Tax Is Calculated</div>

              {/* SE Tax section */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>Self-Employment Tax</div>
                {[
                  { label: "Net Profit", amount: forecast.projectedNetProfit },
                  { label: "SE Income (× 92.35%)", amount: Math.round(forecast.projectedNetProfit * 0.9235), muted: true },
                  { label: "SE Tax (15.3%)", amount: forecast.projectedSETax, bold: true },
                  { label: "Deductible half of SE Tax", amount: -forecast.projectedSEDeduction, muted: true },
                ].map(({ label, amount, muted, bold }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: muted ? "12px" : "13px", color: muted ? "#9ca3af" : "#374151", fontWeight: bold ? 700 : 400 }}>
                    <span>{label}</span>
                    <span style={{ color: amount < 0 ? "#16A34A" : undefined }}>
                      {amount < 0 ? `(${fmt(-amount)})` : fmt(amount)}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ height: "1px", backgroundColor: "#f3f4f6", margin: "12px 0" }} />

              {/* Income Tax section */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>Federal Income Tax</div>
                {[
                  { label: "Adjusted Gross Income", amount: forecast.projectedAGI },
                  { label: `Standard Deduction (${filingStatus === "married_filing_jointly" ? "MFJ" : "Single"})`, amount: -stdDed, muted: true },
                  { label: "Taxable Income", amount: forecast.projectedTaxableIncome },
                  { label: "Federal Income Tax", amount: forecast.projectedIncomeTax, bold: true },
                ].map(({ label, amount, muted, bold }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: muted ? "12px" : "13px", color: muted ? "#9ca3af" : "#374151", fontWeight: bold ? 700 : 400 }}>
                    <span>{label}</span>
                    <span style={{ color: amount < 0 ? "#16A34A" : undefined }}>
                      {amount < 0 ? `(${fmt(-amount)})` : fmt(amount)}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ height: "1px", backgroundColor: "#111827", margin: "12px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", fontWeight: 800, color: "#111827" }}>
                <span>Total Estimated Tax</span>
                <span style={{ color: "#dc2626" }}>{fmt(forecast.projectedTotalTax)}</span>
              </div>

              {/* Tax reserve progress */}
              <div style={{ marginTop: "16px", padding: "14px 16px", backgroundColor: "#f9fafb", borderRadius: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>Recommend setting aside each month</span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>{fmt(Math.round(forecast.projectedTotalTax / 12))}/mo</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "12px", color: "#6b7280" }}>As % of projected monthly income</span>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>
                    {forecast.projectedAnnualIncome > 0 ? Math.round((forecast.projectedTotalTax / forecast.projectedAnnualIncome) * 100) : 0}%
                  </span>
                </div>
              </div>
            </div>

            {/* All quarterly dates */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", padding: "20px 24px", marginBottom: "24px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827", marginBottom: "14px" }}>Quarterly Payment Schedule</div>
              {[
                { label: "Q1", due: `${taxYear}-04-15`,      period: "Jan – Mar" },
                { label: "Q2", due: `${taxYear}-06-16`,      period: "Apr – May" },
                { label: "Q3", due: `${taxYear}-09-15`,      period: "Jun – Aug" },
                { label: "Q4", due: `${taxYear + 1}-01-15`,  period: "Sep – Dec" },
              ].map(({ label, due, period }) => {
                const d = daysUntil(due);
                const isPast = d < 0;
                const isNext = due === forecast.nextQuarterlyDue;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f3f4f6", opacity: isPast ? 0.45 : 1 }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: isNext ? "#16A34A" : isPast ? "#f3f4f6" : "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: isNext ? "#fff" : "#374151", flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, marginLeft: "12px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>{formatDate(due)}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{period}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "14px", fontWeight: 700, color: isPast ? "#9ca3af" : "#374151" }}>{fmt(forecast.quarterlyPayment)}</div>
                      <div style={{ fontSize: "11px", color: isPast ? "#9ca3af" : d <= 14 ? "#dc2626" : "#9ca3af" }}>
                        {isPast ? "passed" : d === 0 ? "today" : `${d}d away`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <p style={{ fontSize: "11px", color: "#9ca3af", textAlign: "center", marginTop: "8px" }}>
              Based on {forecast.transactionCount.toLocaleString()} transactions · Schedule C self-employment only · Does not include state taxes, W-2 income, or credits
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
