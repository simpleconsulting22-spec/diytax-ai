import React, { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, getDocs, orderBy, limit, getDoc, doc, writeBatch, addDoc, serverTimestamp } from "firebase/firestore";
import { CheckCircle2, FolderOpen, ChevronRight, Trash2 } from "lucide-react";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { findOrCreateAccountByName } from "../../services/accountService";
import CSVPreviewTable from "./components/CSVPreviewTable";
import { useCSVImport } from "./hooks/useCSVImport";
import AppNav from "../../components/AppNav";

interface AccountOption {
  id:           string;
  name:         string;
  accountType?: string;
  institutionName?: string;
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Template download ────────────────────────────────────────────────────────

const TEMPLATE_ROWS = [
  ["Date", "Description", "Amount", "Account"],
  ["2025-01-15", "Grocery Store", "-45.23", "Checking"],
  ["2025-01-16", "Direct Deposit Payroll", "2500.00", "Checking"],
  ["2025-01-17", "Electric Company", "-89.50", "Checking"],
  ["2025-01-20", "Office Supplies", "-32.00", "Business Checking"],
  ["2025-01-22", "Client Payment", "1200.00", "Business Checking"],
];

function downloadTemplate() {
  const csv = TEMPLATE_ROWS.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "diytax-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Import history ───────────────────────────────────────────────────────────

interface ImportRecord {
  id: string;
  fileName: string;
  importedCount: number;
  skippedCount: number;
  createdAt: { seconds: number } | null;
  source?: string;
}

function useImportHistory(refreshKey: number) {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const [history, setHistory] = useState<ImportRecord[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "imports"),
          where("userId", "==", ownerUid),
          orderBy("createdAt", "desc"),
          limit(100)
        )
      );
      setHistory(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImportRecord))
      );
    } catch {
      // index may not exist yet — fail silently
    }
  }, [user, ownerUid]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return history;
}

function fmtDate(record: ImportRecord): string {
  if (!record.createdAt) return "";
  return new Date(record.createdAt.seconds * 1000).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Import expansion ─────────────────────────────────────────────────────────

interface TxnRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  accountName: string | null; // resolved from accountId or raw accountName
  hasAccountId: boolean;
}

interface Expansion {
  txns: TxnRow[];
  loading: boolean;
  applying: boolean;
  input: string;        // current value of the "set account" text box
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImportCSVPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const { state, handleFileChange, handleFlipSign, handleAccountTypeChange, handleImport, resetImport, deleteImport, updateRowType } = useCSVImport();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { fileName, parseError, rows, importing, importError, importResult, flipSign, signWarning, accountType } = state;

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const importHistory = useImportHistory(historyRefreshKey);

  // Required account selector (replaces optional account-name text input).
  // The unified backend pipeline requires accountId on every ingest.
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [newAccountName, setNewAccountName] = useState<string>("");

  const loadAccounts = useCallback(async () => {
    if (!ownerUid) return;
    const snap = await getDocs(query(collection(db, "accounts"), where("uid", "==", ownerUid)));
    const opts: AccountOption[] = snap.docs.map((d) => {
      const data = d.data();
      return {
        id:              d.id,
        name:            (data.name as string) ?? "(unnamed)",
        accountType:     data.accountType as string | undefined,
        institutionName: data.institutionName as string | undefined,
      };
    });
    opts.sort((a, b) => a.name.localeCompare(b.name));
    setAccounts(opts);
  }, [ownerUid]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  // ── Import expansion ───────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expansions, setExpansions] = useState<Map<string, Expansion>>(new Map());

  function setExpansion(importId: string, patch: Partial<Expansion>) {
    setExpansions((prev) => {
      const current = prev.get(importId) ?? { txns: [], loading: false, applying: false, input: "" };
      return new Map([...prev, [importId, { ...current, ...patch }]]);
    });
  }

  async function loadExpansion(importId: string) {
    const existing = expansions.get(importId);
    if ((existing?.txns.length ?? 0) > 0 || existing?.loading) return;
    setExpansion(importId, { loading: true });
    try {
      const snap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("importId", "==", importId)
        )
      );

      // Collect distinct accountIds to resolve names
      const accountIdSet = new Set<string>();
      snap.docs.forEach((d) => {
        const aid = d.data().accountId as string | null;
        if (aid) accountIdSet.add(aid);
      });

      const accountNameMap = new Map<string, string>();
      await Promise.all(
        [...accountIdSet].map(async (aid) => {
          const accDoc = await getDoc(doc(db, "accounts", aid));
          if (!accDoc.exists()) return;
          const data = accDoc.data();
          const display = (data.name as string)
            ?? (data.accountName as string)
            ?? "";
          if (display) accountNameMap.set(aid, display);
        })
      );

      const txns: TxnRow[] = snap.docs.map((d) => {
        const data = d.data();
        const accountId = data.accountId as string | null;
        const rawAccountName = (data.accountName as string) ?? null;
        const resolvedAccount = rawAccountName?.trim()
          ? rawAccountName
          : accountId
          ? (accountNameMap.get(accountId) ?? null)
          : null;
        return {
          id: d.id,
          date: data.date as string,
          description: data.description as string,
          amount: data.amount as number,
          type: data.type as string,
          accountName: resolvedAccount,
          hasAccountId: !!accountId,
        };
      });

      txns.sort((a, b) => a.date.localeCompare(b.date));

      // Pre-fill input with existing account name if consistent across all
      const names = [...new Set(txns.map((t) => t.accountName).filter(Boolean))];
      const prefill = names.length === 1 ? names[0]! : "";

      setExpansion(importId, { txns, loading: false, input: prefill });
    } catch {
      setExpansion(importId, { loading: false });
    }
  }

  async function applyAccountName(importId: string) {
    const exp = expansions.get(importId);
    const name = exp?.input.trim();
    if (!name || !ownerUid || !exp) return;
    setExpansion(importId, { applying: true });
    try {
      const { id: accountId } = await findOrCreateAccountByName(ownerUid, name);
      const ids = exp.txns.map((t) => t.id);
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        ids.slice(i, i + 499).forEach((id) =>
          batch.update(doc(db, "transactions", id), { accountName: name, accountId })
        );
        await batch.commit();
      }
      // Update local state so the panel reflects the change immediately
      setExpansion(importId, {
        applying: false,
        txns: exp.txns.map((t) => ({ ...t, accountName: name, hasAccountId: true })),
        input: name,
      });
    } catch {
      setExpansion(importId, { applying: false });
    }
  }

  function toggleExpand(importId: string) {
    if (expandedId === importId) {
      setExpandedId(null);
    } else {
      setExpandedId(importId);
      loadExpansion(importId);
    }
  }

  // Refresh history after a successful import
  useEffect(() => {
    if (importResult) setHistoryRefreshKey((k) => k + 1);
  }, [importResult]);

  const hasParsed = rows.length > 0;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      {/* Content */}
      <div style={{ maxWidth: hasParsed ? "820px" : "560px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Page header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#111827", margin: 0 }}>Import CSV</h1>
            <p style={{ color: "#6b7280", margin: "6px 0 0", fontSize: "14px" }}>
              Upload a bank or credit card export — you can import multiple files
            </p>
          </div>
          <button
            onClick={downloadTemplate}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "9px 16px", backgroundColor: "#f0fdf4", color: "#16A34A",
              border: "1.5px solid #bbf7d0", borderRadius: "8px",
              fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font,
              whiteSpace: "nowrap",
            }}
          >
            ⬇ Download Template
          </button>
        </div>

        {/* ── Success state ──────────────────────────────────────────────── */}
        {importResult && (
          <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "14px", padding: "28px 32px", marginBottom: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <CheckCircle2 size={32} strokeWidth={2} color="#16A34A" />
              <div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "#166534" }}>Import complete</div>
                <div style={{ fontSize: "13px", color: "#4ade80", marginTop: "2px" }}>{importResult.fileName}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "24px", marginBottom: "20px" }}>
              {[
                { label: "Imported", value: importResult.importedCount, color: "#16A34A" },
                { label: "Transfers (excluded)", value: importResult.transferCount, color: "#6b7280" },
                { label: "Duplicates skipped", value: importResult.duplicateCount, color: "#6b7280" },
                { label: "Rows with errors", value: importResult.skippedCount, color: importResult.skippedCount > 0 ? "#d97706" : "#6b7280" },
              ].map((stat) => (
                <div key={stat.label}>
                  <div style={{ fontSize: "22px", fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{stat.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => { resetImport(); setSelectedAccountId(""); setNewAccountName(""); }}
                style={{ padding: "10px 20px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
              >
                Import Another File
              </button>
              <button
                onClick={() => navigate("/review")}
                style={{ padding: "10px 20px", backgroundColor: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
              >
                Review Transactions →
              </button>
            </div>
          </div>
        )}

        {/* ── Upload card ────────────────────────────────────────────────── */}
        {!importResult && (
          <div style={{ backgroundColor: "#fff", borderRadius: "16px", padding: "32px 36px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", marginBottom: "28px" }}>
            {/* Account type selector */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "10px" }}>
                Account type
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                {(["bank", "credit_card"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => handleAccountTypeChange(type)}
                    style={{
                      padding: "8px 18px",
                      borderRadius: "8px",
                      border: accountType === type ? "2px solid #16A34A" : "1.5px solid #d1d5db",
                      backgroundColor: accountType === type ? "#f0fdf4" : "#fff",
                      color: accountType === type ? "#166534" : "#374151",
                      fontWeight: 600,
                      fontSize: "13px",
                      cursor: "pointer",
                      fontFamily: font,
                    }}
                  >
                    {type === "bank" ? "🏦 Bank / Checking / Savings" : "💳 Credit Card"}
                  </button>
                ))}
              </div>
              {accountType === "credit_card" && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>
                  Credit card mode: charges are expenses, payments to the card are transfers, credits are refunds.
                </div>
              )}
            </div>

            {/* Drop zone */}
            <div style={{ marginBottom: hasParsed ? "28px" : "0" }}>
              <div
                style={{ border: "2px dashed #d1d5db", borderRadius: "12px", padding: "32px 24px", textAlign: "center", backgroundColor: "#fafafa", cursor: "pointer" }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div style={{ marginBottom: "10px", display: "flex", justifyContent: "center", color: "#9ca3af" }}>
                  <FolderOpen size={36} strokeWidth={1.6} />
                </div>
                <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
                  {fileName || "Choose a CSV file"}
                </div>
                <div style={{ fontSize: "13px", color: "#9ca3af" }}>
                  {fileName ? "Click to change file" : "Supports exports from most banks and credit cards"}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => {
                  handleFileChange(e.target.files?.[0] ?? null);
                  e.target.value = "";        // allow re-selecting same file
                }}
              />

              {fileName && !hasParsed && !parseError && (
                <div style={{ marginTop: "12px", padding: "12px 16px", backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", fontSize: "14px", color: "#166534" }}>
                  Parsing <strong>{fileName}</strong>…
                </div>
              )}

              {parseError && (
                <div style={{ marginTop: "12px", padding: "12px 16px", backgroundColor: "#fef2f2", borderRadius: "8px", border: "1px solid #fecaca", fontSize: "14px", color: "#dc2626" }}>
                  {parseError}
                </div>
              )}
            </div>

            {/* Preview + import */}
            {hasParsed && (
              <>
                <CSVPreviewTable rows={rows} totalCount={rows.length} onTypeChange={updateRowType} />

                {/* Sign-convention warning (auto-detected, bank mode only) */}
                <div style={{ marginTop: "16px" }}>
                  {accountType === "bank" && signWarning && !flipSign && (
                    <div style={{
                      padding: "12px 16px",
                      backgroundColor: "#fff7ed",
                      border: "1px solid #fed7aa",
                      borderRadius: "8px",
                      fontSize: "13px",
                      color: "#92400e",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                    }}>
                      <span>
                        ⚠ <strong>Sign convention detected:</strong> Most charges appear as positive amounts — this is typical of American Express exports. Expenses may be showing as income.
                      </span>
                      <button
                        onClick={handleFlipSign}
                        style={{
                          padding: "6px 14px",
                          backgroundColor: "#f97316",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: font,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        Flip signs →
                      </button>
                    </div>
                  )}

                  {/* Manual flip toggle — only for bank accounts */}
                  {accountType === "bank" && (
                    <div style={{
                      marginTop: signWarning && !flipSign ? "8px" : "0",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      fontSize: "12px",
                      color: "#6b7280",
                    }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={flipSign}
                          onChange={handleFlipSign}
                          style={{ cursor: "pointer" }}
                        />
                        Flip sign convention (charges are positive, e.g. some bank exports)
                      </label>
                    </div>
                  )}
                </div>

                {/* Required account selector */}
                <div style={{ marginTop: "20px" }}>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                    Account <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid #d1d5db",
                      fontSize: "13px",
                      color: "#374151",
                      fontFamily: font,
                      outline: "none",
                      boxSizing: "border-box",
                      backgroundColor: "#fff",
                    }}
                  >
                    <option value="">— Select account —</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name}{acc.institutionName ? ` (${acc.institutionName})` : ""}
                      </option>
                    ))}
                    <option value="__new__">+ Create new account…</option>
                  </select>

                  {selectedAccountId === "__new__" && (
                    <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={newAccountName}
                        onChange={(e) => setNewAccountName(e.target.value)}
                        placeholder="New account name (e.g. Chase Checking, Amex Gold)"
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "8px",
                          border: "1px solid #d1d5db",
                          fontSize: "13px",
                          color: "#374151",
                          fontFamily: font,
                          outline: "none",
                          boxSizing: "border-box",
                        }}
                      />
                      <button
                        onClick={async () => {
                          const name = newAccountName.trim();
                          if (!name || !ownerUid) return;
                          const docRef = await addDoc(collection(db, "accounts"), {
                            uid:         ownerUid,
                            name,
                            accountType,
                            createdAt:   serverTimestamp(),
                          });
                          await loadAccounts();
                          setSelectedAccountId(docRef.id);
                          setNewAccountName("");
                        }}
                        disabled={!newAccountName.trim()}
                        style={{
                          padding: "8px 14px",
                          backgroundColor: newAccountName.trim() ? "#16A34A" : "#d1d5db",
                          color: "#fff",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: newAccountName.trim() ? "pointer" : "not-allowed",
                          fontFamily: font,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Create
                      </button>
                    </div>
                  )}

                  <div style={{ marginTop: "4px", fontSize: "12px", color: "#9ca3af" }}>
                    Every CSV import must be assigned to one account.
                  </div>
                </div>

                <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
                  <button
                    onClick={() => handleImport(selectedAccountId)}
                    disabled={importing || !selectedAccountId || selectedAccountId === "__new__"}
                    style={{ flex: 1, padding: "14px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 600, cursor: (importing || !selectedAccountId || selectedAccountId === "__new__") ? "not-allowed" : "pointer", opacity: (importing || !selectedAccountId || selectedAccountId === "__new__") ? 0.55 : 1, fontFamily: font }}
                  >
                    {importing
                      ? `Importing ${rows.length} transaction${rows.length !== 1 ? "s" : ""}…`
                      : `Import ${rows.length} transaction${rows.length !== 1 ? "s" : ""}`}
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={importing}
                    style={{ padding: "14px 20px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "10px", fontSize: "15px", fontWeight: 600, cursor: importing ? "not-allowed" : "pointer", fontFamily: font }}
                  >
                    Change file
                  </button>
                </div>

                {importError && (
                  <div style={{ color: "#dc2626", fontSize: "14px", marginTop: "12px" }}>{importError}</div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Column hint / template info ────────────────────────────────── */}
        {!hasParsed && !importResult && (
          <div style={{ fontSize: "12px", color: "#9ca3af", lineHeight: 1.7, marginBottom: "32px" }}>
            <strong>Expected columns:</strong> Date, Description, Amount, Account (optional).<br />
            <strong>Bank:</strong> negative amounts = expenses, positive = income.<br />
            <strong>Credit card:</strong> charges are expenses, payments/autopay = transfers, credits = refunds.<br />
            Duplicate transactions are automatically detected and skipped.
          </div>
        )}

        {/* ── Import history ──────────────────────────────────────────────── */}
        {importHistory.length > 0 && (
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #e5e7eb", fontWeight: 700, fontSize: "14px", color: "#111827" }}>
              Import History
            </div>
            {importHistory.map((record) => {
              const exp = expansions.get(record.id);
              const isExpanded = expandedId === record.id;
              const withAccount = exp?.txns.filter((t) => t.accountName).length ?? 0;
              const withoutAccount = (exp?.txns.length ?? 0) - withAccount;

              return (
                <div key={record.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  {/* ── Row header ── */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", fontSize: "14px" }}>
                    <div
                      onClick={() => toggleExpand(record.id)}
                      style={{ cursor: "pointer", flex: 1 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ color: "#9ca3af", transition: "transform 0.15s", display: "inline-flex", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                          <ChevronRight size={14} strokeWidth={2.4} />
                        </span>
                        <span style={{ fontWeight: 500, color: "#111827" }}>{record.fileName}</span>
                        {record.source === "ai_parser" && (
                          <span style={{ fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "999px", backgroundColor: "#eff6ff", color: "#1d4ed8", whiteSpace: "nowrap" }}>AI Parser</span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px", paddingLeft: "18px" }}>{fmtDate(record)}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontWeight: 600, color: "#16A34A" }}>{record.importedCount} imported</span>
                        {record.skippedCount > 0 && (
                          <span style={{ color: "#9ca3af", marginLeft: "10px" }}>{record.skippedCount} skipped</span>
                        )}
                      </div>
                      {deletingId === record.id ? (
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={async () => {
                              await deleteImport(record.id);
                              setDeletingId(null);
                              setHistoryRefreshKey((k) => k + 1);
                            }}
                            style={{ padding: "5px 12px", backgroundColor: "#dc2626", color: "#fff", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                          >
                            Confirm Delete
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            style={{ padding: "5px 10px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeletingId(record.id)}
                          style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "13px", fontFamily: font, padding: "4px 8px", borderRadius: "4px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                          title="Delete import"
                        >
                          <Trash2 size={14} strokeWidth={2} /> Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── Expanded panel ── */}
                  {isExpanded && (
                    <div style={{ borderTop: "1px solid #f3f4f6", backgroundColor: "#f9fafb", padding: "16px 24px" }}>
                      {exp?.loading ? (
                        <div style={{ fontSize: "13px", color: "#9ca3af" }}>Loading transactions…</div>
                      ) : exp && exp.txns.length > 0 ? (
                        <>
                          {/* Summary + set account */}
                          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "14px", flexWrap: "wrap" }}>
                            <div style={{ fontSize: "13px", color: "#374151" }}>
                              <strong>{exp.txns.length}</strong> transactions —{" "}
                              {withoutAccount > 0 ? (
                                <span style={{ color: "#d97706", fontWeight: 600 }}>{withoutAccount} have no account name</span>
                              ) : (
                                <span style={{ color: "#16A34A", fontWeight: 600 }}>all have account names ✓</span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                              <span style={{ fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap" }}>Set account for all:</span>
                              <input
                                type="text"
                                value={exp.input}
                                onChange={(e) => setExpansion(record.id, { input: e.target.value })}
                                placeholder="e.g. Chase Checking"
                                style={{
                                  padding: "5px 10px",
                                  borderRadius: "6px",
                                  border: "1px solid #d1d5db",
                                  fontSize: "12px",
                                  fontFamily: font,
                                  outline: "none",
                                  width: "160px",
                                }}
                              />
                              <button
                                onClick={() => applyAccountName(record.id)}
                                disabled={!exp.input.trim() || exp.applying}
                                style={{
                                  padding: "5px 14px",
                                  backgroundColor: exp.input.trim() && !exp.applying ? "#16A34A" : "#d1d5db",
                                  color: "#fff",
                                  border: "none",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  cursor: exp.input.trim() && !exp.applying ? "pointer" : "not-allowed",
                                  fontFamily: font,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {exp.applying ? "Applying…" : "Apply to all"}
                              </button>
                            </div>
                          </div>

                          {/* Transaction mini-table */}
                          <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid #e5e7eb", backgroundColor: "#fff" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                              <thead>
                                <tr style={{ backgroundColor: "#f9fafb" }}>
                                  {["Date", "Description", "Amount", "Account"].map((h) => (
                                    <th key={h} style={{ padding: "7px 10px", textAlign: h === "Amount" ? "right" : "left", fontWeight: 600, color: "#6b7280", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {exp.txns.slice(0, 50).map((t, i) => (
                                  <tr key={t.id} style={{ borderBottom: "1px solid #f3f4f6", backgroundColor: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                                    <td style={{ padding: "6px 10px", color: "#9ca3af", whiteSpace: "nowrap" }}>{t.date}</td>
                                    <td style={{ padding: "6px 10px", color: "#111827", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</td>
                                    <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap", color: t.type === "expense" ? "#dc2626" : t.type === "transfer" ? "#9ca3af" : "#16A34A" }}>
                                      {t.type === "expense" ? "−" : t.type === "transfer" ? "" : "+"}${Math.abs(t.amount ?? 0).toFixed(2)}
                                    </td>
                                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>
                                      {t.accountName ? (
                                        <span style={{ color: "#374151" }}>{t.accountName}</span>
                                      ) : (
                                        <span style={{ color: "#d1d5db" }}>—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {exp.txns.length > 50 && (
                              <div style={{ padding: "8px 12px", fontSize: "12px", color: "#9ca3af", borderTop: "1px solid #f3f4f6", textAlign: "center" }}>
                                Showing 50 of {exp.txns.length} — <span style={{ color: "#3b82f6", cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/review")}>view all on Review page</span>
                              </div>
                            )}
                          </div>
                        </>
                      ) : (
                        <div style={{ fontSize: "13px", color: "#9ca3af" }}>No transactions found for this import.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
