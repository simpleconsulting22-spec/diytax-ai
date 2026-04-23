import React, { useState, useEffect, useCallback } from "react";
import { collection, query, where, onSnapshot, Timestamp } from "firebase/firestore";
import { usePlaidLink } from "react-plaid-link";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../services/apiClient";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface Account {
  accountId:       string;
  institutionName: string;
  accountName:     string;
  mask:            string;
  createdAt:       Timestamp | null;
}

interface RefreshState {
  loading:  boolean;
  result:   string | null;
}

interface PlaidMetadata {
  institution?: { name?: string } | null;
  accounts?:    Array<{ name?: string; mask?: string }>;
}

export default function BankAccountsPage() {
  const { user } = useAuth();
  const ownerUid = user?.uid;

  const [accounts, setAccounts]       = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [linkToken, setLinkToken]     = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [connecting, setConnecting]   = useState(false);
  const [linkingBank, setLinkingBank] = useState(false);
  const [successMsg, setSuccessMsg]   = useState<string | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [refreshStates, setRefreshStates] = useState<Record<string, RefreshState>>({});

  // Live account list
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(collection(db, "accounts"), where("uid", "==", ownerUid));
    return onSnapshot(q, (snap) => {
      setAccounts(
        snap.docs.map((d) => ({
          accountId:       d.id,
          institutionName: d.data().institutionName ?? "Bank",
          accountName:     d.data().accountName ?? "Account",
          mask:            d.data().mask ?? "",
          createdAt:       d.data().createdAt ?? null,
        }))
      );
      setAccountsLoaded(true);
    });
  }, [ownerUid]);

  const handlePlaidSuccess = useCallback(
    async (publicToken: string, metadata: PlaidMetadata) => {
      setLinkToken(null);
      setLinkingBank(true);
      setError(null);
      try {
        const institutionName = metadata?.institution?.name ?? "Bank";
        const accountName     = metadata?.accounts?.[0]?.name ?? "Account";
        const mask            = metadata?.accounts?.[0]?.mask ?? "";
        await apiClient.call("exchangePublicToken", {
          publicToken,
          institutionName,
          accountName,
          mask,
        });
        setSuccessMsg(`${institutionName} connected! Transactions are being imported in the background.`);
        setTimeout(() => setSuccessMsg(null), 6000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account.");
      } finally {
        setLinkingBank(false);
        setConnecting(false);
      }
    },
    []
  );

  const { open, ready } = usePlaidLink({
    token:     linkToken ?? "",
    onSuccess: handlePlaidSuccess,
    onExit:    () => { setPendingOpen(false); setConnecting(false); },
  });

  useEffect(() => {
    if (ready && pendingOpen) {
      open();
      setPendingOpen(false);
    }
  }, [ready, pendingOpen, open]);

  async function handleConnectBank() {
    setConnecting(true);
    setError(null);
    try {
      const res = await apiClient.call<{ linkToken: string }>("createPlaidLinkToken");
      setLinkToken(res.linkToken);
      setPendingOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize bank connection.");
      setConnecting(false);
    }
  }

  async function handleRefresh(accountId: string) {
    setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: true, result: null } }));
    try {
      const res = await apiClient.call<{ imported: number }>("fetchTransactions", { accountId });
      const msg = res.imported === 0 ? "Already up to date" : `${res.imported} new transaction${res.imported !== 1 ? "s" : ""} imported`;
      setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: msg } }));
      setTimeout(() => setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: null } })), 5000);
    } catch (err) {
      setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: "Refresh failed" } }));
    }
  }

  function initials(name: string) {
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "B";
  }

  const isWorking = connecting || linkingBank;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
              Bank Accounts
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
              Connect your bank to automatically import and categorize transactions.
            </p>
          </div>
          <button
            onClick={handleConnectBank}
            disabled={isWorking}
            style={{
              padding: "10px 18px",
              backgroundColor: isWorking ? "#86efac" : "#16A34A",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 700,
              cursor: isWorking ? "default" : "pointer",
              fontFamily: font,
              whiteSpace: "nowrap",
            }}
          >
            {connecting ? "Initializing…" : linkingBank ? "Linking…" : "+ Connect Bank"}
          </button>
        </div>

        {/* Success banner */}
        {successMsg && (
          <div style={{ padding: "12px 16px", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", color: "#15803d" }}>
            ✓ {successMsg}
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
            {error}
          </div>
        )}

        {/* Account list */}
        {!accountsLoaded ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px 0", fontSize: "14px" }}>Loading…</div>
        ) : accounts.length === 0 ? (
          <div style={{
            backgroundColor: "#fff",
            borderRadius: "16px",
            padding: "48px 32px",
            textAlign: "center",
            boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
          }}>
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>🏦</div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
              No accounts connected yet
            </div>
            <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "24px" }}>
              Connect your bank to automatically import transactions and get a real-time tax estimate.
            </div>
            <button
              onClick={handleConnectBank}
              disabled={isWorking}
              style={{
                padding: "12px 28px",
                backgroundColor: "#16A34A",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              {isWorking ? "Initializing…" : "Connect Bank"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {accounts.map((acct) => {
              const rs = refreshStates[acct.accountId];
              return (
                <div
                  key={acct.accountId}
                  style={{
                    backgroundColor: "#fff",
                    borderRadius: "14px",
                    padding: "20px 24px",
                    boxShadow: "0 1px 8px rgba(0,0,0,0.06)",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                  }}
                >
                  {/* Avatar */}
                  <div style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "50%",
                    backgroundColor: "#DCFCE7",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "15px",
                    fontWeight: 700,
                    color: "#16A34A",
                    flexShrink: 0,
                  }}>
                    {initials(acct.institutionName)}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827" }}>
                      {acct.institutionName}
                    </div>
                    <div style={{ fontSize: "13px", color: "#6b7280" }}>
                      {acct.accountName}{acct.mask ? ` ···· ${acct.mask}` : ""}
                    </div>
                    {acct.createdAt && (
                      <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
                        Connected {acct.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    )}
                    {rs?.result && (
                      <div style={{ fontSize: "12px", color: "#16A34A", marginTop: "4px" }}>
                        ✓ {rs.result}
                      </div>
                    )}
                  </div>

                  {/* Refresh button */}
                  <button
                    onClick={() => handleRefresh(acct.accountId)}
                    disabled={rs?.loading}
                    style={{
                      padding: "7px 14px",
                      backgroundColor: "#f3f4f6",
                      color: "#374151",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: rs?.loading ? "default" : "pointer",
                      fontFamily: font,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {rs?.loading ? "Syncing…" : "Refresh"}
                  </button>
                </div>
              );
            })}

            {/* Add another account */}
            <button
              onClick={handleConnectBank}
              disabled={isWorking}
              style={{
                padding: "14px",
                backgroundColor: "transparent",
                color: "#16A34A",
                border: "2px dashed #86efac",
                borderRadius: "14px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: font,
                marginTop: "4px",
              }}
            >
              {isWorking ? "Initializing…" : "+ Connect Another Account"}
            </button>
          </div>
        )}

        {/* Sandbox note */}
        <p style={{ fontSize: "11px", color: "#9ca3af", textAlign: "center", marginTop: "32px" }}>
          Bank connections are powered by Plaid. Your credentials are never stored on our servers.
        </p>
      </div>
    </div>
  );
}
