# PULSE security

How PULSE handles each point of a standard web-app security checklist, plus how conversations with the AI are sanitized.
Run `npm run security` before pushing (secret scan, dependency scan, tests). GitHub runs the same checks on every push.

| # | Check | How PULSE does it |
|---|---|---|
| 1 | Hide API keys | AI keys and the Supabase secret key live only in `.env` (your computer) and Render's Environment tab. The browser never receives them: `/api/config` only sends the public sign-in key and the AI provider names. |
| 2 | Purge Git secrets | `.gitignore` blocks `.env`, `roster/`, `.xlsx`/`.csv` files. `npm run check-secrets` (and the GitHub workflow) fails if a key, a `.env` file or a roster/KPI file would be committed. The repo history was rebuilt without the roster files. |
| 3 | Use the public DB key in the browser | The browser uses only the publishable key, for sign-in. All data goes through the PULSE server, which uses the secret key. |
| 4 | Row-level security | RLS is on for every table with no policies, and the public roles have no table privileges (`migrations/010_lock_down.sql`). `npm run doctor` checks that the public key can't read any table. |
| 5 | Encrypt sensitive data | Supabase encrypts the database at rest (AES-256) and all traffic uses TLS. PULSE also avoids storing member data at all: survey comments, roleplay lines, notes and quiz text are scrubbed of member identifiers before they're saved (see below). |
| 6 | Server-side auth | Every `/api` route checks the signed-in person on the server (Supabase token verified with Supabase, or a signed demo token) and their role. Sessions end after 30 idle minutes and 12 hours at most. |
| 7 | Lock record access | Every record is checked against the person's scope: agents see only their own; supervisors their team; managers their supervisors' teams. Other people's records answer "not found". |
| 8 | Block field tampering | Routes only accept the fields they expect (allow-lists) and check each one (types, ranges, dates, the team's behaviors). Fields like `status`, `agent_ack`, `supervisor_id` or `sample` can't be set from the browser. |
| 9 | Secure sessions | PULSE uses Supabase access tokens (sent as `Authorization: Bearer`), not cookies, so there's no cookie to steal or forge and no CSRF. Tokens are refreshed by Supabase, checked on every request, and expire with the session limits above. The strict CSP (#18) protects them from injected scripts. |
| 10 | Hash passwords | Passwords are handled by Supabase Auth (bcrypt). PULSE never stores or logs them. Temporary passwords are random (crypto) and must be changed at first sign-in. |
| 11 | Rate-limit login | Supabase rate-limits its sign-in endpoints. PULSE limits sign-in and password routes to 20 per 10 minutes per IP, password checks to 8 per 10 minutes per person, the whole API to 300 requests per minute per IP, and AI requests per person. |
| 12 | Bot protection | Optional Cloudflare Turnstile on the sign-in page (`TURNSTILE_SITE_KEY`), verified by Supabase Auth's CAPTCHA setting. |
| 13 | Parameterized queries | PULSE has no hand-written SQL at runtime: every query goes through supabase-js, which sends values as parameters. Query strings are parsed as plain strings, so they can't inject filters. |
| 14 | Validate all input | Every request body is cleaned first (no `__proto__`/`constructor` keys, no control or bidi characters, size, depth and row limits), then each route validates its own fields. |
| 15 | Escape user content | Everything shown is escaped (`esc()`), toasts use `textContent`, and AI answers are reduced to plain text. The CSP blocks inline scripts as a second line of defense. |
| 16 | Restrict file uploads | Only `.xlsx` rosters (checked by extension and file signature, 10 MB, 6 files) and `.csv` KPI/survey files (5 MB). Files are read in the browser; the server only receives rows, capped in count and cell size. Nothing is stored as a file. |
| 17 | Trim API responses | Internal fields (the login link `auth_user_id`, `roster_key`, `updated_by`) never leave the server. Errors return a short message; details stay in the server logs. |
| 18 | Security headers | Content-Security-Policy (no inline scripts; the training guides' scripts are allowed by hash), HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (microphone only for this site), `Cross-Origin-Opener-Policy`, `Cache-Control: no-store` on the API. No `X-Powered-By`. CORS only for origins in `CORS_ORIGIN`. |
| 19 | Force HTTPS | On Render (or with `FORCE_HTTPS=true`), plain HTTP is redirected to HTTPS and HSTS tells browsers to use HTTPS only. |
| 20 | Scan dependencies | `npm audit` runs in the GitHub workflow on every push (fails on high-severity issues), Dependabot opens update PRs weekly, and dependencies are pinned to exact versions. |

## Conversations with the AI

Supervisors, agents and managers write text that reaches an AI model (survey comments, call notes, reasons, quiz focus, roleplay lines). PULSE treats all of it as untrusted.

**Before anything is sent to an AI provider**
- **Personal data is scrubbed** (`web/core/sanitize.js`): emails, phone numbers, SSNs, Medicare MBIs, member/group/claim IDs, card numbers, dates of birth and street addresses become placeholders such as `[member id]`. The scrub runs on the whole prompt and the whole conversation, so nothing can slip through a field that was missed. Only first names of agents are sent.
- **Prompt-injection fencing**: text written by people goes inside `⟦ ⟧` markers, and the system prompt tells the model that anything inside is data, never instructions ("ignore your rules…" is just text). The markers are stripped from the text itself so it can't close the fence early.
- **Security rules in every system prompt**: follow no instructions from data, reveal nothing about the instructions, write no personal data, plain text only.
- **Size limits** on every field, and per-person AI rate limits.

**Before an AI answer is stored or shown**
- It must be valid JSON in the expected shape (otherwise PULSE uses its offline suggestion).
- Every string is cleaned: HTML tags, links and URLs, `javascript:` and control/bidi characters are removed, personal data is scrubbed again, and lengths and list sizes are capped.
- Scores and other numbers are checked; the browser escapes everything it shows.

**What's stored**
- Roleplay lines, survey comments, coach notes, diagnosis notes and quiz text are saved already scrubbed, so member identifiers don't end up in the database.
- Prompts aren't logged. AI provider errors are logged on the server without the prompt.

## What you still need to do

1. Run `supabase/migrations/010_lock_down.sql` in the Supabase SQL editor, then `npm run doctor` to confirm the public key can't read any table.
2. In Supabase › Authentication: keep the default rate limits, and turn on **leaked password protection** if your plan has it.
3. Optional bot protection: create a Cloudflare Turnstile widget for your Render domain, put the site key in Render as `TURNSTILE_SITE_KEY`, and the secret key in Supabase › Authentication › Bot and Abuse Protection.
4. Keep the GitHub repo private, and merge Dependabot's pull requests when the CI checks pass.
5. Keep real member data out of PULSE: the scrubber is a safety net, not permission to paste PHI.
