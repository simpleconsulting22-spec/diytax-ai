import React, { useState, useRef, useEffect, useCallback } from "react";
import { TAX_CATEGORIES } from "./CategoryDropdown";

type CategorySource = "rule" | "user_rule" | "ai" | null;

interface InlineCategoryEditorProps {
  value: string | null;
  source: CategorySource;
  disabled?: boolean;
  onChange: (category: string) => void;
}

const SOURCE_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  rule:      { label: "rule",    bg: "#f0fdf4", color: "#15803d" },
  user_rule: { label: "learned", bg: "#eff6ff", color: "#1d4ed8" },
  ai:        { label: "AI",      bg: "#fff7ed", color: "#c2410c" },
};

export default function InlineCategoryEditor({
  value,
  source,
  disabled = false,
  onChange,
}: InlineCategoryEditorProps) {
  const [editing, setEditing]         = useState(false);
  const [inputValue, setInputValue]   = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // ── Suggestions list ───────────────────────────────────────────────────────
  const typed = inputValue.trim();
  const filtered = typed
    ? TAX_CATEGORIES.filter((c) => c.toLowerCase().includes(typed.toLowerCase()))
    : TAX_CATEGORIES;

  // When there is an AI suggestion and the user hasn't typed, pin current value at top
  const suggestions =
    source === "ai" && value && !typed
      ? [value, ...TAX_CATEGORIES.filter((c) => c !== value)]
      : filtered;

  // ── Dropdown positioning (fixed, escapes overflow:auto containers) ─────────
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

  function select(cat: string) {
    onChange(cat);
    closeEditor();
  }

  // ── Keyboard navigation ────────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { closeEditor(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions[highlighted]) select(suggestions[highlighted]);
    }
  }

  // ── Click outside to close ─────────────────────────────────────────────────
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

  // ── Auto-focus input ───────────────────────────────────────────────────────
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
          {suggestions.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "#9ca3af", fontSize: "13px" }}>
              No matches
            </div>
          ) : (
            suggestions.map((cat, i) => {
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
            })
          )}
        </div>
      </div>
    );
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      onClick={openEditor}
      title={disabled ? undefined : "Click to edit"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        cursor: disabled ? "default" : "pointer",
        borderRadius: "6px",
        padding: "4px 8px",
        border: "1.5px solid transparent",
        maxWidth: "240px",
        transition: "border-color 0.12s, background-color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "#d1d5db";
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#f9fafb";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
        (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent";
      }}
    >
      <span style={{
        fontSize: "13px",
        color: value ? "#111827" : "#9ca3af",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontStyle: value ? "normal" : "italic",
      }}>
        {value ?? "Add category…"}
      </span>
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
