import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";

export interface RetirementForm {
  id: string;
  userId: string;
  payerName: string;
  totalDistribution: number;
  taxableAmount: number;
  taxYear: number;
}

const TAX_YEAR = new Date().getFullYear();

export function useRetirementData() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const [forms, setForms] = useState<RetirementForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !ownerUid) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(collection(db, "retirementForms"), where("userId", "==", ownerUid))
      );
      setForms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RetirementForm)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load retirement data.");
    } finally {
      setLoading(false);
    }
  }, [user, ownerUid]);

  useEffect(() => { load(); }, [load]);

  async function addForm(
    payerName: string,
    totalDistribution: number,
    taxableAmount: number
  ): Promise<void> {
    if (!user || !ownerUid) return;
    if (!payerName.trim()) throw new Error("Payer name is required.");
    if (totalDistribution < 0) throw new Error("Total distribution cannot be negative.");
    if (taxableAmount < 0) throw new Error("Taxable amount cannot be negative.");
    await addDoc(collection(db, "retirementForms"), {
      userId: ownerUid,
      payerName: payerName.trim(),
      totalDistribution,
      taxableAmount,
      taxYear: TAX_YEAR,
      createdAt: serverTimestamp(),
    });
    await load();
  }

  async function removeForm(id: string): Promise<void> {
    await deleteDoc(doc(db, "retirementForms", id));
    await load();
  }

  const retirementTotal = forms.reduce((s, f) => s + f.taxableAmount, 0);
  const totalDistributionSum = forms.reduce((s, f) => s + f.totalDistribution, 0);

  return { forms, retirementTotal, totalDistributionSum, loading, error, addForm, removeForm, reload: load };
}
