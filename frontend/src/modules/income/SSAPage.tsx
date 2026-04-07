import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useSSAData } from "./hooks/useSSAData";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function SSAPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { forms, ssaTotal, loading, error, addForm, removeForm } = useSSAData();

  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleAdd() {
    const val = parseFloat(amount);
    if (isNaN(val) || val < 0) {
      setFormError("Enter a valid amount (0 or more).");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await addForm(val);
      setAmount("");
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      {/* Content */}
      <div style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>Social Security Income</h1>
          <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
            SSA-1099 — Enter the total benefits received (Box 5)
          </p>
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "20px" }}>{error}</div>
        )}

        {/* Total banner */}
        {!loading && forms.length > 0 && (
          <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "20px 24px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "#166534" }}>Total Social Security Benefits</div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>{fmt(ssaTotal)}</div>
          </div>
        )}

        {/* Entry card */}
        <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: "24px" }}>
          {/* Section header */}
          <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", backgroundColor: "#f9fafb" }}>
            <div style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>SSA-1099 Forms</div>
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
              Add one entry per SSA-1099 form received. For a married couple filing jointly, enter each spouse's form separately.
            </div>
          </div>

          {/* Existing entries */}
          {loading ? (
            <div style={{ padding: "20px 24px", color: "#9ca3af", fontSize: "14px" }}>Loading…</div>
          ) : forms.length === 0 ? (
            <div style={{ padding: "20px 24px", color: "#9ca3af", fontSize: "14px" }}>No SSA-1099 forms entered yet.</div>
          ) : (
            forms.map((form, i) => (
              <div key={form.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #f3f4f6", fontSize: "14px" }}>
                <span style={{ color: "#374151" }}>Form {i + 1} — Box 5</span>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <span style={{ fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums" }}>{fmt(form.totalBenefits)}</span>
                  <button onClick={() => removeForm(form.id)} style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: 0, fontFamily: font }} title="Remove">×</button>
                </div>
              </div>
            ))
          )}

          {/* Add form */}
          <div style={{ padding: "16px 24px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "8px" }}>
              Total benefits received — Box 5 of SSA-1099
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                type="number"
                placeholder="e.g. 14400.00"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setFormError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: "8px", padding: "10px 12px", fontSize: "14px", fontFamily: font, color: "#111827", outline: "none" }}
              />
              <button
                onClick={handleAdd}
                disabled={saving}
                style={{ padding: "10px 20px", backgroundColor: saving ? "#86efac" : "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}
              >
                {saving ? "Saving…" : "+ Add"}
              </button>
            </div>
            {formError && <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "6px" }}>{formError}</div>}
          </div>
        </div>

        {/* Info note */}
        <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.7 }}>
          <strong>Note:</strong> The taxable portion of Social Security benefits depends on your combined income and filing status.
          Up to 85% of benefits may be taxable. This calculation will be added in a future update — consult a tax professional.
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
