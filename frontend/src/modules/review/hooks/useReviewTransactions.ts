import { useState, useEffect, useCallback, useRef } from "react";
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
  limit,
  increment,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";
import { useTaxYear, matchesTaxYear } from "../../../contexts/TaxYearContext";
import { apiClient } from "../../../services/apiClient";
import { getUserEntities, UserEntity } from "../../../services/entityService";
import { getCustomCategories, addCustomCategory, AddCategoryResult } from "../../../services/customCategoriesService";
import { findOrCreateAccountByName } from "../../../services/accountService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewTransaction {
  id: string;
  date: string;
  description: string;
  normalizedDescription: string;
  vendor: string | null;
  amount: number;
  type: "income" | "expense" | "transfer" | "refund";
  accountId: string | null;
  accountName: string | null;
  importFile: string | null;
  subType: "credit_card_payment" | "loan_payment" | null;
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
  entityAutoAssigned?: boolean;           // true when entity was predicted (not user-set)
  entityAssignmentSource?: "rule" | "user_rule" | "ai" | null; // how entity was assigned
  possibleDuplicate?: boolean;    // true when fuzzy cross-batch match detected
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Prefer the pre-extracted vendor field; fall back to first meaningful word.
function extractVendor(txnOrDesc: ReviewTransaction | string): string {
  if (typeof txnOrDesc !== "string") {
    if (txnOrDesc.vendor?.trim()) return txnOrDesc.vendor.trim().toLowerCase();
    return extractVendor(txnOrDesc.normalizedDescription || txnOrDesc.description || "");
  }
  const words = txnOrDesc.trim().split(/\s+/);
  return words.find((w) => w.length >= 3 && !/^\d/.test(w)) ?? words[0] ?? "";
}

// Upsert a categoryRule by vendor — avoids duplicate documents.
async function upsertVendorRule(
  uid: string,
  vendorName: string,
  fields: {
    category?: string;
    taxCategory?: string;
    taxSchedule?: string;
    entityId?: string | null;
    entityName?: string | null;
    entityType?: string | null;
  }
) {
  if (!vendorName) return;
  const existingSnap = await getDocs(
    query(
      collection(db, "categoryRules"),
      where("uid", "==", uid),
      where("vendorName", "==", vendorName),
      limit(1)
    )
  );
  if (!existingSnap.empty) {
    await updateDoc(existingSnap.docs[0].ref, {
      ...fields,
      usageCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, "categoryRules"), {
      uid,
      vendorName,
      ...fields,
      usageCount: 1,
      createdAt: serverTimestamp(),
    });
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface ReviewState {
  transactions: ReviewTransaction[];
  entities: UserEntity[];
  customCategories: string[];
  loading: boolean;
  error: string;
  selectedIds: Set<string>;
  updating: Set<string>;
  /** Surfaced after a single category edit when other same-vendor rows have a
   *  different category. User confirms before any cascade fires. */
  pendingCategoryPrompt: PendingCategoryPrompt;
}

export type PendingCategoryPrompt = {
  /** id of the row whose edit triggered this prompt — drives inline placement */
  editedRowId:    string;
  /** which field the user edited — drives copy variation */
  triggeredBy:    "category" | "entity";
  vendor:         string;
  /** Bundle to propagate. Empty values mean "do not override matching rows". */
  category:       string | null;
  taxCategory:    string | null;
  taxSchedule:    string | null;
  entityId:       string | null;
  entityType:     "business" | "rental" | "personal" | null;
  entityName:     string | null;
  /** Row ids the cascade would touch (matching same vendor, different bundle,
   *  not user_rule). Length always >= 1; UI shouldn't render an empty prompt. */
  affectedRowIds: string[];
} | null;

export function useReviewTransactions(statusFilter: "needs_review" | "categorized" = "needs_review") {
  const { user, role, effectiveOwnerUid } = useAuth();
  const { selectedYear } = useTaxYear();

  const [state, setState] = useState<ReviewState>({
    transactions: [],
    entities: [],
    customCategories: [],
    loading: true,
    error: "",
    selectedIds: new Set(),
    updating: new Set(),
    pendingCategoryPrompt: null,
  });

  // Loop guardrail: when the user accepts an "Apply to all" prompt, we mark
  // the vendor here so the cascade itself doesn't immediately re-prompt for
  // the same vendor (defensive — handleApplySimilar uses writeBatch directly
  // and shouldn't re-enter handleCategoryChange, but cheap insurance).
  const recentlyAppliedVendorRef = useRef<string | null>(null);

  // ── Vendor-match helper (shared by category + entity edits) ──────────────
  // Returns ids of rows that:
  //   • share the edited row's vendor
  //   • aren't the edited row itself
  //   • differ from the edited row on at least one bundle field that was set
  //   • are NOT type === "transfer" (transfers don't have category/entity)
  //
  // We deliberately do NOT exclude rows with source === "user_rule" — that
  // signal conflates "user manually corrected" with "AI auto-applied a saved
  // rule". When a stale rule has poisoned a vendor, the user needs to be able
  // to cascade a new correction across rows that already say "Learned". The
  // prompt is opt-in (Apply to all / Just this one) so the user always
  // confirms before any cascade fires.
  //
  // The "field was set" check is what enforces our selective-field policy:
  // if the user only edited Assign To and Category is null, candidates are
  // matched on entity differences only — null Category does NOT count as a
  // "difference" that brings rows into the cascade.
  function findVendorMatches(
    transactions: ReviewTransaction[],
    editedRow: ReviewTransaction,
    bundle: {
      category: string | null;
      entityId: string | null;
      entityType: "business" | "rental" | "personal" | null;
    },
  ): string[] {
    const editedVendor = extractVendor(editedRow);
    if (!editedVendor) return [];
    const hasCategory = !!bundle.category && bundle.category.trim().length > 0;
    const hasEntity   = !!bundle.entityType;     // entityId may be null for "personal"

    return transactions
      .filter((t) => {
        if (t.id === editedRow.id) return false;
        if (t.type === "transfer") return false;       // transfers excluded entirely
        if (extractVendor(t) !== editedVendor) return false;
        const categoryDiffers = hasCategory && t.category !== bundle.category;
        const entityDiffers   = hasEntity   && (t.entityId !== bundle.entityId
                                                || t.entityType !== bundle.entityType);
        return categoryDiffers || entityDiffers;
      })
      .map((t) => t.id);
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const loadTransactions = useCallback(async () => {
    if (!user || !effectiveOwnerUid) return;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [snap, entities, accountSnap, customCategories] = await Promise.all([
        getDocs(
          query(
            collection(db, "transactions"),
            where("uid", "==", effectiveOwnerUid),
            where("status", "==", statusFilter),
            orderBy("createdAt", "desc")
          )
        ),
        getUserEntities(effectiveOwnerUid),
        getDocs(
          query(collection(db, "accounts"), where("uid", "==", effectiveOwnerUid))
        ),
        getCustomCategories(effectiveOwnerUid),
      ]);

      // Two-pass account map: Plaid accounts first, then imported accounts
      // resolve to their linked Plaid display name if one is set.
      const plaidDisplayMap = new Map<string, string>();
      const accountMap = new Map<string, string>();

      accountSnap.docs.forEach((d) => {
        const data = d.data();
        if (data.institutionName) {
          // Plaid account — build display name: "Chase – Checking ····1234"
          const mask = data.mask ? ` ····${data.mask}` : "";
          const display = `${data.institutionName} – ${data.accountName ?? d.id}${mask}`;
          plaidDisplayMap.set(d.id, display);
          accountMap.set(d.id, display);
        }
      });

      accountSnap.docs.forEach((d) => {
        const data = d.data();
        if (!data.institutionName) {
          // Imported account — use linked Plaid display name if available
          const linkedId = data.linkedPlaidAccountId as string | undefined;
          const display = linkedId && plaidDisplayMap.has(linkedId)
            ? plaidDisplayMap.get(linkedId)!
            : (data.name as string) ?? d.id;
          accountMap.set(d.id, display);
        }
      });

      const importMap = new Map<string, string>();
      try {
        const importSnap = await getDocs(
          query(collection(db, "imports"), where("userId", "==", effectiveOwnerUid))
        );
        importSnap.docs.forEach((d) => {
          importMap.set(d.id, (d.data().fileName as string) ?? d.id);
        });
      } catch {
        // imports index may not exist — fail silently
      }

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
          accountId: (data.accountId as string) ?? null,
          accountName: (data.accountName as string | undefined)?.trim()
            ? (data.accountName as string)
            : data.accountId
            ? (accountMap.get(data.accountId as string) ?? null)
            : null,
          importFile: data.importId
            ? (importMap.get(data.importId as string) ?? null)
            : null,
          subType: (data.subType as ReviewTransaction["subType"]) ?? null,
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
          entityAssignmentSource: (data.entityAssignmentSource as ReviewTransaction["entityAssignmentSource"]) ?? null,
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
              entityId:      singleBusiness.id,
              entityType:    "business",
              entityName:    singleBusiness.name,
              updatedBy:     user.uid,
              updatedByRole: role,
              updatedAt:     serverTimestamp(),
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
        customCategories,
        loading: false,
      }));
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: e instanceof Error ? e.message : "Failed to load transactions.",
      }));
    }
  }, [user, effectiveOwnerUid, selectedYear, statusFilter]);

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
    if (!user || !effectiveOwnerUid) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      await updateDoc(doc(db, "transactions", id), {
        entityId,
        entityType,
        entityName: entityName ?? null,
        entityAssignmentSource: "user_rule",
        updatedBy:     user.uid,
        updatedByRole: role,
        updatedAt:     serverTimestamp(),
      });

      // Upsert a learned rule so AI uses this entity assignment for the same vendor.
      const txn = state.transactions.find((t) => t.id === id);
      if (txn) {
        const vendorName = extractVendor(txn);
        await upsertVendorRule(effectiveOwnerUid, vendorName, {
          category:    txn.category    ?? "",
          taxCategory: txn.taxCategory ?? "",
          taxSchedule: txn.taxSchedule ?? "",
          entityId:    entityId        ?? null,
          entityName:  entityName      ?? null,
          entityType:  entityType      ?? null,
        });
      }

      // Surface the apply-to-similar prompt if there are matching same-vendor
      // rows whose entity assignment differs. Bundle reflects the row's NEW
      // state (after edit). Selective-field policy: scan helper ignores empty
      // category, so a category-less row's edit only matches on entity diff.
      let pendingCategoryPrompt: PendingCategoryPrompt = null;
      if (txn) {
        const editedVendor = extractVendor(txn);
        const guardrailHit = !!editedVendor &&
          recentlyAppliedVendorRef.current === editedVendor;
        if (editedVendor && !guardrailHit) {
          const updatedRow = { ...txn, entityId, entityType, entityName };
          const affectedRowIds = findVendorMatches(
            state.transactions.map((t) => (t.id === id ? updatedRow : t)),
            updatedRow,
            {
              category:   txn.category ?? null,
              entityId:   entityId ?? null,
              entityType,
            },
          );
          if (affectedRowIds.length >= 1) {
            pendingCategoryPrompt = {
              editedRowId:    id,
              triggeredBy:    "entity",
              vendor:         editedVendor,
              category:       txn.category    ?? null,
              taxCategory:    txn.taxCategory ?? null,
              taxSchedule:    txn.taxSchedule ?? null,
              entityId:       entityId        ?? null,
              entityType,
              entityName:     entityName      ?? null,
              affectedRowIds,
            };
          }
        }
      }

      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
        transactions: prev.transactions.map((t) =>
          t.id === id
            ? { ...t, entityId, entityType, entityName, entityAssignmentSource: "user_rule" as const }
            : t
        ),
        pendingCategoryPrompt,
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
    if (!user || !effectiveOwnerUid) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      const txn = state.transactions.find((t) => t.id === id);

      // Cloud function handles transaction update + rule upsert (no duplicate addDoc needed)
      await apiClient.call("updateTransactionCategory", {
        transactionId: id,
        category:      newCategory,
        taxCategory:   txn?.taxCategory  ?? undefined,
        taxSchedule:   txn?.taxSchedule  ?? undefined,
        entityId:      txn?.entityId     ?? undefined,
        entityType:    txn?.entityType   ?? undefined,
        entityName:    txn?.entityName   ?? undefined,
      });

      // ── Pending prompt: scan loaded rows for same-vendor candidates ─────
      // Uses the shared findVendorMatches helper so category and entity edits
      // share identical scan logic. Selective-field policy: only fields with
      // a value on the edited row count as "differences" → null fields don't
      // pull rows into the cascade or get propagated.
      const editedVendor = txn ? extractVendor(txn) : "";
      const guardrailHit = !!editedVendor &&
        recentlyAppliedVendorRef.current === editedVendor;

      let pendingCategoryPrompt: PendingCategoryPrompt = null;
      if (txn && editedVendor && !guardrailHit) {
        const updatedRow = { ...txn, category: newCategory };
        const affectedRowIds = findVendorMatches(
          state.transactions.map((t) => (t.id === id ? updatedRow : t)),
          updatedRow,
          {
            category:   newCategory,
            entityId:   txn.entityId   ?? null,
            entityType: txn.entityType,
          },
        );
        if (affectedRowIds.length >= 1) {
          pendingCategoryPrompt = {
            editedRowId:    id,
            triggeredBy:    "category",
            vendor:         editedVendor,
            category:       newCategory,
            taxCategory:    txn.taxCategory ?? null,
            taxSchedule:    txn.taxSchedule ?? null,
            entityId:       txn.entityId    ?? null,
            entityType:     txn.entityType,
            entityName:     txn.entityName  ?? null,
            affectedRowIds,
          };
        }
      }

      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
        transactions: prev.transactions.map((t) =>
          t.id === id ? { ...t, category: newCategory, source: "user_rule" as const } : t
        ),
        // Replace any prior pending prompt — newest edit wins. Clears any
        // stale prompt for a vendor the user has moved on from.
        pendingCategoryPrompt,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
      }));
    }
  }

  // ── Pending category-prompt handlers ───────────────────────────────────────

  async function acceptCategoryPrompt() {
    const prompt = state.pendingCategoryPrompt;
    if (!prompt || !user || !effectiveOwnerUid) return;

    recentlyAppliedVendorRef.current = prompt.vendor;
    const ids = prompt.affectedRowIds;

    // Selective-field write: only override candidates' fields when the edited
    // row had a non-empty value for that field. Prevents wiping good data on
    // matching rows when the user only edited one half of the bundle.
    const hasCategory = !!prompt.category && prompt.category.trim().length > 0;
    const hasEntity   = !!prompt.entityType;

    const docUpdate: Record<string, unknown> = {
      updatedBy:     user.uid,
      updatedByRole: role,
      updatedAt:     serverTimestamp(),
    };
    if (hasCategory) {
      docUpdate.category             = prompt.category;
      docUpdate.categorizationSource = "user_rule";
      docUpdate.isUserModified       = true;
      if (prompt.taxCategory) docUpdate.taxCategory = prompt.taxCategory;
      if (prompt.taxSchedule) docUpdate.taxSchedule = prompt.taxSchedule;
    }
    if (hasEntity) {
      docUpdate.entityId               = prompt.entityId;
      docUpdate.entityType             = prompt.entityType;
      docUpdate.entityName             = prompt.entityName ?? null;
      docUpdate.entityAssignmentSource = "user_rule";
    }

    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      // Batch the writes
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const docId of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", docId), docUpdate);
        }
        await batch.commit();
      }

      // Persist the vendor rule with whatever fields the bundle has.
      // categoryRules whose `category` is empty wouldn't match anything at
      // ingest time, so we only upsert when category is present.
      if (hasCategory || hasEntity) {
        await upsertVendorRule(effectiveOwnerUid, prompt.vendor, {
          category:    prompt.category    ?? "",
          taxCategory: prompt.taxCategory ?? "",
          taxSchedule: prompt.taxSchedule ?? "",
          entityId:    prompt.entityId    ?? null,
          entityName:  prompt.entityName  ?? null,
          entityType:  prompt.entityType  ?? null,
        });
      }

      // Mirror the writes into local state so the UI updates immediately.
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
        transactions: prev.transactions.map((t) => {
          if (!ids.includes(t.id)) return t;
          const next = { ...t };
          if (hasCategory) {
            next.category = prompt.category;
            next.source   = "user_rule" as const;
            if (prompt.taxCategory) next.taxCategory = prompt.taxCategory;
            if (prompt.taxSchedule) next.taxSchedule = prompt.taxSchedule;
          }
          if (hasEntity) {
            next.entityId   = prompt.entityId;
            next.entityType = prompt.entityType ?? "personal";
            next.entityName = prompt.entityName ?? undefined;
            next.entityAssignmentSource = "user_rule" as const;
          }
          return next;
        }),
        pendingCategoryPrompt: null,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
        pendingCategoryPrompt: null,
      }));
    } finally {
      // Clear the guardrail one tick later so future independent edits to
      // the same vendor (different bundle) do prompt again.
      setTimeout(() => { recentlyAppliedVendorRef.current = null; }, 0);
    }
  }

  function dismissCategoryPrompt() {
    setState((prev) => ({ ...prev, pendingCategoryPrompt: null }));
  }

  // ── Single confirm ─────────────────────────────────────────────────────────

  async function handleConfirm(id: string) {
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      await updateDoc(doc(db, "transactions", id), {
        status:        "categorized",
        updatedBy:     user?.uid ?? "",
        updatedByRole: role,
        updatedAt:     serverTimestamp(),
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
          status:        "categorized",
          updatedBy:     user?.uid ?? "",
          updatedByRole: role,
          updatedAt:     serverTimestamp(),
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
    if (!user || !effectiveOwnerUid || ids.length === 0) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      // Batch-write category to all selected transactions
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", id), {
            category,
            categorizationSource: "user_rule",
            isUserModified:       true,
            updatedBy:            user.uid,
            updatedByRole:        role,
            updatedAt:            serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // Upsert a categoryRule for each unique vendor (no duplicates)
      const selectedTxns = state.transactions.filter((t) => ids.includes(t.id));
      const seen = new Set<string>();
      for (const txn of selectedTxns) {
        const vendorName = extractVendor(txn);
        if (vendorName && !seen.has(vendorName)) {
          seen.add(vendorName);
          await upsertVendorRule(effectiveOwnerUid, vendorName, {
            category,
            taxCategory: txn.taxCategory ?? "",
            taxSchedule: txn.taxSchedule ?? "",
            entityId:    txn.entityId   ?? null,
            entityName:  txn.entityName ?? null,
            entityType:  txn.entityType ?? null,
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

  // ── Bulk entity assign (Task 4) ────────────────────────────────────────────

  async function handleBulkEntityAssign(
    ids: string[],
    entityId: string | null,
    entityType: "business" | "rental" | "personal",
    entityName?: string
  ) {
    if (!user || !effectiveOwnerUid || ids.length === 0) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", id), {
            entityId,
            entityType,
            entityName:    entityName ?? null,
            updatedBy:     user.uid,
            updatedByRole: role,
            updatedAt:     serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // Upsert a rule per unique vendor (no duplicates)
      const selectedTxns = state.transactions.filter((t) => ids.includes(t.id));
      const seen = new Set<string>();
      for (const txn of selectedTxns) {
        const vendorName = extractVendor(txn);
        if (vendorName && !seen.has(vendorName)) {
          seen.add(vendorName);
          await upsertVendorRule(effectiveOwnerUid, vendorName, {
            category:    txn.category    ?? "",
            taxCategory: txn.taxCategory ?? "",
            taxSchedule: txn.taxSchedule ?? "",
            entityId:    entityId        ?? null,
            entityName:  entityName      ?? null,
            entityType:  entityType      ?? null,
          });
        }
      }

      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
        transactions: prev.transactions.map((t) =>
          ids.includes(t.id) ? { ...t, entityId, entityType, entityName } : t
        ),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
      }));
    }
  }

  // ── Bulk account name assign ───────────────────────────────────────────────

  async function handleBulkAccountAssign(ids: string[], accountName: string) {
    if (!user || !effectiveOwnerUid || ids.length === 0 || !accountName.trim()) return;
    const trimmed = accountName.trim();
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      const { id: accountId } = await findOrCreateAccountByName(effectiveOwnerUid, trimmed);
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", id), { accountName: trimmed, accountId });
        }
        await batch.commit();
      }
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((id) => !ids.includes(id))),
        transactions: prev.transactions.map((t) =>
          ids.includes(t.id) ? { ...t, accountName: trimmed, accountId } : t
        ),
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((id) => !ids.includes(id))),
      }));
    }
  }

  // ── Auto-categorize with progress (Task 2B) ────────────────────────────────

  async function handleAutoCategorizeBatch(
    ids: string[] | "all",
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ categorized: number; skipped: number; error?: string }> {
    if (!user) return { categorized: 0, skipped: 0 };
    // Skip transfer-typed rows (incl. credit-card-payment / loan-payment
    // sub-types). They don't have a category by design — sending them to
    // the AI just produces junk like "Funds Transfer Debit" → "Laundry".
    const transferIds = new Set(
      state.transactions.filter((t) => t.type === "transfer").map((t) => t.id)
    );
    const rawIds =
      ids === "all"
        ? state.transactions.map((t) => t.id)
        : ids;
    const targetIds = rawIds.filter((id) => !transferIds.has(id));
    if (targetIds.length === 0) return { categorized: 0, skipped: 0 };

    const CHUNK = 40;
    const total = targetIds.length;
    let processed = 0;
    let totalCategorized = 0;
    let totalSkipped = 0;

    try {
      for (let i = 0; i < targetIds.length; i += CHUNK) {
        const chunk = targetIds.slice(i, i + CHUNK);
        const result = await apiClient.call<{ total: number; ruleMatched: number; aiMatched: number; skipped: number }>(
          "categorizeSelected", { transactionIds: chunk }
        );
        totalCategorized += (result.ruleMatched ?? 0) + (result.aiMatched ?? 0);
        totalSkipped += result.skipped ?? 0;
        processed = Math.min(i + CHUNK, total);
        onProgress?.(processed, total);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await loadTransactions();
      return { categorized: totalCategorized, skipped: totalSkipped, error: message };
    }

    // Reload so the UI reflects newly categorized rows
    await loadTransactions();
    return { categorized: totalCategorized, skipped: totalSkipped };
  }

  // ── Type change ────────────────────────────────────────────────────────────

  async function handleTypeChange(
    id: string,
    newType: "income" | "expense" | "transfer" | "refund",
    newSubType?: "credit_card_payment" | "loan_payment" | null
  ) {
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, id]) }));
    try {
      const updates: Record<string, unknown> = {
        type:          newType,
        updatedBy:     user?.uid ?? "",
        updatedByRole: role,
        updatedAt:     serverTimestamp(),
      };
      if (newType === "transfer") {
        updates.status = "transfer";
        updates.subType = newSubType ?? null;
      } else {
        updates.subType = null;
      }
      await updateDoc(doc(db, "transactions", id), updates);

      if (newType === "transfer") {
        // Remove from review list — it's now a transfer
        setState((prev) => ({
          ...prev,
          updating: new Set([...prev.updating].filter((i) => i !== id)),
          transactions: prev.transactions.filter((t) => t.id !== id),
          selectedIds: new Set([...prev.selectedIds].filter((i) => i !== id)),
        }));
      } else {
        setState((prev) => ({
          ...prev,
          updating: new Set([...prev.updating].filter((i) => i !== id)),
          transactions: prev.transactions.map((t) =>
            t.id === id ? { ...t, type: newType, subType: null } : t
          ),
        }));
      }
    } catch {
      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => i !== id)),
      }));
    }
  }

  // ── Custom category persistence ────────────────────────────────────────────

  async function handleCustomCategoryAdded(category: string) {
    if (!user) return;
    // Optimistic local update so the new category appears immediately in all
    // open inline editors without waiting for a full reload.
    setState((prev) => {
      if (prev.customCategories.includes(category)) return prev;
      return { ...prev, customCategories: [...prev.customCategories, category] };
    });
    try {
      const result: AddCategoryResult = await addCustomCategory(user.uid, category);
      if (!result.isNew) {
        // Service found an existing canonical name (e.g. "Business Meals" for "business meals").
        // Swap the optimistic entry out in favour of the canonical name.
        setState((prev) => ({
          ...prev,
          customCategories: [
            ...prev.customCategories.filter((c) => c !== category),
            ...(prev.customCategories.includes(result.name) ? [] : [result.name]),
          ],
        }));
      }
    } catch {
      // Non-fatal — category is already saved on the transaction/rule; the
      // list entry will re-appear on next page load.
    }
  }

  // ── Apply to similar (one-click bulk confirm for vendor groups) ───────────

  async function handleApplySimilar(
    ids: string[],
    category: string,
    entityId: string | null,
    entityType: "business" | "rental" | "personal",
    entityName: string | undefined
  ) {
    if (!user || !effectiveOwnerUid || ids.length === 0) return;
    setState((prev) => ({ ...prev, updating: new Set([...prev.updating, ...ids]) }));
    try {
      for (let i = 0; i < ids.length; i += 499) {
        const batch = writeBatch(db);
        for (const id of ids.slice(i, i + 499)) {
          batch.update(doc(db, "transactions", id), {
            category,
            categorizationSource: "user_rule",
            isUserModified:       true,
            entityId:             entityId   ?? null,
            entityType:           entityType,
            entityName:           entityName ?? null,
            updatedBy:            user.uid,
            updatedByRole:        role,
            updatedAt:            serverTimestamp(),
          });
        }
        await batch.commit();
      }

      // Upsert rules for unique vendors in this group
      const selectedTxns = state.transactions.filter((t) => ids.includes(t.id));
      const seen = new Set<string>();
      for (const txn of selectedTxns) {
        const vendorName = extractVendor(txn);
        if (vendorName && !seen.has(vendorName)) {
          seen.add(vendorName);
          await upsertVendorRule(effectiveOwnerUid, vendorName, {
            category,
            taxCategory: txn.taxCategory ?? "",
            taxSchedule: txn.taxSchedule ?? "",
            entityId:    entityId   ?? null,
            entityName:  entityName ?? null,
            entityType:  entityType ?? null,
          });
        }
      }

      setState((prev) => ({
        ...prev,
        updating: new Set([...prev.updating].filter((i) => !ids.includes(i))),
        transactions: prev.transactions.map((t) =>
          ids.includes(t.id)
            ? { ...t, category, entityId, entityType, entityName, source: "user_rule" as const }
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

  // visibleIds — when an account filter is active, pass only the currently
  // visible transaction IDs so Select All operates on the filtered view.
  function toggleSelectAll(visibleIds?: string[]) {
    const ids = visibleIds ?? state.transactions.map((t) => t.id);
    setState((prev) => {
      const allVisible = ids.length > 0 && ids.every((id) => prev.selectedIds.has(id));
      const next = new Set(prev.selectedIds);
      if (allVisible) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return { ...prev, selectedIds: next };
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
    handleTypeChange,
    handleConfirm,
    handleBulkConfirm,
    handleBulkCategoryAssign,
    handleBulkEntityAssign,
    handleBulkAccountAssign,
    handleAutoCategorizeBatch,
    handleApplySimilar,
    handleCustomCategoryAdded,
    clearSelection,
    toggleSelect,
    toggleSelectAll,
    acceptCategoryPrompt,
    dismissCategoryPrompt,
    reload: loadTransactions,
  };
}
