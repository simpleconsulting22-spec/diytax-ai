import React, { useState } from "react";
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ensureUserDoc(uid: string, email: string | null) {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        email,
        createdAt: serverTimestamp(),
        mfaEnabled: true,
        onboardingComplete: false,
      });
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await ensureUserDoc(result.user.uid, result.user.email);
      navigate("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailAuth() {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (mode === "signup") {
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await ensureUserDoc(result.user.uid, result.user.email);
      } else {
        const result = await signInWithEmailAndPassword(auth, email.trim(), password);
        await ensureUserDoc(result.user.uid, result.user.email);
      }
      navigate("/dashboard");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Authentication failed.";
      // Surface Firebase auth errors in plain English
      if (msg.includes("user-not-found") || msg.includes("wrong-password") || msg.includes("invalid-credential")) {
        setError("Incorrect email or password.");
      } else if (msg.includes("email-already-in-use")) {
        setError("An account with this email already exists. Sign in instead.");
      } else if (msg.includes("weak-password")) {
        setError("Password must be at least 6 characters.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    fontFamily: font,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderRadius: "16px",
    padding: "48px 40px",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    textAlign: "center",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    fontSize: "15px",
    border: "1.5px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: "12px",
    fontFamily: font,
    color: "#111827",
    textAlign: "left",
  };

  const btnPrimary: React.CSSProperties = {
    width: "100%",
    padding: "13px",
    backgroundColor: loading ? "#22C55E" : "#16A34A",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    fontFamily: font,
    marginBottom: "12px",
  };

  const btnGoogle: React.CSSProperties = {
    ...btnPrimary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    backgroundColor: "#fff",
    color: "#374151",
    border: "1.5px solid #d1d5db",
    marginBottom: 0,
  };

  const dividerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "20px 0",
    color: "#9ca3af",
    fontSize: "13px",
  };

  const lineStyle: React.CSSProperties = {
    flex: 1,
    height: "1px",
    backgroundColor: "#e5e7eb",
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: "32px", fontWeight: 800, color: "#16A34A", marginBottom: "6px", letterSpacing: "-0.5px" }}>
          DIYTax AI
        </div>
        <div style={{ fontSize: "15px", color: "#6b7280", marginBottom: "32px" }}>
          Your AI-powered tax filing assistant
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", backgroundColor: "#f3f4f6", borderRadius: "10px", padding: "4px", marginBottom: "24px" }}>
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              style={{
                flex: 1,
                padding: "9px",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
                backgroundColor: mode === m ? "#fff" : "transparent",
                color: mode === m ? "#111827" : "#6b7280",
                boxShadow: mode === m ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s",
              }}
            >
              {m === "signin" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* Email / Password */}
        <div style={{ textAlign: "left" }}>
          <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
            Email
          </label>
          <input
            style={inputStyle}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
            autoFocus
          />

          <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
            Password
          </label>
          <input
            style={{ ...inputStyle, marginBottom: "20px" }}
            type="password"
            placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleEmailAuth()}
          />
        </div>

        <button style={btnPrimary} onClick={handleEmailAuth} disabled={loading}>
          {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>

        {/* Divider */}
        <div style={dividerStyle}>
          <div style={lineStyle} />
          or
          <div style={lineStyle} />
        </div>

        {/* Google */}
        <button style={btnGoogle} onClick={handleGoogleSignIn} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {error && (
          <div style={{ color: "#dc2626", fontSize: "13px", marginTop: "16px", padding: "10px 14px", backgroundColor: "#fef2f2", borderRadius: "6px", textAlign: "left" }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "24px", lineHeight: 1.6 }}>
          By continuing, you acknowledge our{" "}
          <a href="/privacy-policy" style={{ color: "#16A34A", textDecoration: "none", fontWeight: 600 }}>Privacy Policy</a>{" "}
          and{" "}
          <a href="/terms-of-service" style={{ color: "#16A34A", textDecoration: "none", fontWeight: 600 }}>Terms of Service</a>.
        </p>
      </div>
    </div>
  );
}
