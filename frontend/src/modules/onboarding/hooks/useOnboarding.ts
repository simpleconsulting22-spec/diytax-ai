import { useState } from "react";
import {
  doc,
  setDoc,
  addDoc,
  collection,
  updateDoc,
  serverTimestamp,
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
  businessName: string;
  rentalName: string;
  expenseTypes: ExpenseType[];
  dataSourcePreference: DataSourcePreference | null;
  saving: boolean;
  error: string;
}

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
    businessName: "",
    rentalName: "",
    expenseTypes: [],
    dataSourcePreference: null,
    saving: false,
    error: "",
  });

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

  function setBusinessName(name: string) {
    setState((prev) => ({ ...prev, businessName: name }));
  }

  function setRentalName(name: string) {
    setState((prev) => ({ ...prev, rentalName: name }));
  }

  function setDataSourcePreference(pref: DataSourcePreference) {
    setState((prev) => ({ ...prev, dataSourcePreference: pref }));
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

      // Create entity documents for business and/or rental
      if (state.incomeSources.includes("business") && state.businessName.trim()) {
        await addDoc(collection(db, "entities"), {
          userId: user.uid,
          type: "business",
          name: state.businessName.trim(),
          createdAt: serverTimestamp(),
        });
      }
      if (state.incomeSources.includes("rental") && state.rentalName.trim()) {
        await addDoc(collection(db, "entities"), {
          userId: user.uid,
          type: "rental",
          name: state.rentalName.trim(),
          createdAt: serverTimestamp(),
        });
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

      // Mark onboarding complete on user doc
      await updateDoc(doc(db, "users", user.uid), { onboardingComplete: true });
      await refreshUserDoc();
      navigate(state.dataSourcePreference === "csv" ? "/import-csv" : "/dashboard");
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
    setBusinessName,
    setRentalName,
    setDataSourcePreference,
    goNext,
    goBack,
    handleSubmit,
    needsStep3: needsStep3(state.incomeSources),
  };
}
