# 2025 Tax Readiness — Inventory, Defects, and Resolution

**Status: Phases 3–7 complete. D1–D5 fixed and covered by tests, plus five
further defects found during the work.** Phase 2 (investigation) findings are
kept below with their resolution, so the record of what was wrong survives.

Every figure in the tax tables was verified against IRS.gov or SSA.gov during
Phase 3 — sources are cited in `shared/taxConstants.ts` next to the numbers.

---

## 1. Tax surfaces (after consolidation)

### Backend (`functions/src`)

| File | Purpose | Tax constants |
|---|---|---|
| `shared/taxConstants.ts` | **Year-indexed IRS/SSA tables + tax maths** | canonical, verified |
| `shared/taxMap.ts` | Category → tax treatment mapping | n/a |
| `shared/transactionMath.ts` | `incomeContribution` / `expenseContribution` | n/a |
| `tax/summarizeTransactions.ts` | Pure summary aggregation | via taxConstants |
| `tax/generateTaxSummary.ts` | Callable wrapper (fetch only) | none |
| `utils/taxEstimate.ts` | Estimate used by notifications | via taxConstants |
| `forecast/getTaxForecast.ts` | Forward-looking forecast | via taxConstants |
| `notifications/{morningSnapshot,quarterlyDeadline}.ts` | Push reminders | via taxConstants |

### Frontend (`frontend/src`)

| Route | Component | Notes |
|---|---|---|
| `/tax-summary` | `modules/tax/TaxSummaryPage.tsx` | **canonical** — Schedule C/E aware |
| `/summary` | — | now redirects to `/tax-summary` |
| `/tax-flow` | — | redirects to `/tax-summary` |
| `/schedule-e` | `modules/tax/ScheduleEPage.tsx` | |
| `/schedule-a` | `modules/tax/ScheduleAPage.tsx` | |
| `/tax-estimate` | `modules/forecast/TaxEstimatePage.tsx` | |

Supporting: `shared/taxConstants.ts` (mirror of the backend file),
`contexts/TaxYearContext.tsx`, `modules/dashboard/taxCalculator.ts`,
`modules/dashboard/LiveTaxMeter.tsx`, `modules/tax/hooks/{useScheduleA,useScheduleC,useScheduleE}.ts`.

**The two disagreeing summary routes are gone.** `pages/SummaryPage.tsx` and
`pages/TaxFlowPage.tsx` were deleted; both were legacy, and `SummaryPage`
computed different totals from the same data.

### The one source of truth

`shared/taxConstants.ts` exists twice — `frontend/src/shared/` and
`functions/src/shared/` — because Firebase Functions cannot import from
`frontend/`. The two copies must be **byte-for-byte identical**, and
`functions/test/sharedMirrors.test.ts` fails the build if they drift. The same
test checks that both `taxMap.ts` copies route every category identically.

---

## 2. Original defects — all resolved

### D1 — Married filing separately used married filing jointly brackets ✅ FIXED

`functions/src/utils/taxEstimate.ts` routed MFS to the MFJ table, understating
tax materially at the upper end. All filing statuses now resolve their own
bracket table from `taxConstants.ts`. At $500,000 taxable income the difference
is **$114,126 (MFJ) vs $147,031.25 (MFS)** — the old code reported the former
for both. Covered by `taxConstants.test.ts` and `taxEstimate.test.ts`.

### D2 — Only two filing statuses existed in the forecast ✅ FIXED

`getTaxForecast` now supports single, married filing jointly, married filing
separately, head of household, and qualifying surviving spouse, and **rejects**
an unrecognized status with `invalid-argument` instead of silently defaulting to
`single` or producing `NaN`. `normalizeFilingStatus` accepts both vocabularies
the app has used (`married_jointly` from onboarding, `married_filing_jointly`
from the forecast pages) so stored profiles keep working.

Qualifying surviving spouse was also added to the onboarding picker; it uses the
MFJ rate schedule and standard deduction, per IRC § 1(j)(2)(A).

### D3 — Income was detected by exact category string ✅ FIXED

`generateTaxSummary` matched `cat === "Income"`, so **Business Income, Wages &
Salaries, Interest Income, Dividend Income, Investment Income and Other Income
were all excluded from `totalIncome`** and from `netProfit`. Income is now routed
by canonical tax bucket via `getTaxBucket`, the same function the dashboard uses.
Aggregation moved to `tax/summarizeTransactions.ts` so it is unit-testable
without Firestore. A test iterates every category `TAX_MAP` groups as Income, so
a newly added income category cannot regress this.

### D4 — Backend constants were 2024 regardless of selected year ✅ FIXED

Both backend calculators now read year-indexed tables. `quickTaxEstimate` takes
a `taxYear`, and a test asserts 2024 and 2025 produce different totals — the
specific thing that was impossible before.

### D5 — Frontend and backend disagreed ✅ FIXED

Both sides now consume `shared/taxConstants.ts`. The frontend calculator's
duplicated tables, `pickYear`, `applyBrackets` and inline SE-tax maths were
deleted in favour of the shared implementations. The mirror test prevents the
drift from reappearing.

---

## 3. Further defects found during Phases 3–7

### D6 — 2025 standard deduction was superseded law 🔴 FIXED

The frontend carried `2025: { single: 15000, married_jointly: 30000, … }` —
correct per Rev. Proc. 2024-40, but **the One Big Beautiful Bill Act raised the
2025 standard deduction retroactively**. The correct 2025 figures are
**$15,750 single / $31,500 MFJ / $15,750 MFS / $23,625 HoH**
([IRS](https://www.irs.gov/newsroom/one-big-beautiful-bill-provisions-individuals-and-workers)).

The old values overstated taxable income by $750–$1,500, so **every 2025 tax
estimate was too high**. Expect the meter to drop slightly after this change.

### D7 — 2026 brackets were wrong in every filing status 🔴 FIXED

The 2026 table cited Rev. Proc. 2025-32 but held pre-OBBBA projections. Actual
2026 single thresholds are `12,400 / 50,400 / 105,700 / 201,775 / 256,225 /
640,600`; the file had `12,275 / 49,950 / 106,400 / 203,200 / 258,000 / 645,250`.
All four statuses were replaced with the published figures
([I.R.B. 2025-45](https://www.irs.gov/irb/2025-45_IRB)).

### D8 — Spouses and accountants saw an empty tax summary 🔴 FIXED

`generateTaxSummary` and `getTaxForecast` used `requireAuth` (the caller's uid)
rather than `resolveEffectiveOwner`. Shared users' transactions live under the
**owner's** uid, so both endpoints returned zeros for every spouse and
accountant. Both now resolve the effective owner, and the forecast is written to
`forecasts/{ownerUid}_{year}`. The frontend hooks were already correct.

### D9 — Schedule C/E/A included unreviewed rows and transfers 🟠 FIXED

`useScheduleC`, `useScheduleE` and `useScheduleA` filtered only on tax schedule
and year. The dashboard meter already skipped `status === "needs_review"` and
`type === "transfer"`, so **the canonical `/tax-summary` page and the dashboard
reported different Schedule C figures for the same year**. All three hooks now
apply the same exclusions, as do `summarizeTransactions` and `getTaxForecast`.

### D10 — Quarterly due dates were hard-coded, and some were wrong 🟠 FIXED

Four separate hard-coded lists existed (`getTaxForecast`, `morningSnapshot`,
`quarterlyDeadline`, `TaxEstimatePage`), and each applied 2025's shifted dates to
every year — e.g. `${year}-06-16`, correct only because June 15 2025 was a
Sunday. `quarterlyDeadline.ts` also listed 2027 Q2 as June 16 when it is June 15.

`quarterlyDueDates(year)` now computes the statutory dates (Apr 15 / Jun 15 /
Sep 15 / Jan 15) and applies the § 7503 next-business-day rule, including
weekends, New Year's Day, MLK Day, DC Emancipation Day and Juneteenth. Verified
against known IRS deadlines: 2022 Q1 → Apr 18, 2023 Q1 → Apr 18, 2025 Q2 →
Jun 16, and 2027 Q4 → Jan 18 2028 (Saturday, then MLK Day).

`nextQuarterlyDue` is now **null** for a completed year instead of pointing at a
deadline that has already passed.

---

## 4. Verified figures and their sources

| Item | 2024 | 2025 | 2026 | Source |
|---|---|---|---|---|
| Standard deduction (S / MFJ) | 14,600 / 29,200 | **15,750 / 31,500** | 16,100 / 32,200 | Rev. Proc. 2023-34; OBBBA § 70102; Rev. Proc. 2025-32 |
| Top bracket starts (single) | 609,350 | 626,350 | **640,600** | IRS rates & brackets; I.R.B. 2025-45 |
| SS wage base | 168,600 | 176,100 | 184,500 | 2025 Sch. SE instructions; IRS Topic 751 |
| QBI threshold (S / MFJ) | 191,950 / 383,900 | 197,300 / 394,600 | 201,750 / 403,500 | 2025 Form 8995 instructions; Rev. Proc. 2025-32 |
| Business mileage | 67¢ | 70¢ | 72.5¢ / 76¢ (split Jul 1) | IRS standard mileage rates |
| SE tax | 12.4% OASDI + 2.9% Medicare on 92.35% of net profit; half deductible | | | IRC § 1401, § 1402(a)(12), § 164(f) |

All four 2025 bracket tables (single, MFJ, MFS, HoH) were checked digit by digit
against the IRS published tables and were already correct.

---

## 5. Known limitations — deliberately NOT modeled

These are not defects to fix silently; they are gaps a user must know about.

- **Duplicate imports are not detected at all.** No `isDuplicate` / `duplicateOf`
  field exists anywhere in the schema. A transaction imported twice is counted
  twice. Adding dedup means choosing a matching rule, which is its own change.
- **OBBBA's new deductions are not modeled**: senior ($6,000, 65+), tips
  ($25,000), overtime ($12,500 / $25,000 joint), car loan interest ($10,000).
  All are 2025–2028 provisions and would reduce tax for those who qualify.
- **SALT cap changes are not modeled**; Schedule A totals are uncapped.
- **Additional standard deduction for age 65+ or blindness** is not applied.
- **QBI is a cliff, not a phase-in.** Above the § 199A threshold the deduction
  drops to zero rather than phasing out (SSTB) or applying the W-2 wage / UBIA
  limit. This **overstates** tax for higher-income Schedule C filers.
- **Capital gains preferential rates, AMT, and tax credits** are not modeled;
  investment income is taxed as ordinary income.
- **No state taxes.** `breakdown.state` is always 0.
- **Schedule E is not folded into the dashboard meter** — rental income appears
  on `/tax-summary` and `/schedule-e` only.
- **Net operating loss carryforward is not implemented**; AGI is floored at 0
  when a Schedule C loss exceeds other income, and the loss simply disappears.

---

## 6. Filing capabilities — what this app does and does not do

**Supported:** organizing imported transactions, categorization, Schedule C/E
summaries, estimates, and CSV / print exports.

**Not supported:** DIYTax AI does **not** electronically file federal or state
tax returns, and does not transmit anything to the IRS or any state authority.
Exports must be reviewed and filed through approved tax software or a tax
professional. No "File with IRS" capability exists or should be implied.

---

## 7. Test coverage

`functions/` — 128 tests passing (`npm test`):

- `taxConstants.test.ts` — published IRS/SSA figures, MFS vs MFJ divergence,
  progressive bracket application, filing-status normalization and rejection,
  SE tax including the wage-base cap and W-2 interaction, quarterly date
  shifting against known IRS deadlines, year fallback
- `summarizeTransactions.test.ts` — D3 income routing across every income
  category, personal vs deductible split, Schedule C/E/A separation, refund
  netting, entity-based routing, exclusions and their counts
- `taxEstimate.test.ts` — year sensitivity, MFS vs MFJ, vocabulary tolerance,
  head of household, W-2 wage-base interaction
- `sharedMirrors.test.ts` — mirror drift guard for `taxConstants.ts` and `taxMap.ts`

The frontend has no test runner. Its tax tables are the byte-identical mirror
verified by `sharedMirrors.test.ts`, so the tested numbers are the ones it uses.

---

## 8. Remaining recommendation

D1–D10 are fixed and tested, and the numbers are traceable to IRS/SSA sources.
Before filing from this app, still reconcile against the source documents
(1099s, bank statements) and review the limitations in section 5 — particularly
duplicate imports, which the app cannot currently detect.
