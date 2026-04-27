import React, { useState, useEffect, useCallback } from "react";
import {
  collection, query, where, onSnapshot, Timestamp,
  doc, updateDoc, deleteField, getDocs, writeBatch, deleteDoc,
} from "firebase/firestore";
import { usePlaidLink } from "react-plaid-link";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { apiClient } from "../../services/apiClient";
import { findOrCreateAccountByName } from "../../services/accountService";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaidAccount {
  id:              string;
  institutionName: string;
  accountName:     string;
  mask:            string;
  plaidItemId:     string;
  createdAt:       Timestamp | null;
}

interface InstitutionGroup {
  plaidItemId:     string;
  institutionName: string;
  accounts:        PlaidAccount[];
}

interface ImportedAccount {
  id:                   string;
  name:                 string;
  last4:                string | null;
  accountType:          "bank" | "credit_card" | null;
  linkedPlaidAccountId: string | null;
}

interface RefreshState {
  loading: boolean;
  result:  string | null;
}

interface PlaidMetadata {
  institution?: { name?: string } | null;
  accounts?:    Array<{ id?: string; name?: string; mask?: string }>;
}

// Opens Plaid Link immediately when mounted. key={token} ensures a fresh
// instance for every new token instead of trying to swap token mid-lifecycle.
function PlaidOpener({
  token,
  onSuccess,
  onExit,
}: {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
  onExit: () => void;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => { if (ready) open(); }, [ready, open]);
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BankAccountsPage() {
  const { user } = useAuth();
  const ownerUid = user?.uid;

  const [plaidAccounts,    setPlaidAccounts]    = useState<PlaidAccount[]>([]);
  const [importedAccounts, setImportedAccounts] = useState<ImportedAccount[]>([]);
  const [accountsLoaded,   setAccountsLoaded]   = useState(false);

  const [linkToken,    setLinkToken]    = useState<string | null>(null);
  const [connecting,   setConnecting]   = useState(false);
  const [linkingBank,  setLinkingBank]  = useState(false);
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [refreshStates, setRefreshStates] = useState<Record<string, RefreshState>>({});

  // pending link selections: plaidId → selected importedId
  const [linkSelections, setLinkSelections] = useState<Record<string, string>>({});
  const [linking, setLinking] = useState<Set<string>>(new Set());

  // delete confirmation: which plaid account id is pending delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // inline rename: which plaid account is being renamed and its draft value
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [savingName, setSavingName] = useState(false);

  // re-import confirmation: clears Plaid transactions for that account and re-syncs
  const [confirmReimportId, setConfirmReimportId] = useState<string | null>(null);
  const [reimporting, setReimporting] = useState(false);

  // remove entire institution connection (all accounts in a plaidItemId group)
  const [confirmRemoveGroupId, setConfirmRemoveGroupId] = useState<string | null>(null);
  const [removingGroup, setRemovingGroup] = useState(false);

  // clean up orphaned transactions (pointing to deleted account docs)
  const [cleaningOrphans, setCleaningOrphans] = useState(false);
  const [orphanResult, setOrphanResult] = useState<string | null>(null);

  // text-only account migration: scan, preview, then apply
  interface MigrationEntry { name: string; count: number; existingAccountId: string | null }
  const [migratePreview, setMigratePreview] = useState<MigrationEntry[] | null>(null);
  const [scanningMigration, setScanningMigration] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  // merge imported account into a Plaid account: open panel, preview count, confirm
  const [mergeAccountId, setMergeAccountId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [mergeCount, setMergeCount] = useState<number | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<string | null>(null);

  // sync start date per account (defaults to 90 days ago)
  const defaultStartDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const [syncStartMap, setSyncStartMap] = useState<Record<string, string>>({});

  // which existing account ID is being used for update-mode link (add accounts to existing institution)
  const [updateModeAccountId, setUpdateModeAccountId] = useState<string | null>(null);

  // Live accounts
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(collection(db, "accounts"), where("uid", "==", ownerUid));
    return onSnapshot(q, (snap) => {
      const plaid: PlaidAccount[]    = [];
      const imported: ImportedAccount[] = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.institutionName) {
          plaid.push({
            id:              d.id,
            institutionName: data.institutionName as string,
            accountName:     data.accountName as string ?? "Account",
            mask:            data.mask as string ?? "",
            plaidItemId:     data.plaidItemId as string ?? d.id,
            createdAt:       data.createdAt ?? null,
          });
        } else if (data.name) {
          imported.push({
            id:                   d.id,
            name:                 data.name as string,
            last4:                data.last4 as string ?? null,
            accountType:          data.accountType as "bank" | "credit_card" ?? null,
            linkedPlaidAccountId: data.linkedPlaidAccountId as string ?? null,
          });
        }
      });
      setPlaidAccounts(plaid);
      setImportedAccounts(imported);
      setAccountsLoaded(true);
    });
  }, [ownerUid]);

  // ── Plaid link flow ──────────────────────────────────────────────────────────

  const handlePlaidSuccess = useCallback(
    async (publicToken: string, metadata: PlaidMetadata) => {
      setLinkToken(null);
      setLinkingBank(true);
      setError(null);
      try {
        const institutionName = metadata?.institution?.name ?? "Bank";
        const accounts = (metadata?.accounts ?? []).map((a) => ({
          plaidAccountId: a.id ?? "",
          name:           a.name ?? "Account",
          mask:           a.mask ?? "",
        })).filter((a) => a.plaidAccountId);

        await apiClient.call("exchangePublicToken", { publicToken, institutionName, accounts });
        const count = accounts.length;
        setSuccessMsg(`${institutionName} connected! ${count} account${count !== 1 ? "s" : ""} added. Transactions are being imported in the background.`);
        setTimeout(() => setSuccessMsg(null), 8000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account.");
      } finally {
        setLinkingBank(false);
        setConnecting(false);
        setUpdateModeAccountId(null);
      }
    },
    []
  );

  async function handleConnectBank() {
    setConnecting(true);
    setError(null);
    try {
      const res = await apiClient.call<{ linkToken: string }>("createPlaidLinkToken");
      setLinkToken(res.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize bank connection.");
      setConnecting(false);
    }
  }

  async function handleAddAccounts(existingAccountId: string) {
    setConnecting(true);
    setError(null);
    setUpdateModeAccountId(existingAccountId);
    try {
      const res = await apiClient.call<{ linkToken: string }>("createPlaidLinkToken", { existingAccountId });
      setLinkToken(res.linkToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open account selection.");
      setConnecting(false);
      setUpdateModeAccountId(null);
    }
  }

  async function handleRefresh(accountId: string) {
    setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: true, result: null } }));
    try {
      const startDate = syncStartMap[accountId] ?? defaultStartDate;
      const res = await apiClient.call<{ imported: number }>("fetchTransactions", { accountId, startDate });
      const msg = res.imported === 0 ? "Already up to date" : `${res.imported} new transaction${res.imported !== 1 ? "s" : ""} imported`;
      setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: msg } }));
      setTimeout(() => setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: null } })), 5000);
    } catch {
      setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: "Refresh failed" } }));
    }
  }

  async function handleRemoveGroup(plaidItemId: string) {
    if (!ownerUid) return;
    setRemovingGroup(true);
    setError(null);
    try {
      const groupAccounts = plaidAccounts.filter((a) => a.plaidItemId === plaidItemId);
      for (const acct of groupAccounts) {
        // Delete all transactions for this account
        const txnSnap = await getDocs(
          query(collection(db, "transactions"), where("uid", "==", ownerUid), where("accountId", "==", acct.id))
        );
        for (let i = 0; i < txnSnap.docs.length; i += 499) {
          const batch = writeBatch(db);
          txnSnap.docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
        // Delete import records
        const importSnap = await getDocs(
          query(collection(db, "imports"), where("userId", "==", ownerUid), where("accountId", "==", acct.id))
        );
        if (!importSnap.empty) {
          const ib = writeBatch(db);
          importSnap.docs.forEach((d) => ib.delete(d.ref));
          await ib.commit();
        }
        // Delete the account doc
        await deleteDoc(doc(db, "accounts", acct.id));
      }
      setConfirmRemoveGroupId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed. Please try again.");
    } finally {
      setRemovingGroup(false);
    }
  }

  async function handleResetAndResync(accountId: string) {
    if (!ownerUid) return;
    setReimporting(true);
    setError(null);
    try {
      // Delete all Plaid-sourced transactions for this account
      const txnSnap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("accountId", "==", accountId),
          where("source", "==", "plaid")
        )
      );
      for (let i = 0; i < txnSnap.docs.length; i += 499) {
        const batch = writeBatch(db);
        txnSnap.docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      // Delete the associated import records
      const importSnap = await getDocs(
        query(
          collection(db, "imports"),
          where("userId", "==", ownerUid),
          where("accountId", "==", accountId),
          where("source", "==", "plaid")
        )
      );
      if (!importSnap.empty) {
        const importBatch = writeBatch(db);
        importSnap.docs.forEach((d) => importBatch.delete(d.ref));
        await importBatch.commit();
      }

      // Re-sync with the corrected income/expense logic
      const startDate = syncStartMap[accountId] ?? defaultStartDate;
      const res = await apiClient.call<{ imported: number }>("fetchTransactions", { accountId, startDate });
      const msg = `Re-import complete — ${res.imported} transaction${res.imported !== 1 ? "s" : ""} imported with corrected types`;
      setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: msg } }));
      setTimeout(() => setRefreshStates((prev) => ({ ...prev, [accountId]: { loading: false, result: null } })), 8000);
      setConfirmReimportId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-import failed. Please try again.");
    } finally {
      setReimporting(false);
    }
  }

  // ── Auto-link by matching last-4 digits once accounts are loaded ─────────────

  useEffect(() => {
    if (!accountsLoaded) return;
    const plaidIds = new Set(plaidAccounts.map((p) => p.id));

    importedAccounts.forEach((imp) => {
      if (!imp.last4) return;
      const match = plaidAccounts.find((p) => p.mask === imp.last4);
      if (!match) return;

      // Not linked yet, or linked to a stale Plaid doc ID that no longer exists
      const needsLink = !imp.linkedPlaidAccountId || !plaidIds.has(imp.linkedPlaidAccountId);
      if (needsLink) {
        updateDoc(doc(db, "accounts", imp.id), { linkedPlaidAccountId: match.id }).catch(() => {});
      }
    });
  }, [accountsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Account mapping ──────────────────────────────────────────────────────────

  async function handleLink(importedId: string, plaidId: string) {
    if (!importedId || !plaidId) return;
    setLinking((prev) => new Set([...prev, plaidId]));
    try {
      await updateDoc(doc(db, "accounts", importedId), { linkedPlaidAccountId: plaidId });
      setLinkSelections((prev) => ({ ...prev, [plaidId]: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save link. Please try again.");
    } finally {
      setLinking((prev) => { const n = new Set(prev); n.delete(plaidId); return n; });
    }
  }

  async function handleUnlink(importedId: string) {
    await updateDoc(doc(db, "accounts", importedId), { linkedPlaidAccountId: deleteField() });
  }

  async function handleSaveName(accountId: string) {
    const trimmed = editNameValue.trim();
    if (!trimmed) return;
    setSavingName(true);
    setError(null);
    try {
      await updateDoc(doc(db, "accounts", accountId), { accountName: trimmed });
      setEditingNameId(null);
      setEditNameValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename. Please try again.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleDeleteAccount(accountId: string) {
    if (!ownerUid) return;
    setDeleting(true);
    setError(null);
    try {
      // Delete all transactions linked to this account in batches
      const txnSnap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("accountId", "==", accountId)
        )
      );
      for (let i = 0; i < txnSnap.docs.length; i += 499) {
        const batch = writeBatch(db);
        txnSnap.docs.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      // Delete the account doc itself
      await deleteDoc(doc(db, "accounts", accountId));
      setConfirmDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleCleanOrphans() {
    if (!ownerUid) return;
    setCleaningOrphans(true);
    setOrphanResult(null);
    setError(null);
    try {
      const validPlaidIds = new Set(plaidAccounts.map((a) => a.id));

      // Only look at Plaid-sourced transactions — never touch CSV imports
      const txnSnap = await getDocs(
        query(collection(db, "transactions"), where("uid", "==", ownerUid), where("source", "==", "plaid"))
      );

      const orphaned = txnSnap.docs.filter((d) => {
        const accountId = d.data().accountId as string | undefined;
        return !accountId || !validPlaidIds.has(accountId);
      });

      if (orphaned.length === 0) {
        setOrphanResult("No orphaned transactions found — nothing to clean up.");
        return;
      }

      for (let i = 0; i < orphaned.length; i += 499) {
        const batch = writeBatch(db);
        orphaned.slice(i, i + 499).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      setOrphanResult(`Removed ${orphaned.length} orphaned transaction${orphaned.length !== 1 ? "s" : ""} with no matching account.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed. Please try again.");
    } finally {
      setCleaningOrphans(false);
    }
  }

  async function handleScanMigration() {
    if (!ownerUid) return;
    setScanningMigration(true);
    setMigrateResult(null);
    setError(null);
    try {
      const txnSnap = await getDocs(
        query(collection(db, "transactions"), where("uid", "==", ownerUid))
      );

      // Group by lowercase name → display name + transaction count, where accountId is missing
      const groups = new Map<string, { displayName: string; count: number }>();
      txnSnap.docs.forEach((d) => {
        const data = d.data();
        const name = (data.accountName as string | undefined)?.trim();
        const accountId = data.accountId as string | undefined;
        if (!name || accountId) return;
        const key = name.toLowerCase();
        const cur = groups.get(key);
        if (cur) cur.count += 1;
        else groups.set(key, { displayName: name, count: 1 });
      });

      if (groups.size === 0) {
        setMigrateResult("No text-only account labels found — nothing to migrate.");
        setMigratePreview(null);
        return;
      }

      // Map existing CSV-style account names (case-insensitive) to detect reuses
      const acctSnap = await getDocs(
        query(collection(db, "accounts"), where("uid", "==", ownerUid))
      );
      const existingByName = new Map<string, string>();
      acctSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.institutionName) return;
        const n = (data.name as string | undefined)?.trim();
        if (n) existingByName.set(n.toLowerCase(), d.id);
      });

      const preview: MigrationEntry[] = [];
      for (const [key, val] of groups) {
        preview.push({
          name: val.displayName,
          count: val.count,
          existingAccountId: existingByName.get(key) ?? null,
        });
      }
      preview.sort((a, b) => b.count - a.count);
      setMigratePreview(preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed. Please try again.");
    } finally {
      setScanningMigration(false);
    }
  }

  async function handleApplyMigration() {
    if (!ownerUid || !migratePreview) return;
    setMigrating(true);
    setError(null);
    try {
      // Re-fetch to ensure we operate on the latest data
      const txnSnap = await getDocs(
        query(collection(db, "transactions"), where("uid", "==", ownerUid))
      );

      // Regroup case-insensitively, collecting all transaction ids per name
      const groupedByName = new Map<string, { displayName: string; ids: string[] }>();
      txnSnap.docs.forEach((d) => {
        const data = d.data();
        const name = (data.accountName as string | undefined)?.trim();
        if (!name || data.accountId) return;
        const key = name.toLowerCase();
        const cur = groupedByName.get(key);
        if (cur) cur.ids.push(d.id);
        else groupedByName.set(key, { displayName: name, ids: [d.id] });
      });

      if (groupedByName.size === 0) {
        setMigrateResult("Already migrated — nothing to update.");
        setMigratePreview(null);
        return;
      }

      let accountsCreated = 0;
      let accountsReused = 0;
      let txnsUpdated = 0;

      for (const [, group] of groupedByName) {
        const { id: accountId, created } = await findOrCreateAccountByName(ownerUid, group.displayName);
        if (created) accountsCreated += 1; else accountsReused += 1;

        for (let i = 0; i < group.ids.length; i += 499) {
          const batch = writeBatch(db);
          group.ids.slice(i, i + 499).forEach((id) =>
            batch.update(doc(db, "transactions", id), { accountId, accountName: group.displayName })
          );
          await batch.commit();
        }
        txnsUpdated += group.ids.length;
      }

      const parts: string[] = [];
      if (accountsCreated > 0) parts.push(`created ${accountsCreated} account${accountsCreated !== 1 ? "s" : ""}`);
      if (accountsReused > 0) parts.push(`reused ${accountsReused}`);
      parts.push(`updated ${txnsUpdated} transaction${txnsUpdated !== 1 ? "s" : ""}`);
      setMigrateResult(parts.join(", ") + ".");
      setMigratePreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed. Please try again.");
    } finally {
      setMigrating(false);
    }
  }

  async function handleOpenMerge(importedAccountId: string) {
    if (!ownerUid) return;
    const imp = importedAccounts.find((a) => a.id === importedAccountId);
    if (!imp) return;
    setMergeAccountId(importedAccountId);
    setMergeTargetId(imp.linkedPlaidAccountId ?? "");
    setMergeCount(null);
    setError(null);
    try {
      const txnSnap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("accountId", "==", importedAccountId)
        )
      );
      setMergeCount(txnSnap.docs.length);
    } catch {
      setMergeCount(0);
    }
  }

  function handleCancelMerge() {
    setMergeAccountId(null);
    setMergeTargetId("");
    setMergeCount(null);
  }

  async function handleConfirmMerge() {
    if (!ownerUid || !mergeAccountId || !mergeTargetId) return;
    const target = plaidAccounts.find((p) => p.id === mergeTargetId);
    if (!target) {
      setError("Pick a Plaid account to merge into.");
      return;
    }
    const sourceName = importedAccounts.find((a) => a.id === mergeAccountId)?.name ?? "imported account";
    setMerging(true);
    setError(null);
    try {
      const txnSnap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("accountId", "==", mergeAccountId)
        )
      );
      const updateCount = txnSnap.docs.length;
      for (let i = 0; i < txnSnap.docs.length; i += 499) {
        const batch = writeBatch(db);
        txnSnap.docs.slice(i, i + 499).forEach((d) =>
          batch.update(d.ref, { accountId: mergeTargetId, accountName: target.accountName })
        );
        await batch.commit();
      }
      await deleteDoc(doc(db, "accounts", mergeAccountId));
      setMergeResult(
        `Merged ${updateCount} transaction${updateCount !== 1 ? "s" : ""} from "${sourceName}" into ${target.accountName}. The "${sourceName}" account was deleted.`
      );
      setTimeout(() => setMergeResult(null), 8000);
      handleCancelMerge();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed. Please try again.");
    } finally {
      setMerging(false);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function initials(name: string) {
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "B";
  }

  function importedLabel(acc: ImportedAccount) {
    return acc.name + (acc.last4 ? ` ···· ${acc.last4}` : "");
  }

  const isWorking = connecting || linkingBank;

  // Group Plaid accounts by institution (plaidItemId)
  const institutionGroups: InstitutionGroup[] = [];
  plaidAccounts.forEach((acct) => {
    const existing = institutionGroups.find((g) => g.plaidItemId === acct.plaidItemId);
    if (existing) {
      existing.accounts.push(acct);
    } else {
      institutionGroups.push({ plaidItemId: acct.plaidItemId, institutionName: acct.institutionName, accounts: [acct] });
    }
  });

  // Imported accounts not yet linked to anything
  const unlinkedImported = importedAccounts.filter((a) => !a.linkedPlaidAccountId);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      {linkToken && (
        <PlaidOpener
          key={linkToken}
          token={linkToken}
          onSuccess={handlePlaidSuccess}
          onExit={() => { setLinkToken(null); setConnecting(false); setUpdateModeAccountId(null); }}
        />
      )}
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
              padding: "10px 18px", backgroundColor: isWorking ? "#86efac" : "#16A34A",
              color: "#fff", border: "none", borderRadius: "10px",
              fontSize: "14px", fontWeight: 700,
              cursor: isWorking ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap",
            }}
          >
            {connecting ? "Initializing…" : linkingBank ? "Linking…" : "+ Connect Bank"}
          </button>
        </div>

        {/* Banners */}
        {successMsg && (
          <div style={{ padding: "12px 16px", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", color: "#15803d" }}>
            ✓ {successMsg}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginBottom: "16px", fontSize: "13px", color: "#dc2626" }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {!accountsLoaded ? (
          <div style={{ textAlign: "center", color: "#9ca3af", padding: "60px 0", fontSize: "14px" }}>Loading…</div>
        ) : (
          <>
            {/* ── Plaid accounts ─────────────────────────────────────────────── */}
            {institutionGroups.length === 0 ? (
              <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "48px 32px", textAlign: "center", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "24px" }}>
                <div style={{ fontSize: "40px", marginBottom: "16px" }}>🏦</div>
                <div style={{ fontSize: "16px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>No accounts connected yet</div>
                <div style={{ fontSize: "14px", color: "#6b7280", marginBottom: "24px" }}>
                  Connect your bank to automatically import transactions and get a real-time tax estimate.
                </div>
                <button
                  onClick={handleConnectBank}
                  disabled={isWorking}
                  style={{ padding: "12px 28px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 700, cursor: "pointer", fontFamily: font }}
                >
                  {isWorking ? "Initializing…" : "Connect Bank"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
                {institutionGroups.map((group) => (
                  <div key={group.plaidItemId} style={{ backgroundColor: "#fff", borderRadius: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>

                    {/* Institution header */}
                    <div style={{ padding: "16px 20px", borderBottom: confirmRemoveGroupId === group.plaidItemId ? "none" : "1px solid #f3f4f6" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div style={{ width: "40px", height: "40px", borderRadius: "50%", backgroundColor: "#DCFCE7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, color: "#16A34A", flexShrink: 0 }}>
                          {initials(group.institutionName)}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "15px", fontWeight: 700, color: "#111827" }}>{group.institutionName}</div>
                          <div style={{ fontSize: "12px", color: "#9ca3af" }}>{group.accounts.length} account{group.accounts.length !== 1 ? "s" : ""} connected</div>
                        </div>
                        <button
                          onClick={() => handleAddAccounts(group.accounts[0].id)}
                          disabled={isWorking}
                          style={{ padding: "6px 14px", backgroundColor: "#f0fdf4", color: "#16A34A", border: "1px solid #bbf7d0", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: isWorking ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                          title="Add more accounts from this institution without logging in again"
                        >
                          {updateModeAccountId === group.accounts[0].id && connecting ? "Opening…" : "+ Add Accounts"}
                        </button>
                        <button
                          onClick={() => setConfirmRemoveGroupId(confirmRemoveGroupId === group.plaidItemId ? null : group.plaidItemId)}
                          style={{ padding: "6px 12px", backgroundColor: "transparent", color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: "8px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                          title="Remove this entire bank connection and all its transactions"
                        >
                          Remove
                        </button>
                      </div>

                      {/* Remove connection confirmation */}
                      {confirmRemoveGroupId === group.plaidItemId && (
                        <div style={{ marginTop: "12px", padding: "12px 14px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px" }}>
                          <div style={{ fontSize: "12px", color: "#991b1b", marginBottom: "10px" }}>
                            <strong>Remove {group.institutionName}?</strong> This will permanently delete all {group.accounts.length} account{group.accounts.length !== 1 ? "s" : ""} and every transaction imported from this connection. This cannot be undone.
                          </div>
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              onClick={() => handleRemoveGroup(group.plaidItemId)}
                              disabled={removingGroup}
                              style={{ padding: "7px 16px", backgroundColor: "#dc2626", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: removingGroup ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                            >
                              {removingGroup ? "Removing…" : "Yes, Remove Connection"}
                            </button>
                            <button
                              onClick={() => setConfirmRemoveGroupId(null)}
                              disabled={removingGroup}
                              style={{ padding: "7px 12px", backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Individual accounts */}
                    {group.accounts.map((acct, idx) => {
                      const rs = refreshStates[acct.id];
                      const linkedToThis = importedAccounts.filter((a) => a.linkedPlaidAccountId === acct.id);
                      const selectedImport = linkSelections[acct.id] ?? "";
                      const isLast = idx === group.accounts.length - 1;

                      return (
                        <div key={acct.id} style={{ borderBottom: isLast ? "none" : "1px solid #f3f4f6" }}>
                          {/* Account row */}
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 20px" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {editingNameId === acct.id ? (
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <input
                                    type="text"
                                    value={editNameValue}
                                    onChange={(e) => setEditNameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") handleSaveName(acct.id);
                                      if (e.key === "Escape") { setEditingNameId(null); setEditNameValue(""); }
                                    }}
                                    autoFocus
                                    disabled={savingName}
                                    style={{ flex: 1, minWidth: 0, padding: "4px 8px", fontSize: "14px", fontWeight: 600, color: "#374151", border: "1px solid #d1d5db", borderRadius: "6px", fontFamily: font, outline: "none" }}
                                  />
                                  <button
                                    onClick={() => handleSaveName(acct.id)}
                                    disabled={savingName || !editNameValue.trim()}
                                    style={{ padding: "4px 10px", backgroundColor: editNameValue.trim() && !savingName ? "#16A34A" : "#d1d5db", color: "#fff", border: "none", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: editNameValue.trim() && !savingName ? "pointer" : "not-allowed", fontFamily: font }}
                                  >
                                    {savingName ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    onClick={() => { setEditingNameId(null); setEditNameValue(""); }}
                                    disabled={savingName}
                                    style={{ padding: "4px 8px", backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#374151" }}>
                                    {acct.accountName}{acct.mask ? ` ···· ${acct.mask}` : ""}
                                  </div>
                                  <button
                                    onClick={() => { setEditingNameId(acct.id); setEditNameValue(acct.accountName); }}
                                    style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "11px", fontFamily: font, padding: "1px 4px" }}
                                    title="Rename this account"
                                  >
                                    Rename
                                  </button>
                                </div>
                              )}
                              {acct.createdAt && (
                                <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                                  Connected {acct.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </div>
                              )}
                              {rs?.result && (
                                <div style={{ fontSize: "11px", color: "#16A34A", marginTop: "2px" }}>✓ {rs.result}</div>
                              )}
                              {confirmReimportId !== acct.id && !rs?.loading && (
                                <button
                                  onClick={() => setConfirmReimportId(acct.id)}
                                  style={{ background: "none", border: "none", padding: 0, marginTop: "2px", fontSize: "11px", color: "#9ca3af", cursor: "pointer", fontFamily: font, textDecoration: "underline", textUnderlineOffset: "2px", display: "block" }}
                                >
                                  Delete &amp; Re-sync
                                </button>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                              <label style={{ fontSize: "11px", color: "#9ca3af", whiteSpace: "nowrap" }}>From</label>
                              <input
                                type="date"
                                value={syncStartMap[acct.id] ?? defaultStartDate}
                                max={new Date().toISOString().split("T")[0]}
                                onChange={(e) => setSyncStartMap((prev) => ({ ...prev, [acct.id]: e.target.value }))}
                                disabled={rs?.loading}
                                style={{ padding: "4px 7px", borderRadius: "7px", border: "1px solid #d1d5db", fontSize: "11px", color: "#374151", fontFamily: font, backgroundColor: "#fff" }}
                              />
                            </div>
                            <button
                              onClick={() => handleRefresh(acct.id)}
                              disabled={rs?.loading}
                              style={{ padding: "6px 12px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: rs?.loading ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap", flexShrink: 0 }}
                            >
                              {rs?.loading ? "Syncing…" : "Sync"}
                            </button>
                            {confirmDeleteId === acct.id ? (
                              <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                <button onClick={() => handleDeleteAccount(acct.id)} disabled={deleting}
                                  style={{ padding: "6px 10px", backgroundColor: "#dc2626", color: "#fff", border: "none", borderRadius: "7px", fontSize: "11px", fontWeight: 600, cursor: deleting ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}>
                                  {deleting ? "Deleting…" : "Confirm"}
                                </button>
                                <button onClick={() => setConfirmDeleteId(null)} disabled={deleting}
                                  style={{ padding: "6px 8px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "7px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteId(acct.id)}
                                style={{ background: "none", border: "none", color: "#d1d5db", cursor: "pointer", fontSize: "13px", fontFamily: font, padding: "4px", flexShrink: 0 }}
                                title="Delete this account and all its transactions">
                                🗑
                              </button>
                            )}
                          </div>

                          {/* Re-import confirmation strip */}
                          {confirmReimportId === acct.id && (
                            <div style={{ margin: "0 20px 14px", padding: "12px 16px", backgroundColor: "#fef9ec", border: "1px solid #fde68a", borderRadius: "10px" }}>
                              <div style={{ fontSize: "12px", color: "#92400e", marginBottom: "10px" }}>
                                <strong>Delete &amp; Re-sync</strong> will remove all Plaid-imported transactions for this account and re-import them with corrected income/expense classification. This cannot be undone.
                              </div>
                              <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                  onClick={() => handleResetAndResync(acct.id)}
                                  disabled={reimporting}
                                  style={{ padding: "7px 16px", backgroundColor: "#d97706", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: reimporting ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                                >
                                  {reimporting ? "Working…" : "Delete & Re-sync"}
                                </button>
                                <button
                                  onClick={() => setConfirmReimportId(null)}
                                  disabled={reimporting}
                                  style={{ padding: "7px 12px", backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Linked imported accounts */}
                          {(linkedToThis.length > 0 || unlinkedImported.length > 0) && (
                            <div style={{ padding: "0 20px 14px", marginTop: "-4px" }}>
                              {linkedToThis.map((imp) => (
                                <div key={imp.id} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                                  <span style={{ fontSize: "11px", padding: "1px 7px", backgroundColor: "#f0fdf4", color: "#16A34A", borderRadius: "999px", fontWeight: 600 }}>✓ linked</span>
                                  <span style={{ fontSize: "12px", color: "#374151", flex: 1 }}>{importedLabel(imp)}</span>
                                  <button onClick={() => handleUnlink(imp.id)}
                                    style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "11px", fontFamily: font, padding: "1px 4px" }}>
                                    Unlink
                                  </button>
                                </div>
                              ))}
                              {unlinkedImported.length > 0 && (
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                                  <select
                                    value={selectedImport}
                                    onChange={(e) => setLinkSelections((prev) => ({ ...prev, [acct.id]: e.target.value }))}
                                    style={{ flex: 1, padding: "4px 7px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "11px", color: "#374151", fontFamily: font, outline: "none", backgroundColor: "#fff" }}
                                  >
                                    <option value="">Link an imported account…</option>
                                    {unlinkedImported.map((imp) => (
                                      <option key={imp.id} value={imp.id}>{importedLabel(imp)}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => handleLink(selectedImport, acct.id)}
                                    disabled={!selectedImport || linking.has(acct.id)}
                                    style={{ padding: "4px 12px", borderRadius: "6px", border: "none", backgroundColor: selectedImport && !linking.has(acct.id) ? "#16A34A" : "#d1d5db", color: "#fff", fontSize: "11px", fontWeight: 600, cursor: selectedImport && !linking.has(acct.id) ? "pointer" : "not-allowed", fontFamily: font, whiteSpace: "nowrap" }}>
                                    {linking.has(acct.id) ? "Linking…" : "Link"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}

                {/* Connect a different institution */}
                <button
                  onClick={handleConnectBank}
                  disabled={isWorking}
                  style={{ padding: "14px", backgroundColor: "transparent", color: "#16A34A", border: "2px dashed #86efac", borderRadius: "14px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font, marginTop: "4px" }}
                >
                  {isWorking ? "Initializing…" : "+ Connect Another Bank"}
                </button>
              </div>
            )}

            {/* ── Imported accounts ──────────────────────────────────────────── */}
            {importedAccounts.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "10px" }}>
                  Imported Accounts
                  <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: "8px" }}>CSV &amp; AI Parser</span>
                </div>
                {mergeResult && (
                  <div style={{ fontSize: "12px", color: "#15803d", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "8px 12px", marginBottom: "10px" }}>
                    ✓ {mergeResult}
                  </div>
                )}
                <div style={{ backgroundColor: "#fff", borderRadius: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  {importedAccounts.map((imp, i) => {
                    const linkedPlaid = imp.linkedPlaidAccountId
                      ? plaidAccounts.find((p) => p.id === imp.linkedPlaidAccountId)
                      : null;
                    const isMerging = mergeAccountId === imp.id;
                    return (
                      <div key={imp.id} style={{ borderBottom: i < importedAccounts.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                        <div
                          style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 20px" }}
                        >
                          <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", flexShrink: 0 }}>
                            {imp.accountType === "credit_card" ? "💳" : "🏦"}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{imp.name}</div>
                            {imp.last4 && (
                              <div style={{ fontSize: "11px", color: "#9ca3af" }}>···· {imp.last4}</div>
                            )}
                          </div>
                          {linkedPlaid ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>
                                → {linkedPlaid.institutionName} {linkedPlaid.accountName}
                              </span>
                              <button
                                onClick={() => handleUnlink(imp.id)}
                                style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "11px", fontFamily: font }}
                              >
                                Unlink
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: "11px", color: "#d1d5db" }}>Not linked to Plaid</span>
                          )}
                          {plaidAccounts.length > 0 && !isMerging && (
                            <button
                              onClick={() => handleOpenMerge(imp.id)}
                              style={{ padding: "4px 10px", backgroundColor: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                              title="Move all transactions to a Plaid account and delete this duplicate"
                            >
                              Merge…
                            </button>
                          )}
                        </div>

                        {isMerging && (
                          <div style={{ margin: "0 20px 14px", padding: "12px 14px", backgroundColor: "#fef9ec", border: "1px solid #fde68a", borderRadius: "10px" }}>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
                              Merge "{imp.name}" into a Plaid account
                            </div>
                            <div style={{ fontSize: "12px", color: "#78350f", marginBottom: "10px" }}>
                              {mergeCount === null
                                ? "Counting transactions…"
                                : <>
                                    <strong>{mergeCount}</strong> transaction{mergeCount !== 1 ? "s" : ""} will move to the selected Plaid account, and the "{imp.name}" account will be deleted. This cannot be undone.
                                  </>
                              }
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                              <label style={{ fontSize: "11px", color: "#78350f", whiteSpace: "nowrap" }}>Merge into:</label>
                              <select
                                value={mergeTargetId}
                                onChange={(e) => setMergeTargetId(e.target.value)}
                                disabled={merging}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: "7px", border: "1px solid #d1d5db", fontSize: "12px", color: "#374151", fontFamily: font, backgroundColor: "#fff" }}
                              >
                                <option value="">Select Plaid account…</option>
                                {plaidAccounts.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.institutionName} – {p.accountName}{p.mask ? ` ····${p.mask}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                              <button
                                onClick={handleConfirmMerge}
                                disabled={merging || !mergeTargetId || mergeCount === null}
                                style={{ padding: "7px 16px", backgroundColor: merging || !mergeTargetId ? "#fcd34d" : "#d97706", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: merging || !mergeTargetId ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                              >
                                {merging ? "Merging…" : "Confirm Merge"}
                              </button>
                              <button
                                onClick={handleCancelMerge}
                                disabled={merging}
                                style={{ padding: "7px 12px", backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Data Tools ───────────────────────────────────────────────── */}
        <div style={{ marginTop: "32px", padding: "16px 20px", backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "6px" }}>Data Tools</div>
          <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px" }}>
            Remove transactions left behind from deleted bank connections. Run this after removing a connection to clean up stale data.
          </div>
          {orphanResult && (
            <div style={{ fontSize: "12px", color: "#15803d", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "8px 12px", marginBottom: "10px" }}>
              ✓ {orphanResult}
            </div>
          )}
          <button
            onClick={handleCleanOrphans}
            disabled={cleaningOrphans}
            style={{ padding: "7px 16px", backgroundColor: cleaningOrphans ? "#f3f4f6" : "#f9fafb", color: cleaningOrphans ? "#9ca3af" : "#374151", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: cleaningOrphans ? "default" : "pointer", fontFamily: font }}
          >
            {cleaningOrphans ? "Scanning…" : "Clean Up Orphaned Transactions"}
          </button>

          {/* Migrate text-only account labels into real account docs */}
          <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #f3f4f6" }}>
            <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "12px" }}>
              Some accounts only exist as text labels on transactions (typed via the Review or Import History pages) and can't be linked to Plaid. Migrate them to real accounts so they appear under Imported Accounts and can be linked.
            </div>
            {migrateResult && (
              <div style={{ fontSize: "12px", color: "#15803d", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", padding: "8px 12px", marginBottom: "10px" }}>
                ✓ {migrateResult}
              </div>
            )}
            {migratePreview ? (
              <div style={{ padding: "12px 14px", backgroundColor: "#fef9ec", border: "1px solid #fde68a", borderRadius: "10px", marginBottom: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#92400e", marginBottom: "8px" }}>
                  Found {migratePreview.length} text-only account label{migratePreview.length !== 1 ? "s" : ""}:
                </div>
                <ul style={{ margin: "0 0 12px", padding: "0 0 0 18px", fontSize: "12px", color: "#78350f" }}>
                  {migratePreview.map((entry) => (
                    <li key={entry.name} style={{ marginBottom: "3px" }}>
                      <strong>{entry.name}</strong> — {entry.count} transaction{entry.count !== 1 ? "s" : ""}
                      {entry.existingAccountId && (
                        <span style={{ color: "#a16207", marginLeft: "6px" }}>(will reuse existing account)</span>
                      )}
                    </li>
                  ))}
                </ul>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={handleApplyMigration}
                    disabled={migrating}
                    style={{ padding: "7px 16px", backgroundColor: "#d97706", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: migrating ? "default" : "pointer", fontFamily: font, whiteSpace: "nowrap" }}
                  >
                    {migrating ? "Migrating…" : "Apply Migration"}
                  </button>
                  <button
                    onClick={() => { setMigratePreview(null); setMigrateResult(null); }}
                    disabled={migrating}
                    style={{ padding: "7px 12px", backgroundColor: "transparent", color: "#6b7280", border: "1px solid #d1d5db", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleScanMigration}
                disabled={scanningMigration}
                style={{ padding: "7px 16px", backgroundColor: scanningMigration ? "#f3f4f6" : "#f9fafb", color: scanningMigration ? "#9ca3af" : "#374151", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: scanningMigration ? "default" : "pointer", fontFamily: font }}
              >
                {scanningMigration ? "Scanning…" : "Find Text-Only Accounts"}
              </button>
            )}
          </div>
        </div>

        <p style={{ fontSize: "11px", color: "#9ca3af", textAlign: "center", marginTop: "20px" }}>
          Bank connections are powered by Plaid. Your credentials are never stored on our servers.
        </p>
      </div>
    </div>
  );
}
