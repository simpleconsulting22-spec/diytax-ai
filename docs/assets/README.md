# Documentation assets

Images referenced by the files in `docs/`. Keep filenames lowercase and
hyphenated — spaces have to be percent-escaped in Markdown links and are easy to
get wrong.

| File | What it is | Used by |
|---|---|---|
| `logo.png` | The DIYTax AI wordmark. | Not yet referenced. |
| `mfa-send-code.png` | The two-factor prompt offering to send a six-digit code, address masked. | `EMAIL_SETUP.md` §7 |
| `mfa-enter-code.png` | The code-entry step, empty field and resend link. | `EMAIL_SETUP.md` §7 |

Both MFA screenshots were captured against `diytax-ai.web.app` and show a masked
recipient address with an empty code field. **Screenshots of authenticated
screens must be checked before they are committed** — a live verification code,
an unmasked address, or a visible session token in a pushed image has to be
treated as disclosed, and rotating it after the fact does not undo the push.
