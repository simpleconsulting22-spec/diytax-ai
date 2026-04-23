import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { getUserEntities, UserEntity } from "../../services/entityService";
import { apiClient } from "../../services/apiClient";
import { CATEGORY_GROUPS } from "../review/components/CategoryDropdown";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Tax schedule derivation ──────────────────────────────────────────────────

function categoryToSchedule(cat: string): { taxSchedule: string; taxCategory: string } {
  for (const group of CATEGORY_GROUPS) {
    if (group.categories.includes(cat)) {
      if (group.group === "Income") return { taxSchedule: "Schedule C", taxCategory: cat };
      if (group.group.includes("Business")) return { taxSchedule: "Schedule C", taxCategory: cat };
      if (group.group.includes("Sch. A")) return { taxSchedule: "Schedule A", taxCategory: cat };
      if (group.group.includes("Sch. E")) return { taxSchedule: "Schedule E", taxCategory: cat };
      return { taxSchedule: "Personal", taxCategory: cat };
    }
  }
  return { taxSchedule: "Personal", taxCategory: cat };
}

// ─── Shared style helpers ─────────────────────────────────────────────────────

const label: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: "6px",
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d1d5db",
  borderRadius: "10px",
  padding: "12px 14px",
  fontSize: "15px",
  fontFamily: font,
  outline: "none",
  boxSizing: "border-box",
  backgroundColor: "#fff",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b7280' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 14px center",
  paddingRight: "36px",
  cursor: "pointer",
};

// ─── Today in YYYY-MM-DD ──────────────────────────────────────────────────────

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function QuickCaptureFAB() {
  const { user, effectiveOwnerUid } = useAuth();
  const { selectedYear } = useTaxYear();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";

  const [isOpen, setIsOpen] = useState(false);

  // Form state
  const [type, setType] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayString);
  const [category, setCategory] = useState("");
  const [taxCategory, setTaxCategory] = useState("");
  const [taxSchedule, setTaxSchedule] = useState("");
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityName, setEntityName] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<"business" | "rental" | "personal">("personal");

  // Entities
  const [entities, setEntities] = useState<UserEntity[]>([]);

  // AI suggestion
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSource, setAiSource] = useState<"ai" | "user_rule" | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Receipt
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [receiptStoragePath, setReceiptStoragePath] = useState<string | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  // Save state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Load entities when modal opens
  useEffect(() => {
    if (!isOpen || !ownerUid) return;
    getUserEntities(ownerUid).then(setEntities).catch(() => {});
  }, [isOpen, ownerUid]);

  // Reset form when modal closes
  function resetForm() {
    setType("expense");
    setAmount("");
    setDescription("");
    setDate(todayString());
    setCategory("");
    setTaxCategory("");
    setTaxSchedule("");
    setEntityId(null);
    setEntityName(null);
    setEntityType("personal");
    setAiLoading(false);
    setAiSource(null);
    setReceiptPreview(null);
    setReceiptStoragePath(null);
    setReceiptUrl(null);
    setUploadingReceipt(false);
    setReceiptError("");
    setSaveError("");
    setSaved(false);
  }

  function handleClose() {
    setIsOpen(false);
    resetForm();
  }

  // ── AI category suggestion (debounced 500ms) ────────────────────────────────

  const suggestCategory = useCallback(
    (desc: string, amt: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!desc.trim() || desc.length < 3) return;

      debounceRef.current = setTimeout(async () => {
        setAiLoading(true);
        try {
          const result = await apiClient.call<{
            category: string;
            taxCategory: string;
            taxSchedule: string;
            confidence: number;
            source: string;
          }>("suggestCategory", {
            description: desc,
            amount: parseFloat(amt) || undefined,
          });

          if (result.category) {
            setCategory(result.category);
            setTaxCategory(result.taxCategory || result.category);
            setTaxSchedule(result.taxSchedule || "Personal");
            setAiSource(result.source === "user_rule" ? "user_rule" : "ai");
          }
        } catch {
          // Suggestion failed — user can set manually, no need to surface error
        } finally {
          setAiLoading(false);
        }
      }, 500);
    },
    []
  );

  function handleDescriptionChange(val: string) {
    setDescription(val);
    setAiSource(null);
    suggestCategory(val, amount);
  }

  // ── Category picker change ──────────────────────────────────────────────────

  function handleCategoryChange(val: string) {
    setCategory(val);
    setAiSource(null);
    const { taxSchedule: sched, taxCategory: tcat } = categoryToSchedule(val);
    setTaxSchedule(sched);
    setTaxCategory(tcat);
  }

  // ── Entity picker change ────────────────────────────────────────────────────

  function handleEntityChange(val: string) {
    if (val === "__personal__") {
      setEntityId(null);
      setEntityName(null);
      setEntityType("personal");
    } else {
      const found = entities.find((e) => e.id === val);
      if (found) {
        setEntityId(found.id);
        setEntityName(found.name);
        setEntityType(found.type);
      }
    }
  }

  // ── Receipt attachment ──────────────────────────────────────────────────────

  async function handleReceiptFile(file: File) {
    setReceiptError("");
    setUploadingReceipt(true);

    // Local preview
    const reader = new FileReader();
    reader.onload = (e) => setReceiptPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    try {
      // Upload to Firebase Storage under the actual caller's uid so the path
      // matches the extractReceiptData security check (which validates against
      // the caller's auth uid, not the effective owner uid).
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `receipts/${user!.uid}/${Date.now()}.${ext}`;
      const sref = storageRef(storage, path);
      await uploadBytes(sref, file);
      const url = await getDownloadURL(sref);
      setReceiptStoragePath(path);
      setReceiptUrl(url);

      // Extract data via Cloud Function
      const extracted = await apiClient.call<{
        merchant: string;
        amount: number;
        date: string;
      }>("extractReceiptData", { storagePath: path });

      if (extracted.merchant) setDescription(extracted.merchant);
      if (extracted.amount > 0) setAmount(String(extracted.amount));
      if (extracted.date) setDate(extracted.date);

      // Trigger AI suggestion with extracted merchant name
      if (extracted.merchant) {
        suggestCategory(extracted.merchant, String(extracted.amount || ""));
      }
    } catch (err) {
      console.error("[QuickCapture] Receipt processing error:", err);
      setReceiptError("Couldn't read receipt — fill in manually.");
    } finally {
      setUploadingReceipt(false);
    }
  }

  // ── Save transaction ────────────────────────────────────────────────────────

  async function handleSave() {
    const parsedAmount = parseFloat(amount.replace(/,/g, ""));
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setSaveError("Enter a valid amount.");
      return;
    }
    if (!description.trim()) {
      setSaveError("Enter a description.");
      return;
    }

    setSaving(true);
    setSaveError("");

    try {
      const txnRef = doc(collection(db, "transactions"));
      const storedAmount =
        type === "expense" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
      const year = parseInt(date.slice(0, 4)) || selectedYear;

      await setDoc(txnRef, {
        uid: ownerUid,
        accountId: "manual",
        accountType: "bank",
        date,
        description: description.trim(),
        normalizedDescription: description.trim().toUpperCase(),
        vendor: description.trim(),
        amount: storedAmount,
        type,
        status: category ? "categorized" : "needs_review",
        source: "manual",
        category: category || null,
        taxCategory: taxCategory || null,
        taxSchedule: taxSchedule || null,
        categorizationSource: category ? "user_rule" : null,
        isUserModified: true,
        entityId,
        entityType,
        entityName,
        taxYear: year,
        receiptUrl: receiptUrl || null,
        receiptStoragePath: receiptStoragePath || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSaved(true);
      setTimeout(() => handleClose(), 1200);
    } catch (err) {
      console.error("[QuickCapture] Save error:", err);
      setSaveError("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Don't render FAB on public pages (user not authenticated) ──────────────

  if (!user) return null;

  return (
    <>
      {/* ── FAB button ── */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Quick capture transaction"
        style={{
          position: "fixed",
          bottom: "28px",
          right: "28px",
          width: "58px",
          height: "58px",
          borderRadius: "50%",
          backgroundColor: "#16A34A",
          color: "#fff",
          border: "none",
          fontSize: "30px",
          lineHeight: 1,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(22, 163, 74, 0.45)",
          zIndex: 900,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: font,
          transition: "transform 0.1s ease, box-shadow 0.1s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 20px rgba(22, 163, 74, 0.55)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(22, 163, 74, 0.45)";
        }}
      >
        +
      </button>

      {/* ── Modal overlay ── */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={handleClose}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.45)",
              zIndex: 1000,
            }}
          />

          {/* Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick capture"
            style={{
              position: "fixed",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: "100%",
              maxWidth: "480px",
              backgroundColor: "#fff",
              borderRadius: "20px 20px 0 0",
              padding: "20px 20px 32px",
              zIndex: 1001,
              maxHeight: "92vh",
              overflowY: "auto",
              fontFamily: font,
              boxShadow: "0 -4px 30px rgba(0,0,0,0.15)",
            }}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "20px",
              }}
            >
              <h2
                style={{
                  fontSize: "17px",
                  fontWeight: 700,
                  color: "#111827",
                  margin: 0,
                }}
              >
                Quick Capture
              </h2>
              <button
                onClick={handleClose}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "22px",
                  color: "#9ca3af",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: "2px 6px",
                }}
              >
                ×
              </button>
            </div>

            {/* Success state */}
            {saved && (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 0",
                  color: "#16A34A",
                  fontSize: "16px",
                  fontWeight: 600,
                }}
              >
                <div style={{ fontSize: "40px", marginBottom: "12px" }}>✓</div>
                Transaction saved!
              </div>
            )}

            {!saved && (
              <>
                {/* Expense / Income toggle */}
                <div
                  style={{
                    display: "flex",
                    backgroundColor: "#f3f4f6",
                    borderRadius: "10px",
                    padding: "4px",
                    marginBottom: "20px",
                  }}
                >
                  {(["expense", "income"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      style={{
                        flex: 1,
                        padding: "9px",
                        borderRadius: "8px",
                        border: "none",
                        fontSize: "14px",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: font,
                        backgroundColor: type === t ? "#fff" : "transparent",
                        color:
                          type === t
                            ? t === "expense"
                              ? "#dc2626"
                              : "#16A34A"
                            : "#9ca3af",
                        boxShadow: type === t ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                        transition: "all 0.15s",
                      }}
                    >
                      {t === "expense" ? "Expense" : "Income"}
                    </button>
                  ))}
                </div>

                {/* Amount */}
                <div style={{ marginBottom: "16px" }}>
                  <span style={label}>Amount</span>
                  <div style={{ position: "relative" }}>
                    <span
                      style={{
                        position: "absolute",
                        left: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "#6b7280",
                        fontSize: "16px",
                        pointerEvents: "none",
                      }}
                    >
                      $
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      style={{
                        ...inputStyle,
                        paddingLeft: "28px",
                        fontSize: "22px",
                        fontWeight: 700,
                        color: type === "expense" ? "#dc2626" : "#16A34A",
                      }}
                    />
                  </div>
                </div>

                {/* Description */}
                <div style={{ marginBottom: "16px" }}>
                  <span style={label}>Description / Vendor</span>
                  <input
                    type="text"
                    placeholder="e.g. Office Depot, Uber, Amazon"
                    value={description}
                    onChange={(e) => handleDescriptionChange(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {/* Date */}
                <div style={{ marginBottom: "16px" }}>
                  <span style={label}>Date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {/* Category */}
                <div style={{ marginBottom: "16px" }}>
                  <span style={label}>
                    Category
                    {aiLoading && (
                      <span
                        style={{
                          marginLeft: "8px",
                          fontSize: "11px",
                          color: "#9ca3af",
                          fontWeight: 400,
                          textTransform: "none",
                        }}
                      >
                        ✦ suggesting…
                      </span>
                    )}
                    {!aiLoading && aiSource && (
                      <span
                        style={{
                          marginLeft: "8px",
                          fontSize: "11px",
                          color: aiSource === "user_rule" ? "#16A34A" : "#7c3aed",
                          fontWeight: 500,
                          textTransform: "none",
                        }}
                      >
                        ✦ {aiSource === "user_rule" ? "from your rules" : "AI suggested"}
                      </span>
                    )}
                  </span>
                  <select
                    value={category}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">— Select category —</option>
                    {CATEGORY_GROUPS.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Entity (only if entities exist) */}
                {entities.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <span style={label}>Assign To</span>
                    <select
                      value={entityId ?? "__personal__"}
                      onChange={(e) => handleEntityChange(e.target.value)}
                      style={selectStyle}
                    >
                      <option value="__personal__">Personal</option>
                      {entities.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({e.type === "business" ? "Sch. C" : "Sch. E"})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Receipt attachment */}
                <div style={{ marginBottom: "20px" }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleReceiptFile(file);
                    }}
                  />

                  {!receiptPreview ? (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingReceipt}
                      style={{
                        width: "100%",
                        padding: "12px",
                        border: "1.5px dashed #d1d5db",
                        borderRadius: "10px",
                        backgroundColor: "#f9fafb",
                        color: "#6b7280",
                        fontSize: "14px",
                        cursor: "pointer",
                        fontFamily: font,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                    >
                      {uploadingReceipt ? (
                        <>⟳ Uploading receipt…</>
                      ) : (
                        <>📷 Attach Receipt (optional)</>
                      )}
                    </button>
                  ) : (
                    <div
                      style={{
                        position: "relative",
                        borderRadius: "10px",
                        overflow: "hidden",
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      <img
                        src={receiptPreview}
                        alt="Receipt"
                        style={{ width: "100%", maxHeight: "180px", objectFit: "cover" }}
                      />
                      {uploadingReceipt && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            backgroundColor: "rgba(0,0,0,0.5)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            fontSize: "14px",
                          }}
                        >
                          Reading receipt…
                        </div>
                      )}
                      <button
                        onClick={() => {
                          setReceiptPreview(null);
                          setReceiptStoragePath(null);
                          setReceiptUrl(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        style={{
                          position: "absolute",
                          top: "8px",
                          right: "8px",
                          backgroundColor: "rgba(0,0,0,0.6)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "28px",
                          height: "28px",
                          cursor: "pointer",
                          fontSize: "16px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                  {receiptError && (
                    <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#dc2626" }}>
                      {receiptError}
                    </p>
                  )}
                </div>

                {/* Error message */}
                {saveError && (
                  <p
                    style={{
                      margin: "0 0 12px",
                      fontSize: "13px",
                      color: "#dc2626",
                      fontWeight: 500,
                    }}
                  >
                    {saveError}
                  </p>
                )}

                {/* Save button */}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    width: "100%",
                    padding: "16px",
                    backgroundColor: saving ? "#9ca3af" : "#16A34A",
                    color: "#fff",
                    border: "none",
                    borderRadius: "12px",
                    fontSize: "16px",
                    fontWeight: 700,
                    cursor: saving ? "default" : "pointer",
                    fontFamily: font,
                    transition: "background-color 0.15s",
                  }}
                >
                  {saving ? "Saving…" : "Save Transaction"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
