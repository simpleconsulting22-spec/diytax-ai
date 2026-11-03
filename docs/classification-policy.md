# Transaction classification policy

How DIYTax AI decides what happens to a transaction automatically. Code:
`functions/src/categorization/decisionPolicy.ts`.

## Three separate questions

| Question | Who answers it | Where it lives |
|---|---|---|
| **Categorization:** what kind of transaction is it? | Your rules, built-in keywords, AI (a suggestion) | `category`, `taxSchedule` |
| **Confirmation:** has a person confirmed it? | You, or a rule you approved | `status`, `zachTier`, `isUserModified` |
| **Deductibility and substantiation:** is it deductible, and are the records adequate? | Tax law applied to your facts and records | Not decided by the app |

Automatic categorization never establishes that an expense is deductible.

## Tiers

| Tier | When | Status | In tax totals |
|---|---|---|---|
| **Sure** | You set it, or a rule you approved matched | `categorized` | Yes |
| **Likely** | A confident automatic guess that is **not** a deductible expense (personal spending, income) | `categorized` | Yes |
| **Ask** | Everything else, including any automatic guess that would put an expense on Schedule C, E or A, and anything that hits a review trigger | `needs_review` | No, until confirmed |

AI confidence must be at least 0.85 for Likely.

## Review triggers (internal, not tax rules)

These only decide when the app asks you to look. They do not decide deductibility.

| Trigger | Fires when | Why ask |
|---|---|---|
| `needs_purpose_confirmation` | An automatic guess puts an expense on Schedule C, E or A | A business, rental or itemized purpose has to come from you |
| `lodging` | A hotel or short-term rental on a deductible schedule | Mixed personal and business use is common |
| `meals_travel_75` | Business meals, travel or entertainment of $75 or more | IRS recordkeeping rules commonly call for receipts at this level (Treas. Reg. § 1.274-5(c)(2)(iii)) |
| `charity_250` | A charitable contribution of $250 or more | A written acknowledgment is required at this level (IRC § 170(f)(8)) |
| `mixed_use_merchant` | Amazon, Costco, Target and similar on a deductible schedule | These stores sell both business and personal goods |

## Defaults

- Streaming services (Netflix, Spotify and others) default to **Personal Subscriptions**. If one is used for business, change it and note the business purpose. A rule you approve then makes it Sure.
- Built-in keywords that suggest a business category, such as software, fuel or rideshare, fill in the suggestion but wait in Needs review.

## Rules and history

- **Rules are opt-in.** Editing one transaction changes only that transaction. A vendor rule is saved only when you choose "Always do this" or "Apply to all + remember".
- **History and Undo.** Every automatic or manual change records its previous values (the last 20), and `undoCategoryChange` restores them.
- **Past transactions are never re-categorized automatically.** Changing transactions already in the books requires a reviewed dry run first.
