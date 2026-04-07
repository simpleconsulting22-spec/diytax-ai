import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";
import AppNav from "../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface SharedUser {
  uid: string;
  email: string;
  role: "spouse" | "accountant";
}

export default function ManageAccessPage() {
  const { role, userDoc, refreshUserDoc } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail]         = useState("");
  const [inviteRole, setInviteRole] = useState<"spouse" | "accountant">("spouse");
  const [sending, setSending]     = useState(false);
  const [success, setSuccess]     = useState("");
  const [error, setError]         = useState("");

  // Owners only
  if (role !== "owner") {
    return (
      <div style={{ fontFamily: font, padding: "40px", textAlign: "center", color: "#6b7280" }}>
        Only the account owner can manage access.
      </div>
    );
  }

  const sharedUsers: SharedUser[] = (userDoc?.sharedAccess as SharedUser[]) ?? [];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError("");
    setSuccess("");
    try {
      await apiClient.call("sendInvite", { email: email.trim(), role: inviteRole });
      setSuccess(`Invite sent to ${email.trim()}. They'll receive an email with a link to accept.`);
      setEmail("");
      await refreshUserDoc();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send invite.");
    } finally {
      setSending(false);
    }
  }

  const roleLabel = (r: string) =>
    r === "spouse" ? "Spouse (full access)" : "Accountant (read + categorize only)";

  return (
    <>
      <AppNav />
      <div style={{ maxWidth: "600px", margin: "40px auto", padding: "0 20px", fontFamily: font }}>

        <button
          onClick={() => navigate(-1)}
          style={{ background: "none", border: "none", color: "#6b7280", fontSize: "14px", cursor: "pointer", padding: 0, marginBottom: "24px" }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#111827", marginBottom: "6px" }}>
          Manage Access
        </h1>
        <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
          Invite your spouse or accountant to view and categorize your transactions.
        </p>

        {/* ── Current access ──────────────────────────────────────────────── */}
        {sharedUsers.length > 0 && (
          <div style={{ marginBottom: "32px" }}>
            <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
              People with access
            </h2>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
              {sharedUsers.map((u, i) => (
                <div
                  key={u.uid}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 16px",
                    borderBottom: i < sharedUsers.length - 1 ? "1px solid #f3f4f6" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 500, color: "#111827" }}>{u.email}</div>
                    <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "2px" }}>{roleLabel(u.role)}</div>
                  </div>
                  <span style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: "12px",
                    backgroundColor: u.role === "spouse" ? "#dcfce7" : "#dbeafe",
                    color: u.role === "spouse" ? "#15803d" : "#1d4ed8",
                    textTransform: "capitalize",
                  }}>
                    {u.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Invite form ─────────────────────────────────────────────────── */}
        <div style={{ border: "1px solid #e5e7eb", borderRadius: "10px", padding: "24px" }}>
          <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#111827", marginBottom: "4px" }}>
            Send an invite
          </h2>
          <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "20px" }}>
            They'll receive an email with a link to create an account or sign in.
          </p>

          <form onSubmit={handleInvite}>
            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="spouse@example.com"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "14px",
                border: "1.5px solid #d1d5db",
                borderRadius: "8px",
                outline: "none",
                boxSizing: "border-box",
                marginBottom: "16px",
                fontFamily: font,
              }}
            />

            <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
              Role
            </label>
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              {(["spouse", "accountant"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setInviteRole(r)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    border: inviteRole === r ? "2px solid #16A34A" : "2px solid #e5e7eb",
                    borderRadius: "8px",
                    background: inviteRole === r ? "#f0fdf4" : "#fff",
                    cursor: "pointer",
                    fontFamily: font,
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 700, color: inviteRole === r ? "#15803d" : "#374151", textTransform: "capitalize" }}>
                    {r}
                  </div>
                  <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                    {r === "spouse" ? "Full read & write access" : "Read + categorize only"}
                  </div>
                </button>
              ))}
            </div>

            {/* Role detail */}
            <div style={{ backgroundColor: "#f9fafb", borderRadius: "8px", padding: "12px 14px", marginBottom: "20px", fontSize: "12px", color: "#6b7280", lineHeight: 1.6 }}>
              {inviteRole === "spouse"
                ? "Spouse can view, import, categorize, and confirm all transactions — same as the owner, except they cannot manage account access."
                : "Accountant can view all transactions and edit category, entity assignment, and notes. They cannot import data, delete transactions, or manage users."}
            </div>

            <button
              type="submit"
              disabled={sending || !email.trim()}
              style={{
                width: "100%",
                padding: "11px",
                backgroundColor: sending || !email.trim() ? "#9ca3af" : "#16A34A",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: sending || !email.trim() ? "not-allowed" : "pointer",
                fontFamily: font,
              }}
            >
              {sending ? "Sending invite…" : "Send Invite"}
            </button>
          </form>

          {success && (
            <div style={{ marginTop: "16px", padding: "12px 14px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", fontSize: "13px", color: "#15803d" }}>
              {success}
            </div>
          )}
          {error && (
            <div style={{ marginTop: "16px", padding: "12px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "13px", color: "#dc2626" }}>
              {error}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
