import { useState, useEffect, useCallback } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../contexts/TaxYearContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxnRecord {
  amount: number;
  type: "income" | "expense";
  category: string | null;
  taxCategory: string | null;
  taxSchedule: string | null;
  status: string;
  entityId?: string | null;
  entityType?: "business" | "rental" | "personal";
  entityName?: string;
  taxYear?: number | null;
  date?: string;
}

export interface CategoryTotal {
  category: string;
  amount: number;
}

export interface ScheduleARow {
  taxCategory: string;
  amount: number;
}

export interface EntityTotal {
  entityId: string | null;
  entityName: string;
  categories: Record<string, number>;
  total: number;
}

export interface ScheduleEProperty {
  entityId: string | null;
  entityName: string;
  netIncome: number;
}

export interface DashboardData {
  total: number;
  categorized: number;
  needsReviewCount: number;
  needsReviewAmount: number;
  categoryTotals: CategoryTotal[];       // expenses only, status == "categorized", sorted DESC
  scheduleC: {
    income: number;
    expenses: number;
    netProfit: number;
  };
  scheduleA: ScheduleARow[];             // sorted DESC by amount
  entityTotals: EntityTotal[];           // expenses grouped by entity, Unassigned last
  hasUnassigned: boolean;                // true if any categorized expense lacks entityId
  scheduleE: {
    properties: ScheduleEProperty[];     // per-property net income, sorted DESC
    totalNetIncome: number;
  };
  ytd: {
    income: number;
    expenses: number;
    net: number;
  };
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function aggregate(txns: TxnRecord[]): DashboardData {
  let needsReviewCount = 0;
  let needsReviewAmount = 0;
  let categorized = 0;
  let ytdIncome = 0;
  let ytdExpenses = 0;

  const categoryMap = new Map<string, number>();
  let scheduleCIncome = 0;
  let scheduleCExpenses = 0;
  const scheduleAMap = new Map<string, number>();

  // entityKey → { name, categories, total }
  const entityMap = new Map<string, { name: string; categories: Map<string, number>; total: number }>();

  // Schedule E — per-property income/expense tracking
  const scheduleEMap = new Map<string, { name: string; income: number; expenses: number }>();

  for (const txn of txns) {
    const absAmount = Math.abs(txn.amount);

    if (txn.status === "needs_review") {
      needsReviewCount++;
      needsReviewAmount += absAmount;
      continue;
    }

    categorized++;

    // YTD income / expenses (all categorized, excluding transfers)
    if (txn.status !== "transfer") {
      if (txn.type === "income") {
        ytdIncome += txn.amount > 0 ? txn.amount : Math.abs(txn.amount);
      } else {
        ytdExpenses += Math.abs(txn.amount);
      }
    }

    // Category totals — expense transactions with a known category
    if (txn.type === "expense" && txn.category) {
      categoryMap.set(txn.category, (categoryMap.get(txn.category) ?? 0) + absAmount);
    }

    // Schedule C — income and expense breakdown
    if (txn.taxSchedule === "Schedule C") {
      if (txn.type === "income") {
        scheduleCIncome += txn.amount > 0 ? txn.amount : absAmount;
      } else {
        scheduleCExpenses += absAmount;
      }
    }

    // Schedule A — grouped by taxCategory
    if (txn.taxSchedule === "Schedule A" && txn.taxCategory) {
      scheduleAMap.set(
        txn.taxCategory,
        (scheduleAMap.get(txn.taxCategory) ?? 0) + absAmount
      );
    }

    // Schedule E — per-property income/expenses for rental summary
    if (txn.taxSchedule === "Schedule E") {
      const key = txn.entityId ?? "__unassigned__";
      const name = key === "__unassigned__" ? "Unassigned" : (txn.entityName ?? key);
      const entry = scheduleEMap.get(key) ?? { name, income: 0, expenses: 0 };
      if (txn.type === "income") {
        entry.income += txn.amount > 0 ? txn.amount : absAmount;
      } else {
        entry.expenses += absAmount;
      }
      scheduleEMap.set(key, entry);
    }

    // Entity totals — expense transactions grouped by entityId → category
    if (txn.type === "expense" && txn.category) {
      const entityKey = txn.entityId || "__unassigned__";
      const entityName =
        entityKey === "__unassigned__"
          ? "Unassigned"
          : (txn.entityName ?? entityKey);

      const entry = entityMap.get(entityKey) ?? {
        name: entityName,
        categories: new Map<string, number>(),
        total: 0,
      };
      entry.categories.set(txn.category, (entry.categories.get(txn.category) ?? 0) + absAmount);
      entry.total += absAmount;
      entityMap.set(entityKey, entry);
    }
  }

  const categoryTotals: CategoryTotal[] = [...categoryMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  const scheduleA: ScheduleARow[] = [...scheduleAMap.entries()]
    .map(([taxCategory, amount]) => ({ taxCategory, amount }))
    .sort((a, b) => b.amount - a.amount);

  const entityTotals: EntityTotal[] = [...entityMap.entries()]
    .map(([key, { name, categories, total }]) => ({
      entityId: key === "__unassigned__" ? null : key,
      entityName: name,
      categories: Object.fromEntries(categories),
      total,
    }))
    .sort((a, b) => {
      // Unassigned always last
      if (a.entityId === null) return 1;
      if (b.entityId === null) return -1;
      return b.total - a.total;
    });

  const hasUnassigned = entityMap.has("__unassigned__");

  const scheduleEProperties: ScheduleEProperty[] = [...scheduleEMap.entries()]
    .map(([key, { name, income, expenses }]) => ({
      entityId: key === "__unassigned__" ? null : key,
      entityName: name,
      netIncome: Math.round((income - expenses) * 100) / 100,
    }))
    .sort((a, b) => {
      if (a.entityId === null) return 1;
      if (b.entityId === null) return -1;
      return b.netIncome - a.netIncome;
    });

  const scheduleETotalNetIncome = Math.round(
    scheduleEProperties.reduce((s, p) => s + p.netIncome, 0) * 100
  ) / 100;

  const ytdNet = Math.round((ytdIncome - ytdExpenses) * 100) / 100;

  return {
    total: txns.length,
    categorized,
    needsReviewCount,
    needsReviewAmount,
    categoryTotals,
    scheduleC: {
      income: scheduleCIncome,
      expenses: scheduleCExpenses,
      netProfit: scheduleCIncome - scheduleCExpenses,
    },
    scheduleA,
    entityTotals,
    hasUnassigned,
    scheduleE: {
      properties: scheduleEProperties,
      totalNetIncome: scheduleETotalNetIncome,
    },
    ytd: {
      income: Math.round(ytdIncome * 100) / 100,
      expenses: Math.round(ytdExpenses * 100) / 100,
      net: ytdNet,
    },
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const EMPTY_DATA: DashboardData = {
  total: 0,
  categorized: 0,
  needsReviewCount: 0,
  needsReviewAmount: 0,
  categoryTotals: [],
  scheduleC: { income: 0, expenses: 0, netProfit: 0 },
  scheduleA: [],
  entityTotals: [],
  hasUnassigned: false,
  scheduleE: { properties: [], totalNetIncome: 0 },
  ytd: { income: 0, expenses: 0, net: 0 },
};

export function useDashboardData() {
  const { user } = useAuth();
  const { selectedYear } = useTaxYear();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(collection(db, "transactions"), where("uid", "==", user.uid))
      );
      const allTxns = snap.docs.map((d) => d.data() as TxnRecord);
      const txns = allTxns.filter((t) => matchesTaxYear(t, selectedYear));
      setData(aggregate(txns));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, [user, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
