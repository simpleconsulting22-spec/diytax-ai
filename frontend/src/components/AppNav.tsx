import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { Home, Wallet, Landmark, FileText, Settings as SettingsIcon, LogOut, type LucideIcon } from "lucide-react";
import { auth } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { useIsMobile } from "../hooks/useIsMobile";
import YearSelector from "./YearSelector";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Hub structure ────────────────────────────────────────────────────────────
//
// Five top-level hubs. Each owns a set of routes (used to compute which hub is
// "active") plus a sub-link list shown as a contextual second row.

interface SubLink { path: string; label: string }
interface Hub {
  key: string;
  label: string;
  primaryPath: string;
  routes: string[];
  subLinks: SubLink[];
  Icon: LucideIcon;
}

const HUBS: Hub[] = [
  {
    key: "home",
    label: "Home",
    primaryPath: "/dashboard",
    routes: ["/dashboard"],
    subLinks: [],
    Icon: Home,
  },
  {
    key: "money",
    label: "Money",
    primaryPath: "/transactions",
    routes: ["/transactions", "/review", "/transfers", "/budget", "/spending-forecast"],
    subLinks: [
      { path: "/transactions", label: "Transactions" },
      { path: "/review", label: "Needs Review" },
      { path: "/transfers", label: "Transfers" },
      { path: "/budget", label: "Budget" },
      { path: "/spending-forecast", label: "Forecast" },
    ],
    Icon: Wallet,
  },
  {
    key: "accounts",
    label: "Accounts",
    primaryPath: "/bank-accounts",
    routes: ["/bank-accounts", "/import-csv", "/ai-parser"],
    subLinks: [
      { path: "/bank-accounts", label: "Bank Accounts" },
      { path: "/import-csv", label: "Import CSV" },
      { path: "/ai-parser", label: "AI Parser" },
    ],
    Icon: Landmark,
  },
  {
    key: "taxes",
    label: "Taxes",
    primaryPath: "/tax-estimate",
    routes: [
      "/tax-estimate",
      "/tax-summary",
      "/schedule-e",
      "/schedule-a",
      "/deductions",
      "/income/ssa",
      "/income/retirement",
      "/summary",
    ],
    subLinks: [
      { path: "/tax-estimate", label: "Tax Estimate" },
      { path: "/tax-summary", label: "Business (Sch. C)" },
      { path: "/schedule-e", label: "Rental (Sch. E)" },
      { path: "/schedule-a", label: "Deductions (Sch. A)" },
    ],
    Icon: FileText,
  },
  {
    key: "settings",
    label: "Settings",
    primaryPath: "/manage-access",
    routes: ["/manage-access", "/settings/notifications", "/onboarding"],
    subLinks: [
      { path: "/manage-access", label: "Team" },
      { path: "/settings/notifications", label: "Notifications" },
      { path: "/onboarding", label: "Profile" },
    ],
    Icon: SettingsIcon,
  },
];

const MOBILE_TAB_HEIGHT = 64; // base height; safe-area-inset-bottom is added on top

function findActiveHub(pathname: string): Hub | null {
  for (const h of HUBS) {
    if (h.routes.some((r) => pathname === r || pathname.startsWith(r + "/"))) return h;
  }
  return null;
}

// ─── AppNav ───────────────────────────────────────────────────────────────────

export default function AppNav() {
  const navigate    = useNavigate();
  const location    = useLocation();
  const { user, role } = useAuth();
  const isMobile    = useIsMobile();

  // Reserve space at the bottom so fixed bottom-tab bar doesn't cover content.
  useEffect(() => {
    if (!isMobile) {
      document.body.style.paddingBottom = "";
      return;
    }
    document.body.style.paddingBottom = `calc(${MOBILE_TAB_HEIGHT}px + env(safe-area-inset-bottom, 0px))`;
    return () => {
      document.body.style.paddingBottom = "";
    };
  }, [isMobile]);

  async function handleSignOut() {
    await signOut(auth);
    navigate("/login");
  }

  const activeHub = findActiveHub(location.pathname);
  const isPathActive = (path: string) => location.pathname === path;

  function visibleSubLinks(hub: Hub): SubLink[] {
    if (hub.key === "settings" && role !== "owner") {
      return hub.subLinks.filter((s) => s.path !== "/manage-access");
    }
    return hub.subLinks;
  }

  // ── Desktop nav ────────────────────────────────────────────────────────────

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
        {/* Row 1: logo + 5 hubs + account actions */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 24px",
          gap: "24px",
        }}>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              background: "none", border: "none", fontSize: "17px", fontWeight: 800,
              color: "#16A34A", cursor: "pointer", fontFamily: font, padding: 0,
              letterSpacing: "-0.01em", flexShrink: 0,
            }}
          >
            DIYTax AI
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "4px", flex: 1, justifyContent: "center" }}>
            {HUBS.map((hub) => {
              const active = activeHub?.key === hub.key;
              return (
                <button
                  key={hub.key}
                  onClick={() => navigate(hub.primaryPath)}
                  style={{
                    background: "none", border: "none",
                    fontSize: "14px",
                    fontWeight: active ? 700 : 500,
                    color: active ? "#16A34A" : "#4b5563",
                    cursor: "pointer", padding: "6px 14px", borderRadius: "8px",
                    backgroundColor: active ? "#f0fdf4" : "transparent",
                    fontFamily: font, whiteSpace: "nowrap",
                    transition: "color 0.15s, background-color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.color = "#111827";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.color = "#4b5563";
                  }}
                >
                  {hub.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexShrink: 0 }}>
            <YearSelector variant="nav" />

            <span style={{
              fontSize: "12px", color: "#9ca3af",
              maxWidth: "180px", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {user?.email}
            </span>

            <button
              onClick={handleSignOut}
              style={{
                padding: "5px 12px", backgroundColor: "transparent", color: "#dc2626",
                border: "1.5px solid #fca5a5", borderRadius: "6px",
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
                fontFamily: font, whiteSpace: "nowrap",
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Row 2: contextual sub-nav */}
        {activeHub && visibleSubLinks(activeHub).length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: "2px",
            padding: "0 24px", borderTop: "1px solid #f3f4f6",
            overflowX: "auto", scrollbarWidth: "none",
          }}>
            {visibleSubLinks(activeHub).map(({ path, label }) => {
              const active = isPathActive(path);
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  style={{
                    background: "none", border: "none",
                    borderBottom: active ? "2px solid #16A34A" : "2px solid transparent",
                    fontSize: "12.5px",
                    fontWeight: active ? 700 : 500,
                    color: active ? "#16A34A" : "#6b7280",
                    cursor: "pointer", padding: "9px 12px 7px",
                    fontFamily: font, whiteSpace: "nowrap",
                    transition: "color 0.15s, border-color 0.15s",
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.color = "#111827";
                  }}
                  onMouseLeave={(e) => {
                    if (!active) (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </nav>
    );
  }

  // ── Mobile nav ─────────────────────────────────────────────────────────────
  // Top bar: logo + year. Sub-nav pill row when in a hub with sub-pages.
  // Bottom: fixed tab bar with 5 hubs (icon + label).

  const subs = activeHub ? visibleSubLinks(activeHub) : [];

  return (
    <>
      {/* Mobile top bar */}
      <div style={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e5e7eb",
        boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
        position: "sticky",
        top: 0,
        zIndex: 100,
        fontFamily: font,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          height: "52px",
        }}>
          <button
            onClick={() => navigate("/dashboard")}
            style={{
              background: "none", border: "none",
              fontSize: "17px", fontWeight: 800, color: "#16A34A",
              cursor: "pointer", fontFamily: font, padding: 0,
            }}
          >
            DIYTax AI
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <YearSelector variant="nav" />
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              style={{
                background: "none",
                border: "none",
                padding: "8px",
                cursor: "pointer",
                color: "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LogOut size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Sub-nav pills (sticky under top bar) */}
        {subs.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "8px 12px",
            borderTop: "1px solid #f3f4f6",
            overflowX: "auto", scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}>
            {subs.map(({ path, label }) => {
              const active = isPathActive(path);
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  style={{
                    flexShrink: 0,
                    padding: "8px 14px",
                    borderRadius: "999px",
                    border: "none",
                    backgroundColor: active ? "#16A34A" : "#f3f4f6",
                    color: active ? "#fff" : "#374151",
                    fontSize: "13px",
                    fontWeight: active ? 700 : 500,
                    fontFamily: font,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "background-color 0.15s",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom tab bar — fixed */}
      <nav
        aria-label="Primary"
        style={{
          position: "fixed",
          bottom: 0, left: 0, right: 0,
          backgroundColor: "#fff",
          borderTop: "1px solid #e5e7eb",
          boxShadow: "0 -2px 16px rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "space-around",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          zIndex: 200,
          fontFamily: font,
        }}
      >
        {HUBS.map((hub) => {
          const active = activeHub?.key === hub.key;
          const Icon = hub.Icon;
          return (
            <button
              key={hub.key}
              onClick={() => navigate(hub.primaryPath)}
              aria-label={hub.label}
              style={{
                flex: 1,
                background: "none",
                border: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "5px",
                padding: "8px 4px",
                minHeight: `${MOBILE_TAB_HEIGHT}px`,
                cursor: "pointer",
                color: active ? "#16A34A" : "#374151",
                fontFamily: font,
                WebkitFontSmoothing: "antialiased",
                MozOsxFontSmoothing: "grayscale",
              }}
            >
              <Icon size={24} strokeWidth={active ? 2.4 : 2.1} color={active ? "#16A34A" : "#374151"} />
              <span style={{
                fontSize: "12px",
                fontWeight: active ? 700 : 600,
                letterSpacing: "0.02em",
                lineHeight: 1.1,
                color: active ? "#16A34A" : "#374151",
              }}>
                {hub.label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
