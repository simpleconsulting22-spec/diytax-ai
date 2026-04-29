import React, { useState, useEffect, useCallback } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { apiClient } from "../../services/apiClient";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface RecurringItem {
  id: string;
  merchantName: string;
  amount: number;
  frequency: string;
  nextExpectedDate: string;
  category: string;
  type: string;
  occurrences: number;
  confidence: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function freqLabel(f: string): string {
  return { weekly: "/ wk", biweekly: "/ 2 wks", monthly: "/ mo", quarterly: "/ qtr", annual: "/ yr" }[f] ?? f;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ForecastPage() {
  const { user } = useAuth();
  const { selectedYear: taxYear } = useTaxYear();
  const uid = user?.uid;

  const [forecast,         setForecast]         = useState<TaxForecast | null>(null);
  const [recurring,        setRecurring]        = useState<RecurringItem[]>([]);
  const [filingStatus,     setFilingStatus]     = useState<"single" | "married_filing_jointly">("single");
  const [loadingForecast,  setLoadingForecast]  = useState(false);
  const [loadingRecurring, setLoadingRecurring] = useState(false);
  const [error,            setError]            = useState<string | null>(null);

  // Live recurring items from Firestore
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "recurringItems"), where("uid", "==", uid));
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecurringItem));
      items.sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
      setRecurring(items);
    });
  }, [uid]);

  const runForecast = useCallback(async (status = filingStatus) => {
    setLoadingForecast(true);
    setError(null);
    try {
      const result = await apiClient.call<TaxForecast>("getTaxForecast", {
        taxYear,
        filingStatus: status,
      });
      setForecast(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load forecast.");
    } finally {
      setLoadingForecast(false);
    }
  }, [taxYear, filingStatus]);

  const runDetectRecurring = useCallback(async () => {
    setLoadingRecurring(true);
    setError(null);
    try {
      await apiClient.call("detectRecurring");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detect recurring transactions.");
    } finally {
      setLoadingRecurring(false);
    }
  }, []);

  // Auto-load forecast on mount / year change
  useEffect(() => {
    if (uid) runForecast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, taxYear]);

  function handleFilingStatusChange(status: "single" | "married_filing_jointly") {
    setFilingStatus(status);
    runForecast(status);
  }

  const days = forecast ? daysUntil(forecast.nextQuarterlyDue) : null;

  // Upcoming recurring: next 90 days
  const today = new Date().toISOString().split("T")[0];
  const in90  = new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0];
  const upcoming90 = recurring.filter((r) => r.nextExpectedDate >= today && r.nextExpectedDate <= in90);
  const upcoming90Total = upcoming90.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
              Forecast &amp; Tax Estimate
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
              Projected full-year results based on transactions so far in {taxYear}.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={filingStatus}
              onChange={(e) => handleFilingStatusChange(e.target.value as "single" | "married_filing_jointly")}
              style={{ padding: "7px 12px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "13px", color: "#374151", fontFamily: font, backgroundColor: "#fff" }}
            >
              <option value="single">Single</option>
              <option value="married_filing_jointly">Married Filing Jointly</option>
            </select>
            <button
              onClick={() => runForecast()}
              disabled={loadingForecast}
              style={{ padding: "7px 14px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: loadingForecast ? "default" : "pointer", fontFamily: font }}
            >
              {loadingForecast ? "Calculating…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
            {error}
          </div>
        )}

        {/* ── Tax Forecast Card ──────────────────────────────────────────────── */}
        {loadingForecast && !forecast ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px 0", fontSize: "14px" }}>Calculating…</div>
        ) : forecast ? (
          <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "20px", overflow: "hidden" }}>

            {/* Year progress bar */}
            <div style={{ padding: "20px 24px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "12px", color: "#6b7280" }}>{taxYear} progress</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>{forecast.progressPercent}% of year elapsed</span>
              </div>
              <div style={{ height: "6px", backgroundColor: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${forecast.progressPercent}%`, backgroundColor: "#16A34A", borderRadius: "99px", transition: "width 0.5s" }} />
              </div>
            </div>

            {/* Income / Expenses / Net Profit */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", backgroundColor: "#f3f4f6", margin: "20px 0 0" }}>
              {[
                { label: "Income", ytd: forecast.ytdIncome, proj: forecast.projectedAnnualIncome, color: "#16A34A" },
                { label: "Deductible Expenses", ytd: forecast.ytdDeductible, proj: forecast.projectedAnnualDeductible, color: "#f59e0b" },
                { label: "Net Profit", ytd: forecast.ytdNetProfit, proj: forecast.projectedNetProfit, color: "#6366f1" },
              ].map(({ label, ytd, proj, color }) => (
                <div key={label} style={{ backgroundColor: "#fff", padding: "16px 20px" }}>
                  <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                  <div style={{ fontSize: "18px", fontWeight: 700, color, marginBottom: "2px" }}>{fmt(proj)}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>YTD {fmt(ytd)}</div>
                </div>
              ))}
            </div>

            {/* Tax breakdown */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "12px" }}>Estimated Tax Breakdown</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {[
                  { label: "Self-Employment Tax (15.3%)", amount: forecast.projectedSETax },
                  { label: "SE Tax Deduction", amount: -forecast.projectedSEDeduction, muted: true },
                  { label: "Adjusted Gross Income", amount: forecast.projectedAGI, muted: true },
                  { label: `Standard Deduction (${filingStatus === "married_filing_jointly" ? "$29,200" : "$14,600"})`, amount: -(filingStatus === "married_filing_jointly" ? 29200 : 14600), muted: true },
                  { label: "Taxable Income", amount: forecast.projectedTaxableIncome, muted: true },
                  { label: "Federal Income Tax", amount: forecast.projectedIncomeTax },
                ].map(({ label, amount, muted }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: muted ? "12px" : "13px", color: muted ? "#9ca3af" : "#374151" }}>
                    <span>{label}</span>
                    <span style={{ fontWeight: muted ? 400 : 600, color: amount < 0 ? "#16A34A" : undefined }}>
                      {amount < 0 ? `(${fmt(-amount)})` : fmt(amount)}
                    </span>
                  </div>
                ))}
                <div style={{ height: "1px", backgroundColor: "#f3f4f6", margin: "4px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", fontWeight: 700, color: "#111827" }}>
                  <span>Total Estimated Tax</span>
                  <span style={{ color: "#dc2626" }}>{fmt(forecast.projectedTotalTax)}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#9ca3af", textAlign: "right" }}>
                  Effective rate on net profit: {forecast.effectiveTaxRate}%
                </div>
              </div>
            </div>

            {/* Next quarterly payment callout */}
            <div style={{ margin: "0 24px 24px", padding: "16px 20px", backgroundColor: days !== null && days <= 30 ? "#fef2f2" : "#f0fdf4", border: `1px solid ${days !== null && days <= 30 ? "#fecaca" : "#bbf7d0"}`, borderRadius: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "2px" }}>
                    Next Quarterly Payment ({forecast.nextQuarterLabel})
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: "#111827" }}>{fmt(forecast.quarterlyPayment)}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                    Due {formatDate(forecast.nextQuarterlyDue)}
                    {days !== null && (
                      <span style={{ marginLeft: "6px", fontWeight: 600, color: days <= 14 ? "#dc2626" : days <= 30 ? "#f59e0b" : "#16A34A" }}>
                        {days < 0 ? "overdue" : days === 0 ? "due today" : `${days} days away`}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>Full-year total</div>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "#374151" }}>{fmt(forecast.projectedTotalTax)}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>÷ 4 quarters</div>
                </div>
              </div>
            </div>

            <div style={{ padding: "0 24px 16px", fontSize: "11px", color: "#9ca3af" }}>
              Based on {forecast.transactionCount.toLocaleString()} transactions · Assumes self-employment (Schedule C) · Does not include state taxes or W-2 income
            </div>
          </div>
        ) : null}

        {/* ── Recurring Transactions ─────────────────────────────────────────── */}
        <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px 16px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#111827" }}>Recurring Transactions</div>
              {upcoming90Total > 0 && (
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                  {fmt(upcoming90Total)} in recurring expenses due in the next 90 days
                </div>
              )}
            </div>
            <button
              onClick={runDetectRecurring}
              disabled={loadingRecurring}
              style={{ padding: "7px 14px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: loadingRecurring ? "default" : "pointer", fontFamily: font }}
            >
              {loadingRecurring ? "Scanning…" : recurring.length > 0 ? "Re-scan" : "Detect Recurring"}
            </button>
          </div>

          {recurring.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
              {loadingRecurring ? "Scanning transactions for patterns…" : "Click “Detect Recurring” to find subscriptions, bills, and repeating income."}
            </div>
          ) : (
            <div>
              {/* Upcoming header */}
              {upcoming90.length > 0 && (
                <div style={{ padding: "4px 24px 8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Due in next 90 days</div>
                  {upcoming90.map((item) => {
                    const d = daysUntil(item.nextExpectedDate);
                    return (
                      <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f9fafb" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: item.type === "income" ? "#f0fdf4" : "#fef3c7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
                          {item.type === "income" ? "💰" : "🔄"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.merchantName}</div>
                          <div style={{ fontSize: "11px", color: "#9ca3af" }}>{item.category || "Uncategorized"} · {item.occurrences}×</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: item.type === "income" ? "#16A34A" : "#111827" }}>
                            {item.type === "income" ? "+" : ""}{fmt(item.amount)}
                          </div>
                          <div style={{ fontSize: "11px", color: "#9ca3af" }}>{freqLabel(item.frequency)}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, minWidth: "60px" }}>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: d <= 7 ? "#dc2626" : d <= 14 ? "#f59e0b" : "#374151" }}>
                            {d === 0 ? "Today" : d < 0 ? "Overdue" : `${d}d`}
                          </div>
                          <div style={{ fontSize: "10px", color: "#9ca3af" }}>{formatDate(item.nextExpectedDate)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* All recurring */}
              <div style={{ padding: "4px 24px 16px" }}>
                {upcoming90.length > 0 && (
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px", marginTop: "12px" }}>All Recurring</div>
                )}
                {recurring.map((item) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 0", borderBottom: "1px solid #f9fafb" }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "6px", backgroundColor: item.type === "income" ? "#f0fdf4" : "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>
                      {item.type === "income" ? "💰" : "🔄"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.merchantName}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{item.category || "Uncategorized"}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: item.type === "income" ? "#16A34A" : "#374151" }}>
                        {item.type === "income" ? "+" : ""}{fmt(item.amount)} <span style={{ fontSize: "11px", fontWeight: 400, color: "#9ca3af" }}>{freqLabel(item.frequency)}</span>
                      </div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>Next: {formatDate(item.nextExpectedDate)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <p style={{ fontSize: "11px", color: "#9ca3af", textAlign: "center", marginTop: "8px" }}>
          Tax estimates are for planning purposes only. Consult a tax professional for advice.
        </p>
      </div>
    </div>
  );
}
