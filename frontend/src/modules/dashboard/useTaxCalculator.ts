import { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../contexts/AuthContext";
import { matchesTaxYear } from "../../contexts/TaxYearContext";
import {
  calculateTaxEstimate,
  TaxEstimate,
  FilingStatus,
  TaxableTransaction,
} from "./taxCalculator";

export interface TaxProfile {
  filingStatus: FilingStatus | null;
  w2Income: number;
  iraContributions: number;
  ownerName?: string;
}

export interface TaxCalculatorResult {
  estimate: TaxEstimate | null;
  loading: boolean;
  profile: TaxProfile;
  trend: "up" | "down" | "neutral";
  saveW2Income: (amount: number) => Promise<void>;
  saveIraContributions: (amount: number) => Promise<void>;
}

const DEFAULT_PROFILE: TaxProfile = {
  filingStatus: null,
  w2Income: 0,
  iraContributions: 0,
};

function trendKey(uid: string, year: number) {
  return `taxMeter_${uid}_${year}`;
}

export function useTaxCalculator(taxYear: number): TaxCalculatorResult {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";

  const [profile, setProfile] = useState<TaxProfile>(DEFAULT_PROFILE);
  const [transactions, setTransactions] = useState<TaxableTransaction[]>([]);
  const [scheduleAManual, setScheduleAManual] = useState(0);

  // Three separate loading guards — meter shows skeleton until all three fire
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [txnsLoaded, setTxnsLoaded] = useState(false);
  const [deductionsLoaded, setDeductionsLoaded] = useState(false);

  const [trend, setTrend] = useState<"up" | "down" | "neutral">("neutral");

  // Reset loading state when owner changes
  useEffect(() => {
    setProfileLoaded(false);
    setTxnsLoaded(false);
    setDeductionsLoaded(false);
  }, [ownerUid]);

  // Real-time: user profile (filing status, W-2, IRA)
  useEffect(() => {
    if (!ownerUid) return;
    return onSnapshot(doc(db, "userProfiles", ownerUid), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setProfile({
          filingStatus: (d.filingStatus as FilingStatus) ?? null,
          w2Income: (d.w2Income as number) ?? 0,
          iraContributions: (d.iraContributions as number) ?? 0,
          ownerName: d.ownerName as string,
        });
      } else {
        setProfile(DEFAULT_PROFILE);
      }
      setProfileLoaded(true);
    });
  }, [ownerUid]);

  // Real-time: transactions
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(collection(db, "transactions"), where("uid", "==", ownerUid));
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map((d) => d.data() as TaxableTransaction);
      setTransactions(all.filter((t) => matchesTaxYear(t, taxYear)));
      setTxnsLoaded(true);
    });
  }, [ownerUid, taxYear]);

  // Real-time: manual Schedule A deductions
  useEffect(() => {
    if (!ownerUid) return;
    const q = query(
      collection(db, "deductions"),
      where("userId", "==", ownerUid)
    );
    return onSnapshot(q, (snap) => {
      const total = snap.docs.reduce((sum, d) => {
        const data = d.data();
        const year =
          (data.taxYear as number) ??
          parseInt((data.date as string ?? "").slice(0, 4));
        if (year !== taxYear) return sum;
        return sum + ((data.amount as number) ?? 0);
      }, 0);
      setScheduleAManual(total);
      setDeductionsLoaded(true);
    });
  }, [ownerUid, taxYear]);

  const loading = !profileLoaded || !txnsLoaded || !deductionsLoaded;

  const estimate: TaxEstimate | null =
    !loading && profile.filingStatus
      ? calculateTaxEstimate({
          transactions,
          scheduleAManualDeductions: scheduleAManual,
          filingStatus: profile.filingStatus,
          w2Income: profile.w2Income,
          iraContributions: profile.iraContributions,
          taxYear,
        })
      : null;

  // Trend: compare total tax to last stored value for this user+year
  useEffect(() => {
    if (!estimate || !ownerUid) return;
    const key = trendKey(ownerUid, taxYear);
    const stored = parseFloat(localStorage.getItem(key) ?? "");
    if (!isNaN(stored)) {
      if (estimate.totalTax > stored + 10) setTrend("up");
      else if (estimate.totalTax < stored - 10) setTrend("down");
      else setTrend("neutral");
    }
    localStorage.setItem(key, String(estimate.totalTax));
  }, [estimate?.totalTax, ownerUid, taxYear]);

  async function saveW2Income(amount: number) {
    if (!ownerUid) return;
    const ref = doc(db, "userProfiles", ownerUid);
    await updateDoc(ref, { w2Income: amount }).catch(() =>
      setDoc(ref, { w2Income: amount }, { merge: true })
    );
  }

  async function saveIraContributions(amount: number) {
    if (!ownerUid) return;
    const ref = doc(db, "userProfiles", ownerUid);
    await updateDoc(ref, { iraContributions: amount }).catch(() =>
      setDoc(ref, { iraContributions: amount }, { merge: true })
    );
  }

  return {
    estimate,
    loading,
    profile,
    trend,
    saveW2Income,
    saveIraContributions,
  };
}
