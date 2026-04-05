import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useRetirementData } from "./hooks/useRetirementData";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

interface FormState {
  payerName: string;
  totalDistribution: string;
  taxableAmount: string;
  saving: boolean;
  formError: string;
}

const EMPTY_FORM: FormState = {
  payerName: "",
  totalDistribution: "",
  taxableAmount: "",
  saving: false,
  formError: "",
};

export default function RetirementPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { forms, retirementTotal, totalDistributionSum, loading, error, addForm, removeForm } = useRetirementData();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const navLink: React.CSSProperties = {
    background: "none", border: "none", fontSize: "14px",
    color: "#6b7280", cursor: "pointer", padding: "4px 0", fontFamily: font,
  };
  const navLinkActive: React.CSSProperties = { ...navLink, color: "#16A34A", fontWeight: 600 };

  function patch(fields: Partial<FormState>) {
    setForm((p) => ({ ...p, ...fields, formError: "" }));
  }

  async function handleAdd() {
    const totalDist = parseFloat(form.totalDistribution);
    const taxable = parseFloat(form.taxableAmount);

    if (!form.payerName.trim()) { setForm((p) => ({ ...p, formError: "Payer name is required." })); return; }
    if (isNaN(totalDist) || totalDist < 0) { setForm((p) => ({ ...p, formError: "Total distribution must be 0 or more." })); return; }
    if (isNaN(taxable) || taxable < 0) { setForm((p) => ({ ...p, formError: "Taxable amount must be 0 or more." })); return; }

    setForm((p) => ({ ...p, saving: true, formError: "" }));
    try {
      await addForm(form.payerName, totalDist, taxable);
      setForm(EMPTY_FORM);
    } catch (e: unknown) {
      setForm((p) => ({ ...p, saving: false, formError: e instanceof Error ? e.message : "Failed to save." }));
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "14px",
    fontFamily: font,
    color: "#111827",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav style={{ backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px 10px", height: "64px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "32px" }}>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }} onClick={() => navigate("/dashboard")}>DIYTax AI</div>
          <button style={navLink} onClick={() => navigate("/dashboard")}>Dashboard</button>
          <button style={navLink} onClick={() => navigate("/transactions")}>Transactions</button>
          <button style={navLink} onClick={() => navigate("/review")}>Review</button>
          <button style={navLink} onClick={() => navigate("/import-csv")}>Import CSV</button>
          <button style={navLink} onClick={() => navigate("/income/ssa")}>Social Security</button>
          <button style={navLinkActive}>Retirement Income</button>
          <button style={navLink} onClick={() => navigate("/tax-summary")}>Business Income & Expenses (Sch. C)</button>
          <button style={navLink} onClick={() => navigate("/schedule-e")}>Rental Properties (Sch. E)</button>
          <button style={navLink} onClick={() => navigate("/schedule-a")}>Deductions (Sch. A)</button>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "16px" }}>
          <button style={navLink} onClick={() => navigate("/onboarding")}>Settings</button>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button onClick={() => signOut(auth).then(() => navigate("/login"))} style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
            Sign Out
          </button>
        </div>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>Retirement or Pension Income</h1>
          <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
            1099-R — Enter distributions from pensions, annuities, IRAs, and retirement plans
          </p>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "20px" }}>{error}</div>
        )}

        {/* Total banner */}
        {!loading && forms.length > 0 && (
          <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "20px 24px", marginBottom: "24px", display: "flex", gap: "40px", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Total Distribution</div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#374151", fontVariantNumeric: "tabular-nums" }}>{fmt(totalDistributionSum)}</div>
            </div>
            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>Taxable Amount</div>
              <div style={{ fontSize: "22px", fontWeight: 700, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>{fmt(retirementTotal)}</div>
            </div>
          </div>
        )}

        {/* Entry card */}
        <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: "24px" }}>
          {/* Section header */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
            <div style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>1099-R Forms</div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>Add one entry per 1099-R form received.</div>
          </div>

          {/* Existing entries */}
          {loading ? (
            <div style={{ padding: "20px 24px", color: "#9ca3af", fontSize: "14px" }}>Loading…</div>
          ) : forms.length === 0 ? (
            <div style={{ padding: "20px 24px", color: "#9ca3af", fontSize: "14px" }}>No 1099-R forms entered yet.</div>
          ) : (
            forms.map((f) => (
              <div key={f.id} style={{ padding: "14px 24px", borderBottom: "1px solid #f3f4f6", fontSize: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "#111827", marginBottom: "4px" }}>{f.payerName}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280" }}>
                      Box 1: {fmt(f.totalDistribution)} &nbsp;·&nbsp; Box 2a (taxable): {fmt(f.taxableAmount)}
                    </div>
                  </div>
                  <button onClick={() => removeForm(f.id)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: 0, fontFamily: font, marginLeft: "12px" }} title="Remove">×</button>
                </div>
              </div>
            ))
          )}

          {/* Add form */}
          <div style={{ padding: "20px 24px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "4px" }}>Payer Name</label>
                <input
                  type="text"
                  placeholder="e.g. Fidelity Investments"
                  value={form.payerName}
                  onChange={(e) => patch({ payerName: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "4px" }}>
                  Box 1 — Total Distribution
                </label>
                <input
                  type="number"
                  placeholder="e.g. 24000.00"
                  min="0"
                  step="0.01"
                  value={form.totalDistribution}
                  onChange={(e) => patch({ totalDistribution: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "4px" }}>
                  Box 2a — Taxable Amount
                </label>
                <input
                  type="number"
                  placeholder="e.g. 22000.00"
                  min="0"
                  step="0.01"
                  value={form.taxableAmount}
                  onChange={(e) => patch({ taxableAmount: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  style={inputStyle}
                />
              </div>
            </div>

            {form.formError && <div style={{ color: "#dc2626", fontSize: "12px", marginBottom: "8px" }}>{form.formError}</div>}

            <button
              onClick={handleAdd}
              disabled={form.saving}
              style={{ padding: "10px 20px", backgroundColor: form.saving ? "#86efac" : "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: form.saving ? "not-allowed" : "pointer", fontFamily: font }}
            >
              {form.saving ? "Saving…" : "+ Add 1099-R"}
            </button>
          </div>
        </div>

        <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.7 }}>
          <strong>Note:</strong> If Box 2a is blank on your 1099-R, you may need to calculate your taxable amount using
          Form 1040 rules or consult a tax professional. Roth IRA distributions that are qualified may be tax-free.
        </div>

        <button
          onClick={() => navigate("/tax-summary")}
          style={{ marginTop: "24px", padding: "11px 24px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
        >
          View Tax Summary →
        </button>
      </div>
    </div>
  );
}
