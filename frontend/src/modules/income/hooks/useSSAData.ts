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

export interface SSAForm {
  id: string;
  userId: string;
  totalBenefits: number;
  taxYear: number;
}

const TAX_YEAR = new Date().getFullYear();

export function useSSAData() {
  const { user, effectiveOwnerUid } = useAuth();
  const ownerUid = effectiveOwnerUid ?? user?.uid ?? "";
  const [forms, setForms] = useState<SSAForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user || !ownerUid) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(collection(db, "ssaForms"), where("userId", "==", ownerUid))
      );
      setForms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SSAForm)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load SSA data.");
    } finally {
      setLoading(false);
    }
  }, [user, ownerUid]);

  useEffect(() => { load(); }, [load]);

  async function addForm(totalBenefits: number): Promise<void> {
    if (!user || !ownerUid) return;
    if (totalBenefits < 0) throw new Error("Amount cannot be negative.");
    await addDoc(collection(db, "ssaForms"), {
      userId: ownerUid,
      totalBenefits,
      taxYear: TAX_YEAR,
      createdAt: serverTimestamp(),
    });
    await load();
  }

  async function removeForm(id: string): Promise<void> {
    await deleteDoc(doc(db, "ssaForms", id));
    await load();
  }

  const ssaTotal = forms.reduce((s, f) => s + f.totalBenefits, 0);

  return { forms, ssaTotal, loading, error, addForm, removeForm, reload: load };
}
