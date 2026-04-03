import React from "react";

export const TAX_CATEGORIES = [
  "Income",
  "Advertising",
  "Meals & Entertainment",
  "Travel",
  "Office Supplies",
  "Software & Subscriptions",
  "Home Office",
  "Vehicle & Mileage",
  "Professional Services",
  "Equipment",
  "Charitable Contribution",
  "Other",
];

interface CategoryDropdownProps {
  value: string | null;
  disabled?: boolean;
  onChange: (category: string) => void;
}

export default function CategoryDropdown({ value, disabled, onChange }: CategoryDropdownProps) {
  return (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
      style={{
        width: "100%",
        padding: "6px 8px",
        border: "1px solid #d1d5db",
        borderRadius: "6px",
        fontSize: "13px",
        color: value ? "#111827" : "#9ca3af",
        backgroundColor: disabled ? "#f9fafb" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        outline: "none",
        minWidth: "160px",
      }}
    >
      <option value="" disabled>
        Select category…
      </option>
      {TAX_CATEGORIES.map((cat) => (
        <option key={cat} value={cat}>
          {cat}
        </option>
      ))}
    </select>
  );
}
