import React, { useCallback, useEffect, useState } from "react";
import AppNav from "../../components/AppNav";
import { apiClient } from "../../services/apiClient";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const card: React.CSSProperties = { backgroundColor: "#fff", borderRadius: "12px", padding: "20px 24px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px" };

interface Summary {
  month: string;
  config: {
    enabled: boolean;
    monthlyTargetUsd: number;
    monthlyAlertUsd: number;
    monthlyLimitUsd: number;
    dailyMessagesPerUser: number;
    dailyDeepPerUser: number;
    perMinutePerUser: number;
    historyTurns: number;
  };
  spend: { monthToDateUsd: number; inFlightReservedUsd: number; targetUsd: number; alertUsd: number; limitUsd: number; percentOfLimit: number; status: string };
  activity: Record<string, number>;
  byModel: Array<{ tier: string; model: string; questions: number; costUsd: number; inputTokens: number; outputTokens: number; share: number }>;
  daily: Array<{ day: string; costUsd: number; questions: number; failures: number }>;
  note: string;
}

const EDITABLE: Array<[keyof Summary["config"], string, number]> = [
  ["monthlyTargetUsd", "Monthly target (USD) — above this, only the low-cost model runs", 0.5],
  ["monthlyAlertUsd", "Monthly alert (USD) — email when crossed", 0.5],
  ["monthlyLimitUsd", "Monthly limit (USD) — new AI questions stop here", 0.5],
  ["dailyMessagesPerUser", "Questions per user per day", 1],
  ["dailyDeepPerUser", "Advanced-model questions per user per day", 1],
  ["perMinutePerUser", "Questions per user per minute", 1],
  ["historyTurns", "Conversation turns sent with each question", 1],
];

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const STATUS_TEXT: Record<string, string> = {
  normal: "Normal",
  throttled_to_fast_model: "Past target: low-cost model only",
  limit_reached: "Limit reached: AI questions paused",
};

export default function AdminZachPage() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Summary["config"]>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiClient.call<Summary>("getZachAdminSummary");
      setS(r);
      setDraft(r.config);
      setError(null);
    } catch (e) {
      const code = ((e as { code?: string }).code ?? "").replace("functions/", "");
      setError(code === "permission-denied" ? "Only a DIYTax AI administrator can view Zach usage." : "Couldn't load Zach usage.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const body: Record<string, unknown> = { enabled: draft.enabled };
      for (const [k] of EDITABLE) body[k] = Number(draft[k]);
      const r = await apiClient.call<Summary>("setZachConfig", body);
      setS(r);
      setDraft(r.config);
      setSaved(true);
    } catch (e) {
      setError((e as { message?: string }).message ?? "Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  }

  const maxDay = Math.max(0.0001, ...(s?.daily ?? []).map((d) => d.costUsd));

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />
      <div style={{ maxWidth: "760px", margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: "22px", margin: "0 0 4px", color: "#111827" }}>Zach usage and limits</h1>
        <p style={{ fontSize: "13px", color: "#6b7280", margin: "0 0 20px" }}>Aggregate figures only. No taxpayer information is shown here.</p>
        {error && <div style={{ ...card, color: "#b91c1c" }}>{error}</div>}
        {s && (
          <>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: "13px", color: "#6b7280" }}>Estimated spend, {s.month}</div>
                <div style={{ fontSize: "13px", fontWeight: 600 }}>{STATUS_TEXT[s.spend.status] ?? s.spend.status}</div>
              </div>
              <div style={{ fontSize: "28px", fontWeight: 700, margin: "6px 0" }}>
                {usd(s.spend.monthToDateUsd)} <span style={{ fontSize: "14px", color: "#6b7280", fontWeight: 400 }}>of {usd(s.spend.limitUsd)} limit ({s.spend.percentOfLimit}%)</span>
              </div>
              <div style={{ position: "relative", height: "10px", backgroundColor: "#f3f4f6", borderRadius: "5px", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, s.spend.percentOfLimit)}%`, height: "100%", backgroundColor: s.spend.status === "normal" ? "#16A34A" : s.spend.status === "limit_reached" ? "#dc2626" : "#f59e0b" }} />
              </div>
              <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
                Target {usd(s.spend.targetUsd)} · Alert {usd(s.spend.alertUsd)} · In flight {usd(s.spend.inFlightReservedUsd)}
              </div>
              <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "6px" }}>{s.note}</div>
            </div>

            <div style={{ ...card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "14px" }}>
              {[
                ["Questions", s.activity.questions],
                ["Active users", s.activity.activeUsers],
                ["Conversations", s.activity.conversations],
                ["Failed requests", s.activity.failures],
                ["Repeats blocked", s.activity.repeatsBlocked],
                ["Avg per question", usd(s.activity.avgCostPerQuestionUsd)],
                ["Avg per conversation", usd(s.activity.avgCostPerConversationUsd)],
                ["Avg per active user", usd(s.activity.avgCostPerActiveUserUsd)],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{k}</div>
                  <div style={{ fontSize: "18px", fontWeight: 700 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={card}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>By model</div>
              <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "#6b7280", textAlign: "left" }}>
                    <th>Model</th><th>Questions</th><th>Share</th><th>Cost</th><th>Tokens in / out</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byModel.map((m) => (
                    <tr key={m.tier} style={{ borderTop: "1px solid #f3f4f6" }}>
                      <td style={{ padding: "6px 0" }}>{m.model} <span style={{ color: "#9ca3af" }}>({m.tier})</span></td>
                      <td>{m.questions}</td>
                      <td>{m.share}%</td>
                      <td>{usd(m.costUsd)}</td>
                      <td>{m.inputTokens.toLocaleString()} / {m.outputTokens.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 600, marginBottom: "8px" }}>Last 30 days</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "80px" }}>
                {s.daily.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${usd(d.costUsd)}, ${d.questions} questions, ${d.failures} failed`}
                    style={{ flex: 1, height: `${Math.max(2, (d.costUsd / maxDay) * 100)}%`, backgroundColor: d.costUsd > 0 ? "#16A34A" : "#e5e7eb", borderRadius: "2px" }}
                  />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>
                <span>{s.daily[0]?.day}</span>
                <span>{s.daily[s.daily.length - 1]?.day}</span>
              </div>
            </div>

            <div style={card}>
              <div style={{ fontWeight: 600, marginBottom: "12px" }}>Settings</div>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", marginBottom: "12px" }}>
                <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                Zach is on for all users
              </label>
              {EDITABLE.map(([k, label, step]) => (
                <label key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", fontSize: "13px", marginBottom: "10px" }}>
                  <span>{label}</span>
                  <input
                    type="number"
                    step={step}
                    min={0}
                    value={String(draft[k] ?? "")}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value === "" ? "" : Number(e.target.value) })}
                    style={{ width: "100px", padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: "8px", fontFamily: font }}
                  />
                </label>
              ))}
              <button
                onClick={save}
                disabled={saving}
                style={{ padding: "8px 16px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 600, cursor: "pointer", fontFamily: font }}
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
              {saved && <span style={{ marginLeft: "10px", fontSize: "13px", color: "#15803d" }}>Saved. Changes apply within 30 seconds.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
