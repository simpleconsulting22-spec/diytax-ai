# Email delivery setup (Resend)

Outbound transactional email for DIYTax AI — MFA verification codes and team
invitations — is delivered by **Resend**. The sending address is
`noreply@diytaxai.com`, shown to recipients as `DIYTax AI <noreply@diytaxai.com>`.

**Email will not work until every step below is complete.** Specifically:
domain verification in Resend, DNS records published at Namecheap, the API key
stored in Firebase Secret Manager, and the two functions redeployed. Until all
four are done, sign-in via MFA remains unavailable.

**Inbound mail is not affected.** `diytaxai.com` continues to receive mail
through Namecheap email forwarding. Nothing in this procedure changes the
**root-domain** MX records, and Namecheap **Mail Settings must stay on
"Email Forwarding"** throughout. Resend does ask for an MX record, but it goes
on a **subdomain** — see §3, which is the one step in this document where a
mistake can break your inbound mail.

---

## Why Resend and not SES

AWS denied production access for this account, which leaves SES permanently in
the sandbox: it will only deliver to individually verified recipient addresses,
so real users can never receive an MFA code. Rather than appeal, the provider
was swapped. Only `src/services/emailService.ts` changed — the two call sites,
the MFA throttle, the log-safety rules, and the failure categories are the same
as before, which is what that module's provider-independent shape was for.

The previous SES procedure is preserved in git history if it is ever needed.

---

## 1. Create the Resend account

1. Sign up at <https://resend.com>. A personal account is fine; use an address
   you will keep long-term and enable two-factor authentication on it.
2. There is no approval queue and no sandbox application. New accounts can send
   immediately, with one restriction: **until a domain is verified you may only
   send to your own account email address.** The application classifies that
   rejection as `sandbox_restriction`, the same category the SES sandbox
   produced, so the logs and troubleshooting table below are unchanged.
3. Pricing: the free tier covers roughly 3,000 messages per month with a daily
   cap, which is far above MFA-and-invitation volume. Check the current figures
   on their pricing page rather than trusting this line. Do not subscribe to a
   paid plan yet — there is nothing to gain at this volume.

---

## 2. Add and verify `diytaxai.com`

1. Resend → **Domains** → **Add Domain**.
2. Enter `diytaxai.com`. Choose a sending region when prompted; any US region is
   fine, and unlike SES the choice does not have to match anything else in this
   stack. It is not referenced anywhere in the code.
3. Resend displays a set of DNS records — typically a **DKIM `TXT`** record, an
   **SPF `TXT`** record, and an **`MX`** record, the last two on a `send`
   subdomain. Their values are generated for your account at this moment and
   cannot be looked up, guessed, or copied from documentation, including this
   one. Leave the page open.

**These are not the SES records.** If you already added the three SES DKIM
CNAMEs, leave them where they are for now — they are inert once SES stops being
called, and removing them mid-migration only adds a way to break things. Clean
them up after §7 succeeds.

---

## 3. Add the DNS records in Namecheap

1. Namecheap → **Domain List** → **Manage** next to `diytaxai.com` →
   **Advanced DNS**.
2. Add each record Resend displayed, matching its type exactly.

### The Namecheap host-field gotcha

Namecheap appends the domain automatically. Enter only the part **before**
`.diytaxai.com`:

| Resend shows | Enter in Namecheap's Host field |
|---|---|
| `resend._domainkey.diytaxai.com` | `resend._domainkey` |
| `send.diytaxai.com` | `send` |

Entering the full hostname produces `…diytaxai.com.diytaxai.com` and
verification will never pass. This is the single most common failure here.

### The MX record — read this before adding it

Resend's `MX` record goes on the **`send` subdomain**, Host field `send`. It
handles bounce and complaint returns for mail you send.

- Host field must be `send`. **Never `@`.**
- An MX record on `send` does not affect, override, or reorder the MX records on
  the root domain, so your Namecheap inbound forwarding is untouched.
- If any instruction — from Resend, from a support article, or from this
  document as you read it — appears to require an MX record on `@`, or changing
  **Mail Settings** away from **Email Forwarding**, stop. That is the wrong
  step, and it is the one that takes down inbound mail to `@diytaxai.com`.

### The SPF record on `send`

The SPF `TXT` record also goes on the `send` subdomain. Do **not** add it to the
root. The root currently publishes
`v=spf1 include:spf.efwd.registrar-servers.com ~all`, and two SPF records on one
host is a permanent error that breaks authentication for **all** mail, including
your inbound forwarding.

### Do not touch these existing records

Leave the root `MX` records pointing at `eforward1–5.registrar-servers.com`
exactly as they are, and leave **Mail Settings** on **Email Forwarding**.

---

## 4. Wait for verification

1. Back in Resend → **Domains** → `diytaxai.com`.
2. Wait until the status shows **Verified**. Resend re-checks automatically and
   you can trigger a re-check from the page.
3. Namecheap usually propagates within minutes; allow up to a few hours.

Until this shows Verified, sends to anything other than your own account address
fail as `sandbox_restriction`.

---

## 5. Create a restricted API key

1. Resend → **API Keys** → **Create API Key**.
2. Name it `diytax-ai-functions`.
3. Permission: **Sending access** — not Full access. The application only ever
   posts to the send endpoint; it never needs to read logs, manage domains, or
   create further keys.
4. Restrict it to the `diytaxai.com` domain if the option is offered.
5. Copy the key. Resend shows it **once**. It begins `re_`.

Never paste the key into a source file, a commit, a screenshot, or a chat
message. The application redacts strings matching the `re_` key pattern from its
logs, but that is a backstop, not a substitute.

---

## 6. Store the key and deploy

The key is a secret and belongs in Firebase Secret Manager, never in
`functions/.env` — values in that file are deployed as plain Cloud Run
environment variables, readable by anyone with project read access.

```bash
firebase functions:secrets:set RESEND_API_KEY
```

The prompt does not echo what you paste. Both `sendMfaCode` and `sendInvite`
declare `secrets: ["RESEND_API_KEY"]`, so Firebase binds it at deploy time.

There is no non-secret email configuration. The sending identity is a constant
in `functions/src/services/emailService.ts`.

Deploy only the two affected functions:

```bash
firebase deploy --only functions:sendMfaCode,functions:sendInvite
```

---

## 7. Smoke tests

1. **MFA:** sign in to the app and request a verification code. It should
   arrive, and the code should complete sign-in.
2. **Invitation:** from **Manage Access**, invite an address you control. It
   should arrive with a working accept link.
3. If an invitation is created but the email fails, the UI says so explicitly
   and shows the accept link for manual sharing — the invite is not lost.

### Check authentication in Gmail

Open the received message in Gmail → three-dot menu → **Show original**. You
want:

```
SPF:   PASS
DKIM:  PASS
DMARC: PASS
```

If DKIM fails while the domain shows Verified, re-check the `resend._domainkey`
record for the host-field mistake in §3.

### Check delivery in Resend

Resend → **Emails** lists every send with its status, including bounces and
complaints. This replaces the SES account dashboard.

### Server-side diagnostics

```bash
firebase functions:log --only sendMfaCode -n 30
```

Failures log a safe category — one of `configuration_missing`,
`authentication_failed`, `sandbox_restriction`, `sender_not_verified`,
`recipient_rejected`, `throttled`, `quota_exceeded`, `provider_unavailable` —
plus the Resend error token and request id. Raw provider messages, recipient
addresses, message bodies, MFA codes, and credentials are never logged.

---

## 8. Clean up AWS

Once §7 passes, the SES credentials are unused and should stop existing.

1. Destroy the secrets so no deployed revision can bind them:

   ```bash
   firebase functions:secrets:destroy AWS_SES_ACCESS_KEY_ID
   firebase functions:secrets:destroy AWS_SES_SECRET_ACCESS_KEY
   ```

2. AWS → IAM → Users → `diytax-ai-ses` → **Security credentials** → deactivate,
   then delete the access key. Delete the user and the
   `diytax-ai-ses-send` policy.
3. Namecheap → remove the three SES DKIM CNAME records on `*._domainkey`.
   Leave the Resend records alone.
4. Leave the root MX records and Mail Settings exactly as they are.

Do this only after Resend is confirmed working, not before.

---

## 9. Cost controls

### MFA issuance limits (enforced server-side)

Unchanged by the provider swap. `sendMfaCode` enforces these per authenticated
uid, inside a Firestore transaction (`functions/src/auth/mfaThrottle.ts`):

| Limit | Value |
|---|---|
| Minimum gap between codes | 60 seconds |
| Maximum per rolling 15 minutes | 5 |
| Maximum per rolling 24 hours | 20 |

This caps a single account at **20 sends per day**. The ceiling is on the
server, so it holds regardless of what the client does — calling the callable
directly, bypassing the UI, or replaying a stolen session all hit the same
limit.

Operational implications worth knowing:

- **A throttled request never reaches Resend**, so it costs nothing and consumes
  no quota.
- **The attempt slot is reserved before the provider is contacted and is not
  released if delivery fails.** This is deliberate: releasing it would let a
  caller facing a persistent provider error retry without limit. The trade-off
  is that during a genuine outage a user burns attempts without receiving mail
  and must wait out the cooldown. Expect `resource-exhausted` errors to follow
  `provider_unavailable` ones in the logs — that is the throttle working, not a
  second fault.
- **The client is told only "too many requests, try again shortly."** Which
  limit tripped, the counters, and the timestamps stay server-side.
- Throttle events log as `[sendMfaCode] throttled` with `reason` set to
  `cooldown`, `window`, or `daily`. A spike in `daily` for one uid is worth
  investigating as credential stuffing.
- Attempt history is a bounded array of at most 20 timestamps on the existing
  `userSecurity/{uid}` document, pruned on every write.

Support note: a user legitimately locked out (for example, our mail was landing
in spam and they retried 20 times) can be released by clearing `mfaAttempts` on
their `userSecurity/{uid}` document.

### Provider-side limits

The free tier has a monthly and a daily cap. Exceeding the daily cap returns
`daily_quota_exceeded`, which the application classifies as `quota_exceeded` and
does not retry. At current volume this should never trigger; if it does, it
means either real growth or abuse, and both are worth looking at before simply
upgrading the plan.

---

## 10. Bounce and complaint handling

Resend maintains suppression automatically and surfaces bounces and complaints
in the **Emails** view. Sends to an address that previously hard-bounced are
rejected; the application classifies this as `recipient_rejected`.

If a legitimate user reports never receiving codes:

1. Resend → **Emails**, filter by their address.
2. If the message shows delivered, the problem is spam filtering on their side —
   check the SPF/DKIM/DMARC results in §7 first.
3. If it shows bounced, confirm the underlying problem is resolved (usually a
   typo'd or since-fixed mailbox) before retrying.

### Before scaling up

Wire Resend's bounce and complaint **webhooks** to a destination you monitor
rather than checking the dashboard by hand. This is not required for the current
milestone and is intentionally not built here, but it should be in place before
meaningful user growth — an unnoticed bounce-rate climb is what gets sending
accounts suspended, at any provider.

---

## 11. Rollback

**Rolling back the code does not restore working email.** The previous revision
called SES, which is sandbox-only for this account, and the revision before that
called SendGrid, whose account has zero credits. Both fail. There is no working
provider to roll back to, which is the reason for this migration.

If Resend misbehaves, the paths are:

1. **Fix forward.** Check the logged category against the troubleshooting table
   below; nearly every failure here is configuration, not code.
2. **Rotate the key** if you suspect exposure: create a new key in Resend, run
   `firebase functions:secrets:set RESEND_API_KEY` again, redeploy, then delete
   the old key in Resend.
3. **Share invite links manually.** `sendInvite` preserves the invite document
   even when delivery fails and returns `emailSent: false`, so the owner can
   still pass the accept link along. MFA has no such fallback.

There is deliberately **no dual-provider fallback**. Carrying two live providers
doubles the credential surface and the failure modes.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Log shows `configuration_missing` | `RESEND_API_KEY` was not set, or the functions were not redeployed after setting it |
| Log shows `authentication_failed` | Key wrong, deleted, or created with read-only rather than sending permission |
| Log shows `sandbox_restriction` | Domain not yet verified — Resend only allows sending to your own account address until it is |
| Log shows `sender_not_verified` | Domain verification lapsed, or a DNS record was removed |
| Log shows `recipient_rejected` | Address previously hard-bounced or filed a complaint (§10) |
| Log shows `throttled` / `quota_exceeded` | Provider rate or daily cap hit; the app does not retry these by design |
| Log shows `provider_unavailable` | Network failure, request timeout (10s), or a Resend 5xx |
| Domain stuck unverified | Host field likely contains the full domain instead of just the subdomain part (§3) |
| DKIM fails in Gmail but domain is Verified | The `resend._domainkey` record is missing or mistyped |
| Inbound mail to `@diytaxai.com` stopped | An MX record was added to `@` instead of `send`, or Mail Settings was changed — restore `eforward1–5.registrar-servers.com` and set Mail Settings back to Email Forwarding (§3) |
