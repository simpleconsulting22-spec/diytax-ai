import React, { useState } from "react";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";

export default function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const { user } = result;

      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          createdAt: serverTimestamp(),
          mfaEnabled: true,
          onboardingComplete: false,
        });
      }

      navigate("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderRadius: "16px",
    padding: "56px 48px",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    textAlign: "center",
  };

  const logoStyle: React.CSSProperties = {
    fontSize: "32px",
    fontWeight: 800,
    color: "#16A34A",
    marginBottom: "8px",
    letterSpacing: "-0.5px",
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: "16px",
    color: "#6b7280",
    marginBottom: "40px",
  };

  const btnStyle: React.CSSProperties = {
    width: "100%",
    padding: "14px",
    backgroundColor: loading ? "#22C55E" : "#16A34A",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    fontSize: "16px",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    transition: "background-color 0.15s",
  };

  const errorStyle: React.CSSProperties = {
    color: "#dc2626",
    fontSize: "14px",
    marginTop: "16px",
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>DIYTax AI</div>
        <div style={subtitleStyle}>Your AI-powered tax filing assistant</div>

        <button style={btnStyle} onClick={handleGoogleSignIn} disabled={loading}>
          {!loading && (
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {loading ? "Signing in..." : "Sign in with Google"}
        </button>

        <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "20px", lineHeight: 1.6 }}>
          By signing in, you acknowledge our{" "}
          <a href="/privacy-policy" style={{ color: "#16A34A", textDecoration: "none", fontWeight: 600 }}>
            Privacy Policy
          </a>{" "}
          and{" "}
          <a href="/terms-of-service" style={{ color: "#16A34A", textDecoration: "none", fontWeight: 600 }}>
            Terms of Service
          </a>
          . You will be asked to provide explicit consent during setup.
        </p>

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
