import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { apiClient } from "../../../services/apiClient";
import { CATEGORY_GROUPS, getMapping } from "../../../shared/taxMap";
import { extractVendor } from "../../../shared/vendorExtraction";
import type { ReviewTransaction } from "../hooks/useReviewTransactions";
import { TRIGGER_TEXT } from "./ReviewTable";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const ROUND_SIZE = 10;
const DEDUCTIBLE = new Set(["Schedule C", "Schedule E", "Schedule A"]);
const PURPOSE: Record<string, string> = { "Schedule C": "business", "Schedule E": "rental", "Schedule A": "itemized deduction" };

interface Group {
  key: string;
  vendor: string;
  rows: ReviewTransaction[];
  total: number;
  guess: string | null;
  guessSchedule: string | null;
  reason: string | null;
  from: string;
  to: string;
}

const money = (n: number) => `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function hiddenKey(uid: string) {
  return `zachQuestionsHidden:${uid}`;
}
function readHidden(uid: string): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(hiddenKey(uid)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Zach's questions: Needs-review transactions grouped by merchant, a round at
 * a time. Every answer goes through updateTransactionCategory, so it is
 * audited (history), Sure, and undoable. Deductible answers need an explicit
 * purpose confirmation. A rule is saved only when "Always do this" is ticked.
 */
export default function ZachQuestionsPanel({
  transactions,
  userId,
  onAnswered,
}: {
  transactions: ReviewTransaction[];
  userId: string;
  onAnswered: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(userId));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<{ key: string; category: string } | null>(null);
  // Opened from a round email (?zach=mine): show the questions Zach sent this person first.
  const [params, setParams] = useSearchParams();
  const mineMode = params.get("zach") === "mine";
  const [mine, setMine] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!mineMode) return;
    apiClient
      .call<{ keys: string[] }>("getMyZachRound")
      .then((r) => setMine(new Set(r.keys)))
      .catch(() => setMine(new Set()));
  }, [mineMode]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const t of transactions) {
      if (t.status !== "needs_review" || t.type === "transfer") continue;
      const vendor =
        extractVendor({ description: t.description, normalizedDescription: t.normalizedDescription, vendor: t.vendor ?? undefined }) ||
        t.description.slice(0, 28);
      const key = vendor.toLowerCase();
      if (hidden.has(key)) continue;
      const g = map.get(key) ?? { key, vendor, rows: [], total: 0, guess: null, guessSchedule: null, reason: null, from: t.date, to: t.date };
      g.rows.push(t);
      g.total += Math.abs(t.amount);
      if (!g.guess && t.category) {
        g.guess = t.category;
        g.guessSchedule = t.taxSchedule ?? getMapping(t.category)?.taxSchedule ?? null;
      }
      const trig = (t.reviewTriggers ?? []).map((x) => TRIGGER_TEXT[x]).find(Boolean);
      if (!g.reason && trig) g.reason = trig;
      if (t.date < g.from) g.from = t.date;
      if (t.date > g.to) g.to = t.date;
      map.set(key, g);
    }
    const all = [...map.values()].sort((a, b) => b.total - a.total);
    return mineMode && mine ? all.filter((g) => mine.has(g.key)) : all;
  }, [transactions, hidden, mineMode, mine]);

  const round = groups.slice(0, ROUND_SIZE);
  if (groups.length === 0) return null;

  function hide(key: string) {
    const next = new Set(hidden);
    next.add(key);
    setHidden(next);
    try {
      sessionStorage.setItem(hiddenKey(userId), JSON.stringify([...next]));
    } catch {
      /* session-only convenience */
    }
  }

  async function apply(g: Group, category: string) {
    const schedule = getMapping(category)?.taxSchedule ?? "Personal";
    if (DEDUCTIBLE.has(schedule) && !(confirming && confirming.key === g.key && confirming.category === category)) {
      setConfirming({ key: g.key, category });
      return;
    }
    setConfirming(null);
    setBusy(g.key);
    setError(null);
    try {
      for (let i = 0; i < g.rows.length; i++) {
        await apiClient.call("updateTransactionCategory", {
          transactionId: g.rows[i].id,
          category,
          taxCategory: category,
          taxSchedule: schedule,
          createRule: !!remember[g.key] && i === 0,
        });
      }
      await onAnswered();
    } catch (e) {
      const code = ((e as { code?: string }).code ?? "").replace("functions/", "");
      setError(
        code === "permission-denied"
          ? "Only the account owner can answer Zach's questions right now."
          : "Zach couldn't save that answer. Nothing was changed for the rows that failed; please try again."
      );
    } finally {
      setBusy(null);
    }
  }

  const btn = (primary = false): React.CSSProperties => ({
    padding: "5px 10px",
    borderRadius: "7px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: font,
    border: primary ? "none" : "1px solid #d1d5db",
    backgroundColor: primary ? "#16A34A" : "#fff",
    color: primary ? "#fff" : "#374151",
  });

  return (
    <section
      aria-label="Zach's questions"
      style={{ backgroundColor: "#fff", borderRadius: "12px", boxShadow: "0 1px 8px rgba(0,0,0,0.07)", marginBottom: "16px", fontFamily: font }}
    >
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: font }}
      >
        <Sparkles size={18} color="#16A34A" />
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 700, fontSize: "15px", color: "#111827" }}>Zach's questions</span>
          <span style={{ fontSize: "13px", color: "#6b7280" }}>
            {" "}· {round.length} of {groups.length} merchant{groups.length !== 1 ? "s" : ""} need you this round
          </span>
        </span>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open && (
        <div style={{ padding: "0 18px 14px" }}>
          {mineMode && (
            <div style={{ fontSize: "12.5px", color: "#1e40af", backgroundColor: "#eff6ff", borderRadius: "8px", padding: "6px 10px", marginBottom: "8px" }}>
              Showing the questions Zach emailed you.{" "}
              <button onClick={() => { params.delete("zach"); setParams(params); }} style={{ background: "none", border: "none", color: "#1d4ed8", textDecoration: "underline", cursor: "pointer", padding: 0 }}>
                Show everything
              </button>
            </div>
          )}
          <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 10px" }}>
            Answers apply to these transactions only, unless you tick "Always do this". Every answer can be undone from the table below.{" "}
            <Link to="/settings/zach" style={{ color: "#2563eb" }}>Email rounds</Link>
          </p>
          {error && <div role="alert" style={{ fontSize: "13px", color: "#b91c1c", marginBottom: "8px" }}>{error}</div>}
          {round.map((g) => {
            const isConfirming = confirming?.key === g.key;
            const sel = choice[g.key] ?? "";
            return (
              <div key={g.key} style={{ borderTop: "1px solid #f3f4f6", padding: "10px 0", opacity: busy === g.key ? 0.5 : 1 }}>
                <div style={{ fontSize: "14px", color: "#111827" }}>
                  <strong>{g.vendor}</strong> — {g.rows.length} charge{g.rows.length !== 1 ? "s" : ""}, {money(g.total)}
                  <span style={{ color: "#9ca3af", fontSize: "12px" }}> ({g.from === g.to ? g.from : `${g.from} to ${g.to}`})</span>
                </div>
                <div style={{ fontSize: "12.5px", color: "#4b5563", margin: "3px 0 6px" }}>
                  {g.guess ? (
                    <>Zach's guess: <strong>{g.guess}</strong>{g.guessSchedule ? ` (${g.guessSchedule})` : ""}. </>
                  ) : (
                    <>Zach doesn't have a guess yet. </>
                  )}
                  {g.reason ?? "What was this for?"}
                </div>

                {isConfirming ? (
                  <div style={{ backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "8px", padding: "8px 10px", fontSize: "12.5px", color: "#78350f" }}>
                    "{confirming!.category}" counts toward {getMapping(confirming!.category)?.taxSchedule}. Confirm these {g.rows.length} charge{g.rows.length !== 1 ? "s were" : " was"} for a {PURPOSE[getMapping(confirming!.category)?.taxSchedule ?? ""] ?? "deductible"} purpose?
                    <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                      <button style={btn(true)} disabled={busy !== null} onClick={() => apply(g, confirming!.category)}>Yes, confirm</button>
                      <button style={btn()} onClick={() => setConfirming(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                    {g.guess && (
                      <button style={btn(true)} disabled={busy !== null} onClick={() => apply(g, g.guess!)}>
                        Yes, {g.guess}
                      </button>
                    )}
                    <select
                      aria-label={`Choose a category for ${g.vendor}`}
                      value={sel}
                      onChange={(e) => setChoice({ ...choice, [g.key]: e.target.value })}
                      style={{ padding: "5px 8px", borderRadius: "7px", border: "1px solid #d1d5db", fontSize: "12px", fontFamily: font, maxWidth: "200px" }}
                    >
                      <option value="">Something else…</option>
                      {CATEGORY_GROUPS.map((cg) => (
                        <optgroup key={cg.group} label={cg.group}>
                          {cg.categories.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {sel && (
                      <button style={btn(true)} disabled={busy !== null} onClick={() => apply(g, sel)}>Use {sel}</button>
                    )}
                    <button style={btn()} disabled={busy !== null} onClick={() => apply(g, "Other Personal")}>Personal</button>
                    <button style={btn()} onClick={() => hide(g.key)}>I don't remember</button>
                    <button style={btn()} onClick={() => hide(g.key)}>Skip</button>
                    <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "#4b5563" }}>
                      <input
                        type="checkbox"
                        checked={!!remember[g.key]}
                        onChange={(e) => setRemember({ ...remember, [g.key]: e.target.checked })}
                      />
                      Always do this for {g.vendor}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
          {groups.length > round.length && (
            <div style={{ fontSize: "12px", color: "#9ca3af", paddingTop: "6px" }}>
              {groups.length - round.length} more merchant{groups.length - round.length !== 1 ? "s" : ""} after this round.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
