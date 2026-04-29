import React, { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../services/apiClient";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Txn {
  id: string;
  date: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  taxCategory: string;
  merchantName: string;
  description: string;
}

interface Recurring {
  id: string;
  merchantName: string;
  amount: number;
  frequency: string;
  nextExpectedDate: string;
  category: string;
  type: string;
  occurrences: number;
}

interface PlannedBill {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  type: "expense" | "income";
  category: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);

function mk(date: string) { return date.substring(0, 7); }

function monthLabel(key: string, short = false) {
  const [y, m] = key.split("-");
  return new Date(+y, +m - 1, 1).toLocaleDateString("en-US", { month: short ? "short" : "long", year: "numeric" });
}

function curMonthKey() { return new Date().toISOString().substring(0, 7); }

function prevMonths(from: string, n: number): string[] {
  const [y, m] = from.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (n - 1 - i), 1);
    return d.toISOString().substring(0, 7);
  });
}

function daysUntil(d: string) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + "T00:00:00").getTime() - t.getTime()) / 86400000);
}

function fmtShortDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function monthlyEquiv(r: Recurring): number {
  const mult: Record<string, number> = { weekly: 4.33, biweekly: 2.17, monthly: 1, quarterly: 0.33, annual: 0.083 };
  return r.amount * (mult[r.frequency] ?? 1);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SpendingForecastPage() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [txns,     setTxns]     = useState<Txn[]>([]);
  const [recur,    setRecur]    = useState<Recurring[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [month,    setMonth]    = useState(curMonthKey());
  const [scanning, setScanning] = useState(false);
  const [scanErr,  setScanErr]  = useState<string | null>(null);

  // Planned bills state
  const [planned,      setPlanned]      = useState<PlannedBill[]>([]);
  const [showAddForm,  setShowAddForm]  = useState(false);
  const [formDesc,     setFormDesc]     = useState("");
  const [formAmt,      setFormAmt]      = useState("");
  const [formDate,     setFormDate]     = useState("");
  const [formType,     setFormType]     = useState<"expense" | "income">("expense");
  const [formCat,      setFormCat]      = useState("");
  const [formSaving,   setFormSaving]   = useState(false);

  // Date range for period total (default: today → 7 days)
  const [rangeStart, setRangeStart] = useState(() => new Date().toISOString().split("T")[0]);
  const [rangeEnd,   setRangeEnd]   = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]);

  // Load last 7 months of transactions (live)
  useEffect(() => {
    if (!uid) return;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 7);
    const q = query(collection(db, "transactions"), where("uid", "==", uid), where("date", ">=", cutoff.toISOString().split("T")[0]));
    return onSnapshot(q, (snap) => {
      setTxns(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Txn)));
      setLoading(false);
    });
  }, [uid]);

  // Load recurring items (live)
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "recurringItems"), where("uid", "==", uid));
    return onSnapshot(q, (snap) => setRecur(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Recurring))));
  }, [uid]);

  // Load manually planned bills (live)
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "plannedBills"), where("uid", "==", uid));
    return onSnapshot(q, (snap) => setPlanned(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PlannedBill))));
  }, [uid]);

  async function scanRecurring() {
    setScanning(true); setScanErr(null);
    try { await apiClient.call("detectRecurring"); }
    catch (e) { setScanErr(e instanceof Error ? e.message : "Scan failed"); }
    finally { setScanning(false); }
  }

  async function savePlannedBill() {
    if (!uid || !formDesc.trim() || !formAmt || !formDate) return;
    setFormSaving(true);
    try {
      await addDoc(collection(db, "plannedBills"), {
        uid,
        description: formDesc.trim(),
        amount: Math.abs(parseFloat(formAmt)),
        dueDate: formDate,
        type: formType,
        category: formCat.trim(),
        createdAt: serverTimestamp(),
      });
      setFormDesc(""); setFormAmt(""); setFormDate(""); setFormCat(""); setFormType("expense");
      setShowAddForm(false);
    } finally {
      setFormSaving(false);
    }
  }

  async function deletePlannedBill(id: string) {
    await deleteDoc(doc(db, "plannedBills", id));
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  const a = useMemo(() => {
    type MD = { inc: number; exp: number; ded: number; byCat: Map<string, number>; byMerch: Map<string, { tot: number; n: number }> };
    const byMonth = new Map<string, MD>();

    for (const t of txns) {
      const key = mk(t.date);
      if (!byMonth.has(key)) byMonth.set(key, { inc: 0, exp: 0, ded: 0, byCat: new Map(), byMerch: new Map() });
      const m = byMonth.get(key)!;
      if (t.type === "income") {
        m.inc += t.amount;
      } else {
        m.exp += t.amount;
        if (t.taxCategory && t.taxCategory !== "" && t.taxCategory !== "Personal") m.ded += t.amount;
        const c = t.category || "Uncategorized";
        m.byCat.set(c, (m.byCat.get(c) ?? 0) + t.amount);
        const merch = t.merchantName || t.description || "Unknown";
        const prev = m.byMerch.get(merch) ?? { tot: 0, n: 0 };
        m.byMerch.set(merch, { tot: prev.tot + t.amount, n: prev.n + 1 });
      }
    }

    const empty: MD = { inc: 0, exp: 0, ded: 0, byCat: new Map(), byMerch: new Map() };
    const months6 = prevMonths(month, 6);
    const cur  = byMonth.get(month) ?? empty;
    const prev = byMonth.get(months6[4]) ?? empty; // 1 month prior
    const last3Keys = months6.slice(2, 5);
    const avg3Exp = last3Keys.reduce((s, k) => s + (byMonth.get(k)?.exp ?? 0), 0) / 3;
    const avg3Inc = last3Keys.reduce((s, k) => s + (byMonth.get(k)?.inc ?? 0), 0) / 3;

    // Category breakdown
    const allCats = new Set([...cur.byCat.keys(), ...prev.byCat.keys()]);
    const cats = [...allCats]
      .map((c) => ({ cat: c, cur: cur.byCat.get(c) ?? 0, prev: prev.byCat.get(c) ?? 0 }))
      .filter((r) => r.cur > 0)
      .sort((a, b) => b.cur - a.cur);

    // Top merchants this month
    const topMerch = [...cur.byMerch.entries()]
      .map(([name, d]) => ({ name, tot: d.tot, n: d.n }))
      .sort((a, b) => b.tot - a.tot)
      .slice(0, 6);

    // Month progress
    const now = new Date();
    const isCur = month === curMonthKey();
    const [sy, sm] = month.split("-").map(Number);
    const daysTotal = new Date(sy, sm, 0).getDate();
    const daysIn    = isCur ? now.getDate() : daysTotal;
    const daysLeft  = isCur ? daysTotal - now.getDate() : 0;
    const projExp   = isCur && daysIn > 0 ? Math.round((cur.exp / daysIn) * daysTotal) : cur.exp;
    const projInc   = isCur && daysIn > 0 ? Math.round((cur.inc / daysIn) * daysTotal) : cur.inc;
    const net       = cur.inc - cur.exp;
    const savRate   = cur.inc > 0 ? Math.round((net / cur.inc) * 100) : 0;

    // 30/60/90 projections
    const todayStr = new Date().toISOString().split("T")[0];
    function window(days: number) {
      const end = new Date(Date.now() + days * 86400000).toISOString().split("T")[0];
      const recurExp = recur.filter((r) => r.type === "expense" && r.nextExpectedDate >= todayStr && r.nextExpectedDate <= end).reduce((s, r) => s + r.amount, 0);
      const recurInc = recur.filter((r) => r.type === "income"  && r.nextExpectedDate >= todayStr && r.nextExpectedDate <= end).reduce((s, r) => s + r.amount, 0);
      const dailyBaseline = (avg3Exp / 30) * days;
      return { recurExp: Math.round(recurExp), recurInc: Math.round(recurInc), baseline: Math.round(dailyBaseline), total: Math.round(dailyBaseline + recurExp) };
    }

    // Monthly history for chart
    const history = months6.map((k) => {
      const m = byMonth.get(k) ?? empty;
      return { key: k, label: monthLabel(k, true), inc: m.inc, exp: m.exp, net: m.inc - m.exp };
    });
    const maxAmt = Math.max(...history.map((h) => Math.max(h.inc, h.exp)), 1);

    // Insights
    const insights: string[] = [];
    const todayIns = new Date().toISOString().split("T")[0];
    const due7 = recur.filter((r) => r.type === "expense" && daysUntil(r.nextExpectedDate) >= 0 && daysUntil(r.nextExpectedDate) <= 7);
    if (due7.length) insights.push(`${due7.length} bill${due7.length > 1 ? "s" : ""} due in the next 7 days — ${fmt(due7.reduce((s, r) => s + r.amount, 0))} total`);
    if (cats.length) {
      const top = cats[0];
      const share = cur.exp > 0 ? Math.round((top.cur / cur.exp) * 100) : 0;
      insights.push(`${top.cat} is your largest expense category at ${share}% of total spending`);
    }
    const expChg = pct(cur.exp, prev.exp);
    if (Math.abs(expChg) >= 15) insights.push(`Spending is ${expChg > 0 ? `up ${expChg}%` : `down ${Math.abs(expChg)}%`} vs last month`);
    if (cur.ded > 0 && cur.exp > 0) {
      const dp = Math.round((cur.ded / cur.exp) * 100);
      insights.push(`${dp}% of your expenses (${fmt(cur.ded)}) are tax-deductible this month`);
    }
    if (savRate > 0) insights.push(`Savings rate: ${savRate}% — you kept ${fmt(Math.max(0, net))} after expenses`);

    return { cur, prev, net, savRate, projExp, projInc, daysIn, daysTotal, daysLeft, isCur,
      cats, topMerch, avg3Exp, avg3Inc,
      w30: window(30), w60: window(60), w90: window(90),
      history, maxAmt, insights,
      incChg: pct(cur.inc, prev.inc), expChg: pct(cur.exp, prev.exp) };
  }, [txns, recur, month]);

  // Bills within the selected date range (auto-detected + manual)
  const rangeBills = useMemo(() => {
    const autoItems = recur
      .filter((r) => r.nextExpectedDate >= rangeStart && r.nextExpectedDate <= rangeEnd)
      .map((r) => ({ id: r.id, description: r.merchantName, amount: r.amount, dueDate: r.nextExpectedDate, type: r.type as "expense" | "income", category: r.category, source: "auto" as const }));
    const manualItems = planned
      .filter((p) => p.dueDate >= rangeStart && p.dueDate <= rangeEnd)
      .map((p) => ({ ...p, source: "manual" as const }));
    const all = [...autoItems, ...manualItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return {
      all,
      totalDue:      all.filter((r) => r.type === "expense").reduce((s, r) => s + r.amount, 0),
      totalIncoming: all.filter((r) => r.type === "income").reduce((s, r)  => s + r.amount, 0),
    };
  }, [recur, planned, rangeStart, rangeEnd]);

  // Available months for selector
  const monthOptions = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return d.toISOString().substring(0, 7);
    });
  }, []);

  const todayStr = new Date().toISOString().split("T")[0];
  const billsUpcoming = recur
    .filter((r) => r.type === "expense" && r.nextExpectedDate >= todayStr)
    .sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  const incomeUpcoming = recur
    .filter((r) => r.type === "income" && r.nextExpectedDate >= todayStr)
    .sort((a, b) => a.nextExpectedDate.localeCompare(b.nextExpectedDate));
  const monthlyRecurCost = recur.filter((r) => r.type === "expense").reduce((s, r) => s + monthlyEquiv(r), 0);
  const monthlyRecurInc  = recur.filter((r) => r.type === "income").reduce((s, r)  => s + monthlyEquiv(r), 0);

  const { cur, prev, net, savRate, projExp, projInc, daysIn, daysTotal, daysLeft, isCur,
    cats, topMerch, history, maxAmt, insights, incChg, expChg, w30, w60, w90 } = a;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Spending Forecast</h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>Cash flow, trends, and upcoming bills — all in one place.</p>
          </div>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #d1d5db", fontSize: "13px", color: "#374151", fontFamily: font, backgroundColor: "#fff" }}
          >
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "80px 0", fontSize: "14px" }}>Loading…</div>
        ) : (
          <>
            {/* ── Section 1: Cash Flow Summary ──────────────────────────────── */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", overflow: "hidden" }}>
              <div style={{ padding: "16px 24px 12px", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>{monthLabel(month)}</span>
                  {isCur && (
                    <span style={{ fontSize: "12px", color: "#6b7280" }}>
                      Day {daysIn} of {daysTotal} · {daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining
                    </span>
                  )}
                </div>
                {isCur && (
                  <div style={{ marginTop: "8px", height: "4px", backgroundColor: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((daysIn / daysTotal) * 100)}%`, backgroundColor: "#16A34A", borderRadius: "99px" }} />
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1px", backgroundColor: "#f3f4f6" }}>
                {[
                  { label: "Income", value: cur.inc, proj: isCur ? projInc : null, chg: incChg, good: true },
                  { label: "Expenses", value: cur.exp, proj: isCur ? projExp : null, chg: expChg, good: false },
                  { label: "Net", value: net, proj: null, chg: null, good: net >= 0 },
                  { label: "Savings Rate", value: null, proj: null, chg: null, good: savRate >= 20, extra: `${savRate}%` },
                ].map(({ label, value, proj, chg, good, extra }) => (
                  <div key={label} style={{ backgroundColor: "#fff", padding: "16px 18px" }}>
                    <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: extra ? (good ? "#16A34A" : "#dc2626") : (value === null ? "#111827" : value >= 0 ? (good ? "#16A34A" : "#dc2626") : "#dc2626") }}>
                      {extra ?? fmt(value!)}
                    </div>
                    {proj !== null && proj !== value && (
                      <div style={{ fontSize: "10px", color: "#9ca3af", marginTop: "1px" }}>proj. {fmt(proj)}</div>
                    )}
                    {chg !== null && prev.inc > 0 && (
                      <div style={{ fontSize: "11px", marginTop: "2px", color: (label === "Expenses" ? chg > 0 : chg < 0) ? "#dc2626" : chg !== 0 ? "#16A34A" : "#9ca3af" }}>
                        {chg > 0 ? "↑" : chg < 0 ? "↓" : "→"} {Math.abs(chg)}% vs last mo
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Deductible insight — our differentiator */}
              {cur.ded > 0 && cur.exp > 0 && (
                <div style={{ padding: "12px 24px", backgroundColor: "#f0fdf4", borderTop: "1px solid #dcfce7" }}>
                  <span style={{ fontSize: "12px", color: "#15803d" }}>
                    <strong>{fmt(cur.ded)}</strong> ({Math.round((cur.ded / cur.exp) * 100)}%) of your expenses are tax-deductible — your true after-tax cost is lower than it looks.
                  </span>
                </div>
              )}
            </div>

            {/* ── Section 2: Upcoming Bills Alert ───────────────────────────── */}
            {billsUpcoming.filter((r) => daysUntil(r.nextExpectedDate) <= 14).length > 0 && (
              <div style={{ backgroundColor: "#fffbeb", border: "1px solid #fde68a", borderRadius: "12px", padding: "14px 20px", marginBottom: "16px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>Upcoming in 14 days</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {billsUpcoming.filter((r) => daysUntil(r.nextExpectedDate) <= 14).map((r) => {
                    const d = daysUntil(r.nextExpectedDate);
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: "#fff", borderRadius: "8px", padding: "6px 10px", border: "1px solid #fde68a" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#374151" }}>{r.merchantName}</span>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: d <= 3 ? "#dc2626" : "#d97706" }}>{fmt(r.amount)}</span>
                        <span style={{ fontSize: "11px", color: "#9ca3af" }}>{d === 0 ? "today" : `${d}d`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Section 2b: Bill Planner ──────────────────────────────────── */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", overflow: "hidden" }}>

              {/* Header */}
              <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>Bill Planner</div>
                  <button
                    onClick={() => setShowAddForm((v) => !v)}
                    style={{ padding: "6px 14px", backgroundColor: showAddForm ? "#f3f4f6" : "#16A34A", color: showAddForm ? "#374151" : "#fff", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: font }}
                  >
                    {showAddForm ? "Cancel" : "+ Add Bill"}
                  </button>
                </div>

                {/* Date range selector */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "12px", color: "#6b7280", fontWeight: 600 }}>Period:</span>
                  <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)}
                    style={{ padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontFamily: font, color: "#374151" }} />
                  <span style={{ fontSize: "12px", color: "#9ca3af" }}>to</span>
                  <input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)}
                    style={{ padding: "5px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontFamily: font, color: "#374151" }} />
                  <div style={{ display: "flex", gap: "6px", marginLeft: "4px" }}>
                    {[
                      { label: "Week",  days: 7  },
                      { label: "Month", days: 30 },
                      { label: "Qtr",   days: 90 },
                    ].map(({ label, days }) => (
                      <button key={label} onClick={() => { const s = new Date().toISOString().split("T")[0]; setRangeStart(s); setRangeEnd(new Date(Date.now() + days * 86400000).toISOString().split("T")[0]); }}
                        style={{ padding: "4px 10px", backgroundColor: "#f3f4f6", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 600, color: "#6b7280", cursor: "pointer", fontFamily: font }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Period totals */}
                {rangeBills.all.length > 0 && (
                  <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                    {rangeBills.totalDue > 0 && (
                      <div style={{ flex: 1, backgroundColor: "#fef2f2", borderRadius: "10px", padding: "10px 14px" }}>
                        <div style={{ fontSize: "11px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }}>Total Due</div>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: "#dc2626" }}>{fmt(rangeBills.totalDue)}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>{rangeBills.all.filter(r => r.type === "expense").length} item{rangeBills.all.filter(r => r.type === "expense").length !== 1 ? "s" : ""}</div>
                      </div>
                    )}
                    {rangeBills.totalIncoming > 0 && (
                      <div style={{ flex: 1, backgroundColor: "#f0fdf4", borderRadius: "10px", padding: "10px 14px" }}>
                        <div style={{ fontSize: "11px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }}>Expected In</div>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A" }}>{fmt(rangeBills.totalIncoming)}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>{rangeBills.all.filter(r => r.type === "income").length} item{rangeBills.all.filter(r => r.type === "income").length !== 1 ? "s" : ""}</div>
                      </div>
                    )}
                    {rangeBills.totalDue > 0 && rangeBills.totalIncoming > 0 && (
                      <div style={{ flex: 1, backgroundColor: "#f8fafc", borderRadius: "10px", padding: "10px 14px" }}>
                        <div style={{ fontSize: "11px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "2px" }}>Net</div>
                        <div style={{ fontSize: "20px", fontWeight: 800, color: (rangeBills.totalIncoming - rangeBills.totalDue) >= 0 ? "#16A34A" : "#dc2626" }}>
                          {fmt(rangeBills.totalIncoming - rangeBills.totalDue)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Add Bill Form */}
              {showAddForm && (
                <div style={{ padding: "16px 24px", backgroundColor: "#f8fafc", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>Description *</label>
                      <input
                        placeholder="e.g. Property Tax Q2"
                        value={formDesc}
                        onChange={(e) => setFormDesc(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "13px", fontFamily: font, boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>Amount *</label>
                      <input
                        type="number" min="0" step="0.01" placeholder="0.00"
                        value={formAmt}
                        onChange={(e) => setFormAmt(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "13px", fontFamily: font, boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>Due Date *</label>
                      <input
                        type="date"
                        value={formDate}
                        onChange={(e) => setFormDate(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "13px", fontFamily: font, boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>Type</label>
                      <select
                        value={formType}
                        onChange={(e) => setFormType(e.target.value as "expense" | "income")}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "13px", fontFamily: font, boxSizing: "border-box", backgroundColor: "#fff" }}
                      >
                        <option value="expense">Bill / Expense</option>
                        <option value="income">Expected Income</option>
                      </select>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: "11px", fontWeight: 600, color: "#6b7280", display: "block", marginBottom: "4px" }}>Category (optional)</label>
                      <input
                        placeholder="e.g. Taxes, Insurance, Rent"
                        value={formCat}
                        onChange={(e) => setFormCat(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "13px", fontFamily: font, boxSizing: "border-box" }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={savePlannedBill}
                    disabled={formSaving || !formDesc.trim() || !formAmt || !formDate}
                    style={{ padding: "9px 24px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: formSaving || !formDesc.trim() || !formAmt || !formDate ? "default" : "pointer", opacity: formSaving || !formDesc.trim() || !formAmt || !formDate ? 0.5 : 1, fontFamily: font }}
                  >
                    {formSaving ? "Saving…" : "Save Bill"}
                  </button>
                </div>
              )}

              {/* Bill list for the selected period */}
              {rangeBills.all.length === 0 ? (
                <div style={{ padding: "28px 24px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                  No bills or income in this period. Adjust the date range or add a bill manually.
                </div>
              ) : (
                <div style={{ padding: "8px 24px 12px" }}>
                  {rangeBills.all.map((item) => {
                    const d = daysUntil(item.dueDate);
                    const isOverdue = d < 0;
                    return (
                      <div key={item.source + item.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f9fafb" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, backgroundColor: item.type === "income" ? "#16A34A" : isOverdue ? "#dc2626" : d <= 3 ? "#ef4444" : d <= 7 ? "#f59e0b" : "#d1d5db" }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</span>
                            {item.source === "manual" && (
                              <span style={{ fontSize: "10px", fontWeight: 700, color: "#6366f1", backgroundColor: "#eef2ff", borderRadius: "4px", padding: "1px 5px", flexShrink: 0 }}>manual</span>
                            )}
                          </div>
                          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>
                            {fmtShortDate(item.dueDate)}
                            {item.category ? ` · ${item.category}` : ""}
                            {isOverdue ? <span style={{ color: "#dc2626", fontWeight: 600 }}> · overdue</span> : d === 0 ? <span style={{ color: "#dc2626", fontWeight: 600 }}> · today</span> : d === 1 ? " · tomorrow" : ` · in ${d} days`}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: item.type === "income" ? "#16A34A" : "#dc2626" }}>
                            {item.type === "income" ? "+" : ""}{fmt(item.amount)}
                          </div>
                        </div>
                        {item.source === "manual" && (
                          <button
                            onClick={() => deletePlannedBill(item.id)}
                            style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "2px 4px", flexShrink: 0 }}
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Section 3: 30 / 60 / 90 Day Outlook ──────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "16px" }}>
              {[
                { label: "30-Day Outlook", w: w30, days: 30 },
                { label: "60-Day Outlook", w: w60, days: 60 },
                { label: "90-Day Outlook", w: w90, days: 90 },
              ].map(({ label, w }) => (
                <div key={label} style={{ backgroundColor: "#fff", borderRadius: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", padding: "16px 18px" }}>
                  <div style={{ fontSize: "11px", color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" }}>{label}</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#dc2626", marginBottom: "4px" }}>{fmt(w.total)}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>projected expenses</div>
                  {w.recurExp > 0 && (
                    <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #f3f4f6" }}>
                      <div style={{ fontSize: "11px", color: "#374151" }}>{fmt(w.recurExp)} recurring</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{fmt(w.baseline)} variable</div>
                    </div>
                  )}
                  {w.recurInc > 0 && (
                    <div style={{ fontSize: "11px", color: "#16A34A", marginTop: "4px" }}>+{fmt(w.recurInc)} expected income</div>
                  )}
                </div>
              ))}
            </div>

            {/* ── Section 4: Spending by Category ───────────────────────────── */}
            {cats.length > 0 && (
              <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", overflow: "hidden" }}>
                <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>Spending by Category</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>vs {monthLabel(prevMonths(month, 2)[0], true)}</div>
                </div>
                <div style={{ padding: "8px 24px 16px" }}>
                  {cats.map((row) => {
                    const barPct = cur.exp > 0 ? (row.cur / cur.exp) * 100 : 0;
                    const chg = pct(row.cur, row.prev);
                    const isNew = row.prev === 0 && row.cur > 0;
                    return (
                      <div key={row.cat} style={{ padding: "10px 0", borderBottom: "1px solid #f9fafb" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                          <span style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>{row.cat}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            {!isNew && row.prev > 0 && (
                              <span style={{ fontSize: "12px", color: chg > 15 ? "#dc2626" : chg > 5 ? "#d97706" : chg < -5 ? "#16A34A" : "#9ca3af" }}>
                                {chg > 0 ? "↑" : chg < 0 ? "↓" : "→"} {Math.abs(chg)}%
                              </span>
                            )}
                            {isNew && <span style={{ fontSize: "11px", color: "#6366f1", fontWeight: 600 }}>new</span>}
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "#111827" }}>{fmt(row.cur)}</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                          <div style={{ flex: 1, height: "6px", backgroundColor: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${barPct}%`, backgroundColor: barPct > 40 ? "#ef4444" : barPct > 25 ? "#f59e0b" : "#6366f1", borderRadius: "99px", transition: "width 0.4s" }} />
                          </div>
                          <span style={{ fontSize: "10px", color: "#9ca3af", minWidth: "32px", textAlign: "right" }}>{Math.round(barPct)}%</span>
                        </div>
                        {row.prev > 0 && (
                          <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "3px" }}>
                            Last month: {fmt(row.prev)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Section 5: Top Merchants ───────────────────────────────────── */}
            {topMerch.length > 0 && (
              <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", overflow: "hidden" }}>
                <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>Top Merchants This Month</div>
                </div>
                <div style={{ padding: "8px 24px 16px" }}>
                  {topMerch.map((m, i) => (
                    <div key={m.name} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "9px 0", borderBottom: i < topMerch.length - 1 ? "1px solid #f9fafb" : "none" }}>
                      <div style={{ width: "28px", height: "28px", borderRadius: "50%", backgroundColor: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "#6b7280", flexShrink: 0 }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>{m.n} transaction{m.n !== 1 ? "s" : ""}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>{fmt(m.tot)}</div>
                        <div style={{ fontSize: "11px", color: "#9ca3af" }}>{cur.exp > 0 ? Math.round((m.tot / cur.exp) * 100) : 0}% of exp</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Section 6: Recurring Bills & Subscriptions ────────────────── */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", overflow: "hidden" }}>
              <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>Subscriptions &amp; Recurring</div>
                    {monthlyRecurCost > 0 && (
                      <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
                        {fmt(monthlyRecurCost)}/mo in recurring expenses
                        {monthlyRecurInc > 0 && <span style={{ color: "#16A34A" }}> · +{fmt(monthlyRecurInc)}/mo recurring income</span>}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={scanRecurring}
                    disabled={scanning}
                    style={{ padding: "6px 12px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: scanning ? "default" : "pointer", fontFamily: font }}
                  >
                    {scanning ? "Scanning…" : recur.length > 0 ? "Re-scan" : "Detect Recurring"}
                  </button>
                </div>
                {scanErr && <div style={{ fontSize: "12px", color: "#dc2626", marginTop: "6px" }}>{scanErr}</div>}
              </div>

              {recur.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: "13px" }}>
                  Click &ldquo;Detect Recurring&rdquo; to find subscriptions, bills, and repeating income from your transaction history.
                </div>
              ) : (
                <div>
                  {billsUpcoming.length > 0 && (
                    <div style={{ padding: "12px 24px 0" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Upcoming Bills</div>
                      {billsUpcoming.slice(0, 8).map((r) => {
                        const d = daysUntil(r.nextExpectedDate);
                        return (
                          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "9px 0", borderBottom: "1px solid #f9fafb" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: d <= 3 ? "#ef4444" : d <= 7 ? "#f59e0b" : "#d1d5db", flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName}</div>
                              <div style={{ fontSize: "11px", color: "#9ca3af" }}>{r.category || "Uncategorized"} · {r.frequency}</div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>{fmt(r.amount)}</div>
                              <div style={{ fontSize: "11px", color: d <= 3 ? "#dc2626" : d <= 7 ? "#d97706" : "#9ca3af", fontWeight: d <= 7 ? 600 : 400 }}>
                                {d === 0 ? "today" : d < 0 ? "overdue" : `in ${d}d · ${fmtShortDate(r.nextExpectedDate)}`}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {incomeUpcoming.length > 0 && (
                    <div style={{ padding: "12px 24px 0" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Recurring Income</div>
                      {incomeUpcoming.slice(0, 4).map((r) => {
                        const d = daysUntil(r.nextExpectedDate);
                        return (
                          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "9px 0", borderBottom: "1px solid #f9fafb" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#16A34A", flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.merchantName}</div>
                              <div style={{ fontSize: "11px", color: "#9ca3af" }}>{r.frequency}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "#16A34A" }}>+{fmt(r.amount)}</div>
                              <div style={{ fontSize: "11px", color: "#9ca3af" }}>{d <= 0 ? fmtShortDate(r.nextExpectedDate) : `in ${d}d`}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ height: "12px" }} />
                </div>
              )}
            </div>

            {/* ── Section 7: 6-Month Trend ───────────────────────────────────── */}
            <div style={{ backgroundColor: "#fff", borderRadius: "16px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", overflow: "hidden" }}>
              <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>6-Month Trend</div>
              </div>
              <div style={{ padding: "16px 24px" }}>
                {/* Legend */}
                <div style={{ display: "flex", gap: "16px", marginBottom: "12px" }}>
                  {[{ color: "#16A34A", label: "Income" }, { color: "#ef4444", label: "Expenses" }].map(({ color, label }) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <div style={{ width: "10px", height: "10px", borderRadius: "2px", backgroundColor: color }} />
                      <span style={{ fontSize: "11px", color: "#6b7280" }}>{label}</span>
                    </div>
                  ))}
                </div>
                {history.map((h) => (
                  <div key={h.key} style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                      <span style={{ fontSize: "12px", fontWeight: h.key === month ? 700 : 400, color: h.key === month ? "#111827" : "#6b7280", minWidth: "64px" }}>{h.label}</span>
                      <div style={{ display: "flex", gap: "12px" }}>
                        <span style={{ fontSize: "11px", color: "#16A34A" }}>{fmt(h.inc)}</span>
                        <span style={{ fontSize: "11px", color: "#ef4444" }}>{fmt(h.exp)}</span>
                        <span style={{ fontSize: "11px", fontWeight: 600, color: h.net >= 0 ? "#16A34A" : "#dc2626" }}>{h.net >= 0 ? "+" : ""}{fmt(h.net)}</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      {[
                        { value: h.inc, color: "#16A34A" },
                        { value: h.exp, color: "#ef4444" },
                      ].map(({ value, color }) => (
                        <div key={color} style={{ height: "5px", backgroundColor: "#f3f4f6", borderRadius: "99px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.round((value / maxAmt) * 100)}%`, backgroundColor: color, borderRadius: "99px" }} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Section 8: Insights ────────────────────────────────────────── */}
            {insights.length > 0 && (
              <div style={{ backgroundColor: "#1e293b", borderRadius: "16px", padding: "20px 24px", marginBottom: "24px" }}>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "#f1f5f9", marginBottom: "12px" }}>Key Insights</div>
                {insights.map((ins, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", marginBottom: i < insights.length - 1 ? "10px" : 0 }}>
                    <span style={{ color: "#16A34A", fontSize: "14px", flexShrink: 0, marginTop: "1px" }}>→</span>
                    <span style={{ fontSize: "13px", color: "#cbd5e1" }}>{ins}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
