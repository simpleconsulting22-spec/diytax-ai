// Account-sync health check. Drives the DataQualityBar + every insight's
// confidence (reduces it when coverage is incomplete).

import type { Confidence, DataQuality } from "../types";
import type { CoachAccount } from "./runway";

const STALE_AFTER_DAYS = 3;

function daysSince(isoTs: string | null, now: Date): number {
  if (!isoTs) return Infinity;
  const ms = now.getTime() - new Date(isoTs).getTime();
  return Math.floor(ms / 86_400_000);
}

export function computeDataQuality(
  accounts: CoachAccount[],
  now:      Date,
): DataQuality {
  const total = accounts.length;
  const stale: DataQuality["staleAccounts"] = [];
  let synced = 0;
  for (const a of accounts) {
    const d = daysSince(a.lastSyncedAt, now);
    if (d <= STALE_AFTER_DAYS) synced++;
    else if (d !== Infinity)   stale.push({ accountId: a.id, name: a.name, daysSinceSync: d });
    else                       stale.push({ accountId: a.id, name: a.name, daysSinceSync: -1 });
  }
  const syncedPct = total > 0 ? synced / total : 1;

  const notes: string[] = [];
  if (total === 0) notes.push("No accounts connected");
  if (stale.length > 0) notes.push(`${stale.length} account${stale.length !== 1 ? "s" : ""} stale (>${STALE_AFTER_DAYS}d since sync)`);

  const baseConfidence: Confidence =
    total === 0      ? "low"    :
    syncedPct < 0.6  ? "low"    :
    syncedPct < 0.9  ? "medium" :
                       "high";

  return {
    totalAccounts: total,
    syncedAccounts: synced,
    syncedPct,
    staleAccounts: stale,
    baseConfidence,
    notes,
  };
}
