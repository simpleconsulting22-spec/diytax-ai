import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { collection, query, where, getDocs } from "firebase/firestore";
import { sendEmailVerification } from "firebase/auth";
import { auth, db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

type PageState =
  | "loading"
  | "signin_required"
  | "ready"
  | "accepting"
  | "done"
  | "error";

interface InviteDetails {
  email: string;
  role: "spouse" | "accountant";
  ownerName: string;
  status: string;
}

export default function AcceptInvitePage() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const { user, loading: authLoading, refreshUserDoc } = useAuth();
  const navigate = useNavigate();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [invite, setInvite]       = useState<InviteDetails | null>(null);
  const [errorMsg, setErrorMsg]   = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendNote, setResendNote] = useState("");

  // Load invite details so we can show what the user is accepting.
  //
  // This runs only once the visitor is signed in. The invite document holds
  // the invited person's email address and the owner's uid, and the Firestore
  // rule now requires an authenticated owner or invited address to read it —
  // so an anonymous fetch here would simply be denied. Gating on `user` keeps
  // the failure legible instead of surfacing a permission error.
  useEffect(() => {
    if (!inviteId) { setPageState("error"); setErrorMsg("Invalid invite link."); return; }
    if (authLoading) return;
    if (!user) { setPageState("signin_required"); return; }

    let cancelled = false;

    async function load() {
      try {
        const snap = await getDocs(
          query(collection(db, "invites"), where("__name__", "==", inviteId!))
        );
        if (cancelled) return;
        if (snap.empty) {
          setPageState("error");
          setErrorMsg(
            "This invite could not be found. It may have already been used, " +
              "or you may be signed in with a different email address than the " +
              "one it was sent to."
          );
          return;
        }
        const data = snap.docs[0].data() as InviteDetails & { status: string };
        if (data.status !== "pending") {
          setPageState("error");
          setErrorMsg("This invite has already been accepted.");
          return;
        }
        setInvite(data);
        setPageState("ready");
      } catch {
        if (cancelled) return;
        setPageState("error");
        setErrorMsg(
          "Could not load this invite. Make sure you're signed in with the " +
            "email address the invitation was sent to."
        );
      }
    }
    load();
    return () => { cancelled = true; };
  }, [inviteId, user, authLoading]);

  function goToSignIn() {
    navigate(`/login?redirect=/accept-invite/${inviteId}`);
  }

  async function handleResendVerification() {
    setResendNote("");
    if (!auth.currentUser) return;
    try {
      await sendEmailVerification(auth.currentUser);
      setResendNote("Verification email sent. Open the link, then try again.");
    } catch {
      setResendNote("Could not send the verification email. Please try again shortly.");
    }
  }

  async function handleAccept() {
    if (!user) { goToSignIn(); return; }
    setPageState("accepting");
    setNeedsVerification(false);
    setResendNote("");
    try {
      await apiClient.call("acceptInvite", { inviteId });
      await refreshUserDoc();
      setPageState("done");
      setTimeout(() => navigate("/dashboard"), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to accept invite.";
      // acceptInvite rejects unverified addresses. That is recoverable in
      // place — offer the resend rather than dead-ending on the error screen.
      setNeedsVerification(/verify your email/i.test(msg));
      setErrorMsg(msg);
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

        {/* Signed out — invite details are not shown until we know who's asking */}
        {pageState === "signin_required" && (
          <>
            <div style={{ fontSize: "32px", marginBottom: "16px" }}>✉️</div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", marginBottom: "8px" }}>
              You've been invited
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "24px", lineHeight: 1.6 }}>
              Sign in with the email address this invitation was sent to, and
              we'll show you what you're accepting. If you don't have an account
              yet, you can create one on the next screen.
            </p>
            <button
              onClick={goToSignIn}
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
              Sign In to Continue
            </button>
          </>
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

            {needsVerification && (
              <div style={{ marginBottom: "20px" }}>
                <button
                  onClick={handleResendVerification}
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
                  Resend Verification Email
                </button>
                {resendNote && (
                  <p style={{ fontSize: "13px", color: "#6b7280", marginTop: "10px" }}>{resendNote}</p>
                )}
              </div>
            )}

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
