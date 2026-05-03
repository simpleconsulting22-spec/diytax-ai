// Single-fetch hook that loads transactions, accounts, and recurringItems
// into memory and computes the entire CoachSnapshot synchronously. The
// decision engine then ranks + caps for the UI.
//
// Phase 0 contract: the hook works against real Firestore data so we can
// dogfood at /coach. No data-write side effects — the page is read-only.

import { useCallback, useEffect, useState } from "react";
import {
  collection, query, where, getDocs,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";

import type {
  CoachPageState, CoachSnapshot, PeriodType,
} from "../types";
import { periodRange, previousPeriodRange } from "../selectors/period";
import {
  type CoachTransaction, sumExpenses, sumIncome, topCategories,
} from "../selectors/transactions";
import {
  type CoachAccount, type CoachRecurringItem,
  computeRunway, avgDailyBurn,
} from "../selectors/runway";
import { computeDataQuality } from "../selectors/dataQuality";
import { buildTrust } from "../insights/confidence";
import {
  categoryIncreaseInsight, discretionaryOverspendInsight, asSavingsOpp,
} from "../insights/savingsInsights";
import {
  dueSoonRisk, lowBalanceRisk,
} from "../insights/riskInsights";
import {
  spendingDownInsight, savingsRateInsight,
} from "../insights/wellnessInsights";
import { buildTrends } from "../insights/trendInsights";
import { decide } from "../engine/decide";
import { suppressInsight as suppressInsightLs } from "../insights/suppression";

const INITIAL: CoachPageState = {
  loading:    true,
  error:      null,
  snapshot:   null,
  decision:   null,
  periodType: "monthly",
};

export interface UseCoachDataReturn {
  state: CoachPageState;
  setPeriodType: (p: PeriodType) => void;
  suppressInsight: (id: string) => void;
  refresh: () => Promise<void>;
}

export function useCoachData(): UseCoachDataReturn {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";

  const [state, setState] = useState<CoachPageState>(INITIAL);

  const load = useCallback(async (periodType: PeriodType): Promise<void> => {
    if (!ownerUid) {
      setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null, periodType }));

    const now      = new Date();
    const current  = periodRange(now, periodType);
    const previous = previousPeriodRange(now, periodType);

    try {
      // Pull current + prior period in one query (date range covers both).
      const [txnsSnap, accountsSnap, recurringSnap] = await Promise.all([
        getDocs(query(
          collection(db, "transactions"),
          where("uid",  "==", ownerUid),
          where("date", ">=", previous.start),
          where("date", "<=", current.end),
        )),
        getDocs(query(collection(db, "accounts"), where("uid", "==", ownerUid))),
        getDocs(query(collection(db, "recurringItems"), where("uid", "==", ownerUid))),
      ]);

      const txns: CoachTransaction[] = txnsSnap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id:            d.id,
          date:          (x.date as string) ?? "",
          description:   (x.description as string) ?? "",
          merchantName:  x.merchantName as string | undefined,
          vendor:        (x.vendor as string | null | undefined) ?? null,
          amount:        typeof x.amount === "number" ? x.amount : 0,
          type:          (x.type as CoachTransaction["type"]) ?? "expense",
          category:      (x.category as string | null | undefined) ?? null,
          status:        (x.status as string) ?? "needs_review",
        };
      });

      const accounts: CoachAccount[] = accountsSnap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const accountType = (x.accountType as string | undefined) ?? "";
        // Spendable = bank/checking/savings. Credit/loan accounts excluded.
        const includeInSpendable = !/credit|loan/i.test(accountType);
        return {
          id:               d.id,
          name:             (x.name as string) ?? (x.accountName as string) ?? "Account",
          availableBalance: typeof x.availableBalance === "number" ? x.availableBalance : null,
          lastSyncedAt:     (x.lastSyncedAt as string | null | undefined) ?? null,
          includeInSpendable,
        };
      });

      const recurring: CoachRecurringItem[] = recurringSnap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id:               d.id,
          merchantName:     (x.merchantName as string) ?? "Unknown",
          amount:           typeof x.amount === "number" ? x.amount : 0,
          frequency:        (x.frequency as CoachRecurringItem["frequency"]) ?? "monthly",
          intervalDays:     typeof x.intervalDays === "number" ? x.intervalDays : 30,
          lastDate:         (x.lastDate as string) ?? "",
          nextExpectedDate: (x.nextExpectedDate as string) ?? "",
          category:         x.category as string | undefined,
          type:             x.type as string | undefined,
        };
      });

      // ── Quality → trust → snapshot ─────────────────────────────────────
      const dataQuality = computeDataQuality(accounts, now);
      const baseTrust = buildTrust({
        dataQuality,
        drivers: [],
        rowCount: txns.length,
        windowLabel:   current.label,
        windowStart:   current.start,
        windowEnd:     current.end,
        baselineLabel: previous.label,
      });

      const categoryRollup = topCategories(
        txns, current, previous,
        ({ rowCount, drivers }) => buildTrust({
          dataQuality, drivers, rowCount,
          windowLabel:   current.label,
          windowStart:   current.start,
          windowEnd:     current.end,
          baselineLabel: previous.label,
        }),
      );

      const runwayMetrics = computeRunway(txns, accounts, recurring, current, now);

      // ── Insights ──────────────────────────────────────────────────────
      const burn = avgDailyBurn(txns, now, 30);

      const risks = [
        dueSoonRisk(recurring, accounts, now, baseTrust),
        lowBalanceRisk(accounts, burn, baseTrust),
      ].filter(notNull);

      const savingsCandidates = [
        ...categoryRollup.map(categoryIncreaseInsight).filter(notNull),
        discretionaryOverspendInsight(categoryRollup),
      ].filter(notNull);
      const savingsOpportunities = savingsCandidates
        .map((i) => asSavingsOpp(i, /* trigger */ "increase", i.kind))
        .filter(notNull);

      const curExpenses  = sumExpenses(txns, current);
      const prevExpenses = sumExpenses(txns, previous);
      const curIncome    = sumIncome(txns, current);

      const wellness = [
        spendingDownInsight(curExpenses, prevExpenses, categoryRollup, baseTrust),
        savingsRateInsight(curIncome, curExpenses, baseTrust),
      ].filter(notNull);

      const trends = buildTrends(txns, now, 30);

      const snapshot: CoachSnapshot = {
        brief: {
          ...runwayMetrics,
          keyInsightId:    null,
          primaryActionId: null,
        },
        risks,
        savingsOpportunities,
        wellness,
        trends,
        categoryRollup,
        dataQuality,
        generatedAt: now.toISOString(),
      };

      const decision = decide(snapshot, now);

      // Backfill brief pointers from the decision result so the brief card
      // can highlight the chosen primary + key insight without re-deciding.
      snapshot.brief.primaryActionId = decision.primaryAction.id;
      snapshot.brief.keyInsightId =
        decision.risks[0]?.id ?? decision.primaryAction.id;

      setState({ loading: false, error: null, snapshot, decision, periodType });
    } catch (e) {
      console.error("[useCoachData] failed:", e);
      setState({
        loading:    false,
        error:      e instanceof Error ? e.message : "Failed to load coach data.",
        snapshot:   null,
        decision:   null,
        periodType,
      });
    }
  }, [ownerUid]);

  useEffect(() => {
    load(state.periodType);
    // intentional — only re-load when period changes or hook re-mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return {
    state,
    setPeriodType: (p) => load(p),
    suppressInsight: (id) => {
      suppressInsightLs(id, 7);
      // Re-decide with updated suppression to immediately hide in the UI.
      if (state.snapshot) {
        const decision = decide(state.snapshot, new Date());
        setState((prev) => ({ ...prev, decision }));
      }
    },
    refresh: () => load(state.periodType),
  };
}

function notNull<T>(x: T | null | undefined): x is T {
  return x !== null && x !== undefined;
}
