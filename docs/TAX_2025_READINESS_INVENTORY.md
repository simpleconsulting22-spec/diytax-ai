# 2025 Tax Readiness — Inventory and Defect Report

**Status: investigation complete, no code changed yet.** This is the Phase 2
deliverable: what exists, what is wrong, and what must be fixed before the app
is used with real 2025 financial data.

Every defect below was confirmed by reading the code, not inferred. File and
line references are against `main` at `4117cf3`.

---

## 1. Tax surfaces

### Backend (`functions/src`)

| File | Purpose | Tax constants |
|---|---|---|
| `tax/generateTaxSummary.ts` | Summary totals | none (delegates) |
| `utils/taxEstimate.ts` | Estimate used by Cloud Functions | **hard-coded 2024** |
| `forecast/getTaxForecast.ts` | Forward-looking forecast | **hard-coded 2024** |
| `shared/taxMap.ts` | Category → tax treatment mapping | n/a |
| `shared/transactionMath.ts` | `incomeContribution` / `expenseContribution` | n/a |

### Frontend (`frontend/src`)

| Route | Component | Notes |
|---|---|---|
| `/summary` | `pages/SummaryPage.tsx` | **legacy** — 4 hard-coded year references |
| `/tax-summary` | `modules/tax/TaxSummaryPage.tsx` | Schedule C/E aware — **the canonical one** |
| `/schedule-e` | `modules/tax/ScheduleEPage.tsx` | |
| `/schedule-a` | `modules/tax/ScheduleAPage.tsx` | |
| `/tax-flow` | `pages/TaxFlowPage.tsx` | entry point; 1 hard-coded year |
| `/tax-estimate` | `modules/forecast/TaxEstimatePage.tsx` | |

Supporting: `contexts/TaxYearContext.tsx`, `modules/dashboard/taxCalculator.ts`,
`modules/dashboard/LiveTaxMeter.tsx`, `modules/tax/hooks/{useScheduleA,useScheduleC,useScheduleE}.ts`.

**Two summary routes exist and can disagree.** `/summary` is the older
implementation; `/tax-summary` is Schedule C/E aware. Consolidation is Phase 5.

---

## 2. Confirmed defects

### D1 — Married filing separately uses married filing jointly brackets 🔴

`functions/src/utils/taxEstimate.ts:66`

```ts
const brackets = (filingStatus === "married_jointly" || filingStatus === "married_separately")
```

MFS is routed to the MFJ bracket table. MFJ bracket widths are roughly double
MFS at the upper end, so **an MFS filer's tax is materially understated**. This
is a wrong-number bug, not a rounding issue.

### D2 — Only two filing statuses exist in the forecast 🔴

`functions/src/forecast/getTaxForecast.ts:9`

```ts
type FilingStatus = "single" | "married_filing_jointly";
```

`BRACKETS` and `STANDARD_DEDUCTION` are `Record<FilingStatus, …>` over those two
only, and line 78 casts an incoming string `as FilingStatus` without validation.
Head of household, married filing separately, and qualifying surviving spouse
have no entry — the lookup yields `undefined` and the bracket loop then fails or
produces `NaN`. There is no rejection path.

### D3 — Income is detected by exact category string 🔴

`functions/src/tax/generateTaxSummary.ts:45`

```ts
if (cat === "Income") {
```

Only the literal category `"Income"` counts. **Business Income, Wages &
Salaries, Interest Income, Dividend Income, Investment Income, and Other Income
are all silently excluded from `totalIncome`** — and therefore from `netProfit`.
Income is under-reported for anyone using specific income categories, which is
the normal case.

### D4 — Backend constants are 2024, regardless of selected year 🔴

`functions/src/utils/taxEstimate.ts`

- Header comment: `Lightweight 2024 IRS tax estimate`
- `SS_WAGE_BASE = 168600` — the **2024** figure
- Standard deductions `married_separately: 14600`, `head_of_household: 21900` — **2024** figures
- Brackets `BRACKETS_SINGLE_2024`, `BRACKETS_MFJ_2024`

`functions/src/forecast/getTaxForecast.ts:5` is commented
`── 2024/2025 tax constants ──` but the values below it are 2024 only.

Neither file is year-indexed. Selecting 2025 in the UI does not change what the
backend computes.

### D5 — Frontend and backend disagree 🟠

`frontend/src/modules/dashboard/taxCalculator.ts` is **already year-indexed**
for 2024 / 2025 / 2026 and cites its sources:

```
// 2024: Rev. Proc. 2023-34
// 2025: Rev. Proc. 2024-40
// 2026: Rev. Proc. 2025-32
```

The backend does not import or share this. The same user can see one number on
the dashboard and a different one from a Cloud Function. The frontend table is
the better starting point; the fix is to extract it into shared, year-indexed
config that both sides consume — not to duplicate it again.

---

## 3. Not yet verified

These are Phase 3–7 scope and were **not** confirmed in this pass. Listed so
they are not mistaken for clean:

- Whether the frontend 2025 bracket values match Rev. Proc. 2024-40 exactly
  (the citation is right; the digits need checking against the IRS source)
- 2025 Social Security wage base, self-employment tax, and the half-SE-tax
  deduction
- 2025 business mileage rate
- Quarterly estimated-tax dates, and the completed-year "next deadline" behavior
- Transfer, refund, personal-expense, and duplicate-import handling in the
  summary
- Schedule C / Schedule E reconciliation
- Export (CSV, print/PDF) year correctness
- Shared owner / spouse / accountant data-owner resolution — `middleware/auth.ts`
  exposes `resolveEffectiveOwner`, but its use across tax routes is unaudited

---

## 4. Filing capabilities — what this app does and does not do

**Supported:** organizing imported transactions, categorization, Schedule C/E
summaries, estimates, and CSV / print exports.

**Not supported:** DIYTax AI does **not** electronically file federal or state
tax returns, and does not transmit anything to the IRS or any state authority.
Exports must be reviewed and filed through approved tax software or a tax
professional. No "File with IRS" capability exists or should be implied.

---

## 5. Recommended order

1. **D3** — income detection. Highest impact, smallest change, and it silently
   under-reports income today.
2. **D1 / D2** — filing status correctness, including rejecting unsupported
   statuses instead of defaulting.
3. **D4 / D5** — extract shared year-indexed tax config; verify 2025 values
   against the IRS/SSA sources before propagating them.
4. Summary reconciliation, route consolidation, exports, shared-access audit.

**Do not use this app for real 2025 filing figures until at least D1–D4 are
fixed and covered by tests.** D3 under-reports income and D1 under-reports tax
for MFS filers — both produce confidently wrong numbers with no error shown.
