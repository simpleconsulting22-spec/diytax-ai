import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type PageState = "loading" | "ready" | "accepting" | "done" | "error";

interface InviteDetails {
  email: string;
  role: "spouse" | "accountant";
  ownerName: string;
  status: string;
}

export default function AcceptInvitePage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { user, refreshUserDoc } = useAuth();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [invite, setInvite]       = useState<InviteDetails | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");

  // Load invite details so we can show what the user is accepting.
  useEffect(() => {
    if (!inviteId) { setPageState("error"); setErrorMsg("Invalid invite link."); return; }

    // Invites are readable by the invited user's email (checked in Firestore rules)
    // or by the owner. We fetch using the document ID directly.
    async function load() {
      try {
        // Use a direct doc fetch via apiClient (the Firestore client rule allows
        // the invited user's email to read it).
        const snap = await getDocs(
          query(collection(db, "invites"), where("__name__", "==", inviteId!))
        );
        if (snap.empty) { setPageState("error"); setErrorMsg("Invite not found or already used."); return; }
        const data = snap.docs[0].data() as InviteDetails & { status: string };
        if (data.status !== "pending") {
          setPageState("error");
          setErrorMsg("This invite has already been accepted.");
          return;
        }
        setInvite(data);
        setPageState("ready");
      } catch {
        setPageState("error");
        setErrorMsg("Could not load invite. Please try again.");
      }
    }
    load();
  }, [inviteId]);

  async function handleAccept() {
    if (!user) {
      // Not logged in — send to login with a return URL
      navigate(`/login?redirect=/accept-invite/${inviteId}`);
      return;
    }
    setPageState("accepting");
    try {
      await apiClient.call("acceptInvite", { inviteId });
      await refreshUserDoc();
      setPageState("done");
      setTimeout(() => navigate("/dashboard"), 2500);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to accept invite.");
      setPageState("error");
    }
  }

  const roleLabel = invite?.role === "spouse"
    ? "Spouse (full read & write access)"
    : "Accountant (read + categorize only)";

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#f9fafb",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: font,
      padding: "20px",
    }}>
      <div style={{
        backgroundColor: "#fff",
        borderRadius: "14px",
        padding: "40px",
        width: "100%",
        maxWidth: "440px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      }}>

        {/* Loading */}
        {pageState === "loading" && (
          <div style={{ textAlign: "center", color: "#6b7280" }}>Loading invite…</div>
        )}

        {/* Ready to accept */}
        {pageState === "ready" && invite && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>✉️</div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
              You've been invited
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "24px", lineHeight: 1.6 }}>
              <strong style={{ color: "#111827" }}>{invite.ownerName}</strong> has invited you to
              access their DIYTax AI account as a{" "}
              <strong style={{ color: "#111827" }}>{invite.role}</strong>.
            </p>

            <div style={{ backgroundColor: "#f9fafb", borderRadius: "8px", padding: "14px 16px", marginBottom: "24px" }}>
              <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Your role</div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>{roleLabel}</div>
              <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "6px" }}>
                {invite.role === "spouse"
                  ? "You'll be able to view, import, and categorize all transactions."
                  : "You'll be able to view transactions and edit category, entity, and notes."}
              </div>
            </div>

            {!user && (
              <div style={{ fontSize: "13px", color: "#6b7280", backgroundColor: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "12px 14px", marginBottom: "20px" }}>
                You'll need to sign in (or create an account) with <strong>{invite.email}</strong> to accept this invite.
              </div>
            )}

            <button
              onClick={handleAccept}
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#16A34A",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "15px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              {user ? "Accept Invitation" : "Sign In to Accept"}
            </button>
          </>
        )}

        {/* Accepting */}
        {pageState === "accepting" && (
          <div style={{ textAlign: "center", color: "#6b7280" }}>Accepting invite…</div>
        )}

        {/* Done */}
        {pageState === "done" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>✅</div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
              You're in!
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280" }}>
              Invite accepted. Redirecting you to the dashboard…
            </p>
          </>
        )}

        {/* Error */}
        {pageState === "error" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>⚠️</div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: "14px", color: "#dc2626", marginBottom: "20px" }}>{errorMsg}</p>
            <button
              onClick={() => navigate("/login")}
              style={{
                padding: "10px 20px",
                backgroundColor: "#f3f4f6",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
                color: "#374151",
              }}
            >
              Go to Login
            </button>
          </>
        )}

      </div>
    </div>
  );
}
