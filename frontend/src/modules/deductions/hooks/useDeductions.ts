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

export type DeductionType = "medical" | "taxes" | "mortgage" | "charity";

export interface Deduction {
  id: string;
  userId: string;
  type: DeductionType;
  description: string;
  amount: number;
  taxYear: number;
}

const TAX_YEAR = new Date().getFullYear();

export function useDeductions() {
  const { user } = useAuth();
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(collection(db, "deductions"), where("userId", "==", user.uid))
      );
      setDeductions(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as Deduction))
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load deductions.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function addDeduction(
    type: DeductionType,
    description: string,
    amount: number
  ): Promise<void> {
    if (!user) return;
    if (amount <= 0) throw new Error("Amount must be positive.");
    await addDoc(collection(db, "deductions"), {
      userId: user.uid,
      type,
      description: description.trim(),
      amount,
      taxYear: TAX_YEAR,
      createdAt: serverTimestamp(),
    });
    await load();
  }

  async function removeDeduction(id: string): Promise<void> {
    await deleteDoc(doc(db, "deductions", id));
    await load();
  }

  return { deductions, loading, error, addDeduction, removeDeduction, reload: load };
}
