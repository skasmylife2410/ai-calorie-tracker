# SnapCal security — ISO/IEC 27001:2022 control map

ISO 27001 certifies an organisation's way of managing security, not an app, so SnapCal can't be
"ISO certified" by itself. This file maps the Annex A controls that apply to a small health-data
app to what the code does, and lists what only the owner can do outside the code.

Status: **in place** (in the code today) · **owner** (a setting or habit, not code).

## Access control and authentication (A.5.15–5.18, A.8.2, A.8.5)

| Control | How | Status |
|---|---|---|
| Unique accounts, no shared logins | One account per person; the old shared passcodes are off unless `ALLOW_LEGACY_PASSCODES=1` | in place |
| Password storage | PBKDF2-SHA256, 210k iterations, per-user salt (`api/_accounts.js`) | in place |
| Password quality | 8+ characters; refuses common passwords, one repeated character, and passwords containing the username (NIST 800-63B) | in place |
| Brute force | 10 wrong guesses per account and per address in 15 min, then a lock (`api/_limits.js`) | in place |
| Username enumeration | Same message for "no such user" and "wrong password", and the same response time (a decoy hash runs for unknown names) | in place |
| Sessions | Signed (HMAC), 180 days, tied to the current password: a change or reset signs out every other phone | in place |
| Old unstamped sessions | Refused from 2026-11-15 (`LEGACY_SESSIONS_UNTIL`) | in place |
| Sensitive actions re-ask the password | Change password, set recovery email, delete account | in place |
| Privileged access | One admin (`ADMIN` in `api/_members.js`), fixed in code so an env var can't hand it over | in place |
| Sign-up | Single-use invite links only; an account cap (`MAX_USERS`, default 25) | in place |
| Password recovery | Single-use reset links that expire in 30 min; only the SHA-256 is stored | in place |
| Manual resets by the owner | Confirm it's really the person (in person or by phone) before making a link, send it privately, and note it here | owner |
| MFA on the admin's infrastructure | Turn on two-factor for GitHub, Vercel, Supabase and Google AI Studio | owner |

## Data protection (A.5.33, A.5.34, A.8.10–8.12, A.8.24)

| Control | How | Status |
|---|---|---|
| Encryption in transit | HTTPS only, HSTS for 2 years | in place |
| Database access | Every table has row level security on with no policies, so the public anon key reads nothing; only the server (service-role key) can reach the data (migration 0015) | in place |
| Consent for health data | Required at sign-up, versioned (`api/_policy.js`) | in place |
| Export and erasure | Profile → Account: download everything, delete the account | in place |
| Retention | Feed posts 7 days; failed sign-in records and expired reset links 1 day; crash reports 90 days, all purged by the daily cron | in place |
| Secrets | Only in Vercel environment variables, never in the repo or the browser. If one is ever pasted somewhere, rotate it | owner |

## Logging and monitoring (A.8.15, A.8.16)

| Control | How | Status |
|---|---|---|
| Security audit trail | One JSON line per event (`api/_audit.js`): sign-in, failed sign-in, lockout, password change/reset, email change, sign-up, account deletion, invite, admin removals. Passwords, tokens and links are never logged | in place |
| Keeping the trail | Vercel keeps function logs only briefly. For a lasting record add a Log Drain (Vercel → Settings → Drains) filtered on `{"audit":` | owner |
| Database advisories | Check Supabase → Advisors (security) after any schema change | owner |

## Secure development and configuration (A.8.9, A.8.25–8.28)

| Control | How | Status |
|---|---|---|
| Browser hardening | CSP with no inline scripts, `frame-ancestors 'none'`, `nosniff`, COOP `same-origin`, strict referrer, a Permissions-Policy | in place |
| Cron endpoint | Needs `CRON_SECRET`, compared in constant time | in place |
| Cost abuse | Per-person hourly allowances on AI calls and error reports | in place |
| Tests | `npm test` covers sign-in abuse, sessions, invites, privacy and retention | in place |
| Review before deploy | Changes go through a branch and pull request, not straight to `main` | owner |
| Dependencies | No runtime npm dependencies; vendored files are pinned in `vendor/` | in place |

## Continuity (A.5.29, A.5.30, A.8.13)

| Control | How | Status |
|---|---|---|
| Backups | The Supabase free plan has no downloadable backups. Upgrade for daily backups, or export the `snapcal_*` tables now and then | owner |
| Log out everyone | Rotate `APP_SECRET` in Vercel, then redeploy | owner |

## Environment checklist (Vercel → Settings → Environment Variables)

- `APP_SECRET` long and random · `CRON_SECRET` set · `SUPABASE_SERVICE_ROLE_KEY` set
- `ALLOW_ANONYMOUS` and `ALLOW_LEGACY_PASSCODES` **absent** in production
- `APP_USERS` and `INVITE_CODE` can be deleted: nothing uses them any more. `APP_TOKEN` too, once `APP_SECRET` is set (sessions fall back to it otherwise)

## Manual access log

| Date | What | Who for | By |
|---|---|---|---|
| 2026-10-31 | Reset link created directly in the database (24 h, single use) | jacquelin | owner, via Claude |
