# Credential rotation checklist

**Status: ACTION REQUIRED — credentials are exposed and are still live.**

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

- [ ] <https://platform.openai.com/api-keys> → find the exposed key
- [ ] If it is already gone (deleted, or lost with an expired trial), you are
      done — no further action
- [ ] Otherwise **delete it**
- [ ] Confirm it is dead:
      `curl -s -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models -H "Authorization: Bearer OLD_KEY"`
      → expect **401**
- [ ] Optionally remove the four `process.env.OPENAI_API_KEY` reads once
      categorization moves to Claude

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

### 3. Twilio

- [ ] <https://console.twilio.com> → Account → API keys & tokens
- [ ] Create a **secondary** auth token, promote it to primary, then delete the
      old one — Twilio's supported zero-downtime path
- [ ] Update `TWILIO_AUTH_TOKEN` locally
- [ ] Redeploy
- [ ] Confirm the old token is dead:
      `curl -s -o /dev/null -w "%{http_code}" https://api.twilio.com/2010-04-01/Accounts/ACCOUNT_SID.json -u ACCOUNT_SID:OLD_TOKEN`
      → expect **401**

No source file currently reads the Twilio variables — the SMS path was never
built. Rotate anyway: the token is live and grants full account access,
including sending SMS at your expense.

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
