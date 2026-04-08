import { useState, useEffect, useCallback } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../../contexts/TaxYearContext";

// ─── IRS Schedule E (Part I) line mapping ─────────────────────────────────────

export const CATEGORY_TO_LINE_E: Record<string, string> = {
  "Advertising":           "line5",
  "Auto & Travel":         "line6",
  "Cleaning & Maintenance":"line7",
  "Commissions":           "line8",
  "Insurance":             "line9",
  "Legal & Professional":  "line10",
  "Management Fees":       "line11",
  "Mortgage Interest":     "line12",
  "Other Interest":        "line13",
  "Repairs":               "line14",
  "Supplies":              "line15",
  "Taxes":                 "line16",
  "Utilities":             "line17",
  "Depreciation":          "line18",
  "Other":                 "line19",
};

export const LINE_META_E: Record<string, { label: string; note?: string }> = {
  line5:  { label: "Advertising" },
  line6:  { label: "Auto and travel" },
  line7:  { label: "Cleaning and maintenance" },
  line8:  { label: "Commissions" },
  line9:  { label: "Insurance" },
  line10: { label: "Legal and other professional fees" },
  line11: { label: "Management fees" },
  line12: { label: "Mortgage interest (paid to banks)" },
  line13: { label: "Other interest" },
  line14: { label: "Repairs" },
  line15: { label: "Supplies" },
  line16: { label: "Taxes" },
  line17: { label: "Utilities" },
  line18: { label: "Depreciation expense or depletion", note: "Depreciation calculation (Form 4562) not included — enter manually on your return" },
  line19: { label: "Other expenses" },
};

export const LINE_ORDER_E = [
  "line5", "line6", "line7", "line8", "line9",
  "line10", "line11", "line12", "line13", "line14",
  "line15", "line16", "line17", "line18", "line19",
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleELine {
  lineKey: string;
  lineNumber: string;
  label: string;
  note?: string;
  amount: number;
}

export interface PropertyScheduleE {
  entityId: string | null;
  entityName: string;
  scheduleE: {
    income: number;
    expensesByLine: ScheduleELine[];
    totalExpenses: number;
    netIncome: number;
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

function aggregate(txns: RawTxn[]): PropertyScheduleE[] {
  const propertyMap = new Map<
    string,
    { name: string; income: number; lineAmounts: Map<string, number> }
  >();

  for (const txn of txns) {
    const key = txn.entityId ?? "__unassigned__";
    const name =
      key === "__unassigned__" ? "Unassigned" : (txn.entityName ?? key);

    if (!propertyMap.has(key)) {
      propertyMap.set(key, { name, income: 0, lineAmounts: new Map() });
    }

    const entry = propertyMap.get(key)!;
    const absAmount = Math.abs(txn.amount);

    if (txn.type === "income") {
      entry.income += absAmount;
    } else if (txn.type === "refund" && txn.category) {
      const lineKey = CATEGORY_TO_LINE_E[txn.category] ?? "line19";
      entry.lineAmounts.set(lineKey, (entry.lineAmounts.get(lineKey) ?? 0) - absAmount);
    } else if (txn.category) {
      const lineKey = CATEGORY_TO_LINE_E[txn.category] ?? "line19";
      entry.lineAmounts.set(lineKey, (entry.lineAmounts.get(lineKey) ?? 0) + absAmount);
    }
  }

  const results: PropertyScheduleE[] = [];

  for (const [key, { name, income, lineAmounts }] of propertyMap) {
    const expensesByLine: ScheduleELine[] = LINE_ORDER_E
      .filter((lk) => lineAmounts.has(lk))
      .map((lk) => ({
        lineKey: lk,
        lineNumber: formatLineNumber(lk),
        label: LINE_META_E[lk]?.label ?? lk,
        note: LINE_META_E[lk]?.note,
        amount: Math.round((lineAmounts.get(lk) ?? 0) * 100) / 100,
      }));

    const totalExpenses = Math.round(
      expensesByLine.reduce((s, l) => s + l.amount, 0) * 100
    ) / 100;

    results.push({
      entityId: key === "__unassigned__" ? null : key,
      entityName: name,
      scheduleE: {
        income: Math.round(income * 100) / 100,
        expensesByLine,
        totalExpenses,
        netIncome: Math.round((income - totalExpenses) * 100) / 100,
      },
    });
  }

  // Assigned properties first (sorted by net income desc), unassigned last
  results.sort((a, b) => {
    if (a.entityId === null) return 1;
    if (b.entityId === null) return -1;
    return b.scheduleE.netIncome - a.scheduleE.netIncome;
  });

  return results;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScheduleE() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const { selectedYear } = useTaxYear();
  const [properties, setProperties] = useState<PropertyScheduleE[]>([]);
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
          where("taxSchedule", "==", "Schedule E")
        )
      );
      const txns = snap.docs
        .map((d) => d.data() as RawTxn)
        .filter((t) => matchesTaxYear(t, selectedYear));
      setProperties(aggregate(txns));
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load Schedule E data."
      );
    } finally {
      setLoading(false);
    }
  }, [user, ownerUid, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  return { properties, loading, error, reload: load };
}
