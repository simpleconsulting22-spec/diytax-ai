import React, { useState } from "react";
import { apiClient } from "../services/apiClient";
import { useAuth } from "../contexts/AuthContext";

interface MfaModalProps {
  onVerified: () => void;
}

export default function MfaModal({ onVerified }: MfaModalProps) {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  async function handleSendCode() {
    if (!user?.email) return;
    setSending(true);
    setError("");
    try {
      await apiClient.call("sendMfaCode", { email: user.email });
      setCodeSent(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send code.");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    if (!code.trim()) return;
    setVerifying(true);
    setError("");
    try {
      await apiClient.call("verifyMfaCode", { code: code.trim() });
      onVerified();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid or expired code.");
    } finally {
      setVerifying(false);
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderRadius: "12px",
    padding: "40px",
    width: "100%",
    maxWidth: "400px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "22px",
    fontWeight: 700,
    color: "#111827",
    marginBottom: "8px",
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: "14px",
    color: "#6b7280",
    marginBottom: "28px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    fontSize: "18px",
    letterSpacing: "6px",
    textAlign: "center",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: "16px",
  };

  const btnPrimary: React.CSSProperties = {
    width: "100%",
    padding: "12px",
    backgroundColor: "#16A34A",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: "10px",
  };

  const btnSecondary: React.CSSProperties = {
    width: "100%",
    padding: "12px",
    backgroundColor: "#f3f4f6",
    color: "#374151",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  };

  const errorStyle: React.CSSProperties = {
    color: "#dc2626",
    fontSize: "13px",
    marginTop: "8px",
    textAlign: "center",
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={titleStyle}>Two-Factor Authentication</div>
        <div style={subtitleStyle}>
          {codeSent
            ? `Enter the 6-digit code sent to ${user?.email}`
            : "Verify your identity to continue."}
        </div>

        {codeSent && (
          <input
            style={inputStyle}
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        )}

        {!codeSent ? (
          <button style={btnPrimary} onClick={handleSendCode} disabled={sending}>
            {sending ? "Sending..." : "Send Verification Code"}
          </button>
        ) : (
          <>
            <button style={btnPrimary} onClick={handleVerify} disabled={verifying || code.length < 6}>
              {verifying ? "Verifying..." : "Verify"}
            </button>
            <button style={btnSecondary} onClick={handleSendCode} disabled={sending}>
              {sending ? "Resending..." : "Resend Code"}
            </button>
          </>
        )}

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
