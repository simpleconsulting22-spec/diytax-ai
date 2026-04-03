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
  const { user } = useAuth();
  const [forms, setForms] = useState<SSAForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(collection(db, "ssaForms"), where("userId", "==", user.uid))
      );
      setForms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SSAForm)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load SSA data.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function addForm(totalBenefits: number): Promise<void> {
    if (!user) return;
    if (totalBenefits < 0) throw new Error("Amount cannot be negative.");
    await addDoc(collection(db, "ssaForms"), {
      userId: user.uid,
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
