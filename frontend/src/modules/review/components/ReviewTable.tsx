import React from "react";
import { ReviewTransaction } from "../hooks/useReviewTransactions";
import { UserEntity } from "../../../services/entityService";
import InlineCategoryEditor from "./InlineCategoryEditor";

// ─── Sub-components ───────────────────────────────────────────────────────────

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
  onChange,
}: {
  value: string | null;
  entities: UserEntity[];
  disabled: boolean;
  autoAssigned?: boolean;
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={handleChange}
        title={autoAssigned ? "Auto-predicted from past transactions — confirm or change" : undefined}
        style={{
          fontSize: "13px",
          padding: "5px 8px",
          borderRadius: "6px",
          border: autoAssigned ? "1.5px solid #a5b4fc" : "1px solid #e5e7eb",
          backgroundColor: disabled ? "#f9fafb" : (autoAssigned ? "#eef2ff" : "#fff"),
          color: value ? "#111827" : "#9ca3af",
          cursor: disabled ? "not-allowed" : "pointer",
          minWidth: "130px",
        }}
      >
        <option value="">Personal</option>
        {entities.map((en) => (
          <option key={en.id} value={en.id}>{en.name}</option>
        ))}
      </select>
      {autoAssigned && (
        <span style={{ fontSize: "10px", color: "#818cf8", fontWeight: 600 }}>
          ✦ auto-predicted
        </span>
      )}
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

interface ReviewTableProps {
  transactions: ReviewTransaction[];
  entities: UserEntity[];
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
  onConfirm: (id: string) => void;
}

const TH: React.CSSProperties = {
  padding: "10px 14px",
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
  padding: "10px 14px",
  fontSize: "13px",
  color: "#374151",
  verticalAlign: "middle",
};

function fmtDate(d: string): string {
  if (!d) return "—";
  // YYYY-MM-DD → M/D
  const [, m, day] = d.split("-");
  if (!m || !day) return d;
  return `${parseInt(m)}/${parseInt(day)}`;
}

export default function ReviewTable({
  transactions,
  entities,
  selectedIds,
  updating,
  allSelected,
  onToggleSelect,
  onToggleSelectAll,
  onCategoryChange,
  onEntityChange,
  onConfirm,
}: ReviewTableProps) {
  if (transactions.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "64px 24px", color: "#6b7280" }}>
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
        <div style={{ fontWeight: 700, color: "#111827", fontSize: "16px", marginBottom: "4px" }}>
          All caught up!
        </div>
        <div style={{ fontSize: "14px" }}>No transactions need review right now.</div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
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
            <th style={{ ...TH, width: "56px" }}>Date</th>
            <th style={TH}>Description</th>
            <th style={{ ...TH, textAlign: "right" }}>Amount</th>
            <th style={{ ...TH, minWidth: "200px" }}>Category</th>
            {entities.length > 0 && (
              <th style={{ ...TH, minWidth: "140px" }}>Assign To</th>
            )}
            <th style={{ ...TH, textAlign: "center", width: "72px" }}>Conf.</th>
            <th style={{ ...TH, textAlign: "center", width: "88px" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((txn, idx) => {
            const isUpdating = updating.has(txn.id);
            const isSelected = selectedIds.has(txn.id);
            const isAI       = txn.source === "ai";

            return (
              <tr
                key={txn.id}
                style={{
                  backgroundColor: isSelected
                    ? "#f0fdf4"
                    : isAI
                    ? "#fffbeb"
                    : idx % 2 === 0 ? "#fff" : "#fafafa",
                  opacity: isUpdating ? 0.5 : 1,
                  transition: "opacity 0.15s, background-color 0.1s",
                  borderBottom: "1px solid #f3f4f6",
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
                  color: txn.type === "expense" ? "#dc2626" : "#16A34A",
                }}>
                  {txn.type === "expense" ? "−" : "+"}$
                  {Math.abs(txn.amount ?? 0).toFixed(2)}
                </td>

                {/* Category — inline editable */}
                <td style={TD}>
                  <InlineCategoryEditor
                    value={txn.category}
                    source={txn.source}
                    disabled={isUpdating}
                    onChange={(cat) => onCategoryChange(txn.id, cat)}
                  />
                </td>

                {/* Assign To */}
                {entities.length > 0 && (
                  <td style={TD}>
                    <EntityDropdown
                      value={txn.entityId}
                      entities={entities}
                      disabled={isUpdating}
                      autoAssigned={txn.entityAutoAssigned}
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
