import React, { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";

interface Stats {
  total: number;
  needsReview: number;
  categorized: number;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ total: 0, needsReview: 0, categorized: 0 });
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    if (!user) return;
    async function loadStats() {
      setLoadingStats(true);
      try {
        const q = query(collection(db, "transactions"), where("uid", "==", user!.uid));
        const snap = await getDocs(q);
        let needsReview = 0;
        let categorized = 0;
        snap.forEach((d) => {
          const data = d.data();
          if (data.status === "needs_review") needsReview++;
          if (data.status === "categorized") categorized++;
        });
        setStats({ total: snap.size, needsReview, categorized });
      } finally {
        setLoadingStats(false);
      }
    }
    loadStats();
  }, [user]);

  const progress = stats.total > 0 ? Math.round((stats.categorized / stats.total) * 100) : 0;

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const navStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderBottom: "1px solid #e5e7eb",
    padding: "0 32px",
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: font,
  };

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: font,
  };

  const contentStyle: React.CSSProperties = {
    maxWidth: "960px",
    margin: "0 auto",
    padding: "40px 24px",
  };

  const statCardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderRadius: "12px",
    padding: "24px",
    flex: 1,
    boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "12px 28px",
    backgroundColor: "#16A34A",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  };

  const btnSecondary: React.CSSProperties = {
    padding: "12px 28px",
    backgroundColor: "#f3f4f6",
    color: "#374151",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div style={pageStyle}>
      <nav style={navStyle}>
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A" }}>DIYTax AI</div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            style={{ ...btnSecondary, padding: "8px 16px", fontSize: "13px" }}
            onClick={() => signOut(auth).then(() => navigate("/login"))}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <div style={contentStyle}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
          Welcome back, {user?.email?.split("@")[0]}
        </h1>
        <p style={{ color: "#6b7280", marginBottom: "32px" }}>
          Tax Year 2025 — Here's where you stand
        </p>

        <div style={{ display: "flex", gap: "20px", marginBottom: "32px" }}>
          <div style={statCardStyle}>
            <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>Total Transactions</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: "#111827" }}>
              {loadingStats ? "—" : stats.total}
            </div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>Needs Review</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: stats.needsReview > 0 ? "#d97706" : "#111827" }}>
              {loadingStats ? "—" : stats.needsReview}
            </div>
          </div>
          <div style={statCardStyle}>
            <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>Tax Year</div>
            <div style={{ fontSize: "32px", fontWeight: 700, color: "#16A34A" }}>2025</div>
          </div>
        </div>

        <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "24px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
            <span style={{ fontSize: "15px", fontWeight: 600, color: "#111827" }}>Categorization Progress</span>
            <span style={{ fontSize: "14px", color: "#6b7280" }}>{progress}%</span>
          </div>
          <div style={{ backgroundColor: "#e5e7eb", borderRadius: "999px", height: "10px", overflow: "hidden" }}>
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                backgroundColor: "#16A34A",
                borderRadius: "999px",
                transition: "width 0.5s",
              }}
            />
          </div>
          <div style={{ marginTop: "8px", fontSize: "13px", color: "#9ca3af" }}>
            {stats.categorized} of {stats.total} transactions categorized
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px" }}>
          <button style={btnPrimary} onClick={() => navigate("/tax-flow")}>
            Continue Your Taxes
          </button>
          <button style={btnSecondary} onClick={() => navigate("/transactions")}>
            View Transactions
          </button>
        </div>
      </div>
    </div>
  );
}
