import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useNotifications } from "../../hooks/useNotifications";
import AppNav from "../../components/AppNav";

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

interface NotificationSettings {
  enabled:       boolean;
  morning:       boolean;
  evening:       boolean;
  quarterly:     boolean;
  uncategorized: boolean;
  milestone:     boolean;
  timezone:      string;
}

const DEFAULTS: NotificationSettings = {
  enabled:       true,
  morning:       true,
  evening:       true,
  quarterly:     true,
  uncategorized: true,
  milestone:     true,
  timezone:      "America/New_York",
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

interface HistoryItem {
  id:        string;
  type:      string;
  title:     string;
  body:      string;
  createdAt: Date | null;
}

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const { permission, requestPermission } = useNotifications();

  const [settings, setSettings]   = useState<NotificationSettings>(DEFAULTS);
  const [history, setHistory]     = useState<HistoryItem[]>([]);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [loadDone, setLoadDone]   = useState(false);

  const ownerUid = user?.uid;

  useEffect(() => {
    if (!ownerUid) return;
    (async () => {
      const snap = await getDoc(doc(db, "userProfiles", ownerUid));
      if (snap.exists()) {
        const ns = snap.data()?.notificationSettings;
        if (ns) setSettings({ ...DEFAULTS, ...ns });
      }
      setLoadDone(true);
    })();
  }, [ownerUid]);

  useEffect(() => {
    if (!ownerUid) return;
    (async () => {
      const q = query(
        collection(db, "notificationHistory"),
        where("uid", "==", ownerUid),
        orderBy("createdAt", "desc"),
        limit(20)
      );
      const snap = await getDocs(q);
      setHistory(
        snap.docs.map((d) => ({
          id:        d.id,
          type:      d.data().type,
          title:     d.data().title,
          body:      d.data().body,
          createdAt: d.data().createdAt?.toDate?.() ?? null,
        }))
      );
    })();
  }, [ownerUid]);

  async function handleSave() {
    if (!ownerUid) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "userProfiles", ownerUid),
        { notificationSettings: settings },
        { merge: true }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof NotificationSettings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  if (!loadDone) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
        <AppNav />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#9ca3af", fontSize: "14px" }}>
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: font }}>
      <AppNav />

      <div style={{ maxWidth: "640px", margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>
          Notifications
        </h1>
        <p style={{ fontSize: "14px", color: "#6b7280", margin: "0 0 28px" }}>
          Stay on top of your taxes with timely reminders.
        </p>

        {/* Permission banner */}
        {permission === "default" && (
          <div style={{ padding: "14px 18px", backgroundColor: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "10px", marginBottom: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <span style={{ fontSize: "13px", color: "#92400e" }}>
              Browser notifications are not enabled for this device.
            </span>
            <button
              onClick={requestPermission}
              style={{ padding: "6px 14px", backgroundColor: "#16A34A", color: "#fff", border: "none", borderRadius: "7px", fontSize: "12px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", fontFamily: font }}
            >
              Enable
            </button>
          </div>
        )}
        {permission === "denied" && (
          <div style={{ padding: "14px 18px", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", marginBottom: "20px", fontSize: "13px", color: "#7f1d1d" }}>
            Notifications are blocked in your browser settings. To enable, update your browser permissions for this site.
          </div>
        )}
        {permission === "granted" && (
          <div style={{ padding: "10px 14px", backgroundColor: "#f0fdf4", border: "1px solid #86efac", borderRadius: "8px", marginBottom: "20px", fontSize: "13px", color: "#15803d" }}>
            ✓ Push notifications enabled
          </div>
        )}

        {/* Master toggle */}
        <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "20px 24px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px" }}>
          <ToggleRow
            label="All Notifications"
            description="Master switch for all push notifications"
            checked={settings.enabled}
            onChange={() => toggle("enabled")}
            bold
          />
        </div>

        {/* Individual toggles */}
        <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "8px 24px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "16px", opacity: settings.enabled ? 1 : 0.5, pointerEvents: settings.enabled ? "auto" : "none" }}>
          <ToggleRow
            label="Morning Snapshot"
            description="Daily tax summary at 7:30 AM"
            checked={settings.morning}
            onChange={() => toggle("morning")}
          />
          <ToggleRow
            label="Evening Capture"
            description="Reminder to log expenses at 6:30 PM"
            checked={settings.evening}
            onChange={() => toggle("evening")}
          />
          <ToggleRow
            label="Quarterly Deadlines"
            description="Alerts 30, 14 & 3 days before due dates"
            checked={settings.quarterly}
            onChange={() => toggle("quarterly")}
          />
          <ToggleRow
            label="Uncategorized Alert"
            description="Weekly Sunday reminder to review transactions"
            checked={settings.uncategorized}
            onChange={() => toggle("uncategorized")}
          />
          <ToggleRow
            label="Deduction Milestones"
            description="Celebrate when you hit $500, $1k, $5k+ in deductions"
            checked={settings.milestone}
            onChange={() => toggle("milestone")}
            last
          />
        </div>

        {/* Timezone */}
        <div style={{ backgroundColor: "#fff", borderRadius: "12px", padding: "20px 24px", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", marginBottom: "24px" }}>
          <label style={{ fontSize: "14px", fontWeight: 600, color: "#111827", display: "block", marginBottom: "8px" }}>
            Timezone
          </label>
          <select
            value={settings.timezone}
            onChange={(e) => setSettings((p) => ({ ...p, timezone: e.target.value }))}
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: "8px", fontSize: "13px", fontFamily: font, color: "#111827", backgroundColor: "#fff" }}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz.replace("_", " ")}</option>
            ))}
          </select>
          <p style={{ fontSize: "12px", color: "#9ca3af", margin: "6px 0 0" }}>
            Notifications are sent in your selected timezone.
          </p>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: "100%",
            padding: "13px",
            backgroundColor: saved ? "#15803d" : "#16A34A",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            fontSize: "15px",
            fontWeight: 700,
            cursor: saving ? "default" : "pointer",
            fontFamily: font,
            marginBottom: "32px",
            transition: "background-color 0.2s",
          }}
        >
          {saved ? "✓ Saved" : saving ? "Saving…" : "Save Preferences"}
        </button>

        {/* Notification history */}
        {history.length > 0 && (
          <div>
            <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#374151", marginBottom: "12px" }}>
              Recent Notifications
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {history.map((item) => (
                <div
                  key={item.id}
                  style={{ backgroundColor: "#fff", borderRadius: "10px", padding: "14px 18px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", marginBottom: "3px" }}>{item.title}</div>
                  <div style={{ fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>{item.body}</div>
                  {item.createdAt && (
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>
                      {item.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  bold = false,
  last = false,
}: {
  label:       string;
  description: string;
  checked:     boolean;
  onChange:    () => void;
  bold?:       boolean;
  last?:       boolean;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 0",
      borderBottom: last ? "none" : "1px solid #f3f4f6",
      gap: "16px",
    }}>
      <div>
        <div style={{ fontSize: "14px", fontWeight: bold ? 700 : 500, color: "#111827" }}>{label}</div>
        <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "2px" }}>{description}</div>
      </div>
      <button
        onClick={onChange}
        role="switch"
        aria-checked={checked}
        style={{
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          border: "none",
          backgroundColor: checked ? "#16A34A" : "#d1d5db",
          cursor: "pointer",
          position: "relative",
          flexShrink: 0,
          transition: "background-color 0.2s",
        }}
      >
        <span style={{
          position: "absolute",
          top: "2px",
          left: checked ? "22px" : "2px",
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          backgroundColor: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
          transition: "left 0.2s",
          display: "block",
        }} />
      </button>
    </div>
  );
}
