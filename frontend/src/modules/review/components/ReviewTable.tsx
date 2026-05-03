import React, { useState, useRef, useEffect, useMemo } from "react";
import { CheckCircle2 } from "lucide-react";
import { ReviewTransaction } from "../hooks/useReviewTransactions";
import { UserEntity } from "../../../services/entityService";
import InlineCategoryEditor from "./InlineCategoryEditor";

// ─── Sub-components ───────────────────────────────────────────────────────────

type ReviewType = "income" | "expense" | "transfer" | "refund";
type ReviewSubType = "credit_card_payment" | "loan_payment" | null;

// All selectable options including transfer subtypes
const TYPE_OPTIONS: Array<{ type: ReviewType; subType: ReviewSubType; label: string }> = [
  { type: "income",   subType: null,           label: "income" },
  { type: "expense",  subType: null,           label: "expense" },
  { type: "refund",   subType: null,           label: "refund" },
  { type: "transfer", subType: null,           label: "transfer" },
  { type: "transfer", subType: "credit_card_payment", label: "credit card payment" },
  { type: "transfer", subType: "loan_payment", label: "loan payment" },
];

function typeBadgeStyle(type: ReviewType): React.CSSProperties {
  switch (type) {
    case "transfer": return { backgroundColor: "#f3f4f6", color: "#6b7280" };
    case "expense":  return { backgroundColor: "#fef2f2", color: "#dc2626" };
    case "refund":   return { backgroundColor: "#f5f3ff", color: "#7c3aed" };
    default:         return { backgroundColor: "#f0fdf4", color: "#16A34A" };
  }
}

function transferSubTypeLabel(subType: ReviewSubType): string | null {
  if (subType === "credit_card_payment") return "credit card payment";
  if (subType === "loan_payment") return "loan payment";
  return null;
}

function TypeBadge({
  type,
  subType,
  id,
  disabled,
  onTypeChange,
}: {
  type: ReviewType;
  subType: ReviewSubType;
  id: string;
  disabled: boolean;
  onTypeChange?: (id: string, type: ReviewType, subType?: ReviewSubType) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const subLabel = type === "transfer" ? transferSubTypeLabel(subType) : null;

  if (!onTypeChange || disabled) {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: "1px" }}>
        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600, ...typeBadgeStyle(type) }}>
          {type}
        </span>
        {subLabel && (
          <span style={{ fontSize: "10px", color: "#9ca3af", paddingLeft: "2px" }}>{subLabel}</span>
        )}
      </span>
    );
  }

  const isActive = (opt: typeof TYPE_OPTIONS[0]) => opt.type === type && opt.subType === subType;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Click to change type"
        style={{
          display: "inline-flex", flexDirection: "column", alignItems: "flex-start",
          padding: "2px 8px", borderRadius: "8px", fontSize: "11px", fontWeight: 600,
          cursor: "pointer", border: "1.5px solid transparent", outline: "none",
          ...typeBadgeStyle(type),
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
          {type}
          <span style={{ fontSize: "9px", opacity: 0.7 }}>▾</span>
        </span>
        {subLabel && (
          <span style={{ fontSize: "10px", fontWeight: 400, opacity: 0.8, lineHeight: 1.2 }}>{subLabel}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.13)", padding: "4px", minWidth: "140px",
        }}>
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={`${opt.type}-${opt.subType}`}
              onClick={() => { onTypeChange(id, opt.type, opt.subType); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: "6px", width: "100%",
                textAlign: "left", padding: "6px 10px", border: "none", borderRadius: "6px",
                fontSize: "12px", fontWeight: isActive(opt) ? 700 : 500, cursor: "pointer",
                backgroundColor: isActive(opt) ? "#f3f4f6" : "transparent",
                color: isActive(opt) ? "#111827" : "#374151",
              }}
            >
              <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: typeBadgeStyle(opt.type).color as string, flexShrink: 0 }} />
              {opt.label}
              {isActive(opt) && <span style={{ marginLeft: "auto", fontSize: "10px" }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfidenceCell({
  confidence,
  explanation,
}: {
  confidence: number | null;
  explanation: string | null;
}) {
  if (confidence === null || confidence === undefined) {
    return <span style={{ color: "#d1d5db", fontSize: "12px" }}>—</span>;
  }
  const pct = Math.round(confidence * 100);
  const isHigh = confidence >= 0.8;
  return (
    <span
      title={explanation ?? undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        fontSize: "12px",
        fontWeight: 600,
        color: isHigh ? "#16A34A" : "#d97706",
        cursor: explanation ? "help" : "default",
      }}
    >
      {isHigh ? "✓" : "⚠"} {pct}%
    </span>
  );
}

function EntityDropdown({
  value,
  entities,
  disabled,
  autoAssigned,
  entityAssignmentSource,
  onChange,
}: {
  value: string | null;
  entities: UserEntity[];
  disabled: boolean;
  autoAssigned?: boolean;
  entityAssignmentSource?: "rule" | "user_rule" | "ai" | null;
  onChange: (entityId: string | null, entityType: "business" | "rental" | "personal", entityName?: string) => void;
}) {
  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === "") {
      onChange(null, "personal");
    } else {
      const entity = entities.find((en) => en.id === val);
      if (entity) onChange(entity.id, entity.type, entity.name);
    }
  }

  // "Learned" shows whenever the entity assignment came from a saved user rule
  // — whether the AI applied it OR the user just picked it (which writes
  // entityAssignmentSource: "user_rule" via handleEntityChange). That's the
  // signal the learning loop is active for this vendor.
  const badge =
    entityAssignmentSource === "user_rule"
      ? { label: "Learned", bg: "#eff6ff", color: "#1d4ed8" }
      : autoAssigned && entityAssignmentSource === "ai"
        ? { label: "AI",   bg: "#fff7ed", color: "#c2410c" }
        : autoAssigned && entityAssignmentSource === "rule"
          ? { label: "rule", bg: "#f0fdf4", color: "#15803d" }
          : null;

  const borderColor =
    entityAssignmentSource === "user_rule" ? "#bfdbfe"
    : autoAssigned && entityAssignmentSource === "ai"   ? "#fed7aa"
    : autoAssigned && entityAssignmentSource === "rule" ? "#bbf7d0"
    : "#e5e7eb";

  const bgColor =
    entityAssignmentSource === "user_rule" ? "#eff6ff"
    : autoAssigned && entityAssignmentSource === "ai"   ? "#fff7ed"
    : autoAssigned && entityAssignmentSource === "rule" ? "#f0fdf4"
    : "#fff";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={handleChange}
        title={autoAssigned ? "Auto-assigned — confirm or change" : undefined}
        style={{
          fontSize: "11px",
          padding: "3px 5px",
          borderRadius: "6px",
          border: `1.5px solid ${borderColor}`,
          backgroundColor: disabled ? "#f9fafb" : bgColor,
          color: value ? "#111827" : "#9ca3af",
          cursor: disabled ? "not-allowed" : "pointer",
          minWidth: "90px",
          maxWidth: "120px",
        }}
      >
        <option value="">Personal</option>
        {entities.map((en) => (
          <option key={en.id} value={en.id}>{en.name}</option>
        ))}
      </select>
      {badge && (
        <span style={{
          fontSize: "10px",
          fontWeight: 700,
          padding: "1px 5px",
          borderRadius: "999px",
          backgroundColor: badge.bg,
          color: badge.color,
          alignSelf: "flex-start",
        }}>
          {badge.label}
        </span>
      )}
    </div>
  );
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type SortCol = "date" | "amount" | "description" | "type" | "category" | "account" | "entity" | "confidence" | null;
type SortDir = "asc" | "desc";

// ─── Table ────────────────────────────────────────────────────────────────────

interface PendingCategoryPromptForUI {
  editedRowId: string;
  triggeredBy: "category" | "entity";
  vendor: string;
  category: string | null;
  entityType: "business" | "rental" | "personal" | null;
  affectedRowIds: string[];
}

interface ReviewTableProps {
  transactions: ReviewTransaction[];
  entities: UserEntity[];
  customCategories: string[];
  selectedIds: Set<string>;
  updating: Set<string>;
  allSelected: boolean;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onCategoryChange: (id: string, category: string) => void;
  onEntityChange: (
    id: string,
    entityId: string | null,
    entityType: "business" | "rental" | "personal",
    entityName?: string
  ) => void;
  onTypeChange: (id: string, type: "income" | "expense" | "transfer" | "refund", subType?: "credit_card_payment" | "loan_payment" | null) => void;
  onConfirm: (id: string) => void;
  onCustomCategoryAdded: (category: string) => void;
  /** Prompt to render inline beneath the edited row. Same prompt is also
   *  surfaced as a sticky banner on the page above the table. */
  pendingCategoryPrompt?: PendingCategoryPromptForUI | null;
  onAcceptCategoryPrompt?: () => void | Promise<void>;
  onDismissCategoryPrompt?: () => void;
}

const TH: React.CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: "11px",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
  backgroundColor: "#f9fafb",
};

const TD: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: "13px",
  color: "#374151",
  verticalAlign: "middle",
};

function fmtDate(d: string): string {
  if (!d) return "—";
  // YYYY-MM-DD → MM/DD/YY
  const [year, m, day] = d.split("-");
  if (!m || !day || !year) return d;
  return `${parseInt(m)}/${parseInt(day)}/${year.slice(2)}`;
}

export default function ReviewTable({
  transactions,
  entities,
  customCategories,
  selectedIds,
  updating,
  allSelected,
  onToggleSelect,
  onToggleSelectAll,
  onCategoryChange,
  onEntityChange,
  onTypeChange,
  onConfirm,
  onCustomCategoryAdded,
  pendingCategoryPrompt,
  onAcceptCategoryPrompt,
  onDismissCategoryPrompt,
}: ReviewTableProps) {
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Three-state sort: first click ASC, second DESC, third resets
  function handleSort(col: Exclude<SortCol, null>) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function sortIcon(col: Exclude<SortCol, null>): string {
    if (sortCol !== col) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const sorted = useMemo(() => {
    if (!sortCol) return transactions;
    return [...transactions].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortCol === "date")        { av = a.date;                              bv = b.date; }
      else if (sortCol === "amount") { av = a.amount;                            bv = b.amount; }
      else if (sortCol === "description") { av = (a.description || "").toLowerCase(); bv = (b.description || "").toLowerCase(); }
      else if (sortCol === "type")   { av = a.type;                              bv = b.type; }
      else if (sortCol === "category") { av = (a.category || "").toLowerCase();  bv = (b.category || "").toLowerCase(); }
      else if (sortCol === "account") { av = (a.accountName || "").toLowerCase(); bv = (b.accountName || "").toLowerCase(); }
      else if (sortCol === "entity") { av = (a.entityName || "").toLowerCase();  bv = (b.entityName || "").toLowerCase(); }
      else if (sortCol === "confidence") { av = a.categorizationConfidence ?? -1; bv = b.categorizationConfidence ?? -1; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [transactions, sortCol, sortDir]);

  const sortableTH = (col: Exclude<SortCol, null>, label: string, extraStyle?: React.CSSProperties): React.ReactNode => (
    <th
      style={{ ...TH, ...extraStyle, cursor: "pointer", userSelect: "none" }}
      onClick={() => handleSort(col)}
      title={`Sort by ${label}`}
    >
      {label}
      <span style={{ opacity: sortCol === col ? 1 : 0.35, fontSize: "10px" }}>{sortIcon(col)}</span>
    </th>
  );

  if (transactions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "64px 24px", color: "#6b7280" }}>
        <div style={{ marginBottom: "12px", display: "flex", justifyContent: "center" }}>
          <CheckCircle2 size={48} strokeWidth={1.7} color="#16A34A" />
        </div>
        <div style={{ fontWeight: 700, color: "#111827", fontSize: "16px", marginBottom: "4px" }}>
          All caught up!
        </div>
        <div style={{ fontSize: "14px" }}>No transactions need review right now.</div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", borderRadius: "12px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1000px" }}>
        <thead>
          <tr>
            {/* Checkbox */}
            <th style={{ ...TH, width: "36px", textAlign: "center" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                style={{ cursor: "pointer" }}
              />
            </th>
            {sortableTH("date", "Date", { width: "52px" })}
            {sortableTH("description", "Description")}
            {sortableTH("amount", "Amount", { textAlign: "right", width: "90px" })}
            {sortableTH("type", "Type", { width: "80px" })}
            {sortableTH("category", "Category", { minWidth: "160px" })}
            {sortableTH("account", "Account", { width: "110px" })}
            {entities.length > 0 && sortableTH("entity", "Assign To", { width: "120px" })}
            {sortableTH("confidence", "Conf.", { textAlign: "center", width: "60px" })}
            <th style={{ ...TH, textAlign: "center", width: "80px" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((txn, idx) => {
            const isUpdating = updating.has(txn.id);
            const isSelected = selectedIds.has(txn.id);
            const isAI       = txn.source === "ai";
            const showInlinePrompt =
              !!pendingCategoryPrompt && pendingCategoryPrompt.editedRowId === txn.id;
            const totalCols = entities.length > 0 ? 10 : 9;

            return (
              <React.Fragment key={txn.id}>
              <tr
                style={{
                  backgroundColor: isSelected
                    ? "#f0fdf4"
                    : isAI
                    ? "#fffbeb"
                    : idx % 2 === 0 ? "#fff" : "#fafafa",
                  opacity: isUpdating ? 0.5 : 1,
                  transition: "opacity 0.15s, background-color 0.1s",
                  borderBottom: showInlinePrompt ? "none" : "1px solid #f3f4f6",
                }}
              >
                {/* Checkbox */}
                <td style={{ ...TD, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isUpdating}
                    onChange={() => onToggleSelect(txn.id)}
                    style={{ cursor: "pointer" }}
                  />
                </td>

                {/* Date */}
                <td style={{ ...TD, color: "#9ca3af", whiteSpace: "nowrap", fontSize: "12px" }}>
                  {fmtDate(txn.date)}
                </td>

                {/* Description + vendor */}
                <td style={{ ...TD, maxWidth: "280px" }}>
                  {txn.possibleDuplicate && (
                    <div style={{
                      fontSize: "10px",
                      color: "#d97706",
                      fontWeight: 700,
                      marginBottom: "2px",
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                    }}>
                      ⚠ Possible duplicate
                    </div>
                  )}
                  <div
                    title={txn.description}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "#111827",
                      fontWeight: 500,
                    }}
                  >
                    {txn.description || "—"}
                  </div>
                  {txn.vendor && txn.vendor !== txn.description.toLowerCase().split(" ")[0] && (
                    <div style={{
                      fontSize: "11px",
                      color: "#9ca3af",
                      marginTop: "1px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}>
                      {txn.vendor}
                    </div>
                  )}
                </td>

                {/* Amount */}
                <td style={{
                  ...TD,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  color: txn.type === "expense" ? "#dc2626" : txn.type === "transfer" ? "#9ca3af" : txn.type === "refund" ? "#7c3aed" : "#16A34A",
                }}>
                  {txn.type === "expense" ? "−" : txn.type === "transfer" ? "" : "+"}$
                  {Math.abs(txn.amount ?? 0).toFixed(2)}
                </td>

                {/* Type — clickable badge */}
                <td style={TD}>
                  <TypeBadge
                    type={txn.type as "income" | "expense" | "transfer" | "refund"}
                    subType={txn.subType ?? null}
                    id={txn.id}
                    disabled={isUpdating}
                    onTypeChange={onTypeChange}
                  />
                </td>

                {/* Category — inline editable, filtered by entity type (Task 5) */}
                <td style={TD}>
                  <InlineCategoryEditor
                    value={txn.category}
                    source={txn.source}
                    disabled={isUpdating}
                    entityType={txn.entityType ?? null}
                    customCategories={customCategories}
                    onChange={(cat) => onCategoryChange(txn.id, cat)}
                    onCustomCategoryAdded={onCustomCategoryAdded}
                  />
                </td>

                {/* Account */}
                <td style={{ ...TD, maxWidth: "130px" }}>
                  <div style={{ fontSize: "11px", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {txn.accountName?.trim() || "—"}
                  </div>
                  {txn.importFile && (
                    <div
                      title={txn.importFile}
                      style={{ fontSize: "10px", color: "#c4c9d4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "2px" }}
                    >
                      {txn.importFile.replace(/\.[^.]+$/, "")}
                    </div>
                  )}
                </td>

                {/* Assign To */}
                {entities.length > 0 && (
                  <td style={TD}>
                    <EntityDropdown
                      value={txn.entityId}
                      entities={entities}
                      disabled={isUpdating}
                      autoAssigned={txn.entityAutoAssigned}
                      entityAssignmentSource={txn.entityAssignmentSource}
                      onChange={(entityId, entityType, entityName) =>
                        onEntityChange(txn.id, entityId, entityType, entityName)
                      }
                    />
                  </td>
                )}

                {/* Confidence — hover for explanation tooltip */}
                <td style={{ ...TD, textAlign: "center" }}>
                  <ConfidenceCell
                    confidence={txn.categorizationConfidence}
                    explanation={txn.categorizationExplanation}
                  />
                </td>

                {/* Confirm */}
                <td style={{ ...TD, textAlign: "center" }}>
                  <button
                    onClick={() => onConfirm(txn.id)}
                    disabled={isUpdating}
                    style={{
                      padding: "5px 14px",
                      backgroundColor: "#16A34A",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: isUpdating ? "not-allowed" : "pointer",
                      opacity: isUpdating ? 0.5 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    ✓ Done
                  </button>
                </td>
              </tr>
              {showInlinePrompt && pendingCategoryPrompt && (
                <tr style={{
                  backgroundColor: "#fffbeb",
                  borderBottom: "1px solid #fcd34d",
                }}>
                  <td colSpan={totalCols} style={{
                    padding: "10px 14px",
                    borderTop: "1px solid #fcd34d",
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      flexWrap: "wrap",
                      fontSize: "13px",
                      color: "#78350f",
                    }}>
                      <div style={{ flex: "1 1 280px" }}>
                        <div style={{ fontWeight: 700, marginBottom: "2px" }}>
                          Apply this to similar transactions?
                        </div>
                        <div style={{ color: "#92400e" }}>
                          You updated &ldquo;<strong>{pendingCategoryPrompt.vendor}</strong>&rdquo;.
                          Apply{" "}
                          {pendingCategoryPrompt.category && pendingCategoryPrompt.entityType
                            ? "this category and assignment"
                            : pendingCategoryPrompt.category
                            ? "this category"
                            : "this assignment"}{" "}
                          to {pendingCategoryPrompt.affectedRowIds.length} similar transaction
                          {pendingCategoryPrompt.affectedRowIds.length !== 1 ? "s" : ""}?
                        </div>
                        <div style={{
                          marginTop: "3px",
                          fontSize: "11px",
                          color: "#a16207",
                          fontStyle: "italic",
                        }}>
                          Applies category, tax treatment, and Assign To.
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                        <button
                          onClick={() => onAcceptCategoryPrompt?.()}
                          style={{
                            padding: "7px 14px",
                            backgroundColor: "#16A34A",
                            color: "#fff",
                            border: "none",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 700,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Apply to all
                        </button>
                        <button
                          onClick={() => onDismissCategoryPrompt?.()}
                          style={{
                            padding: "7px 14px",
                            backgroundColor: "#fff",
                            color: "#78350f",
                            border: "1px solid #fcd34d",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Just this one
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
