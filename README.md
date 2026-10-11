# PULSE

**Coaching intelligence for contact center supervisors.** PULSE helps a supervisor know **who** to coach, on **which of the 7 core behaviors**, **how** to coach it with DIRECT and the right coaching tool, and **whether it worked**. It then follows up every week until the SMART commitment sticks.

Built for a BPO supporting a US health insurance client (Medicare Supplement, BVA, IFM, NPG). Stack: Node.js/Express (Render), static web app (Vercel or served by the API), Supabase (PostgreSQL), Google Gemini (free tier).

---

## What it does

| View | What you can do |
|---|---|
| **Supervisor** | Dashboard of team KPIs vs. goal, agents ranked by gap, NPS performance groups (Top / On goal / Bottom / Outlier), alerts. **AI coaching prep** (identify the behavior, build the plan). **DIRECT session** form with AI talk track, live SMART checker, root cause. **Weekly plan** (Setting Goals + Skill Transfer Mon–Tue, Monitor Wed–Thu, Kudos/Accountability Fri) with a coaching tool and status for each. **Commitments** with the Friday review assistant. AI **roleplays** and **quizzes**. Training library and CSV upload. |
| **Manager** | Org KPIs, a supervisor table (rhythm held vs. due, commitments acknowledged and met, sessions documented, training, alerts), behaviors being coached, met rate by root cause, **daily inspection** of yesterday’s coaching, **effectiveness** before vs. after coaching, editable **KPI goals** per LOB. |
| **Agent** | This week’s commitment (in their own words) with an *I agree* button and a self-log counter, their four coaching sessions, assigned quizzes, AI roleplay practice, KPI progress and history. |

### Sessions

- **Idle:** people are signed out after **30 minutes** without activity (`SESSION_IDLE_MINUTES`). A warning shows 2 minutes before, and any click, key or a voice roleplay keeps the session alive. Activity in any PULSE tab counts.
- **Maximum length:** people are signed out **12 hours** after signing in (`SESSION_MAX_HOURS`), even if they stay active. The server enforces this too, so an old token stops working.
- **Coming back later:** a browser left open overnight comes back to the sign-in page.
- **Sign-in tokens:** they're refreshed automatically. If one stops working, PULSE goes back to sign-in with a message instead of showing "That didn’t load".
- **Switching users:** signing out clears everything for that person, so the next person starts clean.

### Notifications

A **New for you** bar at the top of every page shows what's new, and the **Notifications** bell in the sidebar keeps the last 40.

- **Agents:** a new DIRECT session (with the commitment to acknowledge), a quiz or a roleplay assigned to them, and their Friday result.
- **Supervisors:**
  - when an agent finishes an assigned quiz or roleplay, with the score;
  - their manager's 1:1 and Friday review.
- **Managers:**
  - supervisors who acknowledge their commitment;
  - daily reminders when a supervisor has 3 or more sessions left unmarked, or Friday reviews overdue;
  - their own 1:1s still to hold or review.

Supervisors assign roleplays from an agent's page (**Assign roleplay**). Agents find them under Practice, start them in one click, and the supervisor gets the score.

### Supervisor coaching (manager → supervisor)

Managers coach supervisors the way supervisors coach agents. It's a weekly DIRECT 1:1 with one SMART commitment, reviewed on Friday. PULSE measures six supervisor behaviors from the coaching data supervisors already keep:

| Behavior | Measured as |
|---|---|
| Holds the weekly rhythm | sessions held, of those due |
| Coaches with DIRECT | coaching sessions with all six steps written |
| Writes SMART commitments | commitments that pass the SMART check and the agent acknowledged |
| Diagnoses the root cause | agents re-diagnosed after two weeks not met |
| Uses the right coaching tool | weekly sessions with a tool that fits the root cause |
| Follows up Friday with evidence | commitments reviewed by Friday with Monitor held |

- **Manager › Supervisor coaching:** all supervisors at a glance, plus each supervisor's page. The page shows a 5-week trend, the suggested focus (last week's lowest behavior), the 1:1 form and the Friday review, where the measured result suggests Met, Partially met or Not met.
- **Supervisor › My coaching:** the same page, where the supervisor acknowledges the commitment.

Run `supabase/migrations/006_notifications_and_leader_coaching.sql` once to add these tables.

### AI features (Gemini)

1. **Identify the behavior to coach: supervisor first, AI second.** In **Coaching prep** the supervisor listens to 3–5 of the agent’s calls and marks each of the 7 behaviors as showed up (✓) or missing (✕); PULSE tallies the most-missed one. The supervisor picks the behavior and says why, and that pick is locked in before the AI is shown. The AI then reads the KPIs, verbatims and past commitments, decides on its own, and gives a second opinion on the supervisor’s pick (agrees, or what the data suggests instead and what to listen for to settle it). The supervisor makes the final call; changing their pick needs a reason. The call notes go into the DIRECT session for the I step. Run `supabase/migrations/008_supervisor_diagnosis.sql` once.
   Managers see **how each supervisor picks** on their Supervisor coaching page (supervisors see it under My coaching): calls listened per diagnosis, how often they followed their own call evidence, how often the AI agreed, how often they switched to the AI’s pick, and how often the commitment was met when they kept their pick vs. when they changed it.
2. **Coaching strategy.** The coaching tool for each of the 4 weekly sessions, a DIRECT talk track (what to say and what to avoid per step), a SMART commitment draft and practice ideas.
3. **AI-simulated roleplay, by voice or chat.** Gemini plays a fictional member on a realistic call (claim status, benefits, eligibility, billing, ID card, denial). The agent or supervisor practices one behavior and gets scored feedback with model lines. In a **voice call** the member talks out loud and the agent answers by voice (details below).
4. **Auto-generated quizzes** on the agent’s opportunity. Whatever the supervisor writes in **Focus** leads: every question is built around it (for example “giving timelines on claim-status calls”). The supervisor reviews the draft, edits any question or option, and picks the right answer for each one before assigning it (for AI quizzes no answer is pre-selected; the AI’s pick shows only as a hint).
5. **Friday review assistant.** Suggests the outcome, what to recognize, what to hold accountable, and next week’s step.

### Roleplay scenarios the supervisor controls

On **Roleplay**, a supervisor or manager can click **Review and edit the scenario first** (or **Write or edit the scenario first** in the Assign roleplay window on an agent’s page). The AI drafts a scenario, and the supervisor can change:

- **What the agent practices:** the core behavior, the difficulty, the call type (any text), and the list of things the agent should do. The feedback scores the call against that list.
- **The member:** a fictional name, voice (female or male), age and starting mood.
- **The context:** what the agent sees before the call, the member’s first words, a hidden need (it only comes up if the agent asks about anything else), and an optional direction for the AI member, such as “hard of hearing: asks the agent to repeat once”.

Then **Start the call** to practice it right away, or **Assign** it to the agent: the agent gets exactly that scenario. Agents don’t see the scenario before the call (it has the hidden need); they only see that their supervisor wrote it.

### Practice log

**Practice log** (supervisors, managers and agents) lists every roleplay with filters by agent, behavior, voice or chat, period and score, plus totals, the average score per behavior and a CSV export. Open one to see:

- the whole call, line by line, with the time from the start, the member’s mood changes, and for voice calls how long the agent took to answer, how long they spoke and when they talked over the member;
- the score and feedback, the model lines and the delivery stats;
- the scenario (and who wrote or edited it) and the assignment it came from;
- a **coach note**: supervisors and managers write it, and the agent is notified and sees it.

Agents see their own practice; supervisors see their own and their agents’; managers see their team’s. Run `supabase/migrations/007_practice_log.sql` once to add the columns this needs. Sample data includes scripted practice calls so the log can be explored before anyone practices.

### Voice roleplay

Choose **Voice call** when you set up a roleplay. It uses the browser’s built-in speech engines, so it’s free and needs no extra key.

- **The member speaks.** A voice that matches the member (gender and age), with tone and speed that follow their mood (calm, worried, frustrated, angry). Each line can be replayed. Turn off *Show the member’s words* to practice listening without captions.
- **The agent answers by voice.** With **Hands-free** on, the mic opens when the member stops talking and the answer is sent when you pause (1, 1.5 or 2.5 s). Turn it off to click **Talk**, then **Done talking**. Press **Space** to do the same. You can always type instead.
- **Headset mode** lets you talk over the member, as on a real call. PULSE notes when you do. Leave it off without a headset, or the mic will hear the member’s own voice.
- **Feedback on how you sounded:** pace in words per minute (target 120–165), time to answer, long silences (4 s+, the dead air members complain about), times you talked over the member, filler words and your share of the talking. Gemini adds a delivery tip, and you can click a model line to hear it (Model Tape).
- **Browsers:** Chrome and Edge do both directions. Edge has the most natural voices. Safari works on recent versions. Firefox can play the member, but you type your answers. The mic needs https or localhost, so it works on Render and locally.
- **Privacy:** the browser’s speech service (Google in Chrome, Microsoft in Edge) turns the agent’s voice into text. Scenarios are fictional. Agents must never say real member names, IDs or health details in practice.

### AI providers and backups

PULSE can use up to four AI providers and moves to the next one when a provider hits its free limit, is busy, or is down. A provider that hit its limit rests for a minute.

| Provider | Setting in `.env` | Notes |
|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | Main provider for analysis |
| Groq | `GROQ_API_KEY` | Very fast; answers roleplay turns first (`llama-3.3-70b-versatile`), analysis with `openai/gpt-oss-120b` |
| NVIDIA (build.nvidia.com) | `NVIDIA_API_KEY` | 40 requests a minute; NVIDIA says prompts aren’t used for training |
| Ollama (your own PC) | `OLLAMA_MODEL=qwen3:8b` | Free, no limits, nothing leaves the machine; one request at a time |

- **Order:** analysis uses `AI_ORDER` (default `gemini,groq,nvidia,ollama`), and roleplay replies use `AI_FAST_ORDER` (same default).
- **Getting the most out of Gemini’s free tier:** each Gemini model has its own daily quota. PULSE uses Flash (`GEMINI_MODEL`) for analysis, quizzes and roleplay scoring, and Flash-Lite (`GEMINI_FAST_MODEL`, a much larger quota) for each roleplay reply. A model that runs out for the day is skipped for an hour instead of slowing every request, and Groq takes over when every Gemini model is out.
- **Retired models:** NVIDIA and Groq retire models often. A model that answers 404/410 is skipped from then on, and PULSE picks a live chat model from the provider’s list. Leave `NVIDIA_MODEL` unset to always let it choose; `npm run check-ai` shows which one it picked.
- **Checking your setup:** `npm run check-ai` tests every provider you set up and shows the order.
- **Ollama and Render:** Ollama only works while PULSE runs on the same computer. A server on Render can’t reach `localhost` on your PC.

Every AI feature has a **rule-based fallback**. Without a key, or when the free tier hits its limit (HTTP 429), PULSE keeps working and labels the output *Offline suggestion*.

### How PULSE enforces the process

- One commitment = **one** core behavior + a **root cause** (Knowledge, Skill, Will, Tool/Process) + an **on-call action** + a measure + a follow-up date. Completing a DIRECT session is blocked until the **SMART check** passes. KPI results such as “raise CSAT” are rejected.
- Completing the session creates the commitment and plans the week’s **4 sessions**, with tools matched to the root cause.
- **Missed** sessions require a reason. Sessions planned outside their window (Mon–Tue, Wed–Thu, Fri) are flagged. So are sessions left unmarked, and a Kudos/Accountability held without Monitor.
- **Alerts:** an overdue Friday review, an agent who hasn’t acknowledged their commitment, a commitment that isn’t SMART, the same behavior not met two weeks in a row (re-diagnose), the same commitment three weeks running, and Outlier agents with no commitment this week.
- Coaching on a Saturday or Sunday sets up the **coming** week.

---

## Run it locally (5 minutes)

Requirements: Node.js 22+ (24 recommended). Check your Gemini key any time with `npm run check-ai`.

```bash
npm install
npm run dev          # http://localhost:3000
```

With no environment variables, PULSE uses a local JSON file seeded with **fictional** demo data (`data/local-db.json`), demo sign-in (pick a user, no password), and offline AI suggestions.

- Turn on Gemini: copy `.env.example` to `.env` and set `GEMINI_API_KEY` (free key at https://aistudio.google.com/apikey).
- Reset the demo data: `npm run reset-demo`.
- Run the tests: `npm test` (48 tests: AI provider fallback, session limits, notifications, assigned roleplays, supervisor coaching, sample data, KPI templates, passwords, roster import, role scoping, SMART check, the full weekly cycle, compliance flags, AI fallbacks, quizzes, text and voice roleplays, delivery metrics, uploads, HTTP auth, Gemini retries, sign-in by UID).

---

## Deploy

### 1. Supabase (database + sign-in)

1. Create a project at supabase.com.
2. In the **SQL editor**, run `supabase/schema.sql`.
3. Optional demo data: run `supabase/seed.sql` (fictional users with `@pulse.demo` emails). Regenerate it with `npm run seed:sql`.
4. Add your real people to the `users` table. Each needs `name`, `email`, `role` (`manager`, `supervisor` or `agent`) and `lob`. Agents also need `supervisor_id`, and supervisors need `manager_id`.
   ```sql
   insert into users (name, email, role, lob) values ('Your Name', 'you@company.com', 'manager', 'All');
   ```
5. Create logins for everyone in the `users` table in one go: `npm run create-logins -- --password=YourTempPass123` (uses the secret key in `.env`; skips people who already have a login). Or add them one by one in **Authentication › Users** with the **same email** as their `users` row. Each profile is linked to its login by the Supabase **UID** (`users.auth_user_id`). The script saves it; a login added by hand is linked automatically the first time that person signs in. If you created the tables before this column existed, run `supabase/migrations/002_link_logins_by_uid.sql` once.
6. Open **Project Settings › API Keys** and copy the **Project URL**, the **publishable key** (`sb_publishable_…`) and a **secret key** (`sb_secret_…`; click to reveal). Older projects can use the legacy `anon` and `service_role` keys from the same page instead.

Row Level Security is on with no public policies. The browser never reads tables directly; every request goes through the API, which checks the role and team scope.

### Load your real roster (EDB files)

1. Run `supabase/migrations/003_roster.sql` once in the Supabase SQL editor. It adds CCMS, sub-LOB, tenure and active columns.
2. Import the EDB workbooks, either way:
   - **In the app:** Manager › Data upload › **Roster (EDB)**. Choose the files, review the preview, then click **Import**.
   - **From the terminal:** `npm run import-roster -- "BVA EDB 10122026.xlsx" "IFM - EDB 10122026.xlsx" "Medicare - EDB 10122026.xlsx"`. This shows what would change; add `--apply` to save it.
3. Run `supabase/migrations/004_first_password.sql` once, then create the logins: `npm run create-logins -- --password=YourTempPass123`. Share the temporary password privately.
   The first time someone signs in, PULSE asks them to choose their own password, and nothing else opens until they do. A password needs at least 8 characters, letters and a number, and can't contain their name or login.
   Everyone can change their password later from **Password** in the sidebar (it asks for the current one).
   If someone forgets it, their supervisor (for agents) or manager (for supervisors and agents) clicks **Reset password** on that person's page. That gives them a new temporary password, and they choose their own again at the next sign-in.

How the files are read:

- **Who people are.** Agents come from the **EDB** sheet. Supervisors come from **Team Lead**, with their CCMS and email from the hidden **EDB SUPS** sheet. Floor managers come from **Floor Manager**. Each manager sees only their own supervisors and agents, with a tab per line of business.
- **Names and file names.** Names are matched across spellings: “Feliz Diaz, Jordy R” and jordy_feliz_diaz@… are the same person. Put BVA, IFM, Medicare or NPG in each file name; Medicare loads as **MedSupp**.
- **Logins.** Each login is the name part of the client email plus your domain (default `pulse.com`), for example `jordy_feliz_diaz@pulse.com`. People with no email get one made from their name. Nothing is ever emailed to these addresses.
- **People in training.** Agents in Training, OJT, Uptraining or Staff are tagged and left out of performance groups and team results.
- **Monthly updates.** People are matched by **CCMS**, so a new EDB updates moves and new hires. Agents and supervisors missing from a new file for the same line of business are marked as left and can’t sign in; nothing is deleted.
- **Messy files.**
  - The preview lists what to check: names that don’t match their email, duplicate rows and team leads with no agents.
  - When the same agent appears twice under different team leads, the lower row wins.
  - The first import can also remove the fictional @pulse.demo people.
- **Matching KPI and survey files.** Rows are matched by `ccms`, by email (PULSE or client email) or by name (“Last, First”).
- **Demo sign-in.** Real people show up in demo sign-in only on your own computer. Deployed, use `AUTH_MODE=supabase`.

> This is employee data. Get the OK from IT or compliance before loading it into a cloud database.

### Weekly KPIs for the real roster

- **Fill in the numbers.** Go to Data upload › Weekly KPIs › **Download for my agents**. You get a CSV of your agents with their CCMS, supervisor and this week’s Monday. Fill in `nps, csat, fcr, aht, qa, surveys`, save it as CSV and upload it.
  - **Formats:** rows you leave empty are ignored. Spanish Excel (semicolons and decimal commas), `91.5%` and AHT as `9:35` all work.
  - **More weeks:** copy the rows and change `week_start` to that week’s Monday.
- **Sample data (to explore before real numbers arrive).** Go to Data upload › **Sample data** and switch it on (run `supabase/migrations/005_sample_data.sql` once first).
  - **What it loads:** made-up data for your agents in production:
    - KPIs for 8 weeks and survey comments.
    - For about 8 in 10 agents, 4 to 8 weeks of coaching: a DIRECT session each week with notes for every step, a SMART commitment with its Friday result and the 4 weekly sessions (a few missed, with a reason).
    - The commitments tell a story. After two weeks met, the bar goes up or the agent moves to another behavior. After two weeks not met, the root cause changes.
    - Quizzes: completed ones with scores, and some still waiting.
    - This week's commitment: open, or already reviewed if Friday has passed. A few are left unacknowledged or unreviewed, so the alerts have something to show.
  - **Banner:** shows on every page, for every role, while sample data is on.
  - **Turning it off:** deletes only sample rows. Real KPIs you upload replace the sample week, and real coaching is never attached to sample rows.
  - **Before real coaching:** turn it off, so nobody coaches on made-up numbers.

### 2. Render (API, and the web app too)

1. Push this folder to a GitHub repo.
2. In Render, choose **New › Blueprint** and select the repo (it reads `render.yaml`). Or create a **Web Service** with build `npm install` and start `npm start`.
3. Set the environment variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `AUTH_MODE=supabase`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `APP_SECRET`, and optionally `SESSION_IDLE_MINUTES` and `SESSION_MAX_HOURS`. (Legacy keys also work as `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`.)
4. Open the Render URL. The API serves the web app as well, so this alone is a working deployment.

> Render’s free plan sleeps after inactivity, so the first request can take ~30–60 seconds.

### 3. Vercel (optional separate frontend)

1. Create a Vercel project from the same repo with **Root Directory = `web`** (no build step).
2. Edit `web/config.js`: `apiBase: "https://<your-render-service>.onrender.com"`.
3. On Render, set `CORS_ORIGIN=https://<your-vercel-domain>` and `SERVE_WEB=false`.

---

## Data you load

**Weekly KPIs** (Data upload › Weekly KPIs, one row per agent per week):

```
agent_email,week_start,nps,csat,fcr,aht,qa,surveys
daniela.cruz@pulse.demo,2026-10-05,38,91.5,93.2,575,94,12
```

AHT is in seconds, and `week_start` is the Monday of the week.

**Survey verbatims** (Data upload › Survey verbatims):

```
agent_email,date,score,text
daniela.cruz@pulse.demo,2026-10-07,4,"Nobody told me when my card would arrive."
```

Default goals: MES NPS 36, CSAT 90%, DD FCR 92%. **AHT (600 s) and Quality (90%) are placeholders.** Set your real targets in Manager › KPI goals.

---

## Privacy and the free AI tier

- Before any text goes to Gemini, PULSE sends only agent first names, KPI numbers and survey verbatims, with emails, phone numbers and long numbers (IDs) removed.
- **Google’s free tier may use prompts to improve its models.** Keep member PHI out of verbatims. For production with real member data, use a paid tier or an enterprise agreement that excludes training, and get your client’s approval.
- The Gemini key lives only on the server. Each user is limited to `AI_REQUESTS_PER_MINUTE` AI calls (default 12) to stay inside the free quota.

---

## Project structure

```
backend/
  server.js          Express app: auth, AI rate limit, routes, serves /web
  auth.js            Demo tokens (HMAC) and Supabase token check
  ai/gemini.js       Gemini REST client (JSON mode, timeout, 429 handling)
  store/file.js      Local JSON store with fictional seed data
  store/supabase.js  Supabase adapter (service role, server only)
web/
  index.html, styles.css, config.js, app.js, api.js, ui.js
  voice.js           Voice roleplay: member speech (speechSynthesis) and agent speech recognition
  views/             supervisor.js, manager.js, agent.js, tools.js (prep, DIRECT, roleplay, quizzes, training, upload)
  core/              Shared by server and browser
    constants.js     7 behaviors, root causes, 8 tools, weekly sessions, DIRECT, KPIs, guides
    router.js        The whole API (roles, scoping, validation)
    services.js      KPI analysis, groups, SMART check, compliance, alerts, effectiveness
    ai.js            Prompts, Gemini output validation and offline fallbacks
    delivery.js      Voice delivery metrics (pace, time to answer, silences, talk-over)
    roster.js        Roster import: EDB files -> managers, supervisors, agents
    sample.js        Sample (placeholder) data for the real roster, on/off
    password.js      Password rules
    xlsx.js          Small .xlsx reader (no dependencies)
    seed.js          Fictional demo data
  guides/            The 4 interactive training guides
supabase/            schema.sql, seed.sql, make-seed.js, create-logins.js, migrations/
scripts/             import-roster.js
tests/               node:test suite
```

The API logic in `web/core/router.js` runs in two places: the Express server, and the browser when no server is reachable. That’s how the static demo works with the same rules.

## Limits of this version (from the project scope)

No real-time telephony or CRM integration, no call recording or speech analytics, no native mobile app (the web app is responsive), and no custom-trained model.
