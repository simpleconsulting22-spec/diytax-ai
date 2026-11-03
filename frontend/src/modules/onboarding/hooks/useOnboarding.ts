import { useState, useEffect } from "react";
import {
  doc,
  setDoc,
  addDoc,
  collection,
  updateDoc,
  serverTimestamp,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { db } from "../../../firebase";
import { useAuth } from "../../../contexts/AuthContext";

export type IncomeSource =
  | "job"
  | "business"
  | "rental"
  | "investments"
  | "social_security";

export type ExpenseType =
  | "travel"
  | "meals"
  | "supplies"
  | "software"
  | "professional_services";

export type DataSourcePreference = "csv" | "bank" | "manual";

// One definition of filing status, shared with the tax calculators — a third
// local copy is how "married filing separately" ended up on the wrong brackets.
import type { FilingStatus } from "../../../shared/taxConstants";
export type { FilingStatus };

export type EntityOwner = "primary" | "spouse" | "both";

export interface EntityEntry {
  name: string;
  owner: EntityOwner;
}

export interface OnboardingState {
  step: number;
  // Step 2 — owner info
  ownerName: string;
  filingStatus: FilingStatus | null;
  spouseName: string;
  // Step 3 — income sources
  incomeSources: IncomeSource[];
  // Step 4 — entity names (conditional)
  businesses: EntityEntry[];
  rentals: EntityEntry[];
  // Step 5 — expense types
  expenseTypes: ExpenseType[];
  // Step 6 — data source
  dataSourcePreference: DataSourcePreference | null;
  // Meta
  consented: boolean;
  saving: boolean;
  error: string;
  isEditing: boolean;
  loadingProfile: boolean;
}

export const CONSENT_VERSION = "1.0";

function deriveEnabledSchedules(sources: IncomeSource[]): string[] {
  const schedules: string[] = [];
  if (sources.includes("business")) schedules.push("Schedule C");
  if (sources.includes("rental")) schedules.push("Schedule E");
  if (!sources.includes("business") && !sources.includes("rental")) {
    schedules.push("Schedule A");
  }
  return schedules;
}

export function useOnboarding() {
  const { user, refreshUserDoc } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState<OnboardingState>({
    step: 1,
    ownerName: "",
    filingStatus: null,
    spouseName: "",
    incomeSources: [],
    businesses: [{ name: "", owner: "primary" }],
    rentals: [{ name: "", owner: "primary" }],
    expenseTypes: [],
    dataSourcePreference: null,
    consented: false,
    saving: false,
    error: "",
    isEditing: false,
    loadingProfile: true,
  });

  // Load existing profile on mount to pre-populate for editing
  useEffect(() => {
    if (!user) {
      setState((prev) => ({ ...prev, loadingProfile: false }));
      return;
    }
    async function loadProfile() {
      if (!user) return;
      try {
        const [profileSnap, entitiesSnap] = await Promise.all([
          getDoc(doc(db, "userProfiles", user.uid)),
          getDocs(query(collection(db, "entities"), where("userId", "==", user.uid))),
        ]);

        if (!profileSnap.exists()) {
          setState((prev) => ({ ...prev, loadingProfile: false }));
          return;
        }

        const profile = profileSnap.data();
        const businesses: EntityEntry[] = [];
        const rentals: EntityEntry[] = [];
        entitiesSnap.forEach((d) => {
          const e = d.data();
          const entry: EntityEntry = { name: e.name, owner: (e.owner as EntityOwner) ?? "primary" };
          if (e.type === "business") businesses.push(entry);
          if (e.type === "rental") rentals.push(entry);
        });

        setState((prev) => ({
          ...prev,
          ownerName: profile.ownerName ?? "",
          filingStatus: (profile.filingStatus as FilingStatus) ?? null,
          spouseName: profile.spouseName ?? "",
          incomeSources: (profile.incomeSources as IncomeSource[]) ?? [],
          expenseTypes: (profile.expenseTypes as ExpenseType[]) ?? [],
          dataSourcePreference: (profile.dataSourcePreference as DataSourcePreference) ?? null,
          businesses: businesses.length > 0 ? businesses : [{ name: "", owner: "primary" }],
          rentals: rentals.length > 0 ? rentals : [{ name: "", owner: "primary" }],
          consented: true,
          isEditing: true,
          loadingProfile: false,
        }));
      } catch {
        setState((prev) => ({ ...prev, loadingProfile: false }));
      }
    }
    loadProfile();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  function needsEntityStep(sources: IncomeSource[]) {
    return sources.includes("business") || sources.includes("rental");
  }

  // ── Setters ──────────────────────────────────────────────────────────────────

  function setOwnerName(name: string) {
    setState((prev) => ({ ...prev, ownerName: name }));
  }

  function setFilingStatus(status: FilingStatus) {
    setState((prev) => ({
      ...prev,
      filingStatus: status,
      spouseName: status === "single" || status === "head_of_household" ? "" : prev.spouseName,
    }));
  }

  function setSpouseName(name: string) {
    setState((prev) => ({ ...prev, spouseName: name }));
  }

  function toggleIncomeSource(source: IncomeSource) {
    setState((prev) => ({
      ...prev,
      incomeSources: prev.incomeSources.includes(source)
        ? prev.incomeSources.filter((s) => s !== source)
        : [...prev.incomeSources, source],
    }));
  }

  function toggleExpenseType(type: ExpenseType) {
    setState((prev) => ({
      ...prev,
      expenseTypes: prev.expenseTypes.includes(type)
        ? prev.expenseTypes.filter((t) => t !== type)
        : [...prev.expenseTypes, type],
    }));
  }

  function updateBusiness(index: number, patch: Partial<EntityEntry>) {
    setState((prev) => {
      const updated = [...prev.businesses];
      updated[index] = { ...updated[index], ...patch };
      return { ...prev, businesses: updated };
    });
  }

  function addBusiness() {
    setState((prev) => ({ ...prev, businesses: [...prev.businesses, { name: "", owner: "primary" }] }));
  }

  function removeBusiness(index: number) {
    setState((prev) => ({ ...prev, businesses: prev.businesses.filter((_, i) => i !== index) }));
  }

  function updateRental(index: number, patch: Partial<EntityEntry>) {
    setState((prev) => {
      const updated = [...prev.rentals];
      updated[index] = { ...updated[index], ...patch };
      return { ...prev, rentals: updated };
    });
  }

  function addRental() {
    setState((prev) => ({ ...prev, rentals: [...prev.rentals, { name: "", owner: "primary" }] }));
  }

  function removeRental(index: number) {
    setState((prev) => ({ ...prev, rentals: prev.rentals.filter((_, i) => i !== index) }));
  }

  function setDataSourcePreference(pref: DataSourcePreference) {
    setState((prev) => ({ ...prev, dataSourcePreference: pref }));
  }

  function setConsented(value: boolean) {
    setState((prev) => ({ ...prev, consented: value }));
  }

  // ── Navigation ────────────────────────────────────────────────────────────────
  // Steps: 1=welcome, 2=owner info, 3=income sources, 4=entities(conditional), 5=expenses, 6=data source

  function goNext() {
    setState((prev) => {
      // Skip entity step (4) if no business/rental selected
      if (prev.step === 3 && !needsEntityStep(prev.incomeSources)) {
        return { ...prev, step: 5 };
      }
      return { ...prev, step: prev.step + 1 };
    });
  }

  function goBack() {
    setState((prev) => {
      // Skip back over entity step (4) if it wasn't needed
      if (prev.step === 5 && !needsEntityStep(prev.incomeSources)) {
        return { ...prev, step: 3 };
      }
      return { ...prev, step: prev.step - 1 };
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!user || !state.dataSourcePreference) return;
    setState((prev) => ({ ...prev, saving: true, error: "" }));
    try {
      const enabledSchedules = deriveEnabledSchedules(state.incomeSources);

      // Reconcile entity docs in place instead of delete-then-recreate.
      // Recreating mints new doc IDs, which leaves previously-categorized
      // transactions and categoryRules pointing at the now-deleted entityId
      // and causes the dashboard to show the same business as multiple
      // sections (one per generation).
      const existingSnap = await getDocs(
        query(collection(db, "entities"), where("userId", "==", user.uid))
      );
      const existingByKey = new Map<
        string,
        { id: string; name: string; owner?: EntityOwner }
      >();
      existingSnap.forEach((d) => {
        const data = d.data();
        const t = data.type as string | undefined;
        const n = data.name as string | undefined;
        if (typeof t !== "string" || typeof n !== "string") return;
        existingByKey.set(`${t}:${n.trim().toLowerCase()}`, {
          id: d.id,
          name: n,
          owner: data.owner as EntityOwner | undefined,
        });
      });

      type Desired = { type: "business" | "rental"; name: string; owner: EntityOwner };
      const desired: Desired[] = [];
      if (state.incomeSources.includes("business")) {
        for (const e of state.businesses.filter((b) => b.name.trim())) {
          desired.push({ type: "business", name: e.name.trim(), owner: e.owner });
        }
      }
      if (state.incomeSources.includes("rental")) {
        for (const e of state.rentals.filter((r) => r.name.trim())) {
          desired.push({ type: "rental", name: e.name.trim(), owner: e.owner });
        }
      }

      const keepIds = new Set<string>();
      for (const want of desired) {
        const key = `${want.type}:${want.name.toLowerCase()}`;
        const match = existingByKey.get(key);
        if (match) {
          keepIds.add(match.id);
          if (match.name !== want.name || match.owner !== want.owner) {
            await updateDoc(doc(db, "entities", match.id), {
              name: want.name,
              owner: want.owner,
            });
          }
        } else {
          await addDoc(collection(db, "entities"), {
            userId: user.uid,
            type: want.type,
            name: want.name,
            owner: want.owner,
            createdAt: serverTimestamp(),
          });
        }
      }

      const toDelete = [...existingByKey.values()].filter((e) => !keepIds.has(e.id));
      if (toDelete.length > 0) {
        const batch = writeBatch(db);
        for (const e of toDelete) batch.delete(doc(db, "entities", e.id));
        await batch.commit();
      }

      const isMarried =
        state.filingStatus === "married_jointly" ||
        state.filingStatus === "married_separately";

      // Save userProfiles document
      await setDoc(doc(db, "userProfiles", user.uid), {
        userId: user.uid,
        ownerName: state.ownerName.trim(),
        filingStatus: state.filingStatus,
        ...(isMarried && state.spouseName.trim() ? { spouseName: state.spouseName.trim() } : {}),
        incomeSources: state.incomeSources,
        expenseTypes: state.expenseTypes,
        dataSourcePreference: state.dataSourcePreference,
        enabledSchedules,
        onboardingComplete: true,
        createdAt: serverTimestamp(),
      });

      // Mark onboarding complete and record consent on user doc
      await updateDoc(doc(db, "users", user.uid), {
        onboardingComplete: true,
        consentedAt: serverTimestamp(),
        consentVersion: CONSENT_VERSION,
      });
      await refreshUserDoc();
      if (state.isEditing) {
        navigate("/dashboard");
      } else if (state.dataSourcePreference === "csv") {
        navigate("/import-csv");
      } else if (state.dataSourcePreference === "bank") {
        navigate("/bank-accounts");
      } else {
        navigate("/dashboard");
      }
    } catch (e: unknown) {
      setState((prev) => ({
        ...prev,
        saving: false,
        error: e instanceof Error ? e.message : "Failed to save. Please try again.",
      }));
    }
  }

  return {
    state,
    setOwnerName,
    setFilingStatus,
    setSpouseName,
    toggleIncomeSource,
    toggleExpenseType,
    updateBusiness,
    addBusiness,
    removeBusiness,
    updateRental,
    addRental,
    removeRental,
    setDataSourcePreference,
    setConsented,
    goNext,
    goBack,
    handleSubmit,
    needsEntityStep: needsEntityStep(state.incomeSources),
    isEditing: state.isEditing,
    loadingProfile: state.loadingProfile,
  };
}
