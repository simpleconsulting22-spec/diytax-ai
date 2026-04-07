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
  { path: "/tax-summary",  label: "Business Income (Sch. C)" },
  { path: "/schedule-e",   label: "Rental Properties (Sch. E)" },
  { path: "/schedule-a",   label: "Deductions (Sch. A)" },
] as const;

// ─── AppNav ───────────────────────────────────────────────────────────────────

export default function AppNav() {
  const navigate    = useNavigate();
  const location    = useLocation();
  const { user }    = useAuth();
  const isMobile    = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef   = useRef<HTMLDivElement>(null);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Close drawer on outside click / Escape
  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setDrawerOpen(false); }
    function onOutside(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
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

  // ── Shared styles ──────────────────────────────────────────────────────────

  const navLinkStyle = (active: boolean): React.CSSProperties => ({
    background: "none",
    border: "none",
    fontSize: "14px",
    fontWeight: active ? 700 : 400,
    color: active ? "#16A34A" : "#6b7280",
    cursor: "pointer",
    padding: "4px 0",
    fontFamily: font,
    whiteSpace: "nowrap",
    textDecoration: "none",
  });

  const signOutBtnStyle: React.CSSProperties = {
    padding: "7px 14px",
    backgroundColor: "transparent",
    color: "#dc2626",
    border: "1.5px solid #fca5a5",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: font,
    whiteSpace: "nowrap",
  };

  // ── Desktop nav ────────────────────────────────────────────────────────────

  if (!isMobile) {
    return (
      <nav style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e5e7eb",
        padding: "0 24px",
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
        fontFamily: font,
      }}>
        {/* Left: logo + links */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px", overflow: "hidden" }}>
          <button
            onClick={() => navigate("/dashboard")}
            style={{ background: "none", border: "none", fontSize: "18px", fontWeight: 800, color: "#16A34A", cursor: "pointer", fontFamily: font, whiteSpace: "nowrap", padding: 0 }}
          >
            DIYTax AI
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", overflow: "auto", scrollbarWidth: "none" }}>
            {NAV_LINKS.map(({ path, label }) => (
              <button key={path} style={navLinkStyle(isActive(path))} onClick={() => navigate(path)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: year, settings, sign out */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0, marginLeft: "16px" }}>
          <YearSelector variant="nav" />
          <button style={navLinkStyle(isActive("/onboarding"))} onClick={() => navigate("/onboarding")}>
            Settings
          </button>
          <span style={{ fontSize: "13px", color: "#9ca3af", maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.email}
          </span>
          <button onClick={handleSignOut} style={signOutBtnStyle}>
            Sign Out
          </button>
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
        {/* Logo */}
        <button
          onClick={() => navigate("/dashboard")}
          style={{ background: "none", border: "none", fontSize: "18px", fontWeight: 800, color: "#16A34A", cursor: "pointer", fontFamily: font, padding: 0 }}
        >
          DIYTax AI
        </button>

        {/* Right: sign out + hamburger */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={handleSignOut} style={{ ...signOutBtnStyle, padding: "5px 10px", fontSize: "12px" }}>
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
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            zIndex: 200,
          }}
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
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
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
              ...signOutBtnStyle,
              width: "100%",
              padding: "10px",
              fontSize: "14px",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
}
