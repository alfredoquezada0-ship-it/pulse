// PULSE web app: shell, sign-in and navigation.
import { init, state, api, demoUsers, signInDemo, signInEmail, signOut, resetLocalDemo } from "./api.js";
import { esc, $, $$, icon, toast, setBank } from "./ui.js";
import * as Sup from "./views/supervisor.js";
import * as Tools from "./views/tools.js";
import * as Mgr from "./views/manager.js";
import * as Agent from "./views/agent.js";
import { renderSetPassword, changePasswordModal } from "./views/account.js";
import { createNotifier } from "./views/notify.js";
import { startSessionWatch, expiredReason } from "./session.js";
import * as Lead from "./views/leaders.js";
import * as Practice from "./views/practice.js";
import * as Bank from "./views/bank.js";

const NAV = {
  supervisor: [
    ["Coach", [["sup-dash", "Dashboard", "home"], ["agents", "My agents", "users"], ["prep", "Coaching prep", "spark"], ["sessions", "DIRECT sessions", "clip"]]],
    ["Follow up", [["weekly", "Weekly plan", "cal"], ["commitments", "Commitments", "check"], ["my-coaching", "My coaching", "target"]]],
    ["Practice", [["roleplay", "Roleplay", "chat"], ["practice-log", "Practice log", "list"], ["quizzes", "Quizzes", "quiz"]]],
    ["Learn & data", [["bank", "Our behaviors", "list"], ["training", "Training", "book"], ["upload", "Data upload", "up"]]],
  ],
  manager: [
    ["Operations", [["mgr-overview", "Overview", "home"], ["leaders", "Supervisor coaching", "users"], ["inspection", "Daily inspection", "eye"], ["effect", "Effectiveness", "chart"], ["agents", "My agents", "users"], ["practice-log", "Practice log", "list"]]],
    ["Setup", [["bank", "Behavior bank", "list"], ["goals", "KPI goals", "target"], ["training", "Training", "book"], ["upload", "Data upload", "up"]]],
  ],
  agent: [
    ["My coaching", [["my-week", "My week", "home"], ["my-quizzes", "Quizzes", "quiz"], ["practice", "Practice", "chat"], ["practice-log", "Practice log", "list"], ["my-progress", "My progress", "chart"], ["training", "Training", "book"]]],
  ],
};
const HOME = { supervisor: "sup-dash", manager: "mgr-overview", agent: "my-week" };
const VIEWS = {
  "sup-dash": Sup.dashboard, agents: Sup.agents, agent: Sup.agentDetail, prep: Tools.prep, sessions: Sup.sessions, session: Tools.session,
  weekly: Sup.weekly, commitments: Sup.commitments, roleplay: Tools.roleplay, quizzes: Tools.quizzes, training: Tools.training, upload: Tools.upload,
  "mgr-overview": Mgr.overview, inspection: Mgr.inspection, effect: Mgr.effectiveness, goals: Mgr.goals,
  leaders: Lead.leaders, leader: Lead.leader, "leader-session": Lead.leaderSession, "my-coaching": Lead.myCoaching,
  "my-week": Agent.myWeek, "my-quizzes": Agent.myQuizzes, practice: Tools.roleplay, "my-progress": Agent.myProgress,
  "practice-log": Practice.log, "practice-detail": Practice.detail, bank: Bank.page,
};

let route = { name: null, params: {} };
let notifier = null, watch = null;

// Ends the session everywhere in this tab: stops timers, signs out, and shows the sign-in page with a reason.
async function endSession(message) {
  leave(); notifier?.stop(); notifier = null; watch?.stop(); watch = null; idleWarning(false);
  await signOut();
  renderLogin(message);
}
window.addEventListener("pulse:signed-out", (e) => { if (state.user) endSession(e.detail); });
function idleWarning(show, secs) {
  let el = document.getElementById("idle-warn");
  if (!show) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "idle-warn"; el.className = "idle-warn"; el.setAttribute("role", "alertdialog"); document.body.appendChild(el); }
  el.innerHTML = `<b>Still there?</b> <span>For security you’ll be signed out in about ${Math.max(1, Math.round((secs || 120) / 60))} minute${(secs || 120) > 90 ? "s" : ""} without activity.</span> <button class="btn sm primary" id="stay">Stay signed in</button>`;
  el.querySelector("#stay").onclick = () => watch?.stayActive();
  el.querySelector("#stay").focus();
}
// Views can register clean-up (stop audio, release the microphone) that runs when the user leaves them.
let leaving = [];
const leave = () => { const fns = leaving; leaving = []; fns.forEach((fn) => { try { fn(); } catch {} }); };
const ctx = { api, state, go, toast, refresh: () => go(route.name, route.params), onLeave: (fn) => leaving.push(fn) };

function go(name, params = {}) {
  leave();
  if (!state.user) return renderLogin();
  if (!VIEWS[name]) name = HOME[state.user.role];
  route = { name, params };
  try { sessionStorage.setItem("pulse-route", JSON.stringify({ ...route, user: state.user.id })); } catch {}
  $$(".nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.go === name || (name === "agent" && b.dataset.go === "agents") || (name === "session" && b.dataset.go === "sessions") || (name === "practice-detail" && b.dataset.go === "practice-log") ? "page" : "false"));
  const main = $("#main");
  main.innerHTML = `<div class="loading">Loading…</div>`;
  window.scrollTo(0, 0);
  if (route.name && notifier) setTimeout(() => notifier?.refresh(), 800); // pick up anything new after each move
  Promise.resolve(VIEWS[name](main, params, ctx)).catch((e) => {
    if (e.status === 428) return; // the "choose your password" screen takes over
    const home = HOME[state.user.role];
    // A page saved from an earlier session can point at someone who no longer exists (for example demo people): go home instead.
    if ((e.status === 404 || e.status === 403) && name !== home) { try { sessionStorage.removeItem("pulse-route"); } catch {} toast(`${e.message} Showing your home page.`, "err"); return go(home); }
    main.innerHTML = `<div class="card"><h3>That didn’t load</h3><p class="muted">${esc(e.message)}${e.status ? ` <span class="mono small">(${e.status})</span>` : ""}</p>
      <p class="small muted mt">If this keeps happening, the terminal where PULSE is running shows the details, and <span class="mono">npm run doctor -- --as=${esc(state.user.email || "your login")}</span> checks your setup.</p>
      <div class="row mt"><button class="btn" data-retry>Try again</button>${name !== home ? `<button class="btn ghost" data-home>Go to my home page</button>` : ""}</div></div>`;
    main.querySelector("[data-retry]").onclick = () => go(name, params);
    const h = main.querySelector("[data-home]"); if (h) h.onclick = () => go(home);
  });
}

function renderShell() {
  const u = state.user;
  const banner = state.mode === "local"
    ? `<div class="mode-banner">Demo mode: fictional data saved in this browser. AI features use offline suggestions until the server and an AI key are connected.</div>`
    : state.config.ai.provider === "offline" ? `<div class="mode-banner">AI is offline: add a GROQ_API_KEY, GEMINI_API_KEY or NVIDIA_API_KEY on the server. Offline suggestions are shown meanwhile.</div>` : "";
  document.body.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><span class="mark">P</span><div><b>PULSE</b><small>Coaching intelligence</small></div></div>
      <button class="nbell" id="bell" type="button"></button>
      <nav class="nav" aria-label="Main">${NAV[u.role].map(([g, items]) => `<span class="grp">${g}</span>` + items.map(([id, label, ic]) => `<button data-go="${id}">${icon(ic)}${label}</button>`).join("")).join("")}</nav>
      <div class="who"><div><div class="name">${esc(u.name)}</div><span class="role-chip">${esc(u.role)}${u.lob && u.lob !== "All" ? " · " + esc(u.lob) : ""}</span></div>
        <div class="row"><button class="btn sm" id="theme" aria-label="Switch light or dark mode">Theme</button>${state.config.authMode === "supabase" ? `<button class="btn sm" id="pwd">Password</button>` : ""}<button class="btn sm" id="out">Sign out</button></div></div>
    </aside>
    <main class="main">${banner}<div id="sample-banner"></div><div id="notif-bar" hidden></div><div id="main" tabindex="-1"></div></main>
  </div>`;
  $$(".nav button").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $("#out").onclick = () => endSession();
  $("#theme").onclick = toggleTheme;
  const pwd = $("#pwd"); if (pwd) pwd.onclick = () => changePasswordModal({ state, api });
  refreshSampleBanner();
  notifier?.stop();
  notifier = createNotifier({ api, go, host: $("#notif-bar"), bell: $("#bell") });
}

async function renderLogin(notice = "") {
  const supa = state.config.authMode === "supabase";
  document.body.innerHTML = `<div class="login"><div class="login-card">
    <p class="eyebrow">Coaching intelligence for contact centers</p>
    <h1>PULSE<span>.</span></h1>
    <p class="muted mt">Know who to coach, on which of the 7 core behaviors, how to coach it with DIRECT, and whether the SMART commitment stuck.</p>
    ${notice ? `<div class="sticky small mt2" role="status">${esc(notice)}</div>` : ""}
    <div id="login-body" class="mt2"></div></div></div>`;
  const body = $("#login-body");
  if (supa) {
    body.innerHTML = `<form id="lf" class="fgrid"><label class="f">Work email<input class="in" id="em" type="email" autocomplete="username" required></label><label class="f">Password<input class="in" id="pw" type="password" autocomplete="current-password" required></label><div class="wide"><button class="btn primary">Sign in</button></div></form>`;
    // Bot protection (optional): Cloudflare Turnstile, checked by Supabase Auth when CAPTCHA is turned on there.
    const siteKey = state.config.captchaSiteKey;
    let captcha = null, widget = null;
    if (siteKey) {
      $("#lf").insertAdjacentHTML("beforeend", `<div class="f wide" id="cf"></div>`);
      try {
        await new Promise((ok, fail) => { if (window.turnstile) return ok(); const sc = document.createElement("script"); sc.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; sc.onload = ok; sc.onerror = fail; document.head.appendChild(sc); });
        widget = window.turnstile.render("#cf", { sitekey: siteKey, callback: (t) => (captcha = t), "expired-callback": () => (captcha = null) });
      } catch { toast("The security check didn’t load. Check your connection and reload.", "err"); }
    }
    $("#lf").onsubmit = async (e) => {
      e.preventDefault();
      if (siteKey && !captcha) return toast("Complete the security check first.", "err");
      try { await signInEmail($("#em").value.trim().toLowerCase(), $("#pw").value, captcha); start(); }
      catch (err) { toast(err.message, "err"); if (widget != null) { window.turnstile?.reset(widget); captcha = null; } }
    };
    return;
  }
  const users = await demoUsers();
  const real = users.some((u) => u.real);
  const byId = Object.fromEntries(users.map((u) => [u.id, u]));
  const card = (u, sub) => `<button data-u="${u.id}"><b>${esc(u.name)}</b><span>${esc(sub)}</span></button>`;
  body.innerHTML = `<p class="small muted">${state.mode === "local" ? "Demo mode in this browser." : "Demo sign-in, no password."} ${real ? "These are the people from your roster. This list only shows on your own computer; on the internet, people sign in with their own login." : "Pick a fictional user to see each view."}</p>
    <input class="in mt" id="who" placeholder="Search a name" aria-label="Search people" autocomplete="off">
    <div id="who-list"></div>
    ${state.mode === "local" ? `<p class="small muted mt2">Want a clean start? <button class="btn sm ghost" id="reset">Reset demo data</button></p>` : ""}`;
  const drawPeople = (q = "") => {
    const hit = (u) => !q || u.name.toLowerCase().includes(q);
    const mgrs = users.filter((u) => u.role === "manager" && hit(u)), sups = users.filter((u) => u.role === "supervisor" && hit(u)), ags = users.filter((u) => u.role === "agent" && hit(u));
    $("#who-list").innerHTML = `${mgrs.length ? `<h3 class="mt2">Managers</h3><div class="pick mt">${mgrs.map((u) => card(u, `Manager · ${u.lob === "All" ? "all LOBs" : u.lob}`)).join("")}</div>` : ""}
      ${sups.length ? `<h3 class="mt2">Supervisors</h3><div class="pick mt">${sups.slice(0, q ? 30 : 12).map((u) => card(u, `Supervisor · ${u.lob || ""}${byId[u.manager_id] ? " · " + byId[u.manager_id].name : ""}`)).join("")}</div>${!q && sups.length > 12 ? `<p class="small muted mt">${sups.length - 12} more supervisors: search a name.</p>` : ""}` : ""}
      ${ags.length ? `<h3 class="mt2">Agents</h3><div class="pick mt">${ags.slice(0, q ? 30 : 6).map((u) => card(u, `Agent · ${u.lob} · ${byId[u.supervisor_id]?.name || ""}`)).join("")}</div>${ags.length > (q ? 30 : 6) ? `<p class="small muted mt">${ags.length - (q ? 30 : 6)} more agents: search a name.</p>` : ""}` : ""}
      ${!mgrs.length && !sups.length && !ags.length ? `<p class="muted mt">Nobody matches.</p>` : ""}`;
    $$("[data-u]", body).forEach((b) => (b.onclick = async () => { try { await signInDemo(b.dataset.u); start(); } catch (err) { toast(err.message, "err"); } }));
  };
  drawPeople();
  $("#who").oninput = (e) => drawPeople(e.target.value.trim().toLowerCase());
  const r = $("#reset"); if (r) r.onclick = () => { resetLocalDemo(); location.reload(); };
}

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("pulse-theme", root.dataset.theme); } catch {}
}

// Sample (placeholder) data: a banner on every page while it's on, so nobody mistakes it for real results.
async function refreshSampleBanner() {
  const host = $("#sample-banner"); if (!host) return;
  let s = null; try { s = await api("GET", "/api/sample"); } catch {}
  host.innerHTML = s?.on ? `<div class="sample-banner" role="status"><b>Sample data is on.</b> The KPIs, survey comments and coaching history are made up so you can explore PULSE. Don’t coach on them.${s.can_toggle ? ` <button class="btn sm" id="sample-off">Turn off</button>` : ""}</div>` : "";
  const off = $("#sample-off"); if (off) off.onclick = async () => { off.disabled = true; try { await api("POST", "/api/sample", { on: false }); toast("Sample data removed."); refreshSampleBanner(); go(route.name, route.params); } catch (e) { toast(e.message, "err"); off.disabled = false; } };
}
window.addEventListener("pulse:sample-changed", refreshSampleBanner);

// Signed in with a temporary password (new login or a reset): choose your own before anything else.
const needsPassword = () => state.user?.must_change_password && state.config.authMode === "supabase";
const setPassword = () => renderSetPassword({ state, api, onDone: start, onSignOut: () => endSession() });
window.addEventListener("pulse:set-password", () => { if (state.user) { state.user.must_change_password = true; leave(); setPassword(); } });

async function start() {
  watch?.stop();
  watch = startSessionWatch(state.config.session, { onWarn: idleWarning, onExpire: (reason) => endSession(reason) });
  if (needsPassword()) return setPassword();
  try { setBank(await api("GET", "/api/behaviors")); } catch {} // the manager's behavior bank; the 7 core behaviors if it can't load
  renderShell();
  let saved = null; try { saved = JSON.parse(sessionStorage.getItem("pulse-route") || "null"); } catch {}
  if (saved && saved.user !== state.user.id) saved = null; // only reopen your own last page, never someone else's
  const allowed = NAV[state.user.role].flatMap(([, items]) => items.map((i) => i[0])).concat(state.user.role === "agent" ? [] : ["agent", "session", "sup-dash", "leader", "leader-session"]);
  if (saved && allowed.includes(saved.name)) go(saved.name, saved.params); else go(HOME[state.user.role]);
}

(async function boot() {
  try { const t = localStorage.getItem("pulse-theme"); if (t) document.documentElement.dataset.theme = t; } catch {}
  await init();
  const expired = state.user && expiredReason(state.config.session); // e.g. the browser was left open overnight
  if (expired) { await signOut(); return renderLogin(expired); }
  if (state.user) start(); else renderLogin();
})();
