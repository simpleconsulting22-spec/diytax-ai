import React from "react";

// Categories live in the canonical tax map (single source of truth). This file
// just renders the dropdown and re-exports the names other modules already
// import from here, so existing imports keep working.
export { CATEGORY_GROUPS, TAX_CATEGORIES } from "../../../shared/taxMap";
import { CATEGORY_GROUPS } from "../../../shared/taxMap";

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
      {CATEGORY_GROUPS.map((group) => (
        <optgroup key={group.group} label={group.group}>
          {group.categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
