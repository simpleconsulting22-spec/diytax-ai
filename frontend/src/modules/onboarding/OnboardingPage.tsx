import React from "react";
import ProgressBar from "./components/ProgressBar";
import OptionCard from "./components/OptionCard";
import {
  useOnboarding,
  IncomeSource,
  ExpenseType,
  DataSourcePreference,
  FilingStatus,
} from "./hooks/useOnboarding";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#f9fafb",
  fontFamily: font,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "40px 20px",
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "16px",
  padding: "48px",
  width: "100%",
  maxWidth: "500px",
  boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
};

const titleStyle: React.CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "#111827",
  marginBottom: "8px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "15px",
  color: "#6b7280",
  marginBottom: "28px",
};

const btnPrimary: React.CSSProperties = {
  width: "100%",
  padding: "14px",
  backgroundColor: "#16A34A",
  color: "#fff",
  border: "none",
  borderRadius: "10px",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "24px",
};

const btnSecondary: React.CSSProperties = {
  width: "100%",
  padding: "14px",
  backgroundColor: "#f3f4f6",
  color: "#374151",
  border: "none",
  borderRadius: "10px",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
  marginTop: "10px",
};

const errorStyle: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "14px",
  marginTop: "12px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d1d5db",
  borderRadius: "8px",
  padding: "12px 14px",
  fontSize: "15px",
  fontFamily: font,
  color: "#111827",
  outline: "none",
  boxSizing: "border-box",
  marginTop: "8px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "15px",
  fontWeight: 600,
  color: "#111827",
  display: "block",
  marginBottom: "4px",
};

const INCOME_OPTIONS: { value: IncomeSource; label: string }[] = [
  { value: "job", label: "I have a job" },
  { value: "business", label: "I run a business or side hustle" },
  { value: "rental", label: "I rent out property" },
  { value: "investments", label: "I have investments" },
  { value: "social_security", label: "I receive Social Security" },
];

const EXPENSE_OPTIONS: { value: ExpenseType; label: string }[] = [
  { value: "travel", label: "Travel" },
  { value: "meals", label: "Meals" },
  { value: "supplies", label: "Supplies" },
  { value: "software", label: "Software" },
  { value: "professional_services", label: "Professional services" },
];

const DATA_SOURCE_OPTIONS: { value: DataSourcePreference; label: string; sublabel?: string }[] = [
  { value: "csv", label: "Upload a file (CSV)" },
  { value: "bank_future", label: "Connect bank", sublabel: "Coming soon" },
  { value: "manual", label: "Enter manually" },
];

const FILING_STATUS_OPTIONS: { value: FilingStatus; label: string; sublabel?: string }[] = [
  { value: "single", label: "Single" },
  { value: "married_jointly", label: "Married Filing Jointly", sublabel: "Both spouses on one return" },
  { value: "married_separately", label: "Married Filing Separately", sublabel: "Each spouse files their own return" },
  { value: "head_of_household", label: "Head of Household" },
];

export default function OnboardingPage() {
  const {
    state,
    setOwnerName,
    setFilingStatus,
    setSpouseName,
    toggleIncomeSource,
    toggleExpenseType,
    updateBusinessName,
    addBusinessName,
    removeBusinessName,
    updateRentalName,
    addRentalName,
    removeRentalName,
    setDataSourcePreference,
    setConsented,
    goNext,
    goBack,
    handleSubmit,
    needsEntityStep,
    isEditing,
    loadingProfile,
  } = useOnboarding();

  const {
    step,
    ownerName,
    filingStatus,
    spouseName,
    incomeSources,
    businessNames,
    rentalNames,
    expenseTypes,
    dataSourcePreference,
    consented,
    saving,
    error,
  } = state;

  if (loadingProfile) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: font }}>
        Loading...
      </div>
    );
  }

  // Steps: 1=welcome, 2=owner info, 3=income sources, 4=entities(conditional), 5=expenses, 6=data source
  // When entity step is skipped, visual progress still advances correctly
  const visualStep = step === 5 && !needsEntityStep ? 5 : step === 6 && !needsEntityStep ? 6 : step;

  // ── Screen 1: Welcome + consent ───────────────────────────────────────────────
  if (step === 1) {
    return (
      <div style={pageStyle}>
        <ProgressBar step={1} totalSteps={6} />
        <div style={cardStyle}>
          <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "16px" }}>👍</div>
          <div style={{ ...titleStyle, textAlign: "center" }}>Let's get to know you</div>
          <div style={{ ...subtitleStyle, textAlign: "center" }}>
            It only takes a couple of minutes to set up your tax profile.
          </div>

          <div
            style={{
              backgroundColor: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "16px",
              marginBottom: "4px",
            }}
          >
            <label style={{ display: "flex", alignItems: "flex-start", gap: "12px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
                style={{ marginTop: "3px", width: "16px", height: "16px", flexShrink: 0, cursor: "pointer", accentColor: "#16A34A" }}
              />
              <span style={{ fontSize: "13px", color: "#374151", lineHeight: 1.6 }}>
                I have read and agree to the{" "}
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#16A34A", fontWeight: 600, textDecoration: "none" }}>
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" style={{ color: "#16A34A", fontWeight: 600, textDecoration: "none" }}>
                  Terms of Service
                </a>
                . I consent to the collection and processing of my financial data to provide tax
                organization services.
              </span>
            </label>
          </div>
          <div style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "8px", paddingLeft: "4px" }}>
            You can withdraw consent at any time by deleting your account.
          </div>

          <button
            style={{ ...btnPrimary, marginTop: "8px", opacity: consented ? 1 : 0.4 }}
            disabled={!consented}
            onClick={goNext}
          >
            Let's start
          </button>
        </div>
      </div>
    );
  }

  // ── Screen 2: Owner info ──────────────────────────────────────────────────────
  if (step === 2) {
    const isMarried = filingStatus === "married_jointly" || filingStatus === "married_separately";
    const canContinue =
      ownerName.trim().length > 0 &&
      filingStatus !== null &&
      (!isMarried || spouseName.trim().length > 0);

    return (
      <div style={pageStyle}>
        <ProgressBar step={2} totalSteps={6} />
        <div style={cardStyle}>
          <div style={titleStyle}>About your tax return</div>
          <div style={subtitleStyle}>This helps us correctly label your tax documents</div>

          {/* Owner name */}
          <div style={{ marginBottom: "24px" }}>
            <label style={labelStyle}>Your full legal name</label>
            <input
              style={inputStyle}
              type="text"
              placeholder="e.g. Jane Smith"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </div>

          {/* Filing status */}
          <div style={{ marginBottom: isMarried ? "24px" : "0" }}>
            <div style={labelStyle}>Filing status</div>
            {FILING_STATUS_OPTIONS.map(({ value, label, sublabel }) => (
              <div
                key={value}
                onClick={() => setFilingStatus(value)}
                style={{
                  border: `2px solid ${filingStatus === value ? "#16A34A" : "#e5e7eb"}`,
                  borderRadius: "10px",
                  padding: "12px 16px",
                  cursor: "pointer",
                  marginTop: "8px",
                  backgroundColor: filingStatus === value ? "#DCFCE7" : "#fff",
                  transition: "border-color 0.15s, background-color 0.15s",
                }}
              >
                <span style={{ fontWeight: filingStatus === value ? 600 : 500, fontSize: "14px", color: filingStatus === value ? "#166534" : "#374151" }}>
                  {label}
                </span>
                {sublabel && (
                  <span style={{ marginLeft: "8px", fontSize: "12px", color: "#9ca3af" }}>
                    {sublabel}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Spouse name — shown only when married */}
          {isMarried && (
            <div style={{ marginTop: "24px" }}>
              <label style={labelStyle}>Spouse's full legal name</label>
              <input
                style={inputStyle}
                type="text"
                placeholder="e.g. John Smith"
                value={spouseName}
                onChange={(e) => setSpouseName(e.target.value)}
              />
            </div>
          )}

          <button
            style={{ ...btnPrimary, opacity: canContinue ? 1 : 0.5 }}
            disabled={!canContinue}
            onClick={goNext}
          >
            Next
          </button>
          <button style={btnSecondary} onClick={goBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // ── Screen 3: Income sources ──────────────────────────────────────────────────
  if (step === 3) {
    return (
      <div style={pageStyle}>
        <ProgressBar step={3} totalSteps={6} />
        <div style={cardStyle}>
          <div style={titleStyle}>How do you make money?</div>
          <div style={subtitleStyle}>Select all that apply</div>

          {INCOME_OPTIONS.map(({ value, label }) => (
            <OptionCard
              key={value}
              label={label}
              selected={incomeSources.includes(value)}
              onClick={() => toggleIncomeSource(value)}
            />
          ))}

          <button
            style={{ ...btnPrimary, opacity: incomeSources.length > 0 ? 1 : 0.5 }}
            disabled={incomeSources.length === 0}
            onClick={goNext}
          >
            Next
          </button>
          <button style={btnSecondary} onClick={goBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // ── Screen 4: Entity names (conditional — business and/or rental) ─────────────
  if (step === 4) {
    const hasBusinessSelected = incomeSources.includes("business");
    const hasRentalSelected = incomeSources.includes("rental");

    const validBusinessNames = businessNames.filter((n) => n.trim().length > 0);
    const validRentalNames = rentalNames.filter((n) => n.trim().length > 0);
    const canContinue =
      (!hasBusinessSelected || validBusinessNames.length > 0) &&
      (!hasRentalSelected || validRentalNames.length > 0);

    const addBtnStyle: React.CSSProperties = {
      background: "none",
      border: "1px dashed #16A34A",
      borderRadius: "8px",
      color: "#16A34A",
      fontSize: "13px",
      fontWeight: 600,
      cursor: "pointer",
      padding: "8px 14px",
      marginTop: "8px",
      fontFamily: font,
      width: "100%",
    };

    const removeBtnStyle: React.CSSProperties = {
      background: "none",
      border: "none",
      color: "#9ca3af",
      cursor: "pointer",
      fontSize: "18px",
      lineHeight: 1,
      padding: "0 0 0 8px",
      flexShrink: 0,
    };

    return (
      <div style={pageStyle}>
        <ProgressBar step={4} totalSteps={6} />
        <div style={cardStyle}>
          <div style={titleStyle}>Tell us more</div>
          <div style={subtitleStyle}>We'll use this to set up your tax schedules</div>

          {hasBusinessSelected && (
            <div style={{ marginBottom: "28px" }}>
              <div style={labelStyle}>Business name(s) — Schedule C</div>
              <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                Add one entry per business or side hustle
              </div>
              {businessNames.map((name, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
                  <input
                    style={{ ...inputStyle, marginTop: 0 }}
                    type="text"
                    placeholder="e.g. Acme Consulting LLC"
                    value={name}
                    onChange={(e) => updateBusinessName(i, e.target.value)}
                  />
                  {businessNames.length > 1 && (
                    <button style={removeBtnStyle} onClick={() => removeBusinessName(i)} title="Remove">×</button>
                  )}
                </div>
              ))}
              <button style={addBtnStyle} onClick={addBusinessName}>+ Add another business</button>
            </div>
          )}

          {hasRentalSelected && (
            <div style={{ marginBottom: "8px" }}>
              <div style={labelStyle}>Rental property address(es) — Schedule E</div>
              <div style={{ fontSize: "13px", color: "#6b7280", marginBottom: "8px" }}>
                Add one entry per property
              </div>
              {rentalNames.map((name, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: "8px" }}>
                  <input
                    style={{ ...inputStyle, marginTop: 0 }}
                    type="text"
                    placeholder="e.g. 123 Oak St, Unit 2"
                    value={name}
                    onChange={(e) => updateRentalName(i, e.target.value)}
                  />
                  {rentalNames.length > 1 && (
                    <button style={removeBtnStyle} onClick={() => removeRentalName(i)} title="Remove">×</button>
                  )}
                </div>
              ))}
              <button style={addBtnStyle} onClick={addRentalName}>+ Add another property</button>
            </div>
          )}

          <button
            style={{ ...btnPrimary, opacity: canContinue ? 1 : 0.5 }}
            disabled={!canContinue}
            onClick={goNext}
          >
            Next
          </button>
          <button style={btnSecondary} onClick={goBack}>Back</button>
        </div>
      </div>
    );
  }

  // ── Screen 5: Expense types ───────────────────────────────────────────────────
  if (step === 5) {
    return (
      <div style={pageStyle}>
        <ProgressBar step={visualStep} totalSteps={6} />
        <div style={cardStyle}>
          <div style={titleStyle}>What kinds of things do you usually spend money on?</div>
          <div style={subtitleStyle}>Select all that apply</div>

          {EXPENSE_OPTIONS.map(({ value, label }) => (
            <OptionCard
              key={value}
              label={label}
              selected={expenseTypes.includes(value)}
              onClick={() => toggleExpenseType(value)}
            />
          ))}

          <button
            style={{ ...btnPrimary, opacity: expenseTypes.length > 0 ? 1 : 0.5 }}
            disabled={expenseTypes.length === 0}
            onClick={goNext}
          >
            Next
          </button>
          <button style={btnSecondary} onClick={goBack}>Back</button>
        </div>
      </div>
    );
  }

  // ── Screen 6: Data source preference ─────────────────────────────────────────
  return (
    <div style={pageStyle}>
      <ProgressBar step={6} totalSteps={6} />
      <div style={cardStyle}>
        <div style={titleStyle}>How would you like to bring in your data?</div>
        <div style={subtitleStyle}>You can change this later</div>

        {DATA_SOURCE_OPTIONS.map(({ value, label, sublabel }) => (
          <div
            key={value}
            onClick={() => setDataSourcePreference(value)}
            style={{
              border: `2px solid ${dataSourcePreference === value ? "#16A34A" : "#e5e7eb"}`,
              borderRadius: "12px",
              padding: "16px 20px",
              cursor: "pointer",
              marginBottom: "10px",
              backgroundColor: dataSourcePreference === value ? "#DCFCE7" : "#fff",
              transition: "border-color 0.15s, background-color 0.15s",
            }}
          >
            <span style={{ fontWeight: dataSourcePreference === value ? 600 : 500, fontSize: "15px", color: dataSourcePreference === value ? "#166534" : "#374151" }}>
              {label}
            </span>
            {sublabel && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "#9ca3af", fontStyle: "italic" }}>
                {sublabel}
              </span>
            )}
          </div>
        ))}

        <button
          style={{ ...btnPrimary, opacity: dataSourcePreference && !saving ? 1 : 0.5 }}
          disabled={!dataSourcePreference || saving}
          onClick={handleSubmit}
        >
          {saving ? "Saving..." : isEditing ? "Save Changes" : "Finish Setup"}
        </button>
        <button style={btnSecondary} disabled={saving} onClick={goBack}>Back</button>

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
