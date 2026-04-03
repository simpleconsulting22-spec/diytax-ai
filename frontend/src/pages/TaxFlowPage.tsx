import React, { useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

interface Answers {
  hasW2: boolean | null;
  hasSelfEmployment: boolean | null;
  estimatedIncome: string;
  businessExpenses: Record<string, string>;
  homeOffice: boolean | null;
  homeOfficeSqft: string;
  businessMiles: boolean | null;
  businessMilesCount: string;
  otherDeductions: string;
}

const EXPENSE_CATEGORIES = [
  "Advertising",
  "Meals & Entertainment",
  "Travel",
  "Office Supplies",
  "Software & Subscriptions",
  "Equipment",
  "Professional Services",
];

const STEPS = [
  "Income Sources",
  "Business Expenses",
  "Deductions",
  "Review",
];

export default function TaxFlowPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Answers>({
    hasW2: null,
    hasSelfEmployment: null,
    estimatedIncome: "",
    businessExpenses: {},
    homeOffice: null,
    homeOfficeSqft: "",
    businessMiles: null,
    businessMilesCount: "",
    otherDeductions: "",
  });

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: font,
  };

  const navStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderBottom: "1px solid #e5e7eb",
    padding: "0 32px",
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const layoutStyle: React.CSSProperties = {
    display: "flex",
    maxWidth: "960px",
    margin: "0 auto",
    padding: "40px 24px",
    gap: "32px",
  };

  const sidebarStyle: React.CSSProperties = {
    width: "220px",
    flexShrink: 0,
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: "16px",
    padding: "40px",
    boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
  };

  const stepItemStyle = (i: number): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px 16px",
    borderRadius: "10px",
    marginBottom: "4px",
    backgroundColor: i === step ? "#DCFCE7" : "transparent",
    cursor: "default",
  });

  const stepNumStyle = (i: number): React.CSSProperties => ({
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 700,
    backgroundColor: i < step ? "#16A34A" : i === step ? "#16A34A" : "#e5e7eb",
    color: i <= step ? "#fff" : "#9ca3af",
    flexShrink: 0,
  });

  const titleStyle: React.CSSProperties = {
    fontSize: "24px",
    fontWeight: 700,
    color: "#111827",
    marginBottom: "24px",
  };

  const yesNoGroup = (value: boolean | null, onChange: (v: boolean) => void) => (
    <div style={{ display: "flex", gap: "10px" }}>
      {[true, false].map((v) => (
        <button
          key={String(v)}
          onClick={() => onChange(v)}
          style={{
            padding: "10px 24px",
            border: `2px solid ${value === v ? "#16A34A" : "#e5e7eb"}`,
            borderRadius: "8px",
            backgroundColor: value === v ? "#DCFCE7" : "#fff",
            color: value === v ? "#16A34A" : "#374151",
            fontWeight: 600,
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );

  const btnPrimary: React.CSSProperties = {
    padding: "12px 32px",
    backgroundColor: "#16A34A",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "32px",
  };

  const btnSecondary: React.CSSProperties = {
    padding: "12px 32px",
    backgroundColor: "#f3f4f6",
    color: "#374151",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "32px",
    marginLeft: "10px",
  };

  const fieldLabel: React.CSSProperties = {
    display: "block",
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
    marginBottom: "8px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    fontSize: "14px",
    color: "#111827",
    outline: "none",
    boxSizing: "border-box",
  };

  const sectionGap: React.CSSProperties = { marginBottom: "24px" };

  async function handleSubmit() {
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      const sessionId = `${user.uid}_2025`;
      await setDoc(doc(db, "taxSessions", sessionId), {
        sessionId,
        uid: user.uid,
        taxYear: 2025,
        status: "completed",
        answers,
        createdAt: serverTimestamp(),
      });
      navigate("/summary");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save session.");
    } finally {
      setSaving(false);
    }
  }

  const effectiveSteps = answers.hasSelfEmployment ? STEPS : STEPS.filter((_, i) => i !== 1);
  const visibleSteps = answers.hasSelfEmployment !== null
    ? (answers.hasSelfEmployment ? STEPS : [STEPS[0], STEPS[2], STEPS[3]])
    : STEPS;

  // Map display step index to logical step
  function getLogicalStep(displayStep: number): number {
    if (answers.hasSelfEmployment === false) {
      if (displayStep === 0) return 0;
      if (displayStep === 1) return 2;
      if (displayStep === 2) return 3;
    }
    return displayStep;
  }

  const logicalStep = getLogicalStep(step);
  const totalSteps = answers.hasSelfEmployment === false ? 3 : 4;

  function renderStepContent() {
    // Step 0: Income Sources
    if (logicalStep === 0) {
      return (
        <>
          <div style={titleStyle}>Income Sources</div>

          <div style={sectionGap}>
            <label style={fieldLabel}>Did you receive any W-2 income?</label>
            {yesNoGroup(answers.hasW2, (v) => setAnswers((a) => ({ ...a, hasW2: v })))}
          </div>

          <div style={sectionGap}>
            <label style={fieldLabel}>Did you have any self-employment income?</label>
            {yesNoGroup(answers.hasSelfEmployment, (v) => setAnswers((a) => ({ ...a, hasSelfEmployment: v })))}
          </div>

          <div style={sectionGap}>
            <label style={fieldLabel}>Estimated total income ($)</label>
            <input
              style={inputStyle}
              type="number"
              placeholder="0.00"
              value={answers.estimatedIncome}
              onChange={(e) => setAnswers((a) => ({ ...a, estimatedIncome: e.target.value }))}
            />
          </div>

          <button
            style={{ ...btnPrimary, opacity: answers.hasW2 !== null && answers.hasSelfEmployment !== null ? 1 : 0.5 }}
            disabled={answers.hasW2 === null || answers.hasSelfEmployment === null}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </button>
        </>
      );
    }

    // Step 1: Business Expenses (self-employed only)
    if (logicalStep === 1) {
      return (
        <>
          <div style={titleStyle}>Business Expenses</div>
          <p style={{ color: "#6b7280", marginBottom: "24px", fontSize: "14px" }}>
            Check the categories that apply and enter estimated amounts.
          </p>

          {EXPENSE_CATEGORIES.map((cat) => (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
              <input
                type="checkbox"
                id={cat}
                checked={cat in answers.businessExpenses}
                onChange={(e) => {
                  setAnswers((a) => {
                    const updated = { ...a.businessExpenses };
                    if (e.target.checked) updated[cat] = "";
                    else delete updated[cat];
                    return { ...a, businessExpenses: updated };
                  });
                }}
                style={{ width: "16px", height: "16px", cursor: "pointer" }}
              />
              <label htmlFor={cat} style={{ fontSize: "14px", fontWeight: 600, color: "#374151", flex: 1 }}>{cat}</label>
              {cat in answers.businessExpenses && (
                <input
                  type="number"
                  placeholder="Amount ($)"
                  value={answers.businessExpenses[cat]}
                  onChange={(e) =>
                    setAnswers((a) => ({
                      ...a,
                      businessExpenses: { ...a.businessExpenses, [cat]: e.target.value },
                    }))
                  }
                  style={{ ...inputStyle, width: "140px" }}
                />
              )}
            </div>
          ))}

          <div style={{ display: "flex" }}>
            <button style={btnPrimary} onClick={() => setStep((s) => s + 1)}>Next</button>
            <button style={btnSecondary} onClick={() => setStep((s) => s - 1)}>Back</button>
          </div>
        </>
      );
    }

    // Step 2: Deductions
    if (logicalStep === 2) {
      return (
        <>
          <div style={titleStyle}>Deductions</div>

          <div style={sectionGap}>
            <label style={fieldLabel}>Do you have a home office?</label>
            {yesNoGroup(answers.homeOffice, (v) => setAnswers((a) => ({ ...a, homeOffice: v })))}
            {answers.homeOffice && (
              <div style={{ marginTop: "12px" }}>
                <label style={fieldLabel}>Office square footage</label>
                <input
                  style={{ ...inputStyle, maxWidth: "200px" }}
                  type="number"
                  placeholder="e.g. 150"
                  value={answers.homeOfficeSqft}
                  onChange={(e) => setAnswers((a) => ({ ...a, homeOfficeSqft: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div style={sectionGap}>
            <label style={fieldLabel}>Did you drive for business purposes?</label>
            {yesNoGroup(answers.businessMiles, (v) => setAnswers((a) => ({ ...a, businessMiles: v })))}
            {answers.businessMiles && (
              <div style={{ marginTop: "12px" }}>
                <label style={fieldLabel}>Business miles driven</label>
                <input
                  style={{ ...inputStyle, maxWidth: "200px" }}
                  type="number"
                  placeholder="e.g. 5000"
                  value={answers.businessMilesCount}
                  onChange={(e) => setAnswers((a) => ({ ...a, businessMilesCount: e.target.value }))}
                />
              </div>
            )}
          </div>

          <div style={sectionGap}>
            <label style={fieldLabel}>Any other deductions?</label>
            <textarea
              style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
              placeholder="Describe any other deductions..."
              value={answers.otherDeductions}
              onChange={(e) => setAnswers((a) => ({ ...a, otherDeductions: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex" }}>
            <button style={btnPrimary} onClick={() => setStep((s) => s + 1)}>Next</button>
            <button style={btnSecondary} onClick={() => setStep((s) => s - 1)}>Back</button>
          </div>
        </>
      );
    }

    // Step 3: Review
    return (
      <>
        <div style={titleStyle}>Review Your Information</div>

        <div style={{ backgroundColor: "#f9fafb", borderRadius: "10px", padding: "20px", marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#9ca3af", marginBottom: "12px" }}>INCOME</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ fontSize: "14px", color: "#374151" }}>W-2 Income</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{answers.hasW2 ? "Yes" : "No"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ fontSize: "14px", color: "#374151" }}>Self-Employment</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{answers.hasSelfEmployment ? "Yes" : "No"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: "14px", color: "#374151" }}>Estimated Income</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
              {answers.estimatedIncome ? `$${parseFloat(answers.estimatedIncome).toLocaleString()}` : "Not provided"}
            </span>
          </div>
        </div>

        {answers.hasSelfEmployment && Object.keys(answers.businessExpenses).length > 0 && (
          <div style={{ backgroundColor: "#f9fafb", borderRadius: "10px", padding: "20px", marginBottom: "16px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#9ca3af", marginBottom: "12px" }}>BUSINESS EXPENSES</div>
            {Object.entries(answers.businessExpenses).map(([cat, amt]) => (
              <div key={cat} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "14px", color: "#374151" }}>{cat}</span>
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>{amt ? `$${parseFloat(amt).toLocaleString()}` : "—"}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ backgroundColor: "#f9fafb", borderRadius: "10px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#9ca3af", marginBottom: "12px" }}>DEDUCTIONS</div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ fontSize: "14px", color: "#374151" }}>Home Office</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
              {answers.homeOffice ? `Yes (${answers.homeOfficeSqft || "??"} sq ft)` : "No"}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ fontSize: "14px", color: "#374151" }}>Business Miles</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#111827" }}>
              {answers.businessMiles ? `${answers.businessMilesCount || "??"} miles` : "No"}
            </span>
          </div>
          {answers.otherDeductions && (
            <div>
              <span style={{ fontSize: "14px", color: "#374151" }}>Other: </span>
              <span style={{ fontSize: "14px", color: "#111827" }}>{answers.otherDeductions}</span>
            </div>
          )}
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: "14px", marginBottom: "12px" }}>{error}</div>}

        <div style={{ display: "flex" }}>
          <button
            style={{ ...btnPrimary, marginTop: "0", opacity: saving ? 0.7 : 1 }}
            disabled={saving}
            onClick={handleSubmit}
          >
            {saving ? "Saving..." : "Submit"}
          </button>
          <button style={{ ...btnSecondary, marginTop: "0" }} onClick={() => setStep((s) => s - 1)}>Back</button>
        </div>
      </>
    );
  }

  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A" }}>DIYTax AI</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            style={{ padding: "8px 16px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            onClick={() => signOut(auth).then(() => navigate("/login"))}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={layoutStyle}>
        <div style={sidebarStyle}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#9ca3af", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Progress
          </div>
          {visibleSteps.map((s, i) => (
            <div key={s} style={stepItemStyle(i)}>
              <div style={stepNumStyle(i)}>
                {i < step ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: "14px", fontWeight: i === step ? 600 : 400, color: i === step ? "#16A34A" : "#6b7280" }}>
                {s}
              </span>
            </div>
          ))}
          <div style={{ marginTop: "16px", fontSize: "12px", color: "#9ca3af" }}>
            Step {step + 1} of {totalSteps}
          </div>
        </div>

        <div style={contentStyle}>
          {renderStepContent()}
        </div>
      </div>
    </div>
  );
}
