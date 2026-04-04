import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear } from "../../../contexts/TaxYearContext";
import {
  PeriodType,
  DateRange,
  getPeriodRange,
  getPreviousPeriodRange,
  getEarliestFetchDate,
} from "../utils/periodRange";
import {
  SpendingRecord,
  BudgetCategory,
  BudgetStatus,
  CategoryAnalysis,
  Insight,
  computeBudgetStatus,
  analyzeSpending,
  generateInsights,
} from "../utils/spendingAnalysis";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Budget {
  id: string;
  userId: string;
  periodType: PeriodType;
  categories: BudgetCategory[];
}

export type { PeriodType, BudgetCategory, BudgetStatus, CategoryAnalysis, Insight };

interface BudgetState {
  budget: Budget | null;
  // Raw transactions kept in memory so period switches don't require re-fetch
  loadedTransactions: SpendingRecord[];
  // Computed values
  budgetStatuses: BudgetStatus[];
  analysis: CategoryAnalysis[];
  insights: Insight[];
  currentRange: DateRange;
  previousRange: DateRange;
  // UI state
  periodType: PeriodType;
  loading: boolean;
  saving: boolean;
  error: string;
}

const today = new Date();

const DEFAULT_RANGE = getPeriodRange(today, "monthly");
const DEFAULT_PREV  = getPreviousPeriodRange(today, "monthly");

const INITIAL_STATE: BudgetState = {
  budget: null,
  loadedTransactions: [],
  budgetStatuses: [],
  analysis: [],
  insights: [],
  currentRange: DEFAULT_RANGE,
  previousRange: DEFAULT_PREV,
  periodType: "monthly",
  loading: true,
  saving: false,
  error: "",
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBudget() {
  const { user } = useAuth();
  const { selectedYear } = useTaxYear();
  const [state, setState] = useState<BudgetState>(INITIAL_STATE);

  // ── Compute derived values from loaded transactions + period ──────────────

  function recompute(
    transactions: SpendingRecord[],
    budgetCategories: BudgetCategory[],
    periodType: PeriodType
  ) {
    const now = new Date();
    const currentRange  = getPeriodRange(now, periodType);
    const previousRange = getPreviousPeriodRange(now, periodType);
    const budgetStatuses = computeBudgetStatus(transactions, budgetCategories, currentRange);
    const analysis       = analyzeSpending(transactions, currentRange, previousRange);
    const insights       = generateInsights(budgetStatuses, analysis);
    return { budgetStatuses, analysis, insights, currentRange, previousRange };
  }

  // ── Initial load ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!user) return;
    setState((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      // 1. Fetch budget settings
      const budgetSnap = await getDocs(
        query(collection(db, "budgets"), where("userId", "==", user.uid))
      );
      const budgetDoc = budgetSnap.docs[0] ?? null;
      const budget: Budget | null = budgetDoc
        ? ({ id: budgetDoc.id, ...budgetDoc.data() } as Budget)
        : null;

      const periodType: PeriodType = budget?.periodType ?? "monthly";
      const now = new Date();

      // 2. Fetch transactions covering current + previous period
      //    (limited to selectedYear to stay consistent with year filter)
      const yearStart    = `${selectedYear}-01-01`;
      const yearEnd      = `${selectedYear}-12-31`;
      const earliestDate = getEarliestFetchDate(now, periodType);
      const fetchFrom    = earliestDate < yearStart ? yearStart : earliestDate;

      const txnSnap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", user.uid),
          where("date", ">=", fetchFrom),
          where("date", "<=", yearEnd)
        )
      );

      const transactions: SpendingRecord[] = txnSnap.docs.map((d) => {
        const data = d.data();
        return {
          id:       d.id,
          date:     (data.date     as string) ?? "",
          category: (data.category as string | null) ?? null,
          amount:   (data.amount   as number) ?? 0,
          type:     (data.type     as string) ?? "expense",
          status:   (data.status   as string) ?? "",
        };
      });

      const computed = recompute(transactions, budget?.categories ?? [], periodType);

      setState((prev) => ({
        ...prev,
        budget,
        loadedTransactions: transactions,
        periodType,
        ...computed,
        loading: false,
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load budget data.",
      }));
    }
  }, [user, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Change period type (local re-compute, no Firestore call) ──────────────

  function changePeriodType(periodType: PeriodType) {
    setState((prev) => {
      const computed = recompute(
        prev.loadedTransactions,
        prev.budget?.categories ?? [],
        periodType
      );
      return { ...prev, periodType, ...computed };
    });
  }

  // ── Save budget settings ──────────────────────────────────────────────────

  async function saveBudget(
    periodType: PeriodType,
    categories: BudgetCategory[]
  ): Promise<void> {
    if (!user) return;
    setState((prev) => ({ ...prev, saving: true, error: "" }));

    try {
      if (state.budget?.id) {
        await updateDoc(doc(db, "budgets", state.budget.id), {
          periodType,
          categories,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "budgets"), {
          userId: user.uid,
          periodType,
          categories,
          createdAt: serverTimestamp(),
        });
      }
      // Reload to reflect saved settings
      setState((prev) => ({ ...prev, saving: false }));
      await load();
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: e instanceof Error ? e.message : "Failed to save budget.",
      }));
    }
  }

  return { state, changePeriodType, saveBudget, reload: load };
}
