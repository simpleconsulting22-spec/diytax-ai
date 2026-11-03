import React from "react";

interface OptionCardProps {
  label: string;
  sublabel?: string;
  selected: boolean;
  onClick: () => void;
}

export default function OptionCard({ label, sublabel, selected, onClick }: OptionCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        border: `2px solid ${selected ? "#16A34A" : "#e5e7eb"}`,
        borderRadius: "12px",
        padding: "14px 18px",
        cursor: "pointer",
        marginBottom: "10px",
        backgroundColor: selected ? "#DCFCE7" : "#fff",
        transition: "border-color 0.15s, background-color 0.15s",
      }}
    >
      <div style={{
        fontWeight: selected ? 700 : 600,
        fontSize: "15px",
        color: selected ? "#166534" : "#111827",
        lineHeight: 1.3,
      }}>
        {label}
      </div>
      {sublabel && (
        <div style={{
          fontSize: "13px",
          color: selected ? "#15803d" : "#6b7280",
          marginTop: "3px",
          lineHeight: 1.4,
        }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}
