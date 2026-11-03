import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sparkles, Send, X, ListChecks, MessageCircle, ArrowRight, ExternalLink } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear } from "../../contexts/TaxYearContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  BASIS_LABEL,
  FindingSeverity,
  ZachAnswer,
  ZachFinding,
  askZach,
  getZachFindings,
  zachErrorMessage,
} from "./zachApi";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const INK = "#111827";
const MUTED = "#6b7280";
const GREEN = "#16A34A";
const MAX_CHARS = 1500;

/** Pages where Zach is not shown (public pages and first-run onboarding). */
const HIDDEN_PREFIXES = ["/login", "/accept-invite", "/privacy-policy", "/terms-of-service", "/onboarding", "/admin"];

interface ChatItem {
  role: "user" | "assistant";
  text: string;
  answer?: ZachAnswer;
  error?: boolean;
}

const SUGGESTIONS: Array<[RegExp, string[]]> = [
  [/^\/income/, ["Is my Social Security income taxable?", "What counts as retirement income?", "What information do I need next?"]],
  [/^\/(deductions|schedule-a)/, ["Should I itemize or take the standard deduction?", "What deductions might I be missing?", "What can I deduct for charity?"]],
  [/^\/tax-summary/, ["How is self-employment tax calculated?", "What business expenses can I deduct?", "Do I need to pay estimated taxes?"]],
  [/^\/schedule-e/, ["What rental expenses are deductible?", "How is rental income taxed?"]],
  [/^\/(review|transactions|transfers)/, ["How should I categorize this kind of expense?", "Why are some transactions left out of my totals?"]],
  [/^\/(tax-estimate|dashboard)/, ["Why do I owe taxes?", "Can you explain this calculation?", "Why did my estimate change?"]],
];
const DEFAULT_SUGGESTIONS = ["What information do I need next?", "What deductions might I be missing?", "Why do I owe taxes?"];

const SEVERITY_STYLE: Record<FindingSeverity, { label: string; bg: string; fg: string }> = {
  action: { label: "To do", bg: "#fef2f2", fg: "#b91c1c" },
  check: { label: "Check", bg: "#fffbeb", fg: "#b45309" },
  opportunity: { label: "Possible savings", bg: "#f0fdf4", fg: "#15803d" },
  info: { label: "FYI", bg: "#eff6ff", fg: "#1d4ed8" },
};

function newConversationId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeStorage<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Plain text with "- " bullets → paragraphs and lists. No HTML is injected. */
function AnswerText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
          return (
            <ul key={i} style={{ margin: "6px 0", paddingLeft: "18px" }}>
              {lines.map((l, j) => (
                <li key={j} style={{ marginBottom: "3px" }}>{l.replace(/^\s*[-•*]\s+/, "")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ margin: "6px 0" }}>
            {lines.join(" ")}
          </p>
        );
      })}
    </>
  );
}

export default function ZachAssistant() {
  const { user, mfaVerified } = useAuth();
  const { selectedYear } = useTaxYear();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const storeKey = user ? `zach:${user.uid}:${selectedYear}` : "";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"ask" | "checklist">("ask");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [conversationId, setConversationId] = useState<string>(newConversationId);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<ZachFinding[] | null>(null);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const hidden = !user || !mfaVerified || location.pathname === "/" || HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p));

  // Conversation lives in this browser tab only; nothing is stored on the server.
  useEffect(() => {
    if (!storeKey) return;
    const saved = safeStorage<{ items: ChatItem[]; conversationId: string } | null>(storeKey, null);
    setItems(saved?.items ?? []);
    setConversationId(saved?.conversationId ?? newConversationId());
  }, [storeKey]);

  useEffect(() => {
    if (!storeKey) return;
    try {
      sessionStorage.setItem(storeKey, JSON.stringify({ items: items.slice(-30), conversationId }));
    } catch {
      /* storage unavailable — conversation simply won't persist */
    }
  }, [items, conversationId, storeKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, busy]);

  // Proactive checklist: deterministic, no AI cost. Loaded once per year/session.
  const loadFindings = useCallback(async () => {
    if (!user || !mfaVerified) return;
    setFindingsError(null);
    try {
      const r = await getZachFindings(selectedYear);
      setFindings(r.findings);
    } catch (e) {
      setFindingsError(zachErrorMessage(e));
    }
  }, [user, mfaVerified, selectedYear]);

  useEffect(() => {
    setFindings(null);
    if (!hidden) void loadFindings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, user?.uid, mfaVerified]);

  const actionCount = useMemo(() => (findings ?? []).filter((f) => f.severity === "action").length, [findings]);

  const suggestions = useMemo(
    () => SUGGESTIONS.find(([re]) => re.test(location.pathname))?.[1] ?? DEFAULT_SUGGESTIONS,
    [location.pathname]
  );

  async function send(text: string, mode: "chat" | "review" = "chat") {
    const message = text.trim();
    if (!message || busy) return;
    setTab("ask");
    const history = items
      .filter((i) => !i.error)
      .map((i) => ({ role: i.role, content: i.role === "assistant" ? i.answer?.answer ?? i.text : i.text }))
      .slice(-12);
    setItems((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const a = await askZach({
        message,
        taxYear: selectedYear,
        page: location.pathname,
        mode,
        conversationId,
        history,
      });
      setItems((prev) => [...prev, { role: "assistant", text: a.answer, answer: a }]);
      if (a.findings) setFindings(a.findings);
    } catch (e) {
      setItems((prev) => [...prev, { role: "assistant", text: zachErrorMessage(e), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function go(path: string) {
    navigate(path);
    if (isMobile) setOpen(false);
  }

  function newChat() {
    setItems([]);
    setConversationId(newConversationId());
  }

  if (hidden) return null;

  const fabBottom = isMobile ? "calc(64px + env(safe-area-inset-bottom, 0px) + 16px + 58px + 12px)" : "98px";

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Ask Zach, your tax assistant"
          style={{
            position: "fixed",
            bottom: fabBottom,
            right: isMobile ? "20px" : "28px",
            height: "44px",
            padding: "0 16px 0 12px",
            borderRadius: "22px",
            backgroundColor: INK,
            color: "#fff",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(17, 24, 39, 0.35)",
            zIndex: 900,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: font,
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          <Sparkles size={18} color="#86efac" />
          Ask Zach
          {actionCount > 0 && (
            <span
              aria-label={`${actionCount} item(s) need attention`}
              style={{ backgroundColor: "#ef4444", borderRadius: "10px", minWidth: "20px", height: "20px", fontSize: "12px", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}
            >
              {actionCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Zach, tax assistant"
          style={{
            position: "fixed",
            zIndex: 1002,
            backgroundColor: "#fff",
            fontFamily: font,
            color: INK,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            ...(isMobile
              ? { inset: 0 }
              : { right: "24px", bottom: "24px", width: "400px", height: "min(640px, calc(100vh - 48px))", borderRadius: "16px", overflow: "hidden" }),
          }}
        >
          {/* Header */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "50%", backgroundColor: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={18} color={GREEN} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>Zach</div>
              <div style={{ fontSize: "12px", color: MUTED }}>Tax assistant · {selectedYear} tax year</div>
            </div>
            {items.length > 0 && tab === "ask" && (
              <button onClick={newChat} style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "4px 10px", fontSize: "12px", color: MUTED, cursor: "pointer", fontFamily: font }}>
                New chat
              </button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close Zach" style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: "4px" }}>
              <X size={20} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", padding: "8px 12px 0", borderBottom: "1px solid #f3f4f6" }}>
            {(
              [
                ["ask", "Ask", MessageCircle],
                ["checklist", `Checklist${findings ? ` (${findings.length})` : ""}`, ListChecks],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", border: "none", background: "none",
                  borderBottom: tab === id ? `2px solid ${GREEN}` : "2px solid transparent",
                  color: tab === id ? INK : MUTED, fontWeight: 600, fontSize: "13px", cursor: "pointer", fontFamily: font,
                }}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", backgroundColor: "#fafafa" }}>
            {tab === "checklist" ? (
              <div>
                <p style={{ fontSize: "13px", color: MUTED, margin: "0 0 12px" }}>
                  Zach checks your {selectedYear} information for gaps and inconsistencies. Nothing changes until you change it.
                </p>
                {findingsError && <div style={{ fontSize: "13px", color: "#b91c1c" }}>{findingsError}</div>}
                {!findings && !findingsError && <div style={{ fontSize: "13px", color: MUTED }}>Checking…</div>}
                {findings && findings.length === 0 && (
                  <div style={{ fontSize: "14px", color: "#15803d" }}>Nothing needs attention right now.</div>
                )}
                {findings?.map((f) => {
                  const s = SEVERITY_STYLE[f.severity];
                  return (
                    <div key={f.id} style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px", marginBottom: "10px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, backgroundColor: s.bg, color: s.fg, borderRadius: "6px", padding: "2px 8px" }}>{s.label}</span>
                      <div style={{ fontSize: "14px", margin: "8px 0 4px" }}>{f.message}</div>
                      <div style={{ fontSize: "12px", color: MUTED }}>{f.evidence}</div>
                      {f.source && (
                        <a href={f.source.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#2563eb", textDecoration: "none", marginTop: "4px" }}>
                          <ExternalLink size={12} /> {f.source.title}
                        </a>
                      )}
                      {f.path && (
                        <button onClick={() => go(f.path!)} style={{ marginTop: "8px", display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", color: GREEN, fontWeight: 600, fontSize: "13px", cursor: "pointer", padding: 0, fontFamily: font }}>
                          Go there <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {findings && findings.length > 0 && (
                  <button
                    onClick={() => send("Review my tax information", "review")}
                    disabled={busy}
                    style={{ width: "100%", marginTop: "4px", padding: "10px", borderRadius: "10px", border: "none", backgroundColor: INK, color: "#fff", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: font }}
                  >
                    Have Zach walk me through these
                  </button>
                )}
              </div>
            ) : (
              <div>
                {items.length === 0 && (
                  <div>
                    <p style={{ fontSize: "14px", margin: "0 0 12px" }}>
                      Hi, I'm Zach. Ask me about your taxes, a form or field, or what to do next. I use the {selectedYear} tax year and your DIYTax AI data.
                    </p>
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", marginBottom: "8px", border: "1px solid #e5e7eb", borderRadius: "10px", backgroundColor: "#fff", fontSize: "13px", color: INK, cursor: "pointer", fontFamily: font }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {items.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
                      <div style={{ backgroundColor: GREEN, color: "#fff", padding: "8px 12px", borderRadius: "14px 14px 4px 14px", maxWidth: "85%", fontSize: "14px", whiteSpace: "pre-wrap" }}>{m.text}</div>
                    </div>
                  ) : (
                    <div key={i} style={{ margin: "8px 0" }}>
                      <div style={{ backgroundColor: m.error ? "#fef2f2" : "#fff", border: `1px solid ${m.error ? "#fecaca" : "#e5e7eb"}`, padding: "10px 12px", borderRadius: "14px 14px 14px 4px", maxWidth: "92%", fontSize: "14px", lineHeight: 1.5 }}>
                        {m.answer && <div style={{ fontSize: "11px", color: MUTED, fontWeight: 600, marginBottom: "2px" }}>{BASIS_LABEL[m.answer.basis]}</div>}
                        <AnswerText text={m.text} />
                        {m.answer?.followUpQuestion && <p style={{ margin: "6px 0", fontWeight: 600 }}>{m.answer.followUpQuestion}</p>}
                        {m.answer && m.answer.missingInfo.length > 0 && (
                          <div style={{ fontSize: "13px", marginTop: "6px" }}>
                            <div style={{ fontWeight: 600 }}>To answer fully, Zach needs:</div>
                            <ul style={{ margin: "4px 0", paddingLeft: "18px" }}>{m.answer.missingInfo.map((x, j) => <li key={j}>{x}</li>)}</ul>
                          </div>
                        )}
                        {m.answer?.seeProfessional && (
                          <div style={{ fontSize: "12px", backgroundColor: "#fffbeb", color: "#92400e", borderRadius: "8px", padding: "6px 8px", marginTop: "6px" }}>
                            This may need a qualified tax professional's review.
                          </div>
                        )}
                        {m.answer && m.answer.actions.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
                            {m.answer.actions.map((a) => (
                              <button key={a.routeId} onClick={() => go(a.path)} style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "6px 10px", borderRadius: "8px", border: `1px solid ${GREEN}`, backgroundColor: "#f0fdf4", color: "#15803d", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                                {a.label} <ArrowRight size={13} />
                              </button>
                            ))}
                          </div>
                        )}
                        {m.answer && m.answer.sources.length > 0 && (
                          <div style={{ marginTop: "8px", fontSize: "12px" }}>
                            {m.answer.sources.map((s) => (
                              <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", gap: "4px", color: "#2563eb", textDecoration: "none", marginTop: "2px" }}>
                                <ExternalLink size={12} /> {s.title}
                              </a>
                            ))}
                          </div>
                        )}
                        {m.answer && m.answer.tableYear !== m.answer.taxYear && (
                          <div style={{ fontSize: "11px", color: MUTED, marginTop: "6px" }}>
                            Uses {m.answer.tableYear} IRS figures; {m.answer.taxYear} figures aren't in DIYTax AI yet.
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}
                {busy && <div style={{ fontSize: "13px", color: MUTED, margin: "8px 0" }}>Zach is thinking…</div>}
                <div ref={endRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            style={{ borderTop: "1px solid #e5e7eb", padding: "10px 12px", backgroundColor: "#fff" }}
          >
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                placeholder="Ask Zach a tax question…"
                aria-label="Message Zach"
                style={{ flex: 1, resize: "none", border: "1px solid #d1d5db", borderRadius: "10px", padding: "8px 10px", fontSize: "14px", fontFamily: font, outline: "none" }}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send"
                style={{ width: "40px", height: "40px", borderRadius: "10px", border: "none", backgroundColor: busy || !input.trim() ? "#d1d5db" : GREEN, color: "#fff", cursor: busy || !input.trim() ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <Send size={17} />
              </button>
            </div>
            <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "6px" }}>
              Zach explains and guides. He can't change your data or file your return, and he isn't a substitute for professional tax advice. Don't share Social Security or account numbers.
            </div>
          </form>
        </div>
      )}
    </>
  );
}
