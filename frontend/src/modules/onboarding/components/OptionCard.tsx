import React from "react";

interface OptionCardProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export default function OptionCard({ label, selected, onClick }: OptionCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        border: `2px solid ${selected ? "#16A34A" : "#e5e7eb"}`,
        borderRadius: "12px",
        padding: "16px 20px",
        cursor: "pointer",
        marginBottom: "10px",
        backgroundColor: selected ? "#DCFCE7" : "#fff",
        transition: "border-color 0.15s, background-color 0.15s",
        fontWeight: selected ? 600 : 500,
        fontSize: "15px",
        color: selected ? "#166534" : "#374151",
      }}
    >
      {label}
    </div>
  );
}
