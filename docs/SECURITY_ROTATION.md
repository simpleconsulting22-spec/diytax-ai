# Credential rotation checklist

**Status: IN PROGRESS — started 2026-08-02.**

| # | Credential | Status | Date | Verification |
|---|---|---|---|---|
| 1 | OpenAI | ✅ **Closed — nothing to revoke** | 2026-08-02 | See § 1 |
| 2 | Twilio | ✅ **Closed — account terminated** | 2026-08-02 | See § 3 |
| 3 | SendGrid | ⏳ Next | — | — |
| 4 | Anthropic | ⏳ Pending | — | — |
| 5 | Plaid | ⏳ Pending (last, highest risk) | — | — |

## Preflight audit — 2026-08-02

Read-only. `main` at `ed1f8bc`, identical to `origin/main`. Performed before any
provider action, and it corrected three assumptions this runbook was written on:

1. **`functions/.env` no longer holds any secret.** Six keys remain, all
   non-sensitive config: `PLAID_CLIENT_ID`, `PLAID_ENV`, `PLAID_WEBHOOK_URL`,
   `PLAID_REDIRECT_URI`, `APP_URL`, `AWS_SES_REGION`. `PLAID_ENV=production`.
2. **No `SENDGRID_API_KEY` secret exists in Secret Manager.** The destroy
   command in § 4 is a no-op; step 3 is a provider-side delete only.
3. **Zero plaintext credentials survive in Cloud Run.** All 40 deployed services
   were swept by variable name and `secretKeyRef` only — no value was read,
   printed, or logged.

Cloud Run references secrets through v1-API aliases (`secret-<uuid>`), resolved
via the `run.googleapis.com/secrets` template annotation. The aliases are not
Secret Manager resources; do not look them up directly.

| Credential | Source consumers | Cloud Run bindings | Secret Manager |
|---|---|---|---|
| `OPENAI_API_KEY` | 4 files, all warn-and-skip | **0** | does not exist |
| `TWILIO_*` | **0** | **0** | does not exist |
| `SENDGRID_API_KEY` | **0** | **0** | does not exist |
| `ANTHROPIC_API_KEY` | `parser/parseFinancialData.ts` | 1 → `parsefinancialdata` | v2 active |
| `PLAID_SECRET` | 13 files | 13, all `secretKeyRef` | v2 active |
| `AWS_SES_*` | `sendMfaCode`, `sendInvite` | 2 each | v2 / v4 active |

Version 1 of every secret is still `enabled`. Disable the superseded versions as
hygiene once rotation is finished.

**Note on the Anthropic/OpenAI split:** `ANTHROPIC_API_KEY` powers *financial
data parsing* only (`parseFinancialData.ts`, `claude-haiku-4-5-20251001` with a
`claude-sonnet-4-6` path). AI *categorization* is still OpenAI-shaped and inert.
These are different features; do not conflate them.

---

**Original status when written: ACTION REQUIRED — credentials are exposed and are still live.**

`functions/.env` was tracked in Git and its contents were committed. It has now
been untracked (`git rm --cached functions/.env`) and added to `.gitignore`, and
the local file is preserved and unchanged.

> ## Untracking the file does not make the credentials safe
>
> Every value ever committed remains readable in the Git history of this
> repository and of **every clone, fork, branch, and backup** that was ever
> made from it. `git rm --cached`, deleting the file, and even rewriting
> history do **not** invalidate a credential. Only rotating it at the provider
> does.
>
> Treat every credential listed below as compromised, even though the
> repository is private. Private repositories get cloned to laptops, shared
> with contractors, backed up, and occasionally made public by accident.

History rewriting is **not** part of this checklist. It breaks every existing
clone and branch, and it is the lower-value half of the job. Rotate first; plan
history cleanup afterwards as a separate, coordinated task.

---

## Exposed credentials

Present in committed history (`git log -- functions/.env`):

| Variable | Type | Rotate? |
|---|---|---|
| `OPENAI_API_KEY` | Secret key | **Revoke only — nothing consumes it** |
| `PLAID_SECRET` | Secret | **Yes — second** |
| `PLAID_CLIENT_ID` | Identifier | Rotates with the Plaid secret |
| `TWILIO_AUTH_TOKEN` | Secret | **Yes — third** |
| `TWILIO_ACCOUNT_SID` | Identifier | No — not secret, cannot be rotated |
| `TWILIO_VERIFY_SERVICE_SID` | Identifier | No — not secret |
| `SENDGRID_API_KEY` | Secret key | **Yes — delete it** |

Present in the current working file but **not** yet committed:

| Variable | Type | Rotate? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret key | **Yes — see note below** |

`ANTHROPIC_API_KEY` never reached Git, but it *is* deployed as a plain
environment variable on Cloud Run, where anyone with project read access can
read it via `gcloud run services describe`. The same is true of every other
value in `functions/.env`. That is a smaller blast radius than Git history but
it is not nothing.

Non-secret values needing no action: `PLAID_ENV`, `APP_URL`,
`PLAID_WEBHOOK_URL`, `PLAID_REDIRECT_URI`, `SENDGRID_FROM_EMAIL`,
`AWS_SES_REGION`.

`frontend/.env` is also tracked, but its `VITE_FIREBASE_*` values are public by
design — they ship inside the client JavaScript bundle and are meant to be
visible. Firebase security rules, not secrecy, protect that surface. No action
needed.

---

## The seven-step pattern

Every rotation below follows the same shape. Never revoke before the new
credential is deployed and verified — that is what makes it zero-downtime.

1. **Create** a new credential at the provider (do not touch the old one yet).
2. **Store** it in Secret Manager — `firebase functions:secrets:set NAME`
   (the prompt does not echo; paste and press Enter).
3. **Bind** it to only the consuming functions — already done in code via
   `secrets: [...]`; nothing further to do.
4. **Deploy** only those functions (exact targets per credential below).
5. **Verify** the affected feature works end to end.
6. **Revoke** the old credential at the provider.
7. **Confirm** the old credential is rejected (expect HTTP 401/equivalent).

> ### Order matters: never deploy between removal and binding
>
> `ANTHROPIC_API_KEY` and `PLAID_SECRET` are now declared as per-function
> secrets. They must be deleted from your local `functions/.env`,
> because leaving them re-injects the plaintext into the Cloud Run environment
> on the next deploy, where `gcloud run services describe` can read it —
> defeating the migration.
>
> **But remove them only after the replacements are created and stored in
> Secret Manager.** A deploy that happens after the plaintext is gone but
> before the secret is bound leaves those functions with no credential at all,
> and they will fail at runtime. The safe order is:
>
> 1. Create the replacement credential at the provider.
> 2. `firebase functions:secrets:set NAME` — store it.
> 3. *Then* delete the plaintext line from `functions/.env`.
> 4. Deploy the affected functions (they now read the bound secret).
> 5. Verify the feature works.
> 6. Revoke the old credential at the provider.
> 7. Final deploy + audit confirming no plaintext env var remains.
>
> Leave `PLAID_CLIENT_ID`, `PLAID_ENV`, `PLAID_WEBHOOK_URL`,
> `PLAID_REDIRECT_URI`, `APP_URL`, and `AWS_SES_REGION` in place. They are
> non-sensitive configuration.

## Rotation order

Do these in order. After each one, update configuration, redeploy, and verify
before starting the next — so that if something breaks you know which change
caused it.

### 1. OpenAI — revoke only, do not replace

A real OpenAI key (`sk-` prefix, 164 chars) was committed and sits in git
history. It was removed from `functions/.env` at some point after 2026-04-08,
which is why AI categorization has been silently inactive since — the code logs
`"OPENAI_API_KEY not set, skipping AI categorization"` and falls back to rules.

**There is nothing to rotate to.** No function declares `OPENAI_API_KEY` as a
secret any more, so a replacement key would not be consumed. Just kill the old
one.

- [x] <https://platform.openai.com/api-keys> → no keys exist
- [x] Already gone — lost with the earlier trial. **No action was required.**
- [ ] Optionally remove the four `process.env.OPENAI_API_KEY` reads once
      categorization moves to Claude

#### ✅ Closed 2026-08-02 — no revocation was possible or necessary

**Verification performed** (console evidence + repository timeline):

- API keys page shows **0 results** under the only project, `Default project`
  (`proj_lQuXXXY34CXu0KGDrvdi4RVh`), with 0 members and **$0 monthly spend**.
- **Admin keys: 0 results with `?status=all`** — no status filter applied, so
  nothing is hidden. Admin keys (`sk-admin-` prefix) are an org-scoped credential
  type that does not appear in the project key list, hence checked separately.
- **Exactly one organization** (`Personal`), confirmed via the org switcher, so
  no keys exist under a second org.
- The account has exactly **one project**, created **Apr 25 2026**. The exposed
  key was already committed in `functions/.env` as of the **Apr 8 2026** commit —
  it therefore belonged to an earlier trial org/project that no longer exists.
  A key whose issuing project is deleted is permanently rejected.
- No Cloud Run service binds `OPENAI_API_KEY`; no Secret Manager entry exists.

**Affected functions: none.** No deploy was performed and none was required —
runtime behavior is unchanged, because AI categorization was already inert.

**Deliberately not done:** the old key was *not* extracted from git history to
test against `api.openai.com`. Doing so would mean handling the credential
value. Absence from the account is sufficient proof of revocation.

**Residual risk: none.** AI categorization remains inert until the Haiku port.

Do **not** create an OpenAI account or project to do this. If you never had one,
there is no key to revoke and this step is already complete.

Still-present consumers (they read the variable and skip when it is unset):
`categorization/categorizeTransaction.ts`, `categorization/suggestCategory.ts`,
`receipts/extractReceiptData.ts`, `services/categorizationService.ts`

> **Restoring AI categorization:** the plan is to point these four call sites at
> **Claude Haiku 4.5** using the existing `ANTHROPIC_API_KEY` — no new account,
> `@anthropic-ai/sdk` already installed, roughly $0.30–$3/month at this volume.
> Tracked separately from the security work.

### 2. Plaid

- [ ] <https://dashboard.plaid.com> → Team Settings → Keys
- [ ] Rotate the **production** secret. Plaid supports a grace period during
      which both old and new secrets work — use it rather than rotating blind
- [ ] Update `PLAID_SECRET` (and `PLAID_CLIENT_ID` if it changes) locally
- [ ] Redeploy
- [ ] Verify: open Bank Accounts, confirm balances load and a sync succeeds
- [ ] End the grace period / revoke the old secret in the Plaid dashboard
- [ ] Confirm the old secret is rejected by calling any Plaid endpoint with it
      → expect `INVALID_API_KEYS`

Consumers: all of `functions/src/plaid/*`, plus `admin/wipeBankData.ts`

> Plaid rotation is the riskiest step: a bad secret breaks bank syncing for all
> users. Do it when you can watch it, not at the end of a session.

### 3. Twilio — revoke only, nothing to update

No source file reads the Twilio variables and the `twilio` package is never
imported — the SMS path was never built. The three `TWILIO_*` lines have been
removed from `functions/.env`, so after that deploy the auth token is no longer
present in any function's Cloud Run environment.

**There is nothing to update or redeploy.**

- [x] <https://console.twilio.com> → Admin → Account settings
- [x] **Account closed outright** rather than rotated.

#### ✅ Closed 2026-08-02 — Twilio account terminated

**Two corrections to what this section originally said:**

1. **"Delete the exposed auth token" was not possible.** A Twilio *primary* Auth
   Token cannot be deleted — every account always has one. It can only be
   invalidated by rotation (create secondary → promote to primary), or by
   terminating the account. Closing the account was chosen, since the user
   confirmed no intent to use Twilio; it removes the credential *and* the
   billing surface instead of superseding one live token with another.
2. **The stated risk was overstated.** This section claimed the token granted
   "full account access, including sending SMS at your expense." The console
   showed an **unupgraded trial account** (`Trial: $5.1256`, "Upgraded Twilio
   account" unchecked, no phone number provisioned). With no payment method on
   file and trial sending restricted to verified caller IDs, maximum loss was
   the ~$5.12 of trial credit — not open-ended billing.

**Verification performed:** account closed via the Twilio console; closure
confirmed by the user. Closure terminates the credential, so no live-token test
was run — and could not be, since the token value is deliberately never handled.

**Affected functions: none.** No code change, no deploy, no redeploy. The
`TWILIO_*` variables were already absent from every Cloud Run service before
this step began (see the preflight audit).

**Residual risk: none.** The Account SID remains in git history; it is an
identifier, not a credential, and its account no longer exists.

**Follow-up, not blocking:** `twilio@^5.13.1` is still listed in
`functions/package.json` but is never imported. Dead dependency — remove it
alongside the other unused packages (`nodemailer@^8.0.4`) in a separate cleanup.

### 4. Remaining credentials

**Anthropic** (`parser/parseFinancialData.ts`)
- [ ] <https://console.anthropic.com/settings/keys> → create a new key
- [ ] Update `ANTHROPIC_API_KEY` locally, redeploy, verify financial-data parsing
- [ ] Revoke the old key
- [ ] Confirm dead: a request with the old key returns **401**

**SendGrid** — the account has zero credits and the integration is removed, so
there is nothing to migrate. Just delete the key.
- [ ] <https://app.sendgrid.com/settings/api_keys> → delete the `diytax-ai-prod` key
- [ ] Delete the stale Firebase secret:
      `firebase functions:secrets:destroy SENDGRID_API_KEY --project diytax-ai`
- [ ] Optionally remove the unused `SENDGRID_FROM_EMAIL` line from `functions/.env`

---

## Exact deploy targets

Each secret is bound only to the functions that consume it, so deploys are
narrow. Copy these verbatim.

**`ANTHROPIC_API_KEY`** — 1 function

```bash
firebase deploy --project diytax-ai --only functions:parseFinancialData
```

**`PLAID_SECRET`** — 13 functions

```bash
firebase deploy --project diytax-ai --only \
functions:createPlaidLinkToken,functions:exchangePublicToken,functions:fetchTransactions,functions:backfillTransactionTypes,functions:repairPlaidData,functions:setAccountSignConvention,functions:deletePlaidAccount,functions:diagnoseSignDistribution,functions:verifyAndFixPlaidData,functions:adminWipeBankData,functions:plaidWebhook,functions:scheduledPlaidSync,functions:syncAllPlaidAccounts
```

**`AWS_SES_ACCESS_KEY_ID` / `AWS_SES_SECRET_ACCESS_KEY`** — 2 functions

```bash
firebase deploy --project diytax-ai --only functions:sendMfaCode,functions:sendInvite
```

### Final audit deploy — last, not first

`.env` applies to every function, so once all three plaintext lines are gone and
every replacement secret is bound and verified, run one full deploy so no
function is left holding a stale plaintext value:

```bash
firebase deploy --project diytax-ai --only functions
```

**Run this at the end, after steps 1–6 for every credential — never before.**
Deploying while a plaintext value has been removed but its replacement secret is
not yet bound leaves the affected functions with no credential and they will
fail at runtime.

Then audit that no plaintext credential survives in the runtime environment
(this prints variable names only, never values):

```bash
for f in categorizeTransaction parseFinancialData fetchTransactions sendMfaCode; do
  echo "--- $f"
  gcloud run services describe "$(echo $f | tr 'A-Z' 'a-z')" \
    --project diytax-ai --region us-central1 \
    --format="value(spec.template.spec.containers[0].env)" \
    | tr ';' '\n' | grep -oE "'name': '[A-Z_]+'"
done
```

Either of `ANTHROPIC_API_KEY` or `PLAID_SECRET` appearing with a
literal `'value'` rather than a `valueFrom.secretKeyRef` means the migration did
not take for that function.

---

## Recommended follow-up: move secrets out of `.env`

`functions/.env` values are deployed as plain Cloud Run environment variables,
readable by anyone with project read access. The SES credentials added in this
migration deliberately use Firebase Secret Manager instead:

```bash
firebase functions:secrets:set AWS_SES_ACCESS_KEY_ID
firebase functions:secrets:set AWS_SES_SECRET_ACCESS_KEY
```

Migrating `PLAID_SECRET`, `TWILIO_AUTH_TOKEN`, and `ANTHROPIC_API_KEY` to the
same mechanism is the durable fix. Each function
that reads one would declare it in its `secrets: [...]` array, exactly as
`sendMfaCode` and `sendInvite` now do. This is a follow-up task, not a
prerequisite for rotation.

---

## Planning Git history cleanup (later)

Once every credential above is rotated, the values in history are worthless and
cleanup becomes optional hygiene rather than an emergency.

When you do it, expect it to be disruptive: `git filter-repo` (or BFG) rewrites
every commit hash, which invalidates every existing clone, branch, and open PR.
Everyone with a copy must re-clone. Coordinate it, do it when the repository is
quiet, and take a backup first.

**Do not attempt history rewriting as a substitute for rotation.** Copies you
do not control — old clones, CI caches, backups — keep the original values
regardless of what you do to this repository.
