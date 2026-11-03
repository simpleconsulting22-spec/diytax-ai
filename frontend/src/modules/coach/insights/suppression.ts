// 7-day suppression for insight IDs. Stored in localStorage for v1; will move
// to Firestore in Phase 2 so suppression follows the user across devices.

const KEY = "coach.suppressed.v1";

interface Map_ { [id: string]: number /* unix ms */ }

function load(): Map_ {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Map_) : {};
  } catch {
    return {};
  }
}

function save(m: Map_): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEY, JSON.stringify(m));
    }
  } catch {
    // ignore quota / privacy errors
  }
}

export function isSuppressed(id: string, now = Date.now()): boolean {
  const map = load();
  const exp = map[id];
  if (!exp) return false;
  if (exp <= now) {
    delete map[id];
    save(map);
    return false;
  }
  return true;
}

export function suppressInsight(id: string, days = 7, now = Date.now()): void {
  const map = load();
  map[id] = now + days * 86_400_000;
  save(map);
}

export function clearSuppression(id: string): void {
  const map = load();
  delete map[id];
  save(map);
}
