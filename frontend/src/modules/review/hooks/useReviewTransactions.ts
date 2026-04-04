import { useState, useEffect, useCallback } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  updateDoc,
  addDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../../contexts/TaxYearContext";
import { apiClient } from "../../../services/apiClient";
import { getUserEntities, UserEntity } from "../../../services/entityService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewTransaction {
  id: string;
  date: string;
  description: string;
  normalizedDescription: string;
  vendor: string | null;
  amount: number;
  type: "income" | "expense";
  category: string | null;
  taxCategory: string | null;
  taxSchedule: string | null;
  categorizationConfidence: number | null;
  source: "rule" | "user_rule" | "ai" | null;
  categorizationExplanation: string | null;
  status: "needs_review" | "categorized";
  entityId: string | null;
  entityType: "business" | "rental" | "personal";
  entityName?: string;
  entityAutoAssigned?: boolean;   // true when entity was predicted (not user-set)
  possibleDuplicate?: boolean;    // true when fuzzy cross-batch match detected
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Extract the most meaningful leading word from a normalised description.
// Used as vendorName when writing categoryRules.
function extractVendor(normalizedDescription: string): string {
  const words = normalizedDescription.trim().split(/\s+/);
  return words.find((w) => w.length >= 3 && !/^\d/.test(w)) ?? words[0] ?? "";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface ReviewState {
  transactions: ReviewTransaction[];
  entities: UserEntity[];
  loading: boolean;
  error: string;
  selectedIds: Set<string>;
  updating: Set<string>;
}

export function useReviewTransactions() {
  const { user } = useAuth();
  const { selectedYear } = useTaxYear();

  const [state, setState] = useState<ReviewState>({
    transactions: [],
    entities: [],
    loading: true,
    error: "",
    selectedIds: new Set(),
    updating: new Set(),
  });

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const loadTransactions = useCallback(async () => {
    if (!user) return;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [snap, entities] = await Promise.all([
        getDocs(
          query(
            collection(db, "transactions"),
            where("uid", "==", user.uid),
            where("status", "==", "needs_review"),
            orderBy("createdAt", "desc")
          )
        ),
        getUserEntities(user.uid),
      ]);

      const docs: ReviewTransaction[] = snap.docs.filter((d) =>
        matchesTaxYear(
          { taxYear: d.data().taxYear as number | null | undefined, date: d.data().date as string | undefined },
          selectedYear
        )
      ).map((d) => {
        const data = d.data();
        return {
          id: d.id,
          date: data.date ?? "",
          description: data.description ?? "",
          normalizedDescription: data.normalizedDescription ?? "",
          vendor: (data.vendor as string) ?? null,
          amount: data.amount ?? 0,
          type: data.type ?? "expense",
          category: data.category ?? null,
          taxCategory: data.taxCategory ?? null,
          taxSchedule: data.taxSchedule ?? null,
          categorizationConfidence: data.categorizationConfidence ?? null,
          source: (data.categorizationSource as ReviewTransaction["source"]) ?? null,
          categorizationExplanation: (data.categorizationExplanation as string) ?? null,
          status: data.status ?? "needs_review",
          entityId: data.entityId ?? null,
          entityType: data.entityType ?? "personal",
          entityName: data.entityName,
          entityAutoAssigned: data.entityAutoAssigned === true,
          possibleDuplicate: data.possibleDuplicate === true,
        };
      });

      // Auto-assign: if there is exactly one business entity, assign all
      // unassigned Schedule C transactions to it.
      const singleBusiness =
        entities.length === 1 && entities[0].type === "business"
          ? entities[0]
          : null;

      if (singleBusiness) {
        const unassigned = docs.filter(
          (t) => !t.entityId && t.taxSchedule === "Schedule C"
        );
        if (unassigned.length > 0) {
          const batch = writeBatch(db);
          for (const t of unassigned) {
            batch.update(doc(db, "transactions", t.id), {
              entityId: singleBusiness.id,
              entityType: "business",
              entityName: singleBusiness.name,
              updatedAt: serverTimestamp(),
            });
            t.entityId = singleBusiness.id;
            t.entityType = "business";
            t.entityName = singleBusiness.name;
          }
          await batch.commit();
        }
      }

      setState((prev) => ({
        ...prev,
        transactions: docs,
        entities,
        loading: false,
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load transactions.",
      }));
    }
  }, [user, selectedYear]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  // ── Entity change ──────────────────────────────────────────────────────────

  async function handleEntityChange(
    id: string,
    entityId: string | null,
    entityType: "business" | "rental" | "personal",
    entityName?: string
  ) {
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      await updateDoc(doc(db, "transactions", id), {
        entityId,
        entityType,
        entityName: entityName ?? null,
        updatedAt: serverTimestamp(),
      });
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
        transactions: prev.transactions.map((t) =>
          t.id === id ? { ...t, entityId, entityType, entityName } : t
        ),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
      }));
    }
  }

  // ── Category change ────────────────────────────────────────────────────────

  async function handleCategoryChange(id: string, newCategory: string) {
    if (!user) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      // 1. Call existing Cloud Function — updates category, status, and any
      //    vendorName-based rule for Plaid transactions
      await apiClient.call("updateTransactionCategory", {
        transactionId: id,
        category: newCategory,
      });

      // 2. Mark as user-modified so the batch categorizer skips it in future runs
      await updateDoc(doc(db, "transactions", id), {
        isUserModified: true,
        updatedAt: serverTimestamp(),
      });

      // 3. Learning loop: write a categoryRule keyed on the leading vendor word
      //    from normalizedDescription (fills the gap for CSV transactions that
      //    have no merchantName and are skipped by the Cloud Function's rule logic)
      const txn = state.transactions.find((t) => t.id === id);
      if (txn) {
        const vendorName = extractVendor(
          txn.normalizedDescription || txn.description || ""
        );
        if (vendorName) {
          await addDoc(collection(db, "categoryRules"), {
            uid: user.uid,
            vendorName,
            category: newCategory,
            taxCategory: txn.taxCategory ?? "",
            createdAt: serverTimestamp(),
          });
        }
      }

      // Optimistic local update — row stays in list (still needs_review until confirmed)
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
        transactions: prev.transactions.map((t) =>
          t.id === id ? { ...t, category: newCategory } : t
        ),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
      }));
    }
  }

  // ── Single confirm ─────────────────────────────────────────────────────────

  async function handleConfirm(id: string) {
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      await updateDoc(doc(db, "transactions", id), {
        status: "categorized",
        updatedAt: serverTimestamp(),
      });
      // Remove from list — it's no longer "needs_review"
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
        transactions: prev.transactions.filter((t) => t.id !== id),
        selectedIds: new Set([...prev.selectedIds].filter((i) => i !== id)),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
      }));
    }
  }

  // ── Bulk confirm ───────────────────────────────────────────────────────────

  async function handleBulkConfirm() {
    const ids = [...state.selectedIds];
    if (ids.length === 0) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.update(doc(db, "transactions", id), {
          status: "categorized",
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
        transactions: prev.transactions.filter((t) => !ids.includes(t.id)),
        selectedIds: new Set(),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
      }));
    }
  }

  // ── Bulk category assign ───────────────────────────────────────────────────

  async function handleBulkCategoryAssign(ids: string[], category: string) {
    if (!user || ids.length === 0) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      // Batch-write category to all selected transactions
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", id), {
            category,
            categorizationSource: "user_rule",
            isUserModified: true,
            updatedAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // Learning loop: write a categoryRule for each unique vendor
      const selectedTxns = state.transactions.filter((t) => ids.includes(t.id));
      const seen = new Set<string>();
      for (const txn of selectedTxns) {
        const vendorName = extractVendor(
          txn.normalizedDescription || txn.description || ""
        );
        if (vendorName && !seen.has(vendorName)) {
          seen.add(vendorName);
          await addDoc(collection(db, "categoryRules"), {
            uid: user.uid,
            vendorName,
            category,
            createdAt: serverTimestamp(),
          });
        }
      }

      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
        transactions: prev.transactions.map((t) =>
          ids.includes(t.id)
            ? { ...t, category, source: "user_rule" as const }
            : t
        ),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
      }));
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────────

  function clearSelection() {
    setState((prev) => ({ ...prev, selectedIds: new Set() }));
  }

  function toggleSelect(id: string) {
    setState((prev) => {
      const next = new Set(prev.selectedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...prev, selectedIds: next };
    });
  }

  function toggleSelectAll() {
    setState((prev) => {
      if (prev.selectedIds.size === prev.transactions.length) {
        return { ...prev, selectedIds: new Set() };
      }
      return { ...prev, selectedIds: new Set(prev.transactions.map((t) => t.id)) };
    });
  }

  const allSelected =
    state.transactions.length > 0 &&
    state.selectedIds.size === state.transactions.length;

  return {
    state,
    allSelected,
    handleEntityChange,
    handleCategoryChange,
    handleConfirm,
    handleBulkConfirm,
    handleBulkCategoryAssign,
    clearSelection,
    toggleSelect,
    toggleSelectAll,
    reload: loadTransactions,
  };
}
