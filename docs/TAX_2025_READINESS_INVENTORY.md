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

### D11 — Wages, interest, dividends and rent inflated the SE tax base 🔴 FIXED

`getTaxForecast` pooled all income into one total and all deductible expenses
into another, then fed `income − expenses` to `selfEmploymentTax()`. That
charged **15.3% self-employment tax on W-2 wages, interest, dividends and
rental income**, none of which are self-employment earnings — IRC § 1402(a)
covers trade or business income, and § 1402(a)(1) excludes rental real estate
explicitly. The same pooling let Schedule A and Schedule E deductions reduce
Schedule C profit.

On the synthetic fixture (Sch C net 105,000; wages 65,000; portfolio 3,500;
Sch E net 20,000) the pooled base was **191,500** against a correct base of
**105,000** — an overstatement of roughly **$12,100 of SE tax**.

### D12 — The morning push had the same bug, plus double-counted W-2 🔴 FIXED

`morningSnapshot` computed `netProfit = all income − all expenses` with no
bucket awareness at all and passed it as Schedule C net profit. It also added
`profile.w2Income` on top of wage transactions that were already counted.

Both now run through `summarizeTransactions()` (lane split) and
`computeFederalEstimate()` (tax maths) — one implementation, shared with the
dashboard. `quickTaxEstimate` took a bare `netProfit` number, which is what let
callers pass the wrong thing; it now takes an explicit lane-separated object.

### D13 — Interest and dividends sheltered SE income from OASDI 🟠 FIXED

The dashboard calculator pooled every non-SE, non-rental income into `w2FromTxns`
and passed it as the W-2 wage figure that consumes the Social Security wage
base. Interest and dividends are not wages and do not consume it, so a filer
with large portfolio income had their SE tax understated. Wages are now split
from other ordinary income (`isW2WageCategory`).

### D14 — QBI was a silent cliff 🟠 FIXED

Above the § 199A threshold the deduction was reported as `0` — indistinguishable
from a computed answer of "you get nothing". The real deduction there depends on
W-2 wages paid by the business and UBIA of qualified property, neither of which
this app collects. The estimate now returns `qbiStatus`, and the UI says the
deduction was **not calculated** and that actual tax is likely lower.

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

## 4a. The category → tax lane matrix

Generated from `TAX_MAP` by running one $10,000 transaction of each category
through `summarizeTransactions` → `computeFederalEstimate` (2025, single).
Asserted in `functions/test/taxLanes.test.ts`.

| Category | Bucket | Total income | Sch C gross | Sch C net | Sch E net | AGI | **SE base** |
|---|---|---|---|---|---|---|---|
| Wages & Salaries | ordinary_income | 10,000 | — | — | — | 10,000 | **—** |
| Interest Income | ordinary_income | 10,000 | — | — | — | 10,000 | **—** |
| Dividend Income | ordinary_income | 10,000 | — | — | — | 10,000 | **—** |
| Investment Income | ordinary_income | 10,000 | — | — | — | 10,000 | **—** |
| Other Income | ordinary_income | 10,000 | — | — | — | 10,000 | **—** |
| **Business Income** | se_income | 10,000 | 10,000 | 10,000 | — | 9,293.52 | **10,000** |
| **Rental Income** | rental_income | 10,000 | — | — | 10,000 | 10,000 | **—** |
| All 22 Sch C expense categories | se_expense | — | — | −10,000 | — | — | — |
| All 7 Sch A categories | itemized_deduction | — | — | — | — | — | — |
| All 7 Sch E expense categories | rental_expense | — | — | — | −10,000 | — | — |
| All 13 personal / non-deductible | personal | — | — | — | — | — | — |

Business Income's AGI of 9,293.52 is 10,000 less the deductible half of SE tax
(706.48) — the only category where AGI differs from income, exactly as expected.

**Retirement and Social Security income** are held in separate collections
(`useSSAData`, `useRetirementData`), surface on `/tax-summary` only, and never
enter Schedule C or the SE base. A pension deposit categorized as a
transaction lands in "Other Income" → ordinary income, also never SE.

---

## 5. Known limitations — deliberately NOT modeled

These are not defects to fix silently; they are gaps a user must know about.
They are surfaced in the UI via `ESTIMATE_EXCLUSIONS`, on the dashboard meter,
the tax estimate page, and the tax summary page.

- **Duplicate imports: deterministic protection only.** Plaid rows are keyed on
  the provider's stable `transaction_id` (doc id `plaid_<id>`, written with
  `.create()`), so re-syncing is idempotent. CSV / AI rows are keyed on an exact
  hash of account + date + signed amount + normalized description. There is no
  fuzzy matching, deliberately — a near-miss heuristic would discard legitimate
  transactions. Two consequences follow, and both are disclosed:
  - Genuinely distinct rows identical on all four fields collapse into one
    (two identical coffees, same shop, same day). This **under**-counts.
  - Rows the user force-imported past a duplicate warning carry
    `isForceImport: true` and are counted in the totals. The tax summary shows a
    banner naming how many, since those are the only rows that can double-count.
  - Re-importing the same CSV against a *different* `accountId` produces a
    different hash and will duplicate.
- **OBBBA's new deductions are not modeled**: senior ($6,000, 65+), tips
  ($25,000), overtime ($12,500 / $25,000 joint), car loan interest ($10,000).
  All are 2025–2028 provisions and would reduce tax for those who qualify.
- **SALT cap changes are not modeled**; Schedule A totals are uncapped.
- **Additional standard deduction for age 65+ or blindness** is not applied.
- **QBI above the § 199A threshold is not calculated.** It depends on W-2 wages
  paid by the business and UBIA of qualified property, which the app does not
  collect. No benefit is included, so tax is **overstated** for those filers —
  and the UI says so rather than showing a computed-looking $0.
- **Capital gains preferential rates, AMT, and tax credits** are not modeled;
  investment income is taxed as ordinary income.
- **No state taxes.** `breakdown.state` is always 0.
- **Passive activity loss limits are not applied to Schedule E.** A rental loss
  reduces AGI in full; the real § 469 limits may disallow some of it.
- **Social Security taxability is not modeled** — SSA benefits are shown but not
  run through the 50%/85% inclusion worksheet.
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

`functions/` — 182 tests passing (`npm test`):

- `taxConstants.test.ts` — published IRS/SSA figures including all five 2025
  standard deductions, MFS vs MFJ divergence, progressive bracket application,
  filing-status normalization and rejection, SE tax including the wage-base cap
  and W-2 interaction, quarterly date shifting against known IRS deadlines
- `taxLanes.test.ts` — **the category → lane matrix**: every category's
  contribution to total income, Sch C gross, Sch C net, Sch E, AGI and the SE
  base; non-deductible categories; unknown categories staying review-required
- `summarizeTransactions.test.ts` — income routing across every income category,
  personal vs deductible split, refund netting, entity routing, exclusions
- `taxEstimate.test.ts` — year sensitivity, filing statuses, QBI status, AGI
  assembly, itemized-vs-standard selection, disclosure completeness
- `syntheticEndToEnd.test.ts` — synthetic-data proof through the real callables
  with an in-memory Firestore: owner / spouse / accountant access via
  `effectiveOwnerUid`, cross-owner isolation, unauthenticated rejection,
  hand-derived totals for every lane, forecast SE base, completed-year deadline
  behavior, dynamic year labeling
- `duplicateProtection.test.ts` — Plaid idempotency on `transaction_id`, exact
  (non-fuzzy) CSV hashing, force-import lineage
- `sharedMirrors.test.ts` — mirror drift guard for `taxConstants.ts` and `taxMap.ts`

### Why the tax constants are mirrored, and how drift is caught

Firebase Functions deploy from `functions/` with their own `tsconfig` and
`node_modules`; a `../frontend/src/...` import does not resolve at build time and
would not be bundled. Publishing a shared npm package would mean a versioned
release on every IRS figure change. So `taxConstants.ts` is duplicated, and the
duplication is made safe by making it *checkable*: the two copies must be
byte-for-byte identical, and `sharedMirrors.test.ts` asserts exactly that as
part of the normal `npm test` run — not an optional script.

This was verified by mutating one copy alone (`single: 15750` → `15751` in the
backend file only) and confirming the suite fails. It does. The `taxMap.ts`
copies intentionally differ in comments and tooltip hints, so that guard
compares the routing data (category → group → schedule → bucket) instead.

The frontend has no test runner. Its tax tables are the byte-identical mirror
verified above, so the tested numbers are the ones it uses; its calculator also
now delegates the maths to the shared `computeFederalEstimate`.

---

## 8. Remaining recommendation

D1–D14 are fixed and tested, and every implemented rule is traceable to an
IRS or SSA source cited in `shared/taxConstants.ts`.

**This app produces an estimate, not a filing-ready tax liability.** Section 5
lists what it does not compute; those items are shown to the user in the app,
not just recorded here. Before filing, reconcile against the source documents
(1099s, W-2s, bank statements) and have a tax professional review the return.

Out of scope for this work and still open: the login restriction for
unverified clients remains blocked on AWS approving SES production access —
nothing in this branch changes that.
