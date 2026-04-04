import React, { createContext, useContext, useState } from "react";

// ─── Available years ──────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

// Show current year + up to 5 prior years (e.g. 2026 down to 2021)
export const AVAILABLE_YEARS: number[] = Array.from(
  { length: Math.min(CURRENT_YEAR - 2019, 6) },
  (_, i) => CURRENT_YEAR - i
);

// ─── Context ──────────────────────────────────────────────────────────────────

interface TaxYearContextValue {
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  availableYears: number[];
  isCurrentYear: boolean;
}

const TaxYearContext = createContext<TaxYearContextValue>({
  selectedYear: CURRENT_YEAR,
  setSelectedYear: () => {},
  availableYears: AVAILABLE_YEARS,
  isCurrentYear: true,
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TaxYearProvider({ children }: { children: React.ReactNode }) {
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);

  return (
    <TaxYearContext.Provider
      value={{
        selectedYear,
        setSelectedYear,
        availableYears: AVAILABLE_YEARS,
        isCurrentYear: selectedYear === CURRENT_YEAR,
      }}
    >
      {children}
    </TaxYearContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTaxYear(): TaxYearContextValue {
  return useContext(TaxYearContext);
}

// ─── Shared utility ───────────────────────────────────────────────────────────

/**
 * Returns true when a transaction belongs to the given tax year.
 * Uses the `taxYear` field if present; otherwise derives from the `date` string.
 * This ensures backward compatibility with transactions imported before taxYear
 * was written to the document.
 */
export function matchesTaxYear(
  txn: { taxYear?: number | null; date?: string },
  year: number
): boolean {
  if (txn.taxYear != null) return txn.taxYear === year;
  const dateYear = parseInt((txn.date ?? "").slice(0, 4));
  return dateYear === year;
}
