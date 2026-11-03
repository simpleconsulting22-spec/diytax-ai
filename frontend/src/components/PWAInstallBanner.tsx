import React from "react";
import { usePWAInstall } from "../hooks/usePWAInstall";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function PWAInstallBanner() {
  const { canInstall, promptInstall, dismiss } = usePWAInstall();

  if (!canInstall) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: "90px",
      left: "50%",
      transform: "translateX(-50%)",
      width: "calc(100% - 32px)",
      maxWidth: "480px",
      backgroundColor: "#111827",
      borderRadius: "14px",
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
      zIndex: 800,
      fontFamily: font,
    }}>
      <div style={{
        width: "36px", height: "36px", borderRadius: "8px",
        backgroundColor: "#16A34A", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "18px", fontWeight: 800, color: "#fff",
      }}>
        D
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#fff" }}>
          Add DIYTax AI to Home Screen
        </div>
        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "1px" }}>
          One tap to open — track taxes on the go
        </div>
      </div>

      <button
        onClick={promptInstall}
        style={{
          padding: "7px 14px", backgroundColor: "#16A34A", color: "#fff",
          border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
          cursor: "pointer", fontFamily: font, whiteSpace: "nowrap", flexShrink: 0,
        }}
      >
        Install
      </button>

      <button
        onClick={dismiss}
        style={{
          background: "none", border: "none", color: "#6b7280",
          cursor: "pointer", fontSize: "18px", lineHeight: 1,
          padding: "2px 0 2px 4px", flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
