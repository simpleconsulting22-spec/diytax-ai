import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const green = "#16A34A";
const greenDark = "#15803d";
const greenLight = "#f0fdf4";

// ─── Data ─────────────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "1",
    title: "Set up your tax profile",
    body: "Tell us about you so we can personalize your experience and tax insights.",
    note: "Takes less than 2 minutes",
  },
  {
    n: "2",
    title: "Connect your accounts or upload your data",
    body: "Securely import your transactions from your bank or upload your data.",
  },
  {
    n: "3",
    title: "Review and confirm AI categories",
    body: "Our AI organizes your transactions — you simply review and approve.",
  },
  {
    n: "4",
    title: "Track your finances all year",
    body: "Stay on top of your spending, budget, and tax-ready data in real time.",
  },
  {
    n: "5",
    title: "File with confidence",
    body: "Export everything and file your taxes easily with your preferred tool.",
  },
];

const FEATURES = [
  {
    icon: "💰",
    title: "Track Income & Expenses",
    body: "Automatically capture every dollar in and out across all your accounts.",
  },
  {
    icon: "✦",
    title: "AI Categorization",
    body: "Smart rules and AI learn your patterns and sort transactions for you.",
  },
  {
    icon: "📅",
    title: "Flexible Budgeting",
    body: "Set weekly, bi-weekly, or monthly budgets and track them in real time.",
  },
  {
    icon: "📊",
    title: "Real-Time Insights",
    body: "See your financial picture update instantly as new transactions arrive.",
  },
  {
    icon: "🧾",
    title: "Receipt Storage",
    body: "Attach receipts to transactions so everything stays in one place.",
  },
  {
    icon: "📤",
    title: "Export for Tax Filing",
    body: "Download clean, organized reports ready for Schedule C, E, or A.",
  },
];

// ─── LandingPage ──────────────────────────────────────────────────────────────

export default function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // If already signed in, skip the landing page and go straight to the app.
  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [user, loading, navigate]);

  function goLogin() {
    navigate("/login");
  }

  return (
    <div style={{ fontFamily: font, color: "#111827", backgroundColor: "#fff", overflowX: "hidden" }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backgroundColor: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #e5e7eb",
        padding: "0 20px",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: "18px", fontWeight: 800, color: green }}>DIYTax AI</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={goLogin}
            style={{
              background: "none",
              border: "none",
              fontSize: "14px",
              fontWeight: 500,
              color: "#6b7280",
              cursor: "pointer",
              padding: "6px 10px",
              fontFamily: font,
            }}
          >
            Log In
          </button>
          <button
            onClick={goLogin}
            style={{
              backgroundColor: green,
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
              whiteSpace: "nowrap",
            }}
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section style={{
        background: "linear-gradient(160deg, #f0fdf4 0%, #ffffff 60%)",
        padding: "60px 20px 72px",
        textAlign: "center",
      }}>
        <div style={{ maxWidth: "680px", margin: "0 auto" }}>
          {/* Badge */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: greenLight,
            border: `1px solid #bbf7d0`,
            borderRadius: "999px",
            padding: "4px 14px",
            fontSize: "12px",
            fontWeight: 600,
            color: greenDark,
            marginBottom: "24px",
          }}>
            <span>✦</span> AI-Powered Tax Assistant
          </div>

          <h1 style={{
            fontSize: "clamp(28px, 6vw, 48px)",
            fontWeight: 800,
            lineHeight: 1.2,
            color: "#111827",
            margin: "0 0 20px",
            letterSpacing: "-0.02em",
          }}>
            Who needs an accountant when your{" "}
            <span style={{ color: green }}>AI tax assistant</span>{" "}
            keeps everything organized?
          </h1>

          <p style={{
            fontSize: "clamp(15px, 2.5vw, 18px)",
            color: "#6b7280",
            lineHeight: 1.65,
            margin: "0 0 36px",
            maxWidth: "560px",
            marginLeft: "auto",
            marginRight: "auto",
          }}>
            DIYTax AI tracks your income, expenses, deductions, and budget all year — so tax season becomes simple and stress-free.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
            <button
              onClick={goLogin}
              style={{
                backgroundColor: green,
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                padding: "14px 32px",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: font,
                width: "100%",
                maxWidth: "320px",
                boxShadow: "0 4px 14px rgba(22,163,74,0.35)",
              }}
            >
              Get Started Free →
            </button>
            <a
              href="#how-it-works"
              style={{
                fontSize: "14px",
                color: "#6b7280",
                textDecoration: "none",
                fontWeight: 500,
                padding: "4px 0",
              }}
            >
              See how it works ↓
            </a>
          </div>

          {/* Social proof strip */}
          <div style={{
            marginTop: "48px",
            display: "flex",
            justifyContent: "center",
            gap: "32px",
            flexWrap: "wrap",
          }}>
            {[
              { stat: "100%", label: "Tax-ready data" },
              { stat: "AI", label: "Auto-categorization" },
              { stat: "5 min", label: "Setup time" },
            ].map(({ stat, label }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "22px", fontWeight: 800, color: green }}>{stat}</div>
                <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: "64px 20px", backgroundColor: "#fff" }}>
        <div style={{ maxWidth: "680px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 style={{ fontSize: "clamp(22px, 4vw, 32px)", fontWeight: 800, color: "#111827", margin: "0 0 12px" }}>
              How it works — in minutes, not hours
            </h2>
            <p style={{ fontSize: "15px", color: "#6b7280", margin: 0 }}>
              Go from scattered transactions to tax-ready in 5 easy steps.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {STEPS.map((step, i) => (
              <div
                key={step.n}
                style={{
                  display: "flex",
                  gap: "20px",
                  position: "relative",
                }}
              >
                {/* Connector line + circle */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    backgroundColor: green,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                    fontWeight: 800,
                    flexShrink: 0,
                    zIndex: 1,
                  }}>
                    {step.n}
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{ width: "2px", flex: 1, minHeight: "32px", backgroundColor: "#d1fae5", margin: "4px 0" }} />
                  )}
                </div>

                {/* Content */}
                <div style={{ paddingBottom: i < STEPS.length - 1 ? "28px" : "0", paddingTop: "6px" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", margin: "0 0 6px" }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: "14px", color: "#6b7280", margin: 0, lineHeight: 1.6 }}>
                    {step.body}
                  </p>
                  {step.note && (
                    <span style={{
                      display: "inline-block",
                      marginTop: "6px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: greenDark,
                      backgroundColor: greenLight,
                      padding: "2px 8px",
                      borderRadius: "999px",
                    }}>
                      {step.note}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: "64px 20px", backgroundColor: "#f9fafb" }}>
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2 style={{ fontSize: "clamp(22px, 4vw, 32px)", fontWeight: 800, color: "#111827", margin: "0 0 12px" }}>
              Everything you need, nothing you don't
            </h2>
            <p style={{ fontSize: "15px", color: "#6b7280", margin: 0 }}>
              Built for self-employed people, landlords, and anyone who wants tax season to be painless.
            </p>
          </div>

          <FeatureGrid />
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section style={{
        padding: "72px 20px",
        background: `linear-gradient(135deg, ${green} 0%, #15803d 100%)`,
        textAlign: "center",
      }}>
        <div style={{ maxWidth: "520px", margin: "0 auto" }}>
          <h2 style={{
            fontSize: "clamp(24px, 5vw, 36px)",
            fontWeight: 800,
            color: "#fff",
            margin: "0 0 16px",
            lineHeight: 1.2,
          }}>
            Start organizing your taxes today
          </h2>
          <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.85)", margin: "0 0 32px", lineHeight: 1.6 }}>
            No accountant required. No confusion. Just clear, organized finances all year long.
          </p>
          <button
            onClick={goLogin}
            style={{
              backgroundColor: "#fff",
              color: green,
              border: "none",
              borderRadius: "10px",
              padding: "14px 36px",
              fontSize: "16px",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: font,
              width: "100%",
              maxWidth: "280px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
          >
            Get Started Free →
          </button>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer style={{
        padding: "28px 20px",
        backgroundColor: "#fff",
        borderTop: "1px solid #e5e7eb",
        textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: "24px", flexWrap: "wrap", marginBottom: "12px" }}>
          <a href="/privacy-policy" style={{ fontSize: "13px", color: "#9ca3af", textDecoration: "none" }}>Privacy Policy</a>
          <a href="/terms-of-service" style={{ fontSize: "13px", color: "#9ca3af", textDecoration: "none" }}>Terms of Service</a>
          <button onClick={goLogin} style={{ background: "none", border: "none", fontSize: "13px", color: "#9ca3af", cursor: "pointer", fontFamily: font, padding: 0 }}>Log In</button>
        </div>
        <p style={{ fontSize: "12px", color: "#d1d5db", margin: 0 }}>
          © {new Date().getFullYear()} DIYTax AI. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

// ─── FeatureGrid ──────────────────────────────────────────────────────────────
// Responsive 2-col on mobile, 3-col on wider screens using CSS Grid auto-fit.

function FeatureGrid() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
      gap: "16px",
    }}>
      {FEATURES.map((f) => (
        <div
          key={f.title}
          style={{
            backgroundColor: "#fff",
            borderRadius: "12px",
            padding: "24px 20px",
            boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
            border: "1px solid #f3f4f6",
          }}
        >
          <div style={{ fontSize: "28px", marginBottom: "12px" }}>{f.icon}</div>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#111827", margin: "0 0 6px" }}>{f.title}</h3>
          <p style={{ fontSize: "13px", color: "#6b7280", margin: 0, lineHeight: 1.6 }}>{f.body}</p>
        </div>
      ))}
    </div>
  );
}
