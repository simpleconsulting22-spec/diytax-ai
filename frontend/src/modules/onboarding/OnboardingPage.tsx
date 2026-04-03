import React from "react";
import ProgressBar from "./components/ProgressBar";
import OptionCard from "./components/OptionCard";
import {
  useOnboarding,
  IncomeSource,
  ExpenseType,
  DataSourcePreference,
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

export default function OnboardingPage() {
  const {
    state,
    toggleIncomeSource,
    toggleExpenseType,
    setBusinessName,
    setRentalName,
    setDataSourcePreference,
    goNext,
    goBack,
    handleSubmit,
    needsStep3,
  } = useOnboarding();

  const { step, incomeSources, businessName, rentalName, expenseTypes, dataSourcePreference, saving, error } = state;

  // Progress segment: map logical step to visual progress
  // Steps: 1=welcome, 2=income, 3=entities(conditional), 4=expenses, 5=data source
  // Visual progress always reflects the 5-segment bar; skipped step 3 shows as completed
  const visualStep = step === 4 && !needsStep3 ? 4 : step === 5 && !needsStep3 ? 5 : step;

  // Screen 1: Welcome
  if (step === 1) {
    return (
      <div style={pageStyle}>
        <ProgressBar step={1} />
        <div style={cardStyle}>
          <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "16px" }}>👍</div>
          <div style={{ ...titleStyle, textAlign: "center" }}>
            Let's get to know you
          </div>
          <div style={{ ...subtitleStyle, textAlign: "center" }}>
            It only takes a couple of minutes to set up your tax profile.
          </div>
          <button style={{ ...btnPrimary, marginTop: "8px" }} onClick={goNext}>
            Let's start
          </button>
        </div>
      </div>
    );
  }

  // Screen 2: Income sources
  if (step === 2) {
    return (
      <div style={pageStyle}>
        <ProgressBar step={2} />
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

  // Screen 3: Conditional entity info (business name and/or rental name)
  if (step === 3) {
    const hasBusinessSelected = incomeSources.includes("business");
    const hasRentalSelected = incomeSources.includes("rental");

    const canContinue =
      (!hasBusinessSelected || businessName.trim().length > 0) &&
      (!hasRentalSelected || rentalName.trim().length > 0);

    return (
      <div style={pageStyle}>
        <ProgressBar step={3} />
        <div style={cardStyle}>
          <div style={titleStyle}>Tell us more</div>
          <div style={subtitleStyle}>We'll use this to set up your tax schedules</div>

          {hasBusinessSelected && (
            <div style={{ marginBottom: "24px" }}>
              <label
                style={{ fontSize: "15px", fontWeight: 600, color: "#111827", display: "block" }}
              >
                What's the name of your business?
              </label>
              <input
                style={inputStyle}
                type="text"
                placeholder="e.g. Acme Consulting LLC"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            </div>
          )}

          {hasRentalSelected && (
            <div style={{ marginBottom: "8px" }}>
              <label
                style={{ fontSize: "15px", fontWeight: 600, color: "#111827", display: "block" }}
              >
                Do you have rental property?
              </label>
              <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
                Enter the name or address of your rental property
              </div>
              <input
                style={inputStyle}
                type="text"
                placeholder="e.g. 123 Oak St, Unit 2"
                value={rentalName}
                onChange={(e) => setRentalName(e.target.value)}
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

  // Screen 4: Expense types
  if (step === 4) {
    return (
      <div style={pageStyle}>
        <ProgressBar step={visualStep} />
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
          <button style={btnSecondary} onClick={goBack}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // Screen 5: Data source preference
  return (
    <div style={pageStyle}>
      <ProgressBar step={5} />
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
            <span
              style={{
                fontWeight: dataSourcePreference === value ? 600 : 500,
                fontSize: "15px",
                color: dataSourcePreference === value ? "#166534" : "#374151",
              }}
            >
              {label}
            </span>
            {sublabel && (
              <span
                style={{
                  marginLeft: "8px",
                  fontSize: "12px",
                  color: "#9ca3af",
                  fontStyle: "italic",
                }}
              >
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
          {saving ? "Saving..." : "Finish Setup"}
        </button>
        <button style={btnSecondary} disabled={saving} onClick={goBack}>
          Back
        </button>

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
