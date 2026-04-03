import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import {
  useDeductions,
  DeductionType,
  Deduction,
} from "./hooks/useDeductions";
import { SALT_CAP } from "../tax/hooks/useScheduleA";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Section config ───────────────────────────────────────────────────────────

interface SectionConfig {
  type: DeductionType;
  title: string;
  placeholder: string;
  note?: string;
  capNote?: string;
}

const SECTIONS: SectionConfig[] = [
  {
    type: "medical",
    title: "Medical Expenses",
    placeholder: "e.g. Hospital bills, prescriptions",
    note: "Include out-of-pocket costs not covered by insurance.",
  },
  {
    type: "taxes",
    title: "Taxes Paid (SALT)",
    placeholder: "e.g. Property tax, state income tax",
    capNote: `SALT deduction is capped at ${fmt(SALT_CAP)} per return.`,
  },
  {
    type: "mortgage",
    title: "Mortgage Interest",
    placeholder: "e.g. Primary home mortgage interest",
    note: "Enter the amount from your Form 1098.",
  },
  {
    type: "charity",
    title: "Charitable Contributions",
    placeholder: "e.g. Cash donation to Red Cross",
    note: "Cash and non-cash donations to qualifying organizations.",
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SectionFormState {
  description: string;
  amount: string;
  saving: boolean;
  formError: string;
}

function DeductionSection({
  config,
  items,
  onAdd,
  onRemove,
}: {
  config: SectionConfig;
  items: Deduction[];
  onAdd: (description: string, amount: number) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState<SectionFormState>({
    description: "",
    amount: "",
    saving: false,
    formError: "",
  });

  const sectionTotal = items.reduce((s, d) => s + d.amount, 0);

  async function handleAdd() {
    const amt = parseFloat(form.amount);
    if (!form.description.trim()) {
      setForm((p) => ({ ...p, formError: "Description is required." }));
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      setForm((p) => ({ ...p, formError: "Enter a positive amount." }));
      return;
    }
    setForm((p) => ({ ...p, saving: true, formError: "" }));
    try {
      await onAdd(form.description, amt);
      setForm({ description: "", amount: "", saving: false, formError: "" });
    } catch (e: unknown) {
      setForm((p) => ({
        ...p,
        saving: false,
        formError: e instanceof Error ? e.message : "Failed to save.",
      }));
    }
  }

  return (
    <div
      style={{
        backgroundColor: "#fff",
        borderRadius: "12px",
        boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
        marginBottom: "24px",
        overflow: "hidden",
      }}
    >
      {/* Section header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid #e5e7eb",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#f9fafb",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>
            {config.title}
          </div>
          {config.note && (
            <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>
              {config.note}
            </div>
          )}
          {config.capNote && (
            <div style={{ fontSize: "12px", color: "#d97706", marginTop: "2px", fontWeight: 500 }}>
              ⚠ {config.capNote}
            </div>
          )}
        </div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>
          {fmt(sectionTotal)}
        </div>
      </div>

      {/* Existing entries */}
      {items.length > 0 && (
        <div style={{ borderBottom: "1px solid #f3f4f6" }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 24px",
                borderBottom: "1px solid #f9fafb",
                fontSize: "14px",
              }}
            >
              <span style={{ color: "#374151", flex: 1 }}>{item.description}</span>
              <span style={{ fontWeight: 600, color: "#111827", fontVariantNumeric: "tabular-nums", marginRight: "16px" }}>
                {fmt(item.amount)}
              </span>
              <button
                onClick={() => onRemove(item.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#9ca3af",
                  cursor: "pointer",
                  fontSize: "16px",
                  padding: "0",
                  lineHeight: 1,
                  fontFamily: font,
                }}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div style={{ padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
          <input
            type="text"
            placeholder={config.placeholder}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value, formError: "" }))}
            style={{
              flex: 2,
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              padding: "9px 12px",
              fontSize: "14px",
              fontFamily: font,
              color: "#111827",
              outline: "none",
            }}
          />
          <input
            type="number"
            placeholder="Amount"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value, formError: "" }))}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            style={{
              flex: 1,
              border: "1px solid #d1d5db",
              borderRadius: "8px",
              padding: "9px 12px",
              fontSize: "14px",
              fontFamily: font,
              color: "#111827",
              outline: "none",
              minWidth: "110px",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={form.saving}
            style={{
              padding: "9px 18px",
              backgroundColor: form.saving ? "#86efac" : "#16A34A",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: form.saving ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              fontFamily: font,
            }}
          >
            {form.saving ? "Saving…" : "+ Add"}
          </button>
        </div>
        {form.formError && (
          <div style={{ color: "#dc2626", fontSize: "12px", marginTop: "6px" }}>
            {form.formError}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DeductionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { deductions, loading, error, addDeduction, removeDeduction } = useDeductions();

  const navLink: React.CSSProperties = {
    background: "none", border: "none", fontSize: "14px",
    color: "#6b7280", cursor: "pointer", padding: "4px 0", fontFamily: font,
  };
  const navLinkActive: React.CSSProperties = { ...navLink, color: "#16A34A", fontWeight: 600 };

  const totalAll = deductions.reduce((s, d) => s + d.amount, 0);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav style={{ backgroundColor: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }} onClick={() => navigate("/dashboard")}>
            DIYTax AI
          </div>
          <button style={navLink} onClick={() => navigate("/dashboard")}>Dashboard</button>
          <button style={navLink} onClick={() => navigate("/transactions")}>Transactions</button>
          <button style={navLink} onClick={() => navigate("/review")}>Review</button>
          <button style={navLink} onClick={() => navigate("/import-csv")}>Import CSV</button>
          <button style={navLink} onClick={() => navigate("/tax-summary")}>Business Income & Expenses (Sch. C)</button>
          <button style={navLink} onClick={() => navigate("/schedule-e")}>Rental Properties (Sch. E)</button>
          <button style={navLinkActive}>Deductions (Sch. A)</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button style={navLink} onClick={() => navigate("/onboarding")}>Settings</button>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            onClick={() => signOut(auth).then(() => navigate("/login"))}
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Itemized Deductions
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Schedule A — manually enter deductions not captured from transactions
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
              Total Manual Entries
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#16A34A", fontVariantNumeric: "tabular-nums" }}>
              {fmt(totalAll)}
            </div>
          </div>
        </div>

        <div style={{ backgroundColor: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "12px 16px", marginBottom: "28px", fontSize: "13px", color: "#1e40af" }}>
          Transactions categorized as <strong>Charitable Contribution</strong> or <strong>Medical Expense</strong> are automatically included in your Schedule A summary.
          Use this page to add deductions not captured from your bank transactions (e.g., property tax, mortgage interest paid by check).
        </div>

        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", color: "#dc2626", fontSize: "14px", marginBottom: "24px" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#9ca3af" }}>Loading…</div>
        ) : (
          SECTIONS.map((config) => (
            <DeductionSection
              key={config.type}
              config={config}
              items={deductions.filter((d) => d.type === config.type)}
              onAdd={(desc, amt) => addDeduction(config.type, desc, amt)}
              onRemove={removeDeduction}
            />
          ))
        )}

        {/* Link to summary */}
        {!loading && (
          <div style={{ textAlign: "center", marginTop: "8px" }}>
            <button
              onClick={() => navigate("/schedule-a")}
              style={{ padding: "12px 28px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
            >
              View Schedule A Summary →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
