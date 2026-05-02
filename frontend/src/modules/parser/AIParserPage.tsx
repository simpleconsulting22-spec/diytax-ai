import React, { useState, useRef, useCallback, useEffect } from "react";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { Camera } from "lucide-react";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { apiClient } from "../../services/apiClient";
import AppNav from "../../components/AppNav";
import { extractVendor, normalize } from "../import/hooks/useCSVImport";
import { track } from "../../lib/telemetry";

type PendingPatternPrompt = {
  vendor:        string;
  type:          "expense" | "income" | "transfer";
  affectedCount: number;
} | null;

interface AccountOption {
  id:           string;
  name:         string;       // raw "name" field — used by CSV download fallback
  displayName:  string;       // human-readable display
}

interface IngestReportLite {
  total:    number;
  imported: number;
  skipped:  number;
  errors:   string[];
  importId: string | null;
}

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface ParsedRow {
  id:          string;
  date:        string;
  description: string;
  amount:      number;
  type:        "expense" | "income" | "refund" | "transfer";
  direction?:  "outflow" | "inflow";
  // AI's self-assessed parse quality (separate from the backend classifier's
  // own confidence — these reflect the AI parse step only).
  confidence:  "high" | "medium" | "low";
  reasoning:   string;
}

// Resize image to max 2048px and return {base64, mimeType}
async function prepareImage(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const MAX = 2048;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.src = URL.createObjectURL(file);
  });
}

function downloadCSV(rows: ParsedRow[], accountName: string) {
  const header = ["Date", "Description", "Amount", "Type", "Account"];
  const safeAccount = accountName || "parsed";
  const lines  = rows.map((r) =>
    [r.date, `"${r.description.replace(/"/g, '""')}"`, r.amount.toFixed(2), r.type, `"${safeAccount}"`].join(",")
  );
  const csv  = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `transactions-${safeAccount}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AIParserPage() {
  const { user }         = useAuth();
  const { selectedYear } = useTaxYear();
  const ownerUid         = user?.uid ?? "";

  const [mode, setMode]             = useState<"text" | "image">("text");
  const [textContent, setTextContent] = useState("");
  const [imageFile, setImageFile]   = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [parsing, setParsing]       = useState(false);
  const [importing, setImporting]   = useState(false);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [rows, setRows]             = useState<ParsedRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Required account selector — backend ingestTransactions requires an accountId.
  const [accounts, setAccounts]               = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [newAccountName, setNewAccountName]   = useState<string>("");

  const loadAccounts = useCallback(async () => {
    if (!ownerUid) return;
    const snap = await getDocs(query(collection(db, "accounts"), where("uid", "==", ownerUid)));
    const opts: AccountOption[] = snap.docs.map((d) => {
      const data = d.data();
      const institutionName = data.institutionName as string | undefined;
      const accountName     = data.accountName     as string | undefined;
      const mask            = data.mask            as string | undefined;
      const rawName         = data.name            as string | undefined;

      let displayName: string;
      if (institutionName) {
        const label = accountName?.trim() || rawName?.trim() || "Account";
        const tail  = mask ? ` ····${mask}` : "";
        displayName = `${institutionName} – ${label}${tail}`;
      } else {
        displayName = rawName?.trim() || "(unnamed account)";
      }

      return { id: d.id, name: rawName?.trim() || displayName, displayName };
    });
    opts.sort((a, b) => a.displayName.localeCompare(b.displayName));
    setAccounts(opts);
  }, [ownerUid]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const handleImageDrop = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) { setError("Please upload an image file (PNG, JPG, WEBP)."); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setError(null);
  }, []);

  async function handleParse() {
    setError(null);
    setImportCount(null);
    if (mode === "text" && !textContent.trim()) { setError("Paste your bank statement text first."); return; }
    if (mode === "image" && !imageFile)          { setError("Upload a screenshot first."); return; }
    setParsing(true);
    try {
      let payload: Record<string, unknown>;
      if (mode === "text") {
        payload = { type: "text", content: textContent };
      } else {
        const { base64, mimeType } = await prepareImage(imageFile!);
        payload = { type: "image", imageBase64: base64, mimeType };
      }
      const res = await apiClient.call<{ transactions: Omit<ParsedRow, "id">[] }>(
        "parseFinancialData", payload
      );
      setRows(
        res.transactions.map((t, i) => ({ ...t, id: `row_${Date.now()}_${i}` }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parsing failed. Please try again.");
    } finally {
      setParsing(false);
    }
  }

  const [cascadeMessage, setCascadeMessage] = useState<string>("");

  // Auto-dismiss cascade banner after 4s.
  useEffect(() => {
    if (!cascadeMessage) return;
    const t = setTimeout(() => setCascadeMessage(""), 4000);
    return () => clearTimeout(t);
  }, [cascadeMessage]);

  // Per-vendor correction history for pattern-based learning. Refunds are
  // intentionally excluded from this map — they're per-transaction by nature
  // and never trigger cascades or rules.
  const correctionHistoryRef = useRef<Map<string, {
    type:    "expense" | "income" | "transfer";
    rowIds:  Set<string>;
  }>>(new Map());

  // Reset history each time a fresh parse populates rows.
  useEffect(() => {
    correctionHistoryRef.current.clear();
  }, [parsing]);

  // Pending prompt — shown after a 2nd matching non-refund edit. User must
  // explicitly click "Apply to all" or "Just these" before any cascade fires.
  const [pendingPatternPrompt, setPendingPatternPrompt] = useState<PendingPatternPrompt>(null);

  function updateRow(id: string, field: keyof ParsedRow, value: string | number) {
    if (field !== "type") {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
      return;
    }

    const newType = value as ParsedRow["type"];
    track("type_selected", { type: newType });

    // ── Refunds: ALWAYS single-row, never learn ────────────────────────
    if (newType === "refund") {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, type: "refund" } : r)),
      );
      setCascadeMessage(
        "Refunds are applied per transaction and won't be applied to other transactions.",
      );
      setPendingPatternPrompt(null);   // any pending prompt is cleared
      return;
    }

    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (!target) return prev;

      const targetVendor = extractVendor(normalize(target.description));
      const promotableType = newType as "expense" | "income" | "transfer";

      const prior = correctionHistoryRef.current.get(targetVendor);
      const sameAsPrior = !!prior && prior.type === promotableType;
      const isSecondMatch = !!prior && sameAsPrior && !prior.rowIds.has(id);

      if (!prior || !sameAsPrior) {
        correctionHistoryRef.current.set(targetVendor, {
          type:   promotableType,
          rowIds: new Set([id]),
        });
      } else {
        prior.rowIds.add(id);
      }

      // Apply ONLY the clicked row.
      const updated = prev.map((r) =>
        r.id === id ? { ...r, type: promotableType } : r,
      );

      // Compute affected count for the prompt (rows with same vendor that
      // don't already match the target type).
      const affectedCount = updated.reduce((acc, r) => {
        if (r.id === id) return acc;
        const sameVendor =
          targetVendor && extractVendor(normalize(r.description)) === targetVendor;
        if (!sameVendor) return acc;
        if (r.type === promotableType) return acc;
        return acc + 1;
      }, 0);

      // Manage the pending prompt outside this updater.
      setPendingPatternPrompt((current) => {
        // If a prompt is showing for a different vendor/type, the user has
        // moved on — implicit decline.
        let next = current;
        if (
          current &&
          (current.vendor !== targetVendor || current.type !== promotableType)
        ) {
          track("pattern_prompt_declined", {
            vendor: current.vendor, type: current.type, implicit: true,
          });
          next = null;
        }
        if (isSecondMatch && affectedCount > 0) {
          next = { vendor: targetVendor, type: promotableType, affectedCount };
          track("pattern_prompt_shown", {
            vendor: targetVendor, type: promotableType, count: affectedCount,
          });
        }
        return next;
      });

      return updated;
    });
  }

  function acceptPatternPrompt() {
    setPendingPatternPrompt((prompt) => {
      if (!prompt) return null;
      track("pattern_prompt_applied", { vendor: prompt.vendor, type: prompt.type });

      let cascadeCount = 0;
      setRows((prev) => prev.map((r) => {
        const sameVendor = extractVendor(normalize(r.description)) === prompt.vendor;
        if (!sameVendor) return r;
        if (r.type === prompt.type) return r;
        cascadeCount++;
        return { ...r, type: prompt.type };
      }));
      setCascadeMessage(
        cascadeCount > 0
          ? `Applied "${prompt.type}" to ${cascadeCount} other "${prompt.vendor}" row${cascadeCount !== 1 ? "s" : ""}.`
          : `No additional rows changed.`,
      );
      return null;
    });
  }

  function dismissPatternPrompt() {
    setPendingPatternPrompt((prompt) => {
      if (prompt) {
        track("pattern_prompt_declined", { vendor: prompt.vendor, type: prompt.type });
      }
      return null;
    });
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleImport() {
    if (rows.length === 0) return;
    if (!selectedAccountId || selectedAccountId === "__new__") {
      setError("Please select an account before importing.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const transactions = rows.map((row) => ({
        date:        row.date,
        description: row.description,
        amount:      Math.abs(row.amount),
        type:        row.type,
        // Direction only meaningful for transfers — backend ignores it for
        // other types and falls back to needs_review when missing on a transfer.
        ...(row.type === "transfer" && row.direction ? { direction: row.direction } : {}),
        // AI's self-assessed quality — saved to Firestore as aiConfidence /
        // aiReasoning on the transaction doc.
        confidence:  row.confidence,
        reasoning:   row.reasoning,
      }));
      const label = `[AI] ${selectedAccount?.name ?? "Imported"}`;
      const report = await apiClient.call<IngestReportLite>("ingestTransactions", {
        source:       "ai",
        accountId:    selectedAccountId,
        transactions,
        importLabel:  label,
      });
      setImportCount(report.imported);
      setRows([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const inputBase: React.CSSProperties = {
    border: "1px solid #d1d5db", borderRadius: "8px", padding: "8px 10px",
    fontSize: "13px", fontFamily: font, color: "#111827", backgroundColor: "#fff",
    outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 24px" }}>
        {/* Header */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
            AI Transaction Parser
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", margin: 0 }}>
            Paste any bank statement or upload a screenshot — AI extracts and normalizes every transaction.
          </p>
        </div>

        {/* Account + year row */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 260px" }}>
            <label style={{ fontSize: "12px", fontWeight: 600, color: "#374151", display: "block", marginBottom: "4px" }}>
              Account <span style={{ color: "#dc2626" }}>*</span>
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              style={{ ...inputBase, backgroundColor: "#fff" }}
            >
              <option value="">— Select account —</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.displayName}
                </option>
              ))}
              <option value="__new__">+ Create new account…</option>
            </select>

            {selectedAccountId === "__new__" && (
              <div style={{ marginTop: "8px", display: "flex", gap: "6px" }}>
                <input
                  style={{ ...inputBase, flex: 1 }}
                  placeholder="New account name"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                />
                <button
                  onClick={async () => {
                    const name = newAccountName.trim();
                    if (!name || !ownerUid) return;
                    const docRef = await addDoc(collection(db, "accounts"), {
                      uid:       ownerUid,
                      name,
                      createdAt: serverTimestamp(),
                    });
                    await loadAccounts();
                    setSelectedAccountId(docRef.id);
                    setNewAccountName("");
                  }}
                  disabled={!newAccountName.trim()}
                  style={{
                    padding: "6px 14px",
                    backgroundColor: newAccountName.trim() ? "#16A34A" : "#d1d5db",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "12px",
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
          </div>
          <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
            <span style={{ fontSize: "13px", color: "#6b7280", padding: "8px 0", display: "block" }}>
              Tax year: <strong style={{ color: "#111827" }}>{selectedYear}</strong>
            </span>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: "0", marginBottom: "16px", borderBottom: "2px solid #e5e7eb" }}>
          {(["text", "image"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); }}
              style={{
                background: "none", border: "none",
                borderBottom: mode === m ? "2px solid #16A34A" : "2px solid transparent",
                marginBottom: "-2px",
                padding: "10px 20px",
                fontSize: "14px",
                fontWeight: mode === m ? 700 : 400,
                color: mode === m ? "#16A34A" : "#6b7280",
                cursor: "pointer",
                fontFamily: font,
              }}
            >
              {m === "text" ? "📋 Paste Text" : "📷 Upload Screenshot"}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div style={{ marginBottom: "16px" }}>
          {mode === "text" ? (
            <textarea
              style={{
                ...inputBase,
                height: "200px",
                resize: "vertical",
                lineHeight: 1.5,
              }}
              placeholder={`Paste your bank statement here in any format. Examples:

01/15/2024  Amazon.com          -$45.99
01/16/2024  Payroll Deposit     +$3,200.00
Jan 17      Starbucks           4.75 Dr

Or paste a CSV, email, or any text containing transactions.`}
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
            />
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleImageDrop(file);
              }}
              style={{
                border: "2px dashed #d1d5db",
                borderRadius: "12px",
                padding: "32px",
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: "#fff",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#16A34A")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#d1d5db")}
            >
              {imagePreview ? (
                <div>
                  <img
                    src={imagePreview}
                    alt="Preview"
                    style={{ maxHeight: "200px", maxWidth: "100%", borderRadius: "8px", marginBottom: "10px" }}
                  />
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{imageFile?.name} — click to replace</div>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: "10px", display: "flex", justifyContent: "center", color: "#9ca3af" }}>
                    <Camera size={40} strokeWidth={1.6} />
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "4px" }}>
                    Drop screenshot here or click to browse
                  </div>
                  <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                    PNG, JPG, WEBP — screenshots of bank statements, PDFs, or account pages
                  </div>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageDrop(f); }}
              />
            </div>
          )}
        </div>

        {/* Parse button */}
        <button
          onClick={handleParse}
          disabled={parsing}
          style={{
            padding: "12px 28px",
            backgroundColor: parsing ? "#86efac" : "#16A34A",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: parsing ? "default" : "pointer",
            fontFamily: font,
            marginBottom: "24px",
          }}
        >
          {parsing ? "✦ AI is parsing…" : "✦ Parse with AI"}
        </button>

        {/* Error */}
        {error && (
          <div style={{ padding: "12px 16px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "13px", color: "#dc2626", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {/* Import success */}
        {importCount !== null && (
          <div style={{ padding: "14px 18px", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "10px", fontSize: "14px", color: "#15803d", marginBottom: "20px", fontWeight: 600 }}>
            ✓ {importCount} transactions imported — go to <a href="/review" style={{ color: "#16A34A" }}>Review</a> to categorize them.
          </div>
        )}

        {/* Cascade banner — shows when a type edit was propagated to similar rows */}
        {rows.length > 0 && cascadeMessage && (
          <div style={{
            marginBottom: "10px",
            padding: "10px 14px",
            backgroundColor: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            fontSize: "13px",
            color: "#1d4ed8",
            fontWeight: 500,
          }}>
            ✓ {cascadeMessage}
          </div>
        )}

        {/* Pattern-confirmation prompt — shown after a 2nd matching non-refund
           edit. User must explicitly opt into the cascade. */}
        {rows.length > 0 && pendingPatternPrompt && (
          <div style={{
            marginBottom: "10px",
            padding: "12px 16px",
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "10px",
            fontSize: "13px",
            color: "#78350f",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
          }}>
            <div style={{ flex: "1 1 320px" }}>
              <div style={{ fontWeight: 700, marginBottom: "2px" }}>
                Apply this change to similar transactions?
              </div>
              <div style={{ color: "#92400e" }}>
                You changed 2 &ldquo;{pendingPatternPrompt.vendor}&rdquo; transactions to{" "}
                <strong>{pendingPatternPrompt.type}</strong>. Apply this to the
                remaining {pendingPatternPrompt.affectedCount} similar transaction
                {pendingPatternPrompt.affectedCount !== 1 ? "s" : ""}?
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
              <button
                onClick={acceptPatternPrompt}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#16A34A",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: font,
                  whiteSpace: "nowrap",
                }}
              >
                Apply to all
              </button>
              <button
                onClick={dismissPatternPrompt}
                style={{
                  padding: "8px 16px",
                  backgroundColor: "#fff",
                  color: "#78350f",
                  border: "1px solid #fcd34d",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: font,
                  whiteSpace: "nowrap",
                }}
              >
                Just these
              </button>
            </div>
          </div>
        )}

        {/* Results table */}
        {rows.length > 0 && (
          <div style={{ backgroundColor: "#fff", borderRadius: "14px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", overflow: "hidden", marginBottom: "16px" }}>
            {/* Table header */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                {rows.length} transaction{rows.length !== 1 ? "s" : ""} parsed
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => downloadCSV(rows, selectedAccount?.name ?? "")}
                  style={{ padding: "6px 14px", backgroundColor: "#f3f4f6", color: "#374151", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
                >
                  Download CSV
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || !selectedAccountId || selectedAccountId === "__new__"}
                  style={{
                    padding: "6px 14px",
                    backgroundColor: (importing || !selectedAccountId || selectedAccountId === "__new__") ? "#86efac" : "#16A34A",
                    color: "#fff",
                    border: "none",
                    borderRadius: "7px",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: (importing || !selectedAccountId || selectedAccountId === "__new__") ? "not-allowed" : "pointer",
                    fontFamily: font,
                    opacity: (!selectedAccountId || selectedAccountId === "__new__") ? 0.65 : 1,
                  }}
                  title={!selectedAccountId ? "Select an account first" : undefined}
                >
                  {importing ? "Importing…" : `Import ${rows.length}`}
                </button>
              </div>
            </div>

            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "130px 1fr 100px 110px 36px", gap: "0", padding: "8px 20px", backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              {["Date", "Description", "Amount", "Type", ""].map((h) => (
                <div key={h} style={{ fontSize: "11px", fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {h}
                </div>
              ))}
            </div>

            {/* Rows — outer wrapper stacks the editable grid plus an optional
               reasoning line beneath it for medium/low-confidence rows. High
               confidence collapses (no reasoning shown) so the eye lands on
               rows that actually need attention. */}
            {rows.map((row) => {
              const showReasoning = row.confidence !== "high" && !!row.reasoning;
              const pillStyle = (() => {
                switch (row.confidence) {
                  case "high":   return { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" };
                  case "medium": return { bg: "#fef3c7", color: "#92400e", border: "#fde68a" };
                  case "low":    return { bg: "#fee2e2", color: "#dc2626", border: "#fecaca" };
                  default:       return { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb" };
                }
              })();
              return (
                <div
                  key={row.id}
                  style={{
                    borderBottom: "1px solid #f3f4f6",
                    backgroundColor: row.confidence === "low" ? "#fffbeb" : "transparent",
                  }}
                >
                  <div
                    style={{ display: "grid", gridTemplateColumns: "130px 1fr 100px 110px 36px", gap: "0", padding: "6px 20px", alignItems: "center" }}
                  >
                    <input
                      style={{ ...inputBase, fontSize: "12px", padding: "4px 6px" }}
                      value={row.date}
                      onChange={(e) => updateRow(row.id, "date", e.target.value)}
                    />
                    <input
                      style={{ ...inputBase, fontSize: "12px", padding: "4px 6px", marginLeft: "6px", marginRight: "6px" }}
                      value={row.description}
                      onChange={(e) => updateRow(row.id, "description", e.target.value)}
                    />
                    <input
                      style={{ ...inputBase, fontSize: "12px", padding: "4px 6px", fontVariantNumeric: "tabular-nums" }}
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.amount}
                      onChange={(e) => updateRow(row.id, "amount", parseFloat(e.target.value) || 0)}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginLeft: "6px", flexWrap: "wrap" }}>
                      <select
                        value={row.type}
                        onChange={(e) => {
                          const next = e.target.value as ParsedRow["type"];
                          updateRow(row.id, "type", next);
                          if (next !== "transfer" && row.direction) {
                            updateRow(row.id, "direction", "");
                          }
                          if (next === "transfer" && !row.direction) {
                            updateRow(row.id, "direction", "outflow");
                          }
                        }}
                        style={{
                          padding: "4px 8px",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "11px",
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: font,
                          backgroundColor:
                            row.type === "expense"  ? "#fee2e2" :
                            row.type === "refund"   ? "#f5f3ff" :
                            row.type === "transfer" ? "#f3f4f6" : "#dcfce7",
                          color:
                            row.type === "expense"  ? "#dc2626" :
                            row.type === "refund"   ? "#7c3aed" :
                            row.type === "transfer" ? "#374151" : "#16A34A",
                        }}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfer</option>
                        <option value="refund">Refund</option>
                      </select>

                      {row.type === "transfer" && (
                        <select
                          value={row.direction ?? ""}
                          onChange={(e) => updateRow(row.id, "direction", e.target.value)}
                          title="Which way did the money move on this account's statement?"
                          style={{
                            padding: "4px 6px",
                            border: row.direction ? "1px solid #d1d5db" : "1.5px solid #f59e0b",
                            borderRadius: "6px",
                            fontSize: "10px",
                            fontWeight: 600,
                            cursor: "pointer",
                            fontFamily: font,
                            backgroundColor: "#fff",
                            color: "#374151",
                          }}
                        >
                          <option value="">— dir —</option>
                          <option value="outflow">Out</option>
                          <option value="inflow">In</option>
                        </select>
                      )}

                      {/* AI confidence pill. Always rendered so the user sees
                         "high" rows are intentionally trusted, not unset. */}
                      <span
                        title={row.confidence === "high" ? row.reasoning : undefined}
                        style={{
                          padding: "2px 6px",
                          borderRadius: "999px",
                          fontSize: "9px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          backgroundColor: pillStyle.bg,
                          color:           pillStyle.color,
                          border:          `1px solid ${pillStyle.border}`,
                          fontFamily:      font,
                          whiteSpace:      "nowrap",
                        }}
                      >
                        {row.confidence}
                      </span>
                    </div>
                    <button
                      onClick={() => deleteRow(row.id)}
                      style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", fontSize: "16px", padding: "2px", marginLeft: "4px" }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Inline reasoning — only for medium / low. High confidence
                     collapses to keep the eye on rows that need review. */}
                  {showReasoning && (
                    <div style={{
                      padding: "0 20px 8px 150px",
                      fontSize: "11px",
                      color: "#6b7280",
                      fontStyle: "italic",
                      lineHeight: 1.4,
                    }}>
                      {row.reasoning}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Help text */}
        {rows.length === 0 && !parsing && !importCount && (
          <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "24px", boxShadow: "0 1px 6px rgba(0,0,0,0.05)" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151", marginBottom: "12px" }}>
              What formats work?
            </div>
            <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#6b7280", lineHeight: 2 }}>
              <li>Screenshots of online banking pages or statements</li>
              <li>Text copied from a bank website or statement PDF</li>
              <li>CSV files in any column order (paste the content)</li>
              <li>Email statements or exported Excel data (paste as text)</li>
              <li>Any format with dates, descriptions, and amounts</li>
              <li><strong>Up to ~270 transactions per paste</strong> — if you have more, split into two pastes and import each separately</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
