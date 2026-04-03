import React from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import ReviewTable from "./components/ReviewTable";
import { useReviewTransactions } from "./hooks/useReviewTransactions";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export default function ReviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    state,
    allSelected,
    handleEntityChange,
    handleCategoryChange,
    handleConfirm,
    handleBulkConfirm,
    toggleSelect,
    toggleSelectAll,
    reload,
  } = useReviewTransactions();

  const { transactions, entities, loading, error, selectedIds, updating } = state;

  const navLinkStyle: React.CSSProperties = {
    fontSize: "14px",
    color: "#6b7280",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "4px 0",
    fontFamily: font,
  };

  const activeNavLinkStyle: React.CSSProperties = {
    ...navLinkStyle,
    color: "#16A34A",
    fontWeight: 600,
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {/* Nav */}
      <nav
        style={{
          backgroundColor: "#fff",
          borderBottom: "1px solid #e5e7eb",
          padding: "0 32px",
          height: "64px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
          <div
            style={{ fontSize: "20px", fontWeight: 800, color: "#16A34A", cursor: "pointer" }}
            onClick={() => navigate("/dashboard")}
          >
            DIYTax AI
          </div>
          <button style={navLinkStyle} onClick={() => navigate("/dashboard")}>
            Dashboard
          </button>
          <button style={navLinkStyle} onClick={() => navigate("/transactions")}>
            Transactions
          </button>
          <button style={activeNavLinkStyle}>
            Review
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "14px", color: "#6b7280" }}>{user?.email}</span>
          <button
            style={{
              padding: "8px 16px",
              backgroundColor: "#f3f4f6",
              color: "#374151",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
            onClick={() => signOut(auth).then(() => navigate("/login"))}
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Page content */}
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header row */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: "24px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#111827", margin: 0 }}>
              Review Transactions
            </h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              {loading
                ? "Loading…"
                : `${transactions.length} transaction${transactions.length !== 1 ? "s" : ""} need review`}
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkConfirm}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#16A34A",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Mark {selectedIds.size} as reviewed
              </button>
            )}
            <button
              onClick={reload}
              style={{
                padding: "10px 16px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Legend */}
        {!loading && transactions.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: "20px",
              marginBottom: "16px",
              fontSize: "12px",
              color: "#6b7280",
              flexWrap: "wrap",
            }}
          >
            <span>
              <span style={{ color: "#16A34A", fontWeight: 700 }}>✓</span> High confidence (≥ 80%)
            </span>
            <span>
              <span style={{ color: "#d97706", fontWeight: 700 }}>⚠</span> Low confidence (&lt; 80%)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  backgroundColor: "#fffbeb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "2px",
                }}
              />
              AI-categorized rows
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#dc2626",
              fontSize: "14px",
              marginBottom: "16px",
            }}
          >
            {error}
          </div>
        )}

        {/* Table card */}
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: "12px",
            boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
            overflow: "hidden",
          }}
        >
          {loading ? (
            <div
              style={{
                padding: "60px 24px",
                textAlign: "center",
                color: "#9ca3af",
                fontSize: "14px",
              }}
            >
              Loading transactions…
            </div>
          ) : (
            <ReviewTable
              transactions={transactions}
              entities={entities}
              selectedIds={selectedIds}
              updating={updating}
              allSelected={allSelected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onCategoryChange={handleCategoryChange}
              onEntityChange={handleEntityChange}
              onConfirm={handleConfirm}
            />
          )}
        </div>

        {/* Footer count */}
        {!loading && transactions.length > 0 && (
          <div
            style={{
              marginTop: "12px",
              fontSize: "12px",
              color: "#9ca3af",
              textAlign: "right",
            }}
          >
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${transactions.length} selected`
              : `${transactions.length} total`}
          </div>
        )}
      </div>
    </div>
  );
}
