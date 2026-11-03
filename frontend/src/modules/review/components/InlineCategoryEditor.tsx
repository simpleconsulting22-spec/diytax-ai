import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { TAX_CATEGORIES, CATEGORY_GROUPS } from "./CategoryDropdown";
import { normalizeCategoryName } from "../../../utils/normalizeCategory";

// ─── Entity-type filter ───────────────────────────────────────────────────────

function categoriesForEntity(entityType?: "business" | "rental" | "personal" | null): string[] {
  if (!entityType || entityType === "personal") return TAX_CATEGORIES;
  if (entityType === "business") {
    return CATEGORY_GROUPS
      .filter((g) => g.group.startsWith("Income") || g.group.startsWith("Business"))
      .flatMap((g) => g.categories);
  }
  return CATEGORY_GROUPS
    .filter((g) => g.group.startsWith("Income") || g.group.startsWith("Rental") || g.group.startsWith("Deductions"))
    .flatMap((g) => g.categories);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type CategorySource = "rule" | "user_rule" | "ai" | null;

interface InlineCategoryEditorProps {
  value: string | null;
  source: CategorySource;
  disabled?: boolean;
  entityType?: "business" | "rental" | "personal" | null;
  customCategories?: string[];
  onChange: (category: string) => void;
  onCustomCategoryAdded?: (category: string) => void;
}

const SOURCE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  rule:      { label: "rule",    bg: "#f0fdf4", color: "#15803d" },
  user_rule: { label: "learned", bg: "#eff6ff", color: "#1d4ed8" },
  ai:        { label: "AI",      bg: "#fff7ed", color: "#c2410c" },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function InlineCategoryEditor({
  value,
  source,
  disabled = false,
  entityType,
  customCategories = [],
  onChange,
  onCustomCategoryAdded,
}: InlineCategoryEditorProps) {
  const [editing, setEditing]         = useState(false);
  const [inputValue, setInputValue]   = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // ── Category pool ──────────────────────────────────────────────────────────
  // Predefined list (filtered by entity type) + user custom categories,
  // deduplicated by normalizedName so "business meals" won't duplicate "Business Meals".
  const categoryPool = useMemo(() => {
    const base = categoriesForEntity(entityType);
    if (customCategories.length === 0) return base;
    const baseNorms = new Set(base.map(normalizeCategoryName));
    const extras = customCategories.filter((c) => !baseNorms.has(normalizeCategoryName(c)));
    return extras.length > 0 ? [...base, ...extras] : base;
  }, [entityType, customCategories]);

  const typed = inputValue.trim();

  // ── Exact match (normalized) ───────────────────────────────────────────────
  // Treats "business meals", "Business Meals", "BusinessMeals" as the same.
  const isExactMatch = typed
    ? categoryPool.some((c) => normalizeCategoryName(c) === normalizeCategoryName(typed))
    : false;

  // ── Filtered suggestions ───────────────────────────────────────────────────
  const filtered = typed
    ? categoryPool.filter((c) => c.toLowerCase().includes(typed.toLowerCase()))
    : categoryPool;

  // When AI suggestion exists and user hasn't typed: pin AI-suggested value at top.
  const baseList =
    source === "ai" && value && !typed
      ? [value, ...categoryPool.filter((c) => c !== value)]
      : filtered;

  const showCustomOption = typed.length > 0 && !isExactMatch;

  // ── Close-match suggestion ─────────────────────────────────────────────────
  // Fires when the user typed something that isn't an exact match but is a
  // substring (normalized) of an existing category, or vice versa.
  // Min 3 chars to avoid noisy false-positives.
  const closeMatch = useMemo(() => {
    if (!typed || typed.length < 3 || isExactMatch) return null;
    const ni = normalizeCategoryName(typed);
    return (
      categoryPool.find((c) => {
        const nc = normalizeCategoryName(c);
        return nc.includes(ni) || ni.includes(nc);
      }) ?? null
    );
  }, [typed, isExactMatch, categoryPool]);

  // ── Custom-category count warning ──────────────────────────────────────────
  const showCustomWarning = showCustomOption && customCategories.length >= 5;

  // ── Dropdown positioning ───────────────────────────────────────────────────
  const updateDropdownPosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: "fixed",
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.max(rect.width, 230),
      zIndex: 9999,
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "8px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.14)",
      maxHeight: "260px",
      overflowY: "auto",
    });
  }, []);

  // ── Open / close ───────────────────────────────────────────────────────────
  function openEditor() {
    if (disabled) return;
    updateDropdownPosition();
    setEditing(true);
    setInputValue("");
    setHighlighted(0);
  }

  function closeEditor() {
    setEditing(false);
    setInputValue("");
  }

  // ── Select ─────────────────────────────────────────────────────────────────
  // Normalizes the chosen value against categoryPool so the canonical name is
  // always used (e.g. typing "business meals" resolves to "Business Meals").
  function select(raw: string) {
    const ni = normalizeCategoryName(raw);
    const canonical =
      categoryPool.find((c) => normalizeCategoryName(c) === ni) ?? raw.trim();

    onChange(canonical);

    // Only fire the persistence callback when the category is genuinely absent
    // from the current pool (i.e. it's a net-new custom category).
    if (!categoryPool.some((c) => normalizeCategoryName(c) === ni)) {
      onCustomCategoryAdded?.(canonical);
    }

    closeEditor();
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────
  const suggestions = baseList;
  const totalOptions = suggestions.length + (showCustomOption ? 1 : 0);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { closeEditor(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, totalOptions - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showCustomOption && highlighted === suggestions.length) {
        select(typed);
      } else if (suggestions[highlighted]) {
        select(suggestions[highlighted]);
      } else if (showCustomOption && typed) {
        select(typed);
      }
    }
  }

  // ── Click outside ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editing) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeEditor();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [editing]);

  // ── Reposition on scroll / resize ──────────────────────────────────────────
  useEffect(() => {
    if (!editing) return;
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [editing, updateDropdownPosition]);

  // ── Auto-focus ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const sourceCfg = source ? SOURCE_CONFIG[source] : null;

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editing) {
    const showAILabel = source === "ai" && value && !typed;

    return (
      <div ref={containerRef} style={{ position: "relative", minWidth: "180px" }}>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => { setInputValue(e.target.value); setHighlighted(0); }}
          onKeyDown={handleKeyDown}
          placeholder={value ?? "Search categories…"}
          style={{
            width: "100%",
            padding: "6px 10px",
            border: "2px solid #16A34A",
            borderRadius: "6px",
            fontSize: "13px",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
            color: "#111827",
          }}
        />
        <div style={dropdownStyle}>

          {/* AI suggestion header */}
          {showAILabel && (
            <div style={{
              padding: "5px 12px 3px",
              fontSize: "10px",
              color: "#c2410c",
              fontWeight: 700,
              letterSpacing: "0.06em",
              borderBottom: "1px solid #fff7ed",
              backgroundColor: "#fff7ed",
            }}>
              ✦ AI SUGGESTION — click to accept or type to override
            </div>
          )}

          {/* Close-match suggestion banner */}
          {closeMatch && !showAILabel && (
            <div
              onMouseDown={(e) => { e.preventDefault(); select(closeMatch); }}
              style={{
                padding: "7px 12px",
                backgroundColor: "#fefce8",
                borderBottom: "1px solid #fef08a",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span style={{ color: "#a16207" }}>💡 Use existing:</span>
              <span style={{ fontWeight: 600, color: "#111827" }}>{closeMatch}</span>
            </div>
          )}

          {/* Main list */}
          {suggestions.length === 0 && !showCustomOption ? (
            <div style={{ padding: "10px 12px", color: "#9ca3af", fontSize: "13px" }}>
              No matches — press Enter to use &ldquo;{typed}&rdquo; as a custom category
            </div>
          ) : (
            <>
              {suggestions.map((cat, i) => {
                const isAiPinned = i === 0 && source === "ai" && cat === value && !typed;
                return (
                  <div
                    key={cat + i}
                    onMouseDown={(e) => { e.preventDefault(); select(cat); }}
                    onMouseEnter={() => setHighlighted(i)}
                    style={{
                      padding: "8px 12px",
                      fontSize: "13px",
                      cursor: "pointer",
                      backgroundColor: i === highlighted
                        ? (isAiPinned ? "#fff7ed" : "#f0fdf4")
                        : "transparent",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: isAiPinned ? "1px solid #f3f4f6" : "none",
                    }}
                  >
                    <span style={{
                      color: isAiPinned ? "#c2410c" : "#111827",
                      fontWeight: isAiPinned ? 600 : 400,
                    }}>
                      {cat}
                    </span>
                    {isAiPinned && (
                      <span style={{
                        fontSize: "10px",
                        padding: "1px 7px",
                        backgroundColor: "#fff7ed",
                        color: "#c2410c",
                        borderRadius: "999px",
                        fontWeight: 700,
                        border: "1px solid #fed7aa",
                      }}>
                        AI
                      </span>
                    )}
                  </div>
                );
              })}

              {/* "+ Use as custom category" option */}
              {showCustomOption && (
                <div
                  onMouseDown={(e) => { e.preventDefault(); select(typed); }}
                  onMouseEnter={() => setHighlighted(suggestions.length)}
                  style={{
                    padding: "8px 12px",
                    fontSize: "13px",
                    cursor: "pointer",
                    backgroundColor: highlighted === suggestions.length ? "#f0f6ff" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    borderTop: suggestions.length > 0 ? "1px solid #f3f4f6" : "none",
                    color: "#2563eb",
                    fontWeight: 500,
                  }}
                >
                  <span style={{ fontSize: "14px" }}>+</span>
                  Use &ldquo;{typed}&rdquo; as custom category
                </div>
              )}

              {/* Custom category count warning */}
              {showCustomWarning && (
                <div style={{
                  padding: "6px 12px",
                  fontSize: "11px",
                  color: "#92400e",
                  backgroundColor: "#fffbeb",
                  borderTop: "1px solid #fef3c7",
                }}>
                  ⚠ You have {customCategories.length} custom categories — consider reusing an existing one above.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  // Two visual styles depending on whether the cell has a value:
  //   • Categorized → minimal text, hover gives a subtle border (no noise on
  //     rows that are already good).
  //   • Empty       → button-like affordance with a persistent dashed border
  //     and a "+ Add category" label so the click target is unmistakable.
  // Click target is the full container in both modes, sized for an easy hit.
  const isEmpty = !value;
  return (
    <div
      ref={containerRef}
      onClick={openEditor}
      title={disabled ? undefined : (isEmpty ? "Click to add a category" : "Click to edit")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        cursor: disabled ? "default" : "pointer",
        borderRadius: "6px",
        padding: isEmpty ? "5px 12px" : "4px 8px",
        border: isEmpty
          ? "1.5px dashed #9ca3af"      // persistent affordance for empty rows
          : "1.5px solid transparent",
        backgroundColor: isEmpty ? "#fafafa" : "transparent",
        minWidth: isEmpty ? "150px" : undefined,
        maxWidth: "240px",
        transition: "border-color 0.12s, background-color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        const el = e.currentTarget as HTMLDivElement;
        if (isEmpty) {
          el.style.borderColor     = "#16A34A";
          el.style.borderStyle     = "solid";
          el.style.backgroundColor = "#f0fdf4";
        } else {
          el.style.borderColor     = "#d1d5db";
          el.style.backgroundColor = "#f9fafb";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        if (isEmpty) {
          el.style.borderColor     = "#9ca3af";
          el.style.borderStyle     = "dashed";
          el.style.backgroundColor = "#fafafa";
        } else {
          el.style.borderColor     = "transparent";
          el.style.backgroundColor = "transparent";
        }
      }}
    >
      {isEmpty ? (
        <>
          <span style={{ color: "#16A34A", fontSize: "13px", fontWeight: 700, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: "13px", color: "#374151", fontWeight: 500 }}>
            Add category
          </span>
        </>
      ) : (
        <span style={{
          fontSize: "13px",
          color: "#111827",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {value}
        </span>
      )}
      {sourceCfg && (
        <span style={{
          fontSize: "10px",
          padding: "1px 6px",
          backgroundColor: sourceCfg.bg,
          color: sourceCfg.color,
          borderRadius: "999px",
          fontWeight: 700,
          flexShrink: 0,
        }}>
          {sourceCfg.label}
        </span>
      )}
    </div>
  );
}
