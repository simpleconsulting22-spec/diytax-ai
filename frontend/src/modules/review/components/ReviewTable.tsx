import React from "react";
import { ReviewTransaction } from "../hooks/useReviewTransactions";
import { UserEntity } from "../../../services/entityService";
import CategoryDropdown from "./CategoryDropdown";

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceCell({ confidence }: { confidence: number | null }) {
  if (confidence === null || confidence === undefined) {
    return <span style={{ color: "#9ca3af", fontSize: "13px" }}>—</span>;
  }
  const pct = Math.round(confidence * 100);
  const isHigh = confidence >= 0.8;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        fontSize: "13px",
        fontWeight: 500,
        color: isHigh ? "#16A34A" : "#d97706",
      }}
    >
      <span style={{ fontSize: "14px" }}>{isHigh ? "✓" : "⚠"}</span>
      {pct}%
    </span>
  );
}

function SourceBadge({ source }: { source: ReviewTransaction["source"] }) {
  const config: Record<
    string,
    { label: string; bg: string; color: string }
  > = {
    rule: { label: "rule", bg: "#f0fdf4", color: "#15803d" },
    user_rule: { label: "learned", bg: "#eff6ff", color: "#1d4ed8" },
    ai: { label: "AI", bg: "#fff7ed", color: "#c2410c" },
  };
  const c = source ? config[source] : null;
  if (!c) return <span style={{ color: "#9ca3af", fontSize: "12px" }}>—</span>;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 600,
        backgroundColor: c.bg,
        color: c.color,
      }}
    >
      {c.label}
    </span>
  );
}

function EntityDropdown({
  value,
  entities,
  disabled,
  onChange,
}: {
  value: string | null;
  entities: UserEntity[];
  disabled: boolean;
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
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={handleChange}
      style={{
        fontSize: "13px",
        padding: "5px 8px",
        borderRadius: "6px",
        border: "1px solid #d1d5db",
        backgroundColor: disabled ? "#f9fafb" : "#fff",
        color: value ? "#111827" : "#9ca3af",
        cursor: disabled ? "not-allowed" : "pointer",
        minWidth: "130px",
      }}
    >
      <option value="">Personal</option>
      {entities.map((en) => (
        <option key={en.id} value={en.id}>
          {en.name}
        </option>
      ))}
    </select>
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

const TH_STYLE: React.CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: "12px",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
  backgroundColor: "#f9fafb",
};

const TD_STYLE: React.CSSProperties = {
  padding: "11px 14px",
  fontSize: "13px",
  color: "#374151",
  verticalAlign: "middle",
};

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
      <div
        style={{
          textAlign: "center",
          padding: "60px 24px",
          color: "#6b7280",
          fontSize: "15px",
        }}
      >
        <div style={{ fontSize: "40px", marginBottom: "12px" }}>✅</div>
        <div style={{ fontWeight: 600, color: "#111827", marginBottom: "4px" }}>
          All caught up!
        </div>
        No transactions need review right now.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "980px" }}>
        <thead>
          <tr>
            <th style={{ ...TH_STYLE, width: "36px", textAlign: "center" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                style={{ cursor: "pointer" }}
              />
            </th>
            <th style={TH_STYLE}>Description</th>
            <th style={{ ...TH_STYLE, textAlign: "right" }}>Amount</th>
            <th style={{ ...TH_STYLE, minWidth: "180px" }}>Category</th>
            <th style={TH_STYLE}>Tax Category</th>
            {entities.length > 0 && (
              <th style={{ ...TH_STYLE, minWidth: "150px" }}>Assign To</th>
            )}
            <th style={{ ...TH_STYLE, textAlign: "center" }}>Confidence</th>
            <th style={{ ...TH_STYLE, textAlign: "center" }}>Source</th>
            <th style={{ ...TH_STYLE, textAlign: "center" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((txn, idx) => {
            const isUpdating = updating.has(txn.id);
            const isAI = txn.source === "ai";
            const isSelected = selectedIds.has(txn.id);

            return (
              <tr
                key={txn.id}
                style={{
                  backgroundColor: isSelected
                    ? "#f0fdf4"
                    : isAI
                    ? "#fffbeb"
                    : idx % 2 === 0
                    ? "#fff"
                    : "#fafafa",
                  opacity: isUpdating ? 0.55 : 1,
                  transition: "opacity 0.15s",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                {/* Checkbox */}
                <td style={{ ...TD_STYLE, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isUpdating}
                    onChange={() => onToggleSelect(txn.id)}
                    style={{ cursor: "pointer" }}
                  />
                </td>

                {/* Description */}
                <td style={{ ...TD_STYLE, maxWidth: "260px" }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "#111827",
                      fontWeight: 500,
                    }}
                    title={txn.description}
                  >
                    {txn.description || "—"}
                  </div>
                </td>

                {/* Amount */}
                <td
                  style={{
                    ...TD_STYLE,
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    color: txn.type === "expense" ? "#dc2626" : "#16A34A",
                  }}
                >
                  {txn.type === "expense" ? "-" : "+"}$
                  {Math.abs(txn.amount ?? 0).toFixed(2)}
                </td>

                {/* Category dropdown */}
                <td style={TD_STYLE}>
                  <CategoryDropdown
                    value={txn.category}
                    disabled={isUpdating}
                    onChange={(cat) => onCategoryChange(txn.id, cat)}
                  />
                </td>

                {/* Tax Category (read-only) */}
                <td style={{ ...TD_STYLE, color: "#6b7280", whiteSpace: "nowrap" }}>
                  {txn.taxCategory || "—"}
                </td>

                {/* Assign To dropdown (only if user has entities) */}
                {entities.length > 0 && (
                  <td style={TD_STYLE}>
                    <EntityDropdown
                      value={txn.entityId}
                      entities={entities}
                      disabled={isUpdating}
                      onChange={(entityId, entityType, entityName) =>
                        onEntityChange(txn.id, entityId, entityType, entityName)
                      }
                    />
                  </td>
                )}

                {/* Confidence */}
                <td style={{ ...TD_STYLE, textAlign: "center" }}>
                  <ConfidenceCell confidence={txn.categorizationConfidence} />
                </td>

                {/* Source badge */}
                <td style={{ ...TD_STYLE, textAlign: "center" }}>
                  <SourceBadge source={txn.source} />
                </td>

                {/* Confirm button */}
                <td style={{ ...TD_STYLE, textAlign: "center" }}>
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
                    Confirm
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
