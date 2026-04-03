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

export type DataSourcePreference = "csv" | "bank_future" | "manual";

export interface OnboardingState {
  step: number;
  incomeSources: IncomeSource[];
  businessNames: string[];
  rentalNames: string[];
  expenseTypes: ExpenseType[];
  dataSourcePreference: DataSourcePreference | null;
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
    incomeSources: [],
    businessNames: [""],
    rentalNames: [""],
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
        const businessNames: string[] = [];
        const rentalNames: string[] = [];
        entitiesSnap.forEach((d) => {
          const e = d.data();
          if (e.type === "business") businessNames.push(e.name);
          if (e.type === "rental") rentalNames.push(e.name);
        });

        setState((prev) => ({
          ...prev,
          incomeSources: (profile.incomeSources as IncomeSource[]) ?? [],
          expenseTypes: (profile.expenseTypes as ExpenseType[]) ?? [],
          dataSourcePreference: (profile.dataSourcePreference as DataSourcePreference) ?? null,
          businessNames: businessNames.length > 0 ? businessNames : [""],
          rentalNames: rentalNames.length > 0 ? rentalNames : [""],
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

  function needsStep3(sources: IncomeSource[]) {
    return sources.includes("business") || sources.includes("rental");
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

  function updateBusinessName(index: number, name: string) {
    setState((prev) => {
      const updated = [...prev.businessNames];
      updated[index] = name;
      return { ...prev, businessNames: updated };
    });
  }

  function addBusinessName() {
    setState((prev) => ({ ...prev, businessNames: [...prev.businessNames, ""] }));
  }

  function removeBusinessName(index: number) {
    setState((prev) => ({
      ...prev,
      businessNames: prev.businessNames.filter((_, i) => i !== index),
    }));
  }

  function updateRentalName(index: number, name: string) {
    setState((prev) => {
      const updated = [...prev.rentalNames];
      updated[index] = name;
      return { ...prev, rentalNames: updated };
    });
  }

  function addRentalName() {
    setState((prev) => ({ ...prev, rentalNames: [...prev.rentalNames, ""] }));
  }

  function removeRentalName(index: number) {
    setState((prev) => ({
      ...prev,
      rentalNames: prev.rentalNames.filter((_, i) => i !== index),
    }));
  }

  function setDataSourcePreference(pref: DataSourcePreference) {
    setState((prev) => ({ ...prev, dataSourcePreference: pref }));
  }

  function setConsented(value: boolean) {
    setState((prev) => ({ ...prev, consented: value }));
  }

  function goNext() {
    setState((prev) => {
      if (prev.step === 2 && !needsStep3(prev.incomeSources)) {
        return { ...prev, step: 4 };
      }
      return { ...prev, step: prev.step + 1 };
    });
  }

  function goBack() {
    setState((prev) => {
      if (prev.step === 4 && !needsStep3(prev.incomeSources)) {
        return { ...prev, step: 2 };
      }
      return { ...prev, step: prev.step - 1 };
    });
  }

  async function handleSubmit() {
    if (!user || !state.dataSourcePreference) return;
    setState((prev) => ({ ...prev, saving: true, error: "" }));
    try {
      const enabledSchedules = deriveEnabledSchedules(state.incomeSources);

      // Delete existing entities before recreating to avoid duplicates
      if (state.isEditing) {
        const existingEntities = await getDocs(
          query(collection(db, "entities"), where("userId", "==", user.uid))
        );
        const batch = writeBatch(db);
        existingEntities.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      // Create entity documents for business and/or rental
      if (state.incomeSources.includes("business")) {
        for (const name of state.businessNames.filter((n) => n.trim())) {
          await addDoc(collection(db, "entities"), {
            userId: user.uid,
            type: "business",
            name: name.trim(),
            createdAt: serverTimestamp(),
          });
        }
      }
      if (state.incomeSources.includes("rental")) {
        for (const name of state.rentalNames.filter((n) => n.trim())) {
          await addDoc(collection(db, "entities"), {
            userId: user.uid,
            type: "rental",
            name: name.trim(),
            createdAt: serverTimestamp(),
          });
        }
      }

      // Create userProfiles document
      await setDoc(doc(db, "userProfiles", user.uid), {
        userId: user.uid,
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
      } else {
        navigate(state.dataSourcePreference === "csv" ? "/import-csv" : "/dashboard");
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
    toggleIncomeSource,
    toggleExpenseType,
    updateBusinessName,
    addBusinessName,
    removeBusinessName,
    updateRentalName,
    addRentalName,
    removeRentalName,
    setDataSourcePreference,
    setConsented,
    goNext,
    goBack,
    handleSubmit,
    needsStep3: needsStep3(state.incomeSources),
    isEditing: state.isEditing,
    loadingProfile: state.loadingProfile,
  };
}
