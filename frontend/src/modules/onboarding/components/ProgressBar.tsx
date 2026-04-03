import React from "react";

interface ProgressBarProps {
  step: number;
  totalSteps?: number;
}

export default function ProgressBar({ step, totalSteps = 5 }: ProgressBarProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        marginBottom: "40px",
        width: "100%",
        maxWidth: "500px",
      }}
    >
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
        <div
          key={s}
          style={{
            flex: 1,
            height: "6px",
            borderRadius: "3px",
            backgroundColor: s <= step ? "#16A34A" : "#e5e7eb",
            transition: "background-color 0.3s",
          }}
        />
      ))}
    </div>
  );
}
