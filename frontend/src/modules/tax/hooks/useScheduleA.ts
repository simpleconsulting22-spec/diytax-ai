import { useState, useEffect, useCallback } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../../contexts/TaxYearContext";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SALT_CAP = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScheduleAData {
  medicalTotal: number;
  medicalFromTxns: number;
  medicalManual: number;
  taxesUncapped: number;
  taxesTotal: number;       // capped at SALT_CAP
  saltCapApplied: boolean;
  mortgageTotal: number;
  charityTotal: number;
  charityFromTxns: number;
  charityManual: number;
  totalDeductions: number;
}

const EMPTY: ScheduleAData = {
  medicalTotal: 0,
  medicalFromTxns: 0,
  medicalManual: 0,
  taxesUncapped: 0,
  taxesTotal: 0,
  saltCapApplied: false,
  mortgageTotal: 0,
  charityTotal: 0,
  charityFromTxns: 0,
  charityManual: 0,
  totalDeductions: 0,
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useScheduleA() {
  const { user } = useAuth();
  const { selectedYear } = useTaxYear();
  const [data, setData] = useState<ScheduleAData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const [charitySnap, medicalSnap, deductionsSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("taxCategory", "==", "Charitable Contribution")
          )
        ),
        getDocs(
          query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("taxCategory", "==", "Medical Expense")
          )
        ),
        getDocs(
          query(collection(db, "deductions"), where("userId", "==", user.uid))
        ),
      ]);

      // Helper: filter transaction snap by selected year
      const filterByYear = (docs: typeof charitySnap.docs) =>
        docs.filter((d) => {
          const data = d.data();
          return matchesTaxYear(
            { taxYear: data.taxYear as number | null | undefined, date: data.date as string | undefined },
            selectedYear
          );
        });

      const charityFromTxns = filterByYear(charitySnap.docs).reduce(
        (s, d) => s + Math.abs((d.data().amount as number) ?? 0),
        0
      );
      const medicalFromTxns = filterByYear(medicalSnap.docs).reduce(
        (s, d) => s + Math.abs((d.data().amount as number) ?? 0),
        0
      );

      let medicalManual = 0;
      let taxesUncapped = 0;
      let mortgageTotal = 0;
      let charityManual = 0;

      // Filter deductions by taxYear if the field exists, otherwise include all
      const filteredDeductions = deductionsSnap.docs.filter((d) => {
        const deductionYear = d.data().taxYear as number | undefined;
        return deductionYear == null || deductionYear === selectedYear;
      });

      filteredDeductions.forEach((d) => {
        const item = d.data();
        const amt = (item.amount as number) ?? 0;
        switch (item.type) {
          case "medical":  medicalManual += amt;  break;
          case "taxes":    taxesUncapped += amt;  break;
          case "mortgage": mortgageTotal += amt;  break;
          case "charity":  charityManual += amt;  break;
        }
      });

      const medicalTotal  = round2(medicalFromTxns + medicalManual);
      const saltCapApplied = taxesUncapped > SALT_CAP;
      const taxesTotal    = round2(Math.min(taxesUncapped, SALT_CAP));
      const charityTotal  = round2(charityFromTxns + charityManual);
      const totalDeductions = round2(medicalTotal + taxesTotal + round2(mortgageTotal) + charityTotal);

      setData({
        medicalTotal,
        medicalFromTxns: round2(medicalFromTxns),
        medicalManual:   round2(medicalManual),
        taxesUncapped:   round2(taxesUncapped),
        taxesTotal,
        saltCapApplied,
        mortgageTotal:   round2(mortgageTotal),
        charityTotal,
        charityFromTxns: round2(charityFromTxns),
        charityManual:   round2(charityManual),
        totalDeductions,
      });
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to load Schedule A data."
      );
    } finally {
      setLoading(false);
    }
  }, [user, selectedYear]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
