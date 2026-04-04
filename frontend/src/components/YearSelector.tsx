import React from "react";
import { useTaxYear } from "../contexts/TaxYearContext";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface YearSelectorProps {
  /** Visual variant — "nav" for use inside a nav bar, "inline" for page headers */
  variant?: "nav" | "inline";
}

export default function YearSelector({ variant = "nav" }: YearSelectorProps) {
  const { selectedYear, setSelectedYear, availableYears, isCurrentYear } =
    useTaxYear();
  const currentYear = new Date().getFullYear();

  const isInline = variant === "inline";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: isInline ? "10px" : "8px",
        padding: isInline ? "0" : "0 4px",
      }}
    >
      <span
        style={{
          fontSize: isInline ? "14px" : "12px",
          fontWeight: 600,
          color: "#6b7280",
          fontFamily: font,
          whiteSpace: "nowrap",
        }}
      >
        Tax Year
      </span>

      <select
        value={selectedYear}
        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
        style={{
          padding: isInline ? "8px 14px" : "5px 10px",
          borderRadius: "8px",
          border: isCurrentYear ? "1.5px solid #bbf7d0" : "1.5px solid #d1d5db",
          fontSize: isInline ? "15px" : "13px",
          fontWeight: 700,
          color: "#111827",
          backgroundColor: isCurrentYear ? "#f0fdf4" : "#fff",
          cursor: "pointer",
          fontFamily: font,
          outline: "none",
        }}
      >
        {availableYears.map((year) => (
          <option key={year} value={year}>
            {year}
            {year === currentYear ? " (current)" : ""}
          </option>
        ))}
      </select>

      {/* "Prior year" badge when not viewing current year */}
      {!isCurrentYear && (
        <span
          style={{
            fontSize: "11px",
            padding: "2px 8px",
            backgroundColor: "#fef3c7",
            color: "#92400e",
            borderRadius: "999px",
            fontWeight: 700,
            fontFamily: font,
            whiteSpace: "nowrap",
          }}
        >
          Prior year
        </span>
      )}
    </div>
  );
}
