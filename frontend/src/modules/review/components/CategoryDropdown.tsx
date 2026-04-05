import React from "react";

// Exhaustive list of tax-relevant categories, grouped for readability.
// The flat array is used in dropdowns; the grouped structure is exposed
// for any component that wants to render sections.
export const CATEGORY_GROUPS: Array<{ group: string; categories: string[] }> = [
  {
    group: "Income",
    categories: [
      "Business Income",
      "Rental Income",
      "Investment Income",
      "Interest Income",
      "Dividend Income",
      "Other Income",
    ],
  },
  {
    group: "Business Expenses (Sch. C)",
    categories: [
      "Advertising & Marketing",
      "Auto & Vehicle",
      "Bank Fees & Charges",
      "Business Insurance",
      "Business Meals",
      "Business Travel",
      "Computer & Software",
      "Contract Labor",
      "Education & Training",
      "Equipment & Machinery",
      "Home Office",
      "Legal & Professional",
      "Licenses & Permits",
      "Office Supplies",
      "Phone & Internet",
      "Postage & Shipping",
      "Printing & Publishing",
      "Rent & Lease",
      "Repairs & Maintenance",
      "Taxes & Licenses",
      "Utilities",
      "Wages & Salaries",
      "Other Business Expense",
    ],
  },
  {
    group: "Deductions (Sch. A)",
    categories: [
      "Charitable Contribution",
      "Medical Expense",
      "Dental Expense",
      "State & Local Taxes",
      "Mortgage Interest",
      "Investment Expense",
      "Casualty Loss",
    ],
  },
  {
    group: "Rental (Sch. E)",
    categories: [
      "Mortgage Interest (Rental)",
      "Property Management",
      "Property Taxes",
      "Rental Insurance",
      "Rental Repairs & Maintenance",
      "Rental Supplies",
      "Rental Utilities",
    ],
  },
  {
    group: "Personal",
    categories: [
      "Groceries",
      "Dining & Restaurants",
      "Entertainment",
      "Personal Care",
      "Clothing & Apparel",
      "Healthcare",
      "Personal Transportation",
      "Personal Subscriptions",
      "Other Personal",
    ],
  },
];

export const TAX_CATEGORIES: string[] = CATEGORY_GROUPS.flatMap((g) => g.categories);

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
