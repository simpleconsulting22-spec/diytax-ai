import React, { useState, useCallback } from "react";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { usePlaidLink } from "react-plaid-link";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { apiClient } from "../services/apiClient";

type FilingType = "individual" | "self-employed";

interface PlaidMetadata {
  institution?: { name?: string } | null;
  accounts?: Array<{ name?: string; mask?: string }>;
}

export default function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [filingType, setFilingType] = useState<FilingType | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function fetchLinkToken() {
    try {
      const res = await apiClient.call<{ linkToken: string }>("createPlaidLinkToken");
      setLinkToken(res.linkToken);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to initialize bank connection.");
    }
  }

  const onPlaidSuccess = useCallback(async (publicToken: string, metadata: PlaidMetadata) => {
    try {
      const institutionName = metadata?.institution?.name ?? "Unknown Bank";
      const accountName = metadata?.accounts?.[0]?.name ?? "Checking";
      const mask = metadata?.accounts?.[0]?.mask ?? "";
      await apiClient.call("exchangePublicToken", { publicToken, institutionName, accountName, mask });
      setConnectedAccount(`${institutionName} — ${accountName} (...${mask})`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to connect bank.");
    }
  }, []);

  const { open: openPlaid, ready: plaidReady } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess: onPlaidSuccess,
  });

  async function handleConnectBank() {
    if (!linkToken) {
      await fetchLinkToken();
    }
    if (plaidReady) openPlaid();
  }

  async function handleStartFiling() {
    if (!user || !filingType) return;
    setSaving(true);
    setError("");
    try {
      const profileId = `${user.uid}_2025`;
      await setDoc(doc(db, "taxProfiles", profileId), {
        profileId,
        uid: user.uid,
        filingType,
        taxYear: 2025,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "users", user.uid), { onboardingComplete: true });
      navigate("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: font,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "40px 20px",
  };

  const progressBarContainer: React.CSSProperties = {
    display: "flex",
    gap: "8px",
    marginBottom: "40px",
    width: "100%",
    maxWidth: "500px",
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    borderRadius: "16px",
    padding: "48px",
    width: "100%",
    maxWidth: "500px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "26px",
    fontWeight: 700,
    color: "#111827",
    marginBottom: "8px",
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: "15px",
    color: "#6b7280",
    marginBottom: "32px",
  };

  const optionCardBase: React.CSSProperties = {
    border: "2px solid",
    borderRadius: "12px",
    padding: "20px 24px",
    cursor: "pointer",
    marginBottom: "12px",
    transition: "border-color 0.15s, background-color 0.15s",
  };

  const btnPrimary: React.CSSProperties = {
    width: "100%",
    padding: "14px",
    backgroundColor: "#16A34A",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "24px",
  };

  const btnSecondary: React.CSSProperties = {
    width: "100%",
    padding: "14px",
    backgroundColor: "#f3f4f6",
    color: "#374151",
    border: "none",
    borderRadius: "10px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    marginTop: "10px",
  };

  const errorStyle: React.CSSProperties = {
    color: "#dc2626",
    fontSize: "14px",
    marginTop: "12px",
  };

  function ProgressBar() {
    return (
      <div style={progressBarContainer}>
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            style={{
              flex: 1,
              height: "6px",
              borderRadius: "3px",
              backgroundColor: s <= step ? "#16A34A" : "#e5e7eb",
              transition: "background-color 0.3s",
            }}
          />
        ))}
      </div>
    );
  }

  if (step === 1) {
    return (
      <div style={pageStyle}>
        <ProgressBar />
        <div style={cardStyle}>
          <div style={titleStyle}>What best describes you?</div>
          <div style={subtitleStyle}>Step 1 of 3 — Choose your filing type</div>

          {(["individual", "self-employed"] as FilingType[]).map((type) => (
            <div
              key={type}
              style={{
                ...optionCardBase,
                borderColor: filingType === type ? "#16A34A" : "#e5e7eb",
                backgroundColor: filingType === type ? "#DCFCE7" : "#fff",
              }}
              onClick={() => setFilingType(type)}
            >
              <div style={{ fontWeight: 700, fontSize: "16px", color: "#111827", marginBottom: "4px" }}>
                {type === "individual" ? "Individual" : "Self-Employed"}
              </div>
              <div style={{ fontSize: "14px", color: "#6b7280" }}>
                {type === "individual"
                  ? "W-2 employee, personal taxes"
                  : "Freelancer, contractor, or small business owner"}
              </div>
            </div>
          ))}

          <button
            style={{ ...btnPrimary, opacity: filingType ? 1 : 0.5 }}
            disabled={!filingType}
            onClick={() => setStep(2)}
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div style={pageStyle}>
        <ProgressBar />
        <div style={cardStyle}>
          <div style={titleStyle}>Connect your bank account</div>
          <div style={subtitleStyle}>
            Step 2 of 3 — We'll import your transactions automatically
          </div>

          {connectedAccount ? (
            <div style={{ padding: "16px", backgroundColor: "#f0fdf4", borderRadius: "10px", border: "1px solid #bbf7d0", marginBottom: "16px" }}>
              <div style={{ fontWeight: 600, color: "#166534", fontSize: "14px" }}>Connected</div>
              <div style={{ color: "#374151", fontSize: "14px", marginTop: "4px" }}>{connectedAccount}</div>
            </div>
          ) : null}

          <button
            style={{ ...btnPrimary, marginTop: connectedAccount ? "0" : "24px" }}
            onClick={handleConnectBank}
          >
            {connectedAccount ? "Connect Another Account" : "Connect Bank"}
          </button>

          <button style={btnSecondary} onClick={() => setStep(3)}>
            {connectedAccount ? "Continue" : "Skip for now"}
          </button>

          {error && <div style={errorStyle}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <ProgressBar />
      <div style={cardStyle}>
        <div style={{ fontSize: "48px", textAlign: "center", marginBottom: "16px" }}>🎉</div>
        <div style={{ ...titleStyle, textAlign: "center" }}>You're all set!</div>
        <div style={{ ...subtitleStyle, textAlign: "center" }}>Step 3 of 3 — Review and start</div>

        <div style={{ backgroundColor: "#f9fafb", borderRadius: "10px", padding: "20px", marginBottom: "8px" }}>
          <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "4px" }}>Filing Type</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827", textTransform: "capitalize" }}>
            {filingType ?? "Not set"}
          </div>
        </div>

        <div style={{ backgroundColor: "#f9fafb", borderRadius: "10px", padding: "20px", marginBottom: "24px" }}>
          <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "4px" }}>Bank Account</div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827" }}>
            {connectedAccount ?? "Not connected"}
          </div>
        </div>

        <button
          style={{ ...btnPrimary, marginTop: "0", opacity: saving ? 0.7 : 1 }}
          disabled={saving || !filingType}
          onClick={handleStartFiling}
        >
          {saving ? "Saving..." : "Start Filing"}
        </button>

        {error && <div style={errorStyle}>{error}</div>}
      </div>
    </div>
  );
}
