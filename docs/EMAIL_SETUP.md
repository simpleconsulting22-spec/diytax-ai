# Email delivery setup (Amazon SES)

Outbound transactional email for DIYTax AI — MFA verification codes and team
invitations — is delivered by **Amazon SES v2**. The sending address is
`noreply@diytaxai.com`.

**Email will not work until every step below is complete.** Specifically:
SES domain verification, DKIM verification, SES production access approval,
Firebase secret configuration, and function deployment. Until all five are
done, sign-in via MFA remains unavailable.

**Inbound mail is not affected.** `diytaxai.com` continues to receive mail
through Namecheap email forwarding. Nothing in this procedure changes the
root-domain MX records, and Namecheap **Mail Settings must stay on
"Email Forwarding"** throughout. If any step appears to require changing that
setting or the root MX records, stop — that is the wrong step.

---

## 1. AWS account and region

1. Create an AWS account at <https://aws.amazon.com>, or sign in to an existing
   one. Use an account you control long-term.
2. Choose **one** SES region and use it for everything that follows — identity
   verification, IAM, credentials, metrics, and the `AWS_SES_REGION` value.
   `us-east-1` (N. Virginia) is the default assumed by this repo's
   `functions/.env`. If you pick a different region, change that value to match.

   An identity verified in one region does **not** exist in another. A region
   mismatch between your verified domain and `AWS_SES_REGION` is the most common
   cause of `MessageRejected` after an otherwise correct setup.

3. Pricing: use SES **à-la-carte / on-demand** pricing, currently about
   **$0.10 per 1,000 outbound messages** plus data charges. Do **not** subscribe
   to any monthly SES plan. On-demand requires no opt-in — it is what you get by
   default when you simply use the API. If the console offers a paid monthly
   tier, decline it.

---

## 2. Verify `diytaxai.com` and enable Easy DKIM

1. In the AWS console, open **Amazon SES** and confirm the region selector shows
   the region you chose in §1.
2. Go to **Identities** → **Create identity**.
3. Select **Domain**, enter `diytaxai.com`.
4. Under **Advanced DKIM settings**, choose **Easy DKIM** with **RSA_2048_BIT**,
   and leave **DKIM signatures** enabled.
5. Click **Create identity**.

AWS now displays **three CNAME records**. Their hostnames and values are unique
to your account and are generated at this moment — they cannot be looked up,
guessed, or copied from documentation, including this one. Leave the page open
and copy them verbatim in the next step.

---

## 3. Add the DNS records in Namecheap

1. Namecheap → **Domain List** → **Manage** next to `diytaxai.com` →
   **Advanced DNS**.
2. For each of the three CNAME records AWS displayed, click **Add New Record**,
   choose **CNAME Record**, and paste the host and value.

### The Namecheap host-field gotcha

Namecheap appends the domain automatically. Enter only the part **before**
`.diytaxai.com`:

| AWS shows | Enter in Namecheap's Host field |
|---|---|
| `abc123._domainkey.diytaxai.com` | `abc123._domainkey` |

Entering the full hostname produces `…diytaxai.com.diytaxai.com` and
verification will never pass. This is the single most common failure here.

Namecheap sometimes appends a trailing dot to CNAME values. That is normal and
does not need removing.

### These DKIM records cannot affect inbound mail

DKIM records are `CNAME` entries on `*._domainkey` subdomains. Inbound mail
routing is determined solely by `MX` records on the root domain. Adding CNAMEs
on unrelated subdomains does not touch, override, or reorder those MX records,
so your Namecheap forwarding is unaffected.

### Do not touch these existing records

Leave the root `MX` records pointing at `eforward1–5.registrar-servers.com`
exactly as they are, and leave **Mail Settings** on **Email Forwarding**.

---

## 4. Custom MAIL FROM subdomain (optional — skip unless justified)

SES works fully without this. It only changes the envelope-sender domain used
for SPF alignment, which slightly improves deliverability reputation for
high-volume senders. At MFA-and-invitations volume the benefit is marginal and
the added DNS surface is a real risk, so **the recommendation is to skip it**.

If you later decide you need it, the only safe configuration is:

- Use a dedicated subdomain such as `mail.diytaxai.com`.
- Its `MX` and SPF `TXT` records go **on that subdomain only** — Host field
  `mail`, never `@`.
- Never add a second SPF record to the root. The root currently publishes
  `v=spf1 include:spf.efwd.registrar-servers.com ~all`; two SPF records on one
  host is a permanent error that breaks authentication for **all** mail,
  including your inbound forwarding.
- Never switch Mail Settings away from Email Forwarding to accommodate it.

---

## 5. Wait for verification

1. Back in SES → **Identities** → `diytaxai.com`.
2. Wait until **Identity status** shows `Verified` **and** **DKIM configuration**
   shows `Successful`. Both are required.
3. Namecheap usually propagates within minutes; AWS may take up to 72 hours.

---

## 6. Request SES production access

New SES accounts start in the **sandbox**, where you can send **only to
verified recipient addresses**. Your users' addresses are not verified, so in
sandbox mode real sign-ins will fail. The application classifies this failure as
`sandbox_restriction` in its logs.

1. SES → **Account dashboard** → **Request production access**.
2. Mail type: **Transactional**.
3. Website URL: `https://diytaxai.com`.
4. Use case description — this is truthful for this application; do not
   embellish it:

   > DIYTax AI is a personal tax-preparation web application. We send two types
   > of transactional email only: six-digit multi-factor authentication codes
   > requested by a user during sign-in, and team invitations explicitly
   > initiated by an account owner to a spouse or accountant. All recipients are
   > opt-in: they are either the account holder's own registered address or an
   > address the account owner entered directly. We do not send marketing email
   > and we do not use purchased, rented, or scraped lists. Initial volume is
   > low — under 100 messages per day. We monitor bounce and complaint rates
   > through the SES account dashboard and will act on the account-level
   > suppression list. Recipients who no longer wish to receive invitations are
   > removed at the account owner's request.

5. Submit. AWS typically responds within 24 hours.

---

## 7. Create a least-privilege IAM identity

Never use your AWS root account credentials, and never reuse a personal access
key. Create a dedicated identity that can do nothing except send through SES.

1. IAM → **Policies** → **Create policy** → **JSON** tab.
2. Paste the policy below, replacing `REGION` and `ACCOUNT_ID` with your values:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendFromDiytaxaiIdentityOnly",
      "Effect": "Allow",
      "Action": ["ses:SendEmail"],
      "Resource": "arn:aws:ses:REGION:ACCOUNT_ID:identity/diytaxai.com",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "noreply@diytaxai.com"
        }
      }
    }
  ]
}
```

   This is as narrow as SES permits: one action, scoped to the one verified
   identity, further constrained to the one From address. It grants no ability
   to read metrics, alter identities, manage the suppression list, or send from
   any other address. `ses:SendEmail` is the action used by both the SES v1
   `SendEmail` and the SES v2 `SendEmail` API that this application calls.

3. Name it `diytax-ai-ses-send` and create it.
4. IAM → **Users** → **Create user**, name `diytax-ai-ses`.
   Do **not** grant console access.
5. Attach the `diytax-ai-ses-send` policy directly to the user.
6. Open the user → **Security credentials** → **Create access key** → choose
   **Application running outside AWS**.
7. Copy the **Access key ID** and **Secret access key**. AWS shows the secret
   **once**.

Never paste either value into a source file, a commit, a screenshot, or a chat
message. The application redacts strings matching the AWS key-id pattern from
its logs, but that is a backstop, not a substitute.

---

## 8. Store credentials and region

The Firebase CLI is not currently installed in this environment. If
`firebase --version` fails, install it first:

```bash
npm install -g firebase-tools
firebase login
```

Store the two credentials in Secret Manager. Neither prompt echoes what you
paste:

```bash
firebase functions:secrets:set AWS_SES_ACCESS_KEY_ID
firebase functions:secrets:set AWS_SES_SECRET_ACCESS_KEY
```

The region is **not** a secret and follows this repo's existing `.env`
convention. It is already set in `functions/.env`:

```
AWS_SES_REGION=us-east-1
```

Change it if you chose a different region in §1. Both `sendMfaCode` and
`sendInvite` declare `secrets: ["AWS_SES_ACCESS_KEY_ID", "AWS_SES_SECRET_ACCESS_KEY"]`,
so Firebase binds them at deploy time.

---

## 9. Deploy

Deploy only the two affected functions:

```bash
firebase deploy --only functions:sendMfaCode,functions:sendInvite
```

---

## 10. Smoke tests

1. **MFA:** sign in to the app and request a verification code. It should
   arrive, and the code should complete sign-in.
2. **Invitation:** from **Manage Access**, invite an address you control. It
   should arrive with a working accept link.
3. If an invitation is created but the email fails, the UI now says so
   explicitly and shows the accept link for manual sharing — the invite is not
   lost.

### Check SES metrics

SES → **Account dashboard** shows sending volume, bounce rate, and complaint
rate. Keep bounces under 5% and complaints under 0.1%; AWS pauses accounts that
exceed these.

### Check authentication in Gmail

Open the received message in Gmail → three-dot menu → **Show original**. You
want:

```
SPF:   PASS
DKIM:  PASS
DMARC: PASS
```

`DKIM: PASS` confirms Easy DKIM is working. If DKIM fails, re-check the three
CNAME records for the host-field mistake in §3.

### Server-side diagnostics

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="sendmfacode"' \
  --project diytax-ai --limit 20 --freshness=1d \
  --format="value(timestamp,textPayload,jsonPayload.message)"
```

Failures log a safe category — one of `configuration_missing`,
`authentication_failed`, `sandbox_restriction`, `sender_not_verified`,
`recipient_rejected`, `throttled`, `quota_exceeded`, `provider_unavailable` —
plus the AWS exception name and request ID. Raw AWS messages, recipient
addresses, message bodies, MFA codes, and credentials are never logged.

---

## 11. Cost controls

SES bills **per recipient**, so every send costs money and repeated requests
cost repeatedly.

### MFA issuance limits (enforced server-side)

`sendMfaCode` enforces these per authenticated uid, inside a Firestore
transaction (`functions/src/auth/mfaThrottle.ts`):

| Limit | Value |
|---|---|
| Minimum gap between codes | 60 seconds |
| Maximum per rolling 15 minutes | 5 |
| Maximum per rolling 24 hours | 20 |

This caps a single account at **20 SES sends per day**, or about $0.002/day at
à-la-carte pricing. The ceiling is on the server, so it holds regardless of what
the client does — calling the callable directly, bypassing the UI, or replaying
a stolen session all hit the same limit.

Operational implications worth knowing:

- **A throttled request never reaches SES**, so it costs nothing.
- **The attempt slot is reserved before SES is contacted and is not released if
  delivery fails.** This is deliberate: releasing it would let a caller facing a
  persistent SES error retry without limit and hammer the provider. The
  trade-off is that during a genuine SES outage a user burns attempts without
  receiving mail, and must wait out the cooldown. If SES is down, expect
  `resource-exhausted` errors to follow the `provider_unavailable` ones in the
  logs — that is the throttle working, not a second fault.
- **The client is told only "too many requests, try again shortly."** Which
  limit tripped, the counters, and the timestamps stay server-side, so the
  limits cannot be mapped from outside.
- Throttle events log as `[sendMfaCode] throttled` with `reason` set to
  `cooldown`, `window`, or `daily`. A spike in `daily` for one uid is worth
  investigating as credential stuffing.
- Attempt history is stored as a bounded array of at most 20 timestamps on the
  existing `userSecurity/{uid}` document, pruned on every write. It cannot grow
  without limit.

Support note: a user legitimately locked out (for example, our mail was landing
in spam and they retried 20 times) can be released by clearing `mfaAttempts` on
their `userSecurity/{uid}` document.

### Set a budget alert

1. AWS **Billing and Cost Management** → **Budgets** → **Create budget**.
2. Choose **Cost budget**, set a monthly amount such as **$5**.
3. Add an alert at 80% of the budget, sent to an address you actually read.

This is a free AWS feature and does not subscribe you to any monthly plan.

---

## 12. Suppression list handling

SES maintains an **account-level suppression list**. Addresses that hard-bounce
or file a complaint are added automatically, and later sends to them are
rejected without leaving SES — you are not charged, but the user receives
nothing. The application classifies this as `recipient_rejected`.

If a legitimate user reports never receiving codes:

1. SES → **Suppression list** → search for their address.
2. If listed, confirm the underlying problem is resolved (usually a typo'd or
   since-fixed mailbox), then remove the entry.
3. Removing an address that genuinely bounces will re-add it and damage your
   bounce rate. Verify before removing.

Note that the least-privilege IAM policy in §7 deliberately does **not** grant
suppression-list access — perform this in the AWS console as an administrator.

### Before scaling up

Enable **bounce and complaint event publishing** (SES → **Configuration sets**)
so these events reach a destination you monitor rather than only the dashboard.
This is not required for the current milestone and is intentionally not wired up
here, but it should be in place before meaningful user growth — an unnoticed
bounce-rate climb is what gets SES accounts paused.

---

## 13. Rollback

Nothing is deployed yet, so rollback before first deploy is simply: do not
deploy.

**After deploying, if SES misbehaves:**

1. **Redeploy the previous revision.** This is the fastest route and restores
   the exact prior behavior:

   ```bash
   gcloud run services update-traffic sendmfacode --project diytax-ai \
     --region us-central1 --to-revisions PREVIOUS_REVISION=100
   gcloud run services update-traffic sendinvite --project diytax-ai \
     --region us-central1 --to-revisions PREVIOUS_REVISION=100
   ```

   List revisions with:

   ```bash
   gcloud run revisions list --service sendmfacode --project diytax-ai --region us-central1
   ```

   Note that the previous revision used SendGrid, whose account has zero
   credits — it will fail too. Rolling back restores prior *code*, not working
   email.

2. **Revert the code** with `git revert` on the migration commit, then rebuild
   and redeploy.

3. **Rotate credentials** if you suspect key exposure: create a new access key
   in IAM, run the two `firebase functions:secrets:set` commands again,
   redeploy, then deactivate and delete the old key in IAM.

There is deliberately **no dual-provider fallback**. Carrying two live providers
doubles the credential surface and the failure modes, and the rollback paths
above are sufficient.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Log shows `configuration_missing` | A secret was not set, or the function was not redeployed after setting it |
| Log shows `authentication_failed` | Access key wrong, deactivated, or the IAM policy does not permit `ses:SendEmail` |
| Log shows `sandbox_restriction` | Production access not yet granted — SES can only reach verified recipients |
| Log shows `sender_not_verified` | Domain not verified, or verified in a different region than `AWS_SES_REGION` |
| Log shows `recipient_rejected` | Address is on the account suppression list (§12) |
| Log shows `throttled` / `quota_exceeded` | Sending rate or daily quota exceeded; the app does not retry these by design |
| Domain stuck unverified | Host field likely contains the full domain instead of just the subdomain part (§3) |
| DKIM fails in Gmail but identity is Verified | One of the three CNAMEs is missing or mistyped |
| Inbound mail to `@diytaxai.com` stopped | Root MX records or Mail Settings were changed — restore `eforward1–5.registrar-servers.com` and set Mail Settings back to Email Forwarding |
