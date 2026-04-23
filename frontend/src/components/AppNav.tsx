import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import YearSelector from "./YearSelector";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Nav link definitions ─────────────────────────────────────────────────────

const NAV_LINKS = [
  { path: "/dashboard",    label: "Dashboard" },
  { path: "/transactions", label: "Transaction History" },
  { path: "/review",       label: "Review" },
  { path: "/import-csv",   label: "Import CSV" },
  { path: "/bank-accounts", label: "Bank Accounts" },
  { path: "/tax-summary",  label: "Business (Sch. C)" },
  { path: "/schedule-e",   label: "Rental Properties (Sch. E)" },
  { path: "/schedule-a",   label: "Deductions (Sch. A)" },
  { path: "/transfers",     label: "Transfers" },
  { path: "/budget",       label: "Budget" },
] as const;

// ─── AppNav ───────────────────────────────────────────────────────────────────

export default function AppNav() {
  const navigate    = useNavigate();
  const location    = useLocation();
  const { user, role }    = useAuth();
  const isMobile    = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef   = useRef<HTMLDivElement>(null);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setDrawerOpen(false); }
    function onOutside(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node))
        setDrawerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onOutside);
    };
  }, [drawerOpen]);

  async function handleSignOut() {
    await signOut(auth);
    navigate("/login");
  }

  const isActive = (path: string) => location.pathname === path;

  // ── Desktop nav — 2-row layout ─────────────────────────────────────────────

  if (!isMobile) {
    return (
      <nav style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e5e7eb",
        boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        fontFamily: font,
      }}>

        {/* ── Row 1: logo + account actions ── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px 8px",
          borderBottom: "1px solid #f3f4f6",
        }}>
          {/* Logo */}
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              background: "none",
              border: "none",
              fontSize: "17px",
              fontWeight: 800,
              color: "#16A34A",
              cursor: "pointer",
              fontFamily: font,
              padding: 0,
              letterSpacing: "-0.01em",
            }}
          >
            DIYTax AI
          </button>

          {/* Right: year selector + settings + email + sign out */}
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <YearSelector variant="nav" />

            {role === "owner" && (
              <button
                onClick={() => navigate("/manage-access")}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: isActive("/manage-access") ? 700 : 500,
                  color: isActive("/manage-access") ? "#16A34A" : "#6b7280",
                  cursor: "pointer",
                  fontFamily: font,
                  padding: 0,
                }}
              >
                Team
              </button>
            )}

            <button
              onClick={() => navigate("/settings/notifications")}
              style={{
                background: "none",
                border: "none",
                fontSize: "13px",
                fontWeight: isActive("/settings/notifications") ? 700 : 500,
                color: isActive("/settings/notifications") ? "#16A34A" : "#6b7280",
                cursor: "pointer",
                fontFamily: font,
                padding: 0,
              }}
            >
              Notifications
            </button>

            <button
              onClick={() => navigate("/onboarding")}
              style={{
                background: "none",
                border: "none",
                fontSize: "13px",
                fontWeight: isActive("/onboarding") ? 700 : 500,
                color: isActive("/onboarding") ? "#16A34A" : "#6b7280",
                cursor: "pointer",
                fontFamily: font,
                padding: 0,
              }}
            >
              Settings
            </button>

            {/* Divider */}
            <span style={{ width: "1px", height: "16px", backgroundColor: "#e5e7eb", display: "inline-block" }} />

            <span style={{
              fontSize: "12px",
              color: "#9ca3af",
              maxWidth: "180px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {user?.email}
            </span>

            <button
              onClick={handleSignOut}
              style={{
                padding: "5px 12px",
                backgroundColor: "transparent",
                color: "#dc2626",
                border: "1.5px solid #fca5a5",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
                whiteSpace: "nowrap",
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* ── Row 2: nav links ── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          padding: "0 20px",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}>
          {NAV_LINKS.map(({ path, label }) => {
            const active = isActive(path);
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2px solid #16A34A" : "2px solid transparent",
                  fontSize: "12.5px",
                  fontWeight: active ? 700 : 500,
                  color: active ? "#16A34A" : "#4b5563",
                  cursor: "pointer",
                  padding: "10px 10px 8px",
                  fontFamily: font,
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, border-color 0.15s",
                  flexShrink: 0,
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.color = "#111827";
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.color = "#4b5563";
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  // ── Mobile nav ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile top bar */}
      <nav style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e5e7eb",
        boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
        padding: "0 16px",
        height: "52px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
        fontFamily: font,
      }}>
        <button
          onClick={() => navigate("/dashboard")}
          style={{ background: "none", border: "none", fontSize: "17px", fontWeight: 800, color: "#16A34A", cursor: "pointer", fontFamily: font, padding: 0 }}
        >
          DIYTax AI
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={handleSignOut}
            style={{
              padding: "5px 10px",
              backgroundColor: "transparent",
              color: "#dc2626",
              border: "1.5px solid #fca5a5",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Sign Out
          </button>
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            style={{
              background: "none",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "6px 10px",
              cursor: "pointer",
              fontSize: "18px",
              lineHeight: 1,
              color: "#374151",
            }}
          >
            ☰
          </button>
        </div>
      </nav>

      {/* Backdrop */}
      {drawerOpen && (
        <div
          style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 200 }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Slide-in drawer */}
      <div
        ref={drawerRef}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "280px",
          backgroundColor: "#fff",
          zIndex: 201,
          boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          transform: drawerOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.25s ease",
          fontFamily: font,
        }}
      >
        {/* Drawer header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid #e5e7eb",
        }}>
          <span style={{ fontSize: "16px", fontWeight: 800, color: "#16A34A" }}>DIYTax AI</span>
          <button
            onClick={() => setDrawerOpen(false)}
            style={{ background: "none", border: "none", fontSize: "20px", cursor: "pointer", color: "#6b7280", padding: "4px" }}
          >
            ✕
          </button>
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {NAV_LINKS.map(({ path, label }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 20px",
                background: isActive(path) ? "#f0fdf4" : "none",
                border: "none",
                borderLeft: isActive(path) ? "3px solid #16A34A" : "3px solid transparent",
                fontSize: "14px",
                fontWeight: isActive(path) ? 700 : 400,
                color: isActive(path) ? "#15803d" : "#374151",
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              {label}
            </button>
          ))}
          {role === "owner" && (
            <button
              onClick={() => navigate("/manage-access")}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "12px 20px",
                background: isActive("/manage-access") ? "#f0fdf4" : "none",
                border: "none",
                borderLeft: isActive("/manage-access") ? "3px solid #16A34A" : "3px solid transparent",
                fontSize: "14px",
                fontWeight: isActive("/manage-access") ? 700 : 400,
                color: isActive("/manage-access") ? "#15803d" : "#374151",
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              Team
            </button>
          )}
          <button
            onClick={() => navigate("/settings/notifications")}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "12px 20px",
              background: isActive("/settings/notifications") ? "#f0fdf4" : "none",
              border: "none",
              borderLeft: isActive("/settings/notifications") ? "3px solid #16A34A" : "3px solid transparent",
              fontSize: "14px",
              fontWeight: isActive("/settings/notifications") ? 700 : 400,
              color: isActive("/settings/notifications") ? "#15803d" : "#374151",
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Notifications
          </button>
          <button
            onClick={() => navigate("/onboarding")}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "12px 20px",
              background: isActive("/onboarding") ? "#f0fdf4" : "none",
              border: "none",
              borderLeft: isActive("/onboarding") ? "3px solid #16A34A" : "3px solid transparent",
              fontSize: "14px",
              fontWeight: isActive("/onboarding") ? 700 : 400,
              color: isActive("/onboarding") ? "#15803d" : "#374151",
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Settings
          </button>
        </div>

        {/* Drawer footer */}
        <div style={{ borderTop: "1px solid #e5e7eb", padding: "16px 20px" }}>
          <div style={{ marginBottom: "12px" }}>
            <YearSelector variant="nav" />
          </div>
          {user?.email && (
            <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.email}
            </div>
          )}
          <button
            onClick={handleSignOut}
            style={{
              width: "100%",
              padding: "10px",
              backgroundColor: "transparent",
              color: "#dc2626",
              border: "1.5px solid #fca5a5",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
