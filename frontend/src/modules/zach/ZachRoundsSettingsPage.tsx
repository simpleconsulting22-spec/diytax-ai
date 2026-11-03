import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppNav from "../../components/AppNav";
import { apiClient } from "../../services/apiClient";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const card: React.CSSProperties = { backgroundColor: "#fff", borderRadius: "12px", padding: "20px 24px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px" };
const selectStyle: React.CSSProperties = { padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "13px", fontFamily: font, backgroundColor: "#fff" };

type Cadence = "weekly" | "biweekly" | "monthly";
interface Settings {
  enabled: boolean;
  cadence: Cadence;
  accountRespondents: Record<string, string>;
  defaultRespondent: string;
  nextRoundAt: number | null;
  lastRoundAt: number | null;
}
interface Loaded {
  settings: Settings;
  canEdit: boolean;
  members: Array<{ uid: string; role: "owner" | "spouse"; email: string }>;
  accounts: Array<{ id: string; name: string }>;
}
interface Preview {
  byRespondent: Record<string, { email: string; groups: Array<{ vendor: string; count: number; total: number }> }>;
  totalGroups: number;
}

const CADENCE_LABEL: Record<Cadence, string> = { weekly: "Every week", biweekly: "Every 2 weeks", monthly: "Every month" };
const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

export default function ZachRoundsSettingsPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.call<Loaded>("getZachRoundSettings");
      setData(r);
      setDraft(r.settings);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Couldn't load question-round settings.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (uid: string) => {
    const m = data?.members.find((x) => x.uid === uid);
    return m ? `${m.role === "owner" ? "You (owner)" : "Spouse"} · ${m.email}` : uid;
  };

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await apiClient.call<Settings>("saveZachRoundSettings", draft);
      setDraft(saved);
      setNotice(saved.enabled ? "Saved. Zach will check for questions at the next daily run (9 AM Central)." : "Saved. Question rounds are off.");
      await load();
    } catch (e) {
      setError((e as { message?: string }).message ?? "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      setPreview(await apiClient.call<Preview>("previewZachRound"));
    } catch (e) {
      setError((e as { message?: string }).message ?? "Couldn't preview.");
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    setBusy(true);
    setError(null);
    setConfirmSend(false);
    try {
      const r = await apiClient.call<{ sent: boolean }>("sendZachRoundNow");
      setNotice(r.sent ? "Round sent. Check your inbox." : "Nothing to ask right now, so no email was sent.");
      await load();
    } catch (e) {
      setError((e as { message?: string }).message ?? "Couldn't send.");
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !data?.canEdit;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: "22px", margin: "0 0 4px", color: "#111827" }}>Zach's question rounds</h1>
        <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 20px" }}>
          Zach emails your household a short list of transactions he needs help with, while you still remember them. Answers are made in DIYTax AI, and every answer can be undone.
        </p>
        {error && <div role="alert" style={{ ...card, color: "#b91c1c" }}>{error}</div>}
        {notice && <div role="status" style={{ ...card, color: "#15803d" }}>{notice}</div>}

        {data && draft && (
          <>
            <div style={card}>
              {readOnly && (
                <p style={{ fontSize: "13px", color: "#92400e", marginTop: 0 }}>Only the account owner can change these settings.</p>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, marginBottom: "14px" }}>
                <input type="checkbox" disabled={readOnly} checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Send question rounds by email
              </label>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px", marginBottom: "12px" }}>
                How often
                <select disabled={readOnly} value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Cadence })} style={selectStyle}>
                  {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                    <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                  ))}
                </select>
              </label>
              <div style={{ fontSize: "12px", color: "#6b7280" }}>
                Last round: {day(draft.lastRoundAt)} · Next: {draft.enabled ? day(draft.nextRoundAt) : "off"} · No email is sent when there's nothing to ask. One reminder after 3 days if questions are still open.
              </div>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 600, marginBottom: "4px" }}>Who answers</div>
              <p style={{ fontSize: "12px", color: "#6b7280", margin: "0 0 12px" }}>
                Questions go to the person who usually uses each account. Household members: {data.members.map((m) => (m.role === "owner" ? "you" : "your spouse")).join(" and ")}.
              </p>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", fontSize: "13px", marginBottom: "10px" }}>
                <span>Anything not listed below</span>
                <select disabled={readOnly} value={draft.defaultRespondent} onChange={(e) => setDraft({ ...draft, defaultRespondent: e.target.value })} style={selectStyle}>
                  {data.members.map((m) => (
                    <option key={m.uid} value={m.uid}>{nameOf(m.uid)}</option>
                  ))}
                </select>
              </label>
              {data.accounts.map((a) => (
                <label key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", fontSize: "13px", marginBottom: "8px" }}>
                  <span>{a.name}</span>
                  <select
                    disabled={readOnly}
                    value={draft.accountRespondents[a.id] ?? ""}
                    onChange={(e) => {
                      const next = { ...draft.accountRespondents };
                      if (e.target.value) next[a.id] = e.target.value;
                      else delete next[a.id];
                      setDraft({ ...draft, accountRespondents: next });
                    }}
                    style={selectStyle}
                  >
                    <option value="">Default</option>
                    {data.members.map((m) => (
                      <option key={m.uid} value={m.uid}>{nameOf(m.uid)}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            {!readOnly && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                <button onClick={save} disabled={busy} style={{ padding: "9px 18px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  Save
                </button>
                <button onClick={runPreview} disabled={busy} style={{ padding: "9px 14px", backgroundColor: "#fff", border: "1px solid #d1d5db", borderRadius: "8px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                  Preview the next round
                </button>
                {!confirmSend ? (
                  <button onClick={() => setConfirmSend(true)} disabled={busy} style={{ padding: "9px 14px", backgroundColor: "#fff", border: "1px solid #d1d5db", borderRadius: "8px", fontWeight: 600, cursor: "pointer", fontFamily: font }}>
                    Send a round now
                  </button>
                ) : (
                  <span style={{ fontSize: "13px", color: "#92400e" }}>
                    This emails your household now.{" "}
                    <button onClick={sendNow} style={{ padding: "6px 12px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "7px", fontWeight: 600, cursor: "pointer" }}>Send</button>{" "}
                    <button onClick={() => setConfirmSend(false)} style={{ padding: "6px 10px", backgroundColor: "#fff", border: "1px solid #d1d5db", borderRadius: "7px", cursor: "pointer" }}>Cancel</button>
                  </span>
                )}
              </div>
            )}

            {preview && (
              <div style={{ ...card, marginTop: "16px" }}>
                <div style={{ fontWeight: 600, marginBottom: "8px" }}>Preview (nothing sent)</div>
                {preview.totalGroups === 0 ? (
                  <p style={{ fontSize: "13px", color: "#15803d", margin: 0 }}>Nothing to ask right now, so no email would go out.</p>
                ) : (
                  Object.entries(preview.byRespondent).map(([uid, r]) => (
                    <div key={uid} style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600 }}>{nameOf(uid)}: {r.groups.length} question{r.groups.length !== 1 ? "s" : ""}</div>
                      <ul style={{ margin: "4px 0", paddingLeft: "18px", fontSize: "13px", color: "#374151" }}>
                        {r.groups.map((g) => (
                          <li key={g.vendor}>{g.vendor}: {g.count} charge{g.count !== 1 ? "s" : ""}, ${g.total.toFixed(2)}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}

            <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "16px" }}>
              Emails list merchant names and amounts only, and link to <Link to="/review">Review</Link>, where you sign in to answer.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
