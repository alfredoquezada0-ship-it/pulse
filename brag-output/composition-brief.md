# Hyperframes Composition Brief: PULSE

## Objective
Create a ~1-minute Spanish-language launch-style brag video for PULSE.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30 fps
- Duration: 60 seconds (user-requested; overrides the 15–25 s default)

## Source Material
- Project root: `pulse-main/`
- Primary files read: `README.md`, `web/index.html`, `web/styles.css`, `web/app.js`, `web/views/tools.js`, `web/views/agent.js`, `web/core/constants.js`, `web/core/services.js` (SMART check), `web/api.js`
- Product name: PULSE
- Tagline / strongest claim: "Coaching intelligence for contact center supervisors" · "Know who to coach, on which of the 7 core behaviors, how to coach it with DIRECT, and whether the SMART commitment stuck."
- Key UI moments: real markup captured from the running demo app (`web/` in local/demo mode, fictional seed users) — dashboard "Who to coach first", coaching-prep call-listening grid, AI second opinion, SMART commitment card (reject → pass), Step 5 weekly session cards, practice-log call + "How it sounded", agent "My commitment this week" + "My coaching week", manager "Coaching effectiveness" table. App CSS is reused, scoped under `.pa`.
- Copy that must appear verbatim (UI, English): "Who to coach first", "Agrees with you: Set Clear Expectations", "That’s a KPI result. Write the on-call action that moves it.", "Met", "Locked in"
- Spanish narrative copy: see storyboard in `brag-plan.md`

## Creative Direction
- Tone preset: app-store
- Creative direction: lanzamiento serio para supervisores de contact center: cuatro preguntas de cada lunes, cuatro respuestas en pantalla
- Interpretation: feature-card pacing, smooth slides, real UI floating on the brand board; fast entrances, readable holds
- Angle: four numbered questions (¿A quién? ¿En qué? ¿Cómo? ¿Funcionó?) asked in the hook, answered by the real product, checked off in the outro
- Hook: four questions slam in on the beat
- Outro / punchline: checklist ✓✓✓✓ → PULSE lockup → "Cada semana, hasta que el compromiso se sostenga."
- Avoid: generic SaaS language, abstract filler, redesigning the product UI, presenting demo numbers as results

## Visual Identity
- Background: `#E4EAF0`; surfaces `#FFFFFF`
- Text: `#14212A` (ink), `#44545F` (ink-2)
- Accent: `#0B5C63` teal; `#FBE38A` sticky yellow for AI
- Display font: Bricolage Grotesque (local woff2)
- Body font: Instrument Sans (local woff2); mono IBM Plex Mono
- Visual references: sidebar "P" brand mark, KPI tiles, ✓/✕ mark buttons, sticky AI cards, S-M-A-R-T tiles

## Storyboard
Creative contract: `brag-plan.md`.
1. Hook — 0–7.9 s — four questions + "Las cuatro preguntas de todo supervisor."
2. Reveal — 7.9–14.2 s — PULSE lockup, Spanish tagline, 3 chips
3. 01 ¿A quién? — 14.2–22.6 s — dashboard, push into "Who to coach first", cursor on Luis
4. 02 ¿En qué? — 22.6–31.0 s — call grid marks, Locked in, AI second opinion
5. 03 ¿Cómo? — 31.0–39.4 s — SMART reject → pass, 4 weekly sessions
6. 03 Práctica — 39.4–45.7 s — roleplay transcript + "How it sounded"
7. 04 ¿Funcionó? — 45.7–54.1 s — agent commitment Met, effectiveness before/after
8. Outro — 54.1–60.0 s — checklist + lockup

## Audio
- Audio role: warm bed
- Audio arc: bed from frame 0, tactile UI accents in the product scenes, success hits on all-green SMART and "Met", final bell on lockup, fade-out over the last ~2.5 s
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3`, volume ~0.32
- Music cue guidance: bundled preset (`assets/music/cues/…vol-11….music-cues.json`), 114.84 BPM; scene cuts on bar downbeats; strong-cue locks at 1.60 s, 8.44 s, 47.39 s
- Audio-reactive treatment: subtle; RMS drives the background teal glow
- SFX selection guidance: low-HF picks from `sfx-analysis.md` — `interface/click_00x`, `impact/impactSoft_medium_00x`, `interface/switch_00x`, `keyboard/keypress-*`, `interface/error_005` (quiet), `impact/impactBell_heavy_000`
- Exact SFX choice: chosen against the implemented animation
- Audio files: copied into `composition/assets/`

## Hyperframes Instructions
Built against `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-cli` (fetched from the hyperframes repo; CLI 0.8.168). Single paused GSAP timeline, deterministic, local fonts and audio, `npx hyperframes check` as the gate, local render only.
