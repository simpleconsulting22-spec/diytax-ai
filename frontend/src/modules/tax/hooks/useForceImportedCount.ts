import { useState, useEffect } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../../contexts/TaxYearContext";

/**
 * Count of transactions the user force-imported past duplicate detection.
 *
 * Import dedup is deterministic, not fuzzy: Plaid rows are keyed on the stable
 * `plaid_transaction_id`, and CSV / AI rows on an exact hash of
 * account + date + amount + description. When a row matched an existing one and
 * the user chose "import anyway", it is saved with `isForceImport: true`.
 *
 * Those are the only rows that can legitimately be a double count, so they are
 * the only ones worth flagging. Anything fuzzier would risk hiding real
 * transactions that merely look alike.
 */
export function useForceImportedCount(): { count: number; loading: boolean } {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const { selectedYear } = useTaxYear();
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ownerUid) return;
      setLoading(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, "transactions"),
            where("uid", "==", ownerUid),
            where("isForceImport", "==", true)
          )
        );
        const n = snap.docs.filter((d) => {
          const t = d.data();
          return matchesTaxYear(
            { taxYear: t.taxYear as number | null | undefined, date: t.date as string | undefined },
            selectedYear
          );
        }).length;
        if (!cancelled) setCount(n);
      } catch {
        // A missing index or permission hiccup must not break the page; the
        // disclosure simply doesn't render.
        if (!cancelled) setCount(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ownerUid, selectedYear]);

  return { count, loading };
}
