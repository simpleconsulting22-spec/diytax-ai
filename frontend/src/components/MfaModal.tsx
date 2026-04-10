import React, { useState } from "react";
import { apiClient } from "../services/apiClient";
import { useAuth } from "../contexts/AuthContext";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "****";
  const masked = local.length <= 2 ? "**" : `${local[0]}***`;
  return `${masked}@${domain}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  fontFamily: font,
};

const cardStyle: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: "14px",
  padding: "40px",
  width: "100%",
  maxWidth: "420px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
};

const titleStyle: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  color: "#111827",
  marginBottom: "6px",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "14px",
  color: "#6b7280",
  marginBottom: "28px",
  lineHeight: 1.5,
};

const codeInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "22px",
  letterSpacing: "8px",
  textAlign: "center",
  border: "1.5px solid #d1d5db",
  borderRadius: "8px",
  outline: "none",
  boxSizing: "border-box",
  marginBottom: "16px",
  fontFamily: font,
  color: "#111827",
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
  fontFamily: font,
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
  fontFamily: font,
};

// ─── Component ────────────────────────────────────────────────────────────────

interface MfaModalProps {
  onVerified: () => void;
}

type Step = "send" | "code";

export default function MfaModal({ onVerified }: MfaModalProps) {
  const { user } = useAuth();

  const email = user?.email ?? "";

  const [step, setStep] = useState<Step>("send");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  // ── Send code ──────────────────────────────────────────────────────────────

  async function handleSendCode() {
    setSending(true);
    setError("");
    try {
      await apiClient.call("sendMfaCode", {});
      setStep("code");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send code. Please try again.");
    } finally {
      setSending(false);
    }
  }

  // ── Verify code ────────────────────────────────────────────────────────────

  async function handleVerify() {
    if (code.length < 6) return;
    setVerifying(true);
    setError("");
    try {
      await apiClient.call("verifyMfaCode", { code: code.trim() });
      onVerified();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid or expired code.");
      setVerifying(false);
    }
  }

  // ── Resend ─────────────────────────────────────────────────────────────────

  async function handleResend() {
    setCode("");
    setError("");
    setSending(true);
    try {
      await apiClient.call("sendMfaCode", {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to resend code.");
    } finally {
      setSending(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={overlay}>
      <div style={cardStyle}>
        <div style={{ fontSize: "28px", marginBottom: "16px" }}>🔐</div>

        {step === "send" ? (
          <>
            <div style={titleStyle}>Two-Factor Authentication</div>
            <div style={subtitleStyle}>
              We'll send a 6-digit verification code to{" "}
              <strong>{email ? maskEmail(email) : "your email"}</strong>.
            </div>

            <button
              style={{
                ...btnPrimary,
                opacity: sending ? 0.65 : 1,
                cursor: sending ? "not-allowed" : "pointer",
              }}
              onClick={handleSendCode}
              disabled={sending}
              autoFocus
            >
              {sending ? "Sending code…" : "Send Verification Code"}
            </button>
          </>
        ) : (
          <>
            <div style={titleStyle}>Enter your code</div>
            <div style={subtitleStyle}>
              We emailed a 6-digit code to {email ? maskEmail(email) : "your email"}.{" "}
              <button
                onClick={() => { setStep("send"); setCode(""); setError(""); }}
                style={{ background: "none", border: "none", color: "#16A34A", fontSize: "14px", cursor: "pointer", padding: 0, fontFamily: font, textDecoration: "underline" }}
              >
                Resend
              </button>
            </div>

            <input
              style={codeInputStyle}
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && handleVerify()}
              autoFocus
            />

            <button
              style={{
                ...btnPrimary,
                opacity: verifying || code.length < 6 ? 0.65 : 1,
                cursor: verifying || code.length < 6 ? "not-allowed" : "pointer",
              }}
              onClick={handleVerify}
              disabled={verifying || code.length < 6}
            >
              {verifying ? "Verifying…" : "Verify"}
            </button>

            <button style={btnSecondary} onClick={handleResend} disabled={sending}>
              {sending ? "Resending…" : "Resend code"}
            </button>
          </>
        )}

        {error && (
          <div style={{ color: "#dc2626", fontSize: "13px", marginTop: "12px", padding: "10px 14px", backgroundColor: "#fef2f2", borderRadius: "6px" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
