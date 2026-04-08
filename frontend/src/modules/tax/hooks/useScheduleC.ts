import { useState, useEffect, useCallback } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../../contexts/TaxYearContext";

// ─── IRS Schedule C line mapping ──────────────────────────────────────────────

export const CATEGORY_TO_LINE: Record<string, string> = {
  "Advertising":          "line8",
  "Car & Truck":          "line9",
  "Commissions":          "line10",
  "Insurance":            "line15",
  "Legal & Professional": "line17",
  "Office":               "line18",
  "Rent":                 "line20",
  "Repairs":              "line21",
  "Supplies":             "line22",
  "Taxes & Licenses":     "line23",
  "Travel":               "line24a",
  "Meals":                "line24b",
  "Utilities":            "line25",
  "Wages":                "line26",
  "Other":                "line27a",
};

export const LINE_META: Record<string, { label: string; note?: string }> = {
  line8:   { label: "Advertising" },
  line9:   { label: "Car and truck expenses" },
  line10:  { label: "Commissions and fees" },
  line15:  { label: "Insurance (other than health)" },
  line17:  { label: "Legal and professional services" },
  line18:  { label: "Office expense" },
  line20:  { label: "Rent or lease" },
  line21:  { label: "Repairs and maintenance" },
  line22:  { label: "Supplies" },
  line23:  { label: "Taxes and licenses" },
  line24a: { label: "Travel" },
  line24b: { label: "Meals (50% deductible)", note: "Enter 50% of actual amount on Form 1040 Sch C, Line 24b" },
  line25:  { label: "Utilities" },
  line26:  { label: "Wages" },
  line27a: { label: "Other expenses" },
};

export const LINE_ORDER = [
  "line8", "line9", "line10", "line15", "line17",
  "line18", "line20", "line21", "line22", "line23",
  "line24a", "line24b", "line25", "line26", "line27a",
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleCLine {
  lineKey: string;
  lineNumber: string;   // "Line 8", "Line 24a"
  label: string;
  note?: string;
  amount: number;
}

export interface EntityScheduleC {
  entityId: string | null;
  entityName: string;
  scheduleC: {
    income: number;
    expensesByLine: ScheduleCLine[];
    totalExpenses: number;
    netProfit: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatLineNumber(key: string): string {
  return "Line " + key.replace("line", "");
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface RawTxn {
  entityId?: string | null;
  entityName?: string;
  type: "income" | "expense" | "refund";
  amount: number;
  category: string | null;
  taxYear?: number | null;
  date?: string;
}

function aggregate(txns: RawTxn[]): EntityScheduleC[] {
  const entityMap = new Map<
    string,
    { name: string; income: number; lineAmounts: Map<string, number> }
  >();

  for (const txn of txns) {
    const key = txn.entityId ?? "__unassigned__";
    const name =
      key === "__unassigned__" ? "Unassigned" : (txn.entityName ?? key);

    if (!entityMap.has(key)) {
      entityMap.set(key, { name, income: 0, lineAmounts: new Map() });
    }

    const entry = entityMap.get(key)!;
    const absAmount = Math.abs(txn.amount);

    if (txn.type === "income") {
      entry.income += absAmount;
    } else if (txn.type === "refund" && txn.category) {
      const lineKey = CATEGORY_TO_LINE[txn.category] ?? "line27a";
      entry.lineAmounts.set(lineKey, (entry.lineAmounts.get(lineKey) ?? 0) - absAmount);
    } else if (txn.category) {
      const lineKey = CATEGORY_TO_LINE[txn.category] ?? "line27a";
      entry.lineAmounts.set(lineKey, (entry.lineAmounts.get(lineKey) ?? 0) + absAmount);
    }
  }

  const results: EntityScheduleC[] = [];

  for (const [key, { name, income, lineAmounts }] of entityMap) {
    const expensesByLine: ScheduleCLine[] = LINE_ORDER
      .filter((lk) => lineAmounts.has(lk))
      .map((lk) => ({
        lineKey: lk,
        lineNumber: formatLineNumber(lk),
        label: LINE_META[lk]?.label ?? lk,
        note: LINE_META[lk]?.note,
        amount: Math.round((lineAmounts.get(lk) ?? 0) * 100) / 100,
      }));

    const totalExpenses = Math.round(
      expensesByLine.reduce((s, l) => s + l.amount, 0) * 100
    ) / 100;

    results.push({
      entityId: key === "__unassigned__" ? null : key,
      entityName: name,
      scheduleC: {
        income: Math.round(income * 100) / 100,
        expensesByLine,
        totalExpenses,
        netProfit: Math.round((income - totalExpenses) * 100) / 100,
      },
    });
  }

  // Assigned entities first (sorted by total expenses desc), unassigned last
  results.sort((a, b) => {
    if (a.entityId === null) return 1;
    if (b.entityId === null) return -1;
    return b.scheduleC.totalExpenses - a.scheduleC.totalExpenses;
  });

  return results;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScheduleC() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const { selectedYear } = useTaxYear();
  const [entities, setEntities] = useState<EntityScheduleC[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(
          collection(db, "transactions"),
          where("uid", "==", ownerUid),
          where("taxSchedule", "==", "Schedule C")
        )
      );
      const txns = snap.docs
        .map((d) => d.data() as RawTxn)
        .filter((t) => matchesTaxYear(t, selectedYear));
      setEntities(aggregate(txns));
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load Schedule C data."
      );
    } finally {
      setLoading(false);
    }
  }, [user, ownerUid, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  return { entities, loading, error, reload: load };
}
