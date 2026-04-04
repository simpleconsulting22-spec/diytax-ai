import React, { useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { apiClient } from "../services/apiClient";
import { useAuth } from "../contexts/AuthContext";

// ─── Phone normalisation ──────────────────────────────────────────────────────

/**
 * Converts common US/international formats to E.164.
 * 10-digit US → +1XXXXXXXXXX
 * 11-digit starting with 1 → +1XXXXXXXXXX
 * Already has + prefix → strip non-digits and re-prefix
 */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return `+${digits}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "••••••••••";
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: "15px",
  border: "1.5px solid #d1d5db",
  borderRadius: "8px",
  outline: "none",
  boxSizing: "border-box",
  marginBottom: "16px",
  fontFamily: font,
  color: "#111827",
};

const codeInputStyle: React.CSSProperties = {
  ...inputStyle,
  fontSize: "22px",
  letterSpacing: "8px",
  textAlign: "center",
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

type Step = "phone" | "code";

export default function MfaModal({ onVerified }: MfaModalProps) {
  const { user, userDoc } = useAuth();

  const savedPhone: string = (userDoc?.phoneNumber as string) ?? "";

  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState(savedPhone);
  const [resolvedPhone, setResolvedPhone] = useState(savedPhone);
  const [code, setCode] = useState("");

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  // ── Send code ──────────────────────────────────────────────────────────────

  async function handleSendCode() {
    const phone = toE164(phoneInput.trim());
    if (!phone || phone.length < 9) {
      setError("Please enter a valid phone number.");
      return;
    }

    setSending(true);
    setError("");

    try {
      // Persist phone to user doc so we don't ask again on next login
      if (user && phone !== savedPhone) {
        await updateDoc(doc(db, "users", user.uid), { phoneNumber: phone });
      }

      await apiClient.call("sendMfaCode", { phoneNumber: phone });
      setResolvedPhone(phone);
      setStep("code");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send code. Check your number and try again.");
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
      await apiClient.call("sendMfaCode", { phoneNumber: resolvedPhone });
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

        {step === "phone" ? (
          <>
            <div style={titleStyle}>Two-Factor Authentication</div>
            <div style={subtitleStyle}>
              {savedPhone
                ? `We'll send a 6-digit code to ${maskPhone(savedPhone)}. You can update your number below.`
                : "Enter your mobile number. We'll send a 6-digit code each time you sign in."}
            </div>

            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
              Mobile number
            </label>
            <input
              style={inputStyle}
              type="tel"
              placeholder="+1 (555) 000-0000"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
              autoFocus
            />
            <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "20px", marginTop: "-8px" }}>
              US numbers: enter 10 digits. International: include country code (e.g. +44…)
            </div>

            <button
              style={{
                ...btnPrimary,
                opacity: sending || !phoneInput.trim() ? 0.65 : 1,
                cursor: sending || !phoneInput.trim() ? "not-allowed" : "pointer",
              }}
              onClick={handleSendCode}
              disabled={sending || !phoneInput.trim()}
            >
              {sending ? "Sending code…" : "Send Verification Code"}
            </button>
          </>
        ) : (
          <>
            <div style={titleStyle}>Enter your code</div>
            <div style={subtitleStyle}>
              We texted a 6-digit code to {maskPhone(resolvedPhone)}.{" "}
              <button
                onClick={() => { setStep("phone"); setCode(""); setError(""); }}
                style={{ background: "none", border: "none", color: "#16A34A", fontSize: "14px", cursor: "pointer", padding: 0, fontFamily: font, textDecoration: "underline" }}
              >
                Change number
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
