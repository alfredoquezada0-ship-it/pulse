// PULSE API, written once and used by the Express server and by the in-browser demo.
// handle({ method, path, query, body, user }, { store, ai }) -> JSON-serializable result.
import * as C from "./constants.js";
import * as S from "./services.js";
import * as AI from "./ai.js";
import { HttpError, today, weekStart, addDays, coachingWeek } from "./util.js";
import { cleanVoice } from "./delivery.js";
import { cleanScenario, practiceFacts, practiceRow } from "./practice.js";
import { cleanCalls, tallyCalls, callLines, calibration } from "./diagnosis.js";
import { DEFAULT_BEHAVIORS, defaultRows, normalize, forLob, byKey, cleanBehavior, newKey, MAX_ACTIVE } from "./bank.js";
import { parseRoster, rosterTree, applyRoster, fold, emailLocal } from "./roster.js";
import { passwordProblems } from "./password.js";
import { sampleOn, sampleOff } from "./sample.js";

const routes = [];
const OPEN_WHILE_CHANGING = new Set(["GET /api/me", "POST /api/me/password", "GET /api/meta"]);
const on = (method, pattern, roles, fn) => {
  const keys = []; const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
  routes.push({ method, re, keys, roles, fn, pattern });
};

export async function handle(req, deps) {
  const path = req.path.split("?")[0];
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = path.match(r.re); if (!m) continue;
    if (r.roles !== "public") {
      if (!req.user) throw new HttpError(401, "Sign in to continue.");
      if (r.roles && !r.roles.includes(req.user.role)) throw new HttpError(403, "Your role can’t do that.");
      // First sign-in with a temporary password: nothing else works until the person picks their own.
      if (req.user.must_change_password && deps.passwords && !OPEN_WHILE_CHANGING.has(`${r.method} ${r.pattern}`)) throw new HttpError(428, "Set your own password to continue.");
    }
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.fn({ ...req, params, query: req.query || {}, body: req.body || {} }, deps);
  }
  throw new HttpError(404, "Not found.");
}

// ---------- scope helpers ----------
// A manager sees their own supervisors and agents (people who left the roster are hidden).
const active = (u) => u.active !== false;
async function managerTeam(user, store) {
  const all = (await store.list("users")).filter(active);
  const sups = all.filter((u) => u.role === "supervisor" && u.manager_id === user.id);
  const supIds = new Set(sups.map((x) => x.id));
  const agents = all.filter((u) => u.role === "agent" && (u.manager_id === user.id || supIds.has(u.supervisor_id)));
  return { sups, agents, all };
}
async function scopedAgents(user, store) {
  if (user.role === "manager") return (await managerTeam(user, store)).agents;
  if (user.role === "supervisor") return (await store.list("users", { role: "agent", supervisor_id: user.id })).filter(active);
  return [user];
}
async function mustSeeAgent(user, store, agentId) {
  const a = await store.get("users", agentId);
  if (!a || a.role !== "agent") throw new HttpError(404, "Agent not found.");
  let ok = (user.role === "supervisor" && a.supervisor_id === user.id) || (user.role === "agent" && a.id === user.id);
  if (user.role === "manager") ok = a.manager_id === user.id || (a.supervisor_id && (await store.get("users", a.supervisor_id))?.manager_id === user.id);
  if (!ok) throw new HttpError(403, "That agent isn’t on your team.");
  return a;
}
const agentIdsFor = async (user, store) => new Set((await scopedAgents(user, store)).map((a) => a.id));
const first = (name) => String(name || "").split(" ")[0];

// ---------- notifications ----------
// One row per person and event. `key` (optional) keeps reminders from repeating: one per person per key.
async function notify(store, userId, n) {
  if (!userId) return null;
  if (n.key && (await store.list("notifications", { user_id: userId, key: n.key })).length) return null;
  try { return await store.insert("notifications", { user_id: userId, type: n.type, title: n.title, body: n.body || "", link: n.link || null, key: n.key || null, read_at: null }); }
  catch { return null; } // a notification must never break the action that caused it
}
async function summariesFor(agents, store) {
  const goals = await store.list("kpi_goals");
  const rows = await store.list("kpi_weekly", { agent_id: agents.map((a) => a.id) });
  const sums = agents.map((a) => S.agentSummary(a, rows.filter((r) => r.agent_id === a.id), goals));
  return { goals, rows, sums: S.assignQuartiles(sums) };
}
const supervisorIdFor = (user, agent) => (user.role === "supervisor" ? user.id : agent.supervisor_id);

// ---------- behavior bank ----------
// Every person works with their manager's bank (agents and supervisors through their manager), filtered by LOB.
async function managerIdOf(store, person) {
  if (!person) return null;
  if (person.role === "manager") return person.id;
  if (person.manager_id) return person.manager_id;
  if (person.supervisor_id) return (await store.get("users", person.supervisor_id))?.manager_id || null;
  return null;
}
const creatingBank = new Map();
async function bankOf(store, managerId) {
  if (!managerId) return DEFAULT_BEHAVIORS;
  let rows = await store.list("behaviors", { manager_id: managerId });
  if (!rows.length) { // first use: the bank starts as a copy of the 7 core behaviors
    if (!creatingBank.has(managerId)) creatingBank.set(managerId, store.insertMany("behaviors", defaultRows(managerId)).catch(() => null).finally(() => creatingBank.delete(managerId)));
    await creatingBank.get(managerId);
    rows = await store.list("behaviors", { manager_id: managerId });
    if (!rows.length) return DEFAULT_BEHAVIORS;
  }
  return rows.map(normalize).sort((a, b) => a.position - b.position);
}
// { all: the whole bank (also retired ones, for names in history), usable: active ones for this LOB, BY: lookup by key }
async function bankFor(store, person, lob = person?.lob) {
  const all = await bankOf(store, await managerIdOf(store, person));
  const BY = { ...byKey(DEFAULT_BEHAVIORS), ...byKey(all) };
  return { all, usable: forLob(all, lob), BY };
}
const mustUse = (bank, id, msg = "Pick one of your team’s behaviors.") => { const b = bank.usable.find((x) => x.id === id); if (!b) throw new HttpError(400, msg); return b; };

// ---------- meta / me ----------
on("GET", "/api/health", "public", async () => ({ ok: true, app: "PULSE", time: new Date().toISOString() }));
on("GET", "/api/meta", "public", async () => ({
  program: C.PROGRAM, lobs: C.LOBS, kpis: C.KPIS, behaviors: C.BEHAVIORS.map(({ keywords, ...b }) => b), root_causes: C.ROOT_CAUSES,
  tools: C.TOOLS, session_types: C.SESSION_TYPES, tool_plan: C.TOOL_PLAN, direct: C.DIRECT_STEPS, call_types: C.CALL_TYPES,
  quartiles: C.QUARTILES, guides: C.GUIDES, statuses: C.COMMITMENT_STATUS,
}));
on("GET", "/api/me", null, async ({ user }) => user);

// ---------- passwords (Supabase sign-in only) ----------
// deps.passwords = { set(user, pw), check(user, pw) } is provided by the server when AUTH_MODE=supabase.
const noPasswords = () => new HttpError(400, "Passwords only apply when people sign in with Supabase (AUTH_MODE=supabase).");
on("POST", "/api/me/password", null, async ({ user, body }, { store, passwords }) => {
  if (!passwords) throw noPasswords();
  if (!user.auth_user_id) throw new HttpError(400, "Your profile isn’t linked to a login yet. Sign out and sign in again.");
  const pw = String(body.password || "");
  const problems = passwordProblems(pw, user);
  if (problems.length) throw new HttpError(400, `Your new password needs: ${problems.join("; ").toLowerCase()}.`);
  if (!user.must_change_password && !(body.current && (await passwords.check(user, String(body.current))))) throw new HttpError(400, "Your current password isn’t right.");
  if (await passwords.check(user, pw)) throw new HttpError(400, "Pick a password different from the one you have now.");
  await passwords.set(user, pw);
  return store.update("users", user.id, { must_change_password: false, password_changed_at: new Date().toISOString() });
});
// A leader gives a team member a new temporary password; they choose their own at the next sign-in.
on("POST", "/api/people/:id/reset-password", ["manager", "supervisor"], async ({ user, params, body }, { store, passwords }) => {
  if (!passwords) throw noPasswords();
  const p = await store.get("users", params.id);
  if (!p || p.active === false) throw new HttpError(404, "Person not found.");
  let ok = user.role === "supervisor" ? p.role === "agent" && p.supervisor_id === user.id : p.manager_id === user.id;
  if (!ok && user.role === "manager" && p.role === "agent" && p.supervisor_id) ok = (await store.get("users", p.supervisor_id))?.manager_id === user.id;
  if (!ok || p.id === user.id) throw new HttpError(403, "You can reset passwords only for people on your team.");
  if (!p.auth_user_id) throw new HttpError(400, `${p.name} has no login yet. Create it with npm run create-logins.`);
  const pw = String(body.password || "");
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, "The temporary password needs 8+ characters with letters and a number.");
  await passwords.set(p, pw);
  await store.update("users", p.id, { must_change_password: true });
  return { ok: true, name: p.name, email: p.email };
});
on("GET", "/api/demo-users", "public", async (_, { store, demo, demoRoster }) => {
  if (!demo) throw new HttpError(404, "Not found.");
  // Real people (imported from the roster) only appear in demo sign-in on your own computer.
  const us = (await store.list("users")).filter((u) => active(u) && (demoRoster || u.source !== "roster"));
  return us.map(({ id, name, role, lob, supervisor_id, manager_id, source }) => ({ id, name, role, lob, supervisor_id, manager_id, real: source === "roster" }));
});

// ---------- people ----------
on("GET", "/api/agents", ["manager", "supervisor"], async ({ user }, { store }) => {
  const agents = await scopedAgents(user, store);
  const { sums } = await summariesFor(agents, store);
  const sups = await store.list("users", { role: "supervisor" });
  return sums.map((s) => { const a = agents.find((x) => x.id === s.id); return { ...s, email: a?.email, employee_id: a?.employee_id || null, tenure_bucket: a?.tenure_bucket || null, supervisor_name: sups.find((x) => x.id === s.supervisor_id)?.name }; });
});
on("GET", "/api/agents/:id", null, async ({ user, params }, { store }) => {
  const a = await mustSeeAgent(user, store, params.id);
  const { sums } = await summariesFor([a], store);
  const [verbatims, sessions, commitments, quizzes, weekly] = await Promise.all([
    store.list("verbatims", { agent_id: a.id }), store.list("coaching_sessions", { agent_id: a.id }),
    store.list("commitments", { agent_id: a.id }), store.list("quizzes", { agent_id: a.id }), store.list("weekly_sessions", { agent_id: a.id }),
  ]);
  const team = user.role === "agent" ? [] : await scopedAgents(user, store);
  const teamSums = team.length ? (await summariesFor(team, store)).sums : [];
  const sup = a.supervisor_id ? await store.get("users", a.supervisor_id) : null;
  return {
    agent: a, supervisor: sup ? { id: sup.id, name: sup.name } : null,
    summary: { ...sums[0], quartile: teamSums.find((s) => s.id === a.id)?.quartile || null },
    verbatims: verbatims.sort((x, y) => (x.date < y.date ? 1 : -1)),
    sessions: sessions.sort((x, y) => (x.date < y.date ? 1 : -1)),
    commitments: commitments.sort((x, y) => (x.week_start < y.week_start ? 1 : -1)),
    quizzes: quizzes.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)),
    weekly: weekly.filter((w) => w.week_start >= addDays(weekStart(), -7)),
    effectiveness: S.effectiveness(a, (await store.list("kpi_weekly", { agent_id: a.id })).sort((x, y) => (x.week_start < y.week_start ? -1 : 1)), sessions, commitments),
  };
});
on("GET", "/api/supervisors", ["manager"], async ({ user }, { store }) => (await managerTeam(user, store)).sups);

// ---------- dashboards ----------
on("GET", "/api/dashboard/supervisor", ["supervisor", "manager"], async ({ user, query }, { store }) => {
  const supId = user.role === "supervisor" ? user.id : query.supervisor_id;
  const sup = await store.get("users", supId);
  if (!sup) throw new HttpError(404, "Supervisor not found.");
  if (user.role === "manager" && sup.manager_id !== user.id) throw new HttpError(403, "That supervisor isn’t on your team.");
  const agents = (await store.list("users", { role: "agent", supervisor_id: sup.id })).filter(active);
  const { goals, sums } = await summariesFor(agents, store);
  const week = query.week || weekStart();
  const [commitments, sessions] = await Promise.all([store.list("commitments", { supervisor_id: sup.id }), store.list("weekly_sessions", { supervisor_id: sup.id })]);
  return {
    supervisor: { id: sup.id, name: sup.name, lob: sup.lob }, week,
    team: S.teamKpis(sums, goals, sup.lob),
    agents: sums.sort((a, b) => b.risk - a.risk),
    compliance: S.weeklyCompliance(sessions, commitments, week),
    commitments: commitments.filter((c) => c.week_start === week),
    alerts: S.buildAlerts({ agents, summaries: sums, commitments, sessions, week }),
  };
});

on("GET", "/api/dashboard/manager", ["manager"], async ({ user, query }, { store }) => {
  const week = query.week || weekStart();
  const team = await managerTeam(user, store);
  // Lines of business this manager covers, largest first. ?lob= narrows the page to one of them.
  const lobCount = {}; team.agents.forEach((a) => (lobCount[a.lob] = (lobCount[a.lob] || 0) + 1));
  const lobs = Object.keys(lobCount).sort((a, b) => lobCount[b] - lobCount[a]);
  const lob = lobs.includes(query.lob) ? query.lob : null;
  const sups = team.sups.filter((x) => !lob || x.lob === lob);
  const agents = team.agents.filter((a) => !lob || a.lob === lob);
  const ids = agents.map((a) => a.id), supIds = sups.map((x) => x.id);
  const [commitments, sessions, coaching, training, goals, rows] = await Promise.all([
    store.list("commitments", { agent_id: ids }), store.list("weekly_sessions", { agent_id: ids }),
    store.list("coaching_sessions", { agent_id: ids }), store.list("training_completions", { user_id: supIds }), store.list("kpi_goals"), store.list("kpi_weekly", { agent_id: ids }),
  ]);
  const sums = S.assignQuartiles(agents.map((a) => S.agentSummary(a, rows.filter((r) => r.agent_id === a.id), goals)));
  const supervisors = sups.map((s) => {
    const team = sums.filter((x) => x.supervisor_id === s.id);
    const cs = commitments.filter((c) => c.supervisor_id === s.id);
    const reviewed = cs.filter((c) => c.status !== "open");
    const comp = S.weeklyCompliance(sessions.filter((x) => x.supervisor_id === s.id), cs, week);
    const docs = coaching.filter((x) => x.supervisor_id === s.id);
    return {
      id: s.id, name: s.name, lob: s.lob, agents: team.length, team: S.teamKpis(team, goals, s.lob), compliance: comp,
      commitments: { total: cs.length, met: reviewed.filter((c) => c.status === "met").length, reviewed: reviewed.length, thisWeek: cs.filter((c) => c.week_start === week).length },
      documented: docs.length ? Math.round((docs.filter((d) => d.status === "completed" && d.root_cause && d.behavior).length / docs.length) * 100) : null,
      training: training.filter((t) => t.user_id === s.id).map((t) => t.guide_id),
      alerts: S.buildAlerts({ agents: agents.filter((a) => a.supervisor_id === s.id), summaries: team, commitments: cs, sessions: sessions.filter((x) => x.supervisor_id === s.id), week }).length,
    };
  });
  const yesterday = addDays(today(), -1);
  const lastWorkday = [0, 1, 2, 3].map((n) => addDays(yesterday, -n)).find((d) => sessions.some((x) => x.planned_date === d)) || yesterday;
  const mgrBank = await bankFor(store, user, null);
  const effect = agents.map((a) => S.effectiveness(a, rows.filter((r) => r.agent_id === a.id).sort((x, y) => (x.week_start < y.week_start ? -1 : 1)), coaching, commitments, mgrBank.all)).filter(Boolean);
  return {
    week, lob, lobs, lob_counts: lobCount, people: { supervisors: sups.length, agents: agents.length, in_production: agents.filter(active).filter((a) => a.in_production !== false).length },
    org: S.teamKpis(sums, goals, lob || lobs[0] || "NPG"), supervisors,
    behaviors: S.behaviorDistribution(commitments, mgrBank.all.filter((b) => b.active || commitments.some((c) => c.behavior === b.id))),
    byRootCause: C.ROOT_CAUSES.map((r) => { const cs = commitments.filter((c) => c.root_cause === r.id && c.status !== "open"); return { id: r.id, name: r.name, reviewed: cs.length, met: cs.filter((c) => c.status === "met").length }; }),
    inspection: { date: lastWorkday, sessions: sessions.filter((x) => x.planned_date === lastWorkday).map((x) => ({ ...x, agent_name: agents.find((a) => a.id === x.agent_id)?.name, supervisor_name: sups.find((s) => s.id === x.supervisor_id)?.name, commitment: commitments.find((c) => c.id === x.commitment_id) || null })) },
    effectiveness: { agents: effect.length, improved: effect.filter((e) => e.improved).length, list: effect.map((e) => ({ ...e, name: agents.find((a) => a.id === e.agent_id)?.name })) },
    quartiles: C.QUARTILES.map((q) => ({ ...q, count: sums.filter((s) => s.quartile === q.id).length })),
  };
});

on("GET", "/api/dashboard/agent", ["agent"], async ({ user }, { store }) => {
  const { sums } = await summariesFor([user], store);
  const week = weekStart();
  const [commitments, weekly, quizzes, sessions] = await Promise.all([store.list("commitments", { agent_id: user.id }), store.list("weekly_sessions", { agent_id: user.id }), store.list("quizzes", { agent_id: user.id }), store.list("coaching_sessions", { agent_id: user.id })]);
  commitments.sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
  const sup = user.supervisor_id ? await store.get("users", user.supervisor_id) : null;
  return {
    me: { id: user.id, name: user.name, lob: user.lob }, supervisor: sup ? sup.name : null, week, summary: sums[0],
    current: commitments.find((c) => c.week_start === week) || null, history: commitments.filter((c) => c.week_start !== week),
    weekly: weekly.filter((w) => w.week_start === week).sort((a, b) => (a.planned_date < b.planned_date ? -1 : 1)),
    quizzes: quizzes.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    lastSession: sessions.sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null,
  };
});

// ---------- KPI goals and uploads ----------
on("GET", "/api/goals", null, async (_, { store }) => store.list("kpi_goals"));
on("PATCH", "/api/goals/:id", ["manager"], async ({ params, body }, { store }) => store.update("kpi_goals", params.id, { goal: Number(body.goal) }));

// Rows from KPI or survey exports are matched by CCMS, by email (PULSE or client email, same name before the @),
// or by full name ("Last, First" or "First Last").
function agentMatcher(agents) {
  const by = new Map();
  const nameKeys = (n) => { const s = fold(n).replace(/[^a-z, ]/g, " ").replace(/\s+/g, " ").trim(); if (!s) return []; const [l, f] = s.split(","); return f ? [`${f.trim().split(" ")[0]} ${l.trim()}`, s] : [s]; };
  for (const a of agents) {
    if (a.employee_id) by.set("id:" + String(a.employee_id), a);
    if (a.email) { by.set("em:" + a.email.toLowerCase(), a); by.set("lp:" + emailLocal(a.email), a); }
    nameKeys(a.name).forEach((k) => by.set("nm:" + k, a));
  }
  return (r) => {
    const id = String(r.ccms ?? r.employee_id ?? r.agent_ccms ?? "").trim().replace(/\.0+$/, "");
    const em = String(r.agent_email || r.email || "").trim().toLowerCase();
    const nm = r.agent_name || r.name || "";
    return (id && by.get("id:" + id)) || (em && (by.get("em:" + em) || by.get("lp:" + emailLocal(em)))) || nameKeys(nm).map((k) => by.get("nm:" + k)).find(Boolean) || null;
  };
}
// "91,5" (decimal comma), "91.5%" and "9:35" (AHT as minutes:seconds) are all accepted.
const num = (v) => {
  const t = String(v).trim().replace(/%$/, "");
  const mmss = t.match(/^(\d{1,3}):([0-5]\d)$/); if (mmss) return +mmss[1] * 60 + +mmss[2];
  return Number(/^-?\d+,\d+$/.test(t) ? t.replace(",", ".") : t);
};
const rowWho = (r) => r.ccms || r.employee_id || r.agent_email || r.email || r.agent_name || r.name || "?";

on("POST", "/api/upload/kpis", ["manager", "supervisor"], async ({ user, body }, { store }) => {
  const agents = await scopedAgents(user, store);
  const find = agentMatcher(agents);
  const existing = await store.list("kpi_weekly", { agent_id: agents.map((a) => a.id) });
  let added = 0, updated = 0, blank = 0; const skipped = [];
  for (const [i, r] of (body.rows || []).entries()) {
    const a = find(r);
    if (!a) { skipped.push(`Row ${i + 2}: ${rowWho(r)} isn’t on your team`); continue; }
    const week = weekStart(r.week_start || r.week || today());
    const vals = {}; C.KPIS.forEach((k) => { if (r[k.id] !== undefined && r[k.id] !== "") vals[k.id] = num(r[k.id]); });
    if (r.surveys) vals.surveys = num(r.surveys);
    if (!Object.keys(vals).length) { blank++; continue; } // template rows left empty
    const bad = Object.entries(vals).find(([, v]) => !Number.isFinite(v));
    if (bad) { skipped.push(`Row ${i + 2}: ${rowWho(r)} has “${r[bad[0]]}” in ${bad[0]}, which isn’t a number`); continue; }
    const ex = existing.find((x) => x.agent_id === a.id && x.week_start === week);
    if (ex && ex.sample) { await store.remove("kpi_weekly", ex.id); await store.insert("kpi_weekly", { agent_id: a.id, week_start: week, ...vals }); added++; } // real numbers replace the sample week
    else if (ex) { await store.update("kpi_weekly", ex.id, vals); updated++; } else { await store.insert("kpi_weekly", { agent_id: a.id, week_start: week, ...vals }); added++; }
  }
  return { added, updated, blank, skipped };
});
on("POST", "/api/upload/verbatims", ["manager", "supervisor"], async ({ user, body }, { store }) => {
  const agents = await scopedAgents(user, store);
  const find = agentMatcher(agents);
  const rows = []; const skipped = [];
  (body.rows || []).forEach((r, i) => {
    const a = find(r);
    if (!a || !r.text) { skipped.push(`Row ${i + 2}: ${!a ? "agent not on your team" : "no text"}`); return; }
    rows.push({ agent_id: a.id, date: (r.date || today()).slice(0, 10), score: r.score === "" || r.score == null ? null : Number(r.score), text: r.text });
  });
  if (rows.length) await store.insertMany("verbatims", rows);
  return { added: rows.length, skipped };
});

// ---------- notification bar ----------
const digestAt = new Map(); // manager id -> last time the reminders were checked (at most every 10 minutes)
on("GET", "/api/notifications", null, async ({ user }, { store }) => {
  if (user.role === "manager" && Date.now() - (digestAt.get(user.id) || 0) > 600000) {
    digestAt.set(user.id, Date.now());
    try { await managerDigest(user, store); } catch {}
  }
  const all = (await store.list("notifications", { user_id: user.id })).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { unread: all.filter((n) => !n.read_at).length, items: all.slice(0, 40) };
});
on("POST", "/api/notifications/read", null, async ({ user, body }, { store }) => {
  const mine = (await store.list("notifications", { user_id: user.id })).filter((n) => !n.read_at && (body.all || (body.ids || []).includes(n.id)));
  const at = new Date().toISOString();
  for (const n of mine) await store.update("notifications", n.id, { read_at: at });
  return { read: mine.length };
});

// Reminders for managers about their supervisors: sessions left unmarked, Friday reviews overdue, and their own 1:1 follow-up.
async function managerDigest(user, store) {
  const { sups, agents } = await managerTeam(user, store);
  if (!sups.length) return;
  const now = today(), week = weekStart(now), ids = agents.map((a) => a.id);
  const [weekly, commitments, leaderC] = await Promise.all([
    store.list("weekly_sessions", { agent_id: ids, week_start: week }), store.list("commitments", { agent_id: ids, status: "open" }), store.list("leader_commitments", { supervisor_id: sups.map((x) => x.id) }),
  ]);
  for (const sup of sups) {
    const unmarked = weekly.filter((w) => w.supervisor_id === sup.id && w.status === "planned" && w.planned_date < now).length;
    if (unmarked >= 3) await notify(store, user.id, { type: "sup_unmarked", key: `unmarked:${sup.id}:${now}`, title: `${sup.name} has ${unmarked} coaching sessions not marked`, body: "Sessions from earlier this week are still “planned”.", link: { view: "sup-dash", params: { supervisor_id: sup.id } } });
    const overdue = commitments.filter((c) => c.supervisor_id === sup.id && c.follow_up_date && c.follow_up_date < now).length;
    if (overdue) await notify(store, user.id, { type: "sup_overdue", key: `overdue:${sup.id}:${week}`, title: `${sup.name}: ${overdue} Friday review${overdue > 1 ? "s" : ""} overdue`, body: "Commitments past their follow-up date without a result.", link: { view: "sup-dash", params: { supervisor_id: sup.id } } });
    const lc = leaderC.find((c) => c.supervisor_id === sup.id && c.week_start === week);
    if (lc && lc.status === "open" && lc.follow_up_date < now) await notify(store, user.id, { type: "leader_review_due", key: `leader-review:${lc.id}`, title: `Review ${first(sup.name)}’s commitment`, body: `“${lc.action}”`, link: { view: "leader", params: { id: sup.id } } });
    if (lc && !lc.sup_ack && addDays(lc.week_start, 1) < now) await notify(store, user.id, { type: "leader_not_ack", key: `leader-ack:${lc.id}`, title: `${first(sup.name)} hasn’t acknowledged this week’s commitment`, body: `“${lc.action}”`, link: { view: "leader", params: { id: sup.id } } });
    if (!lc && isoWeekdayOf(now) >= 3) await notify(store, user.id, { type: "leader_missing", key: `leader-missing:${sup.id}:${week}`, title: `No 1:1 with ${first(sup.name)} this week yet`, body: "Hold the DIRECT 1:1 and agree on a commitment.", link: { view: "leader", params: { id: sup.id } } });
  }
}
const isoWeekdayOf = (d) => { const x = new Date(d + "T12:00:00").getDay(); return x === 0 ? 7 : x; };

// ---------- manager → supervisor coaching (weekly 1:1 + Friday review) ----------
async function mustSeeSupervisor(user, store, supId) {
  const sup = await store.get("users", supId);
  if (!sup || sup.role !== "supervisor") throw new HttpError(404, "Supervisor not found.");
  if (user.role === "supervisor" ? sup.id !== user.id : sup.manager_id !== user.id) throw new HttpError(403, "That supervisor isn’t on your team.");
  return sup;
}
// Measured supervisor behaviors for the last `weeks` weeks (newest first).
async function supMetricsFor(store, sup, weeks = 5, from = weekStart()) {
  const agents = (await store.list("users", { role: "agent", supervisor_id: sup.id })).filter(active);
  const ids = agents.map((a) => a.id);
  const [weekly, commitments, coaching] = await Promise.all([store.list("weekly_sessions", { agent_id: ids }), store.list("commitments", { agent_id: ids }), store.list("coaching_sessions", { agent_id: ids })]);
  const mine = (r) => !r.supervisor_id || r.supervisor_id === sup.id;
  const w0 = from;
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(w0, -7 * i);
    return { week, metrics: S.supervisorMetrics({ weekly: weekly.filter(mine), commitments: commitments.filter(mine), coaching: coaching.filter(mine), week }) };
  });
}
async function leaderView(store, sup) {
  const [trend, sessions, commitments] = await Promise.all([supMetricsFor(store, sup), store.list("leader_sessions", { supervisor_id: sup.id }), store.list("leader_commitments", { supervisor_id: sup.id })]);
  const week = weekStart();
  sessions.sort((a, b) => (a.date < b.date ? 1 : -1)); commitments.sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
  // This week's commitment, or next week's when the 1:1 was held on the weekend.
  const current = commitments.find((c) => c.week_start === week) || commitments.find((c) => c.week_start > week) || null;
  const liveFor = current && current.week_start !== week ? (await supMetricsFor(store, sup, 1, current.week_start))[0].metrics : trend[0].metrics;
  const agents = (await store.list("users", { role: "agent", supervisor_id: sup.id })).filter(active).length;
  const [diags, agentCommitments, people] = await Promise.all([store.list("diagnoses", { supervisor_id: sup.id }), store.list("commitments", { supervisor_id: sup.id }), store.list("users", { role: "agent", supervisor_id: sup.id })]);
  diags.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const since = addDays(week, -7 * 8);
  const diagnosis = calibration(diags.filter((d) => d.week_start >= since), agentCommitments);
  diagnosis.recent = diagnosis.recent.map((r) => ({ ...r, agent_name: people.find((p) => p.id === r.agent_id)?.name || "" }));
  return {
    diagnosis,
    supervisor: { id: sup.id, name: sup.name, lob: sup.lob, email: sup.email, agents }, week, trend, metrics: trend[0].metrics, last_week: trend[1]?.metrics || null, suggested: S.suggestSupBehavior(trend[1]?.metrics || trend[0].metrics), // the Monday 1:1 looks at last week
    current: current ? { ...current, live: liveFor[current.behavior], smart: S.leaderSmartCheck(current) } : null,
    commitments: commitments.map((c) => ({ ...c, smart: S.leaderSmartCheck(c) })), sessions,
    draft: sessions.find((x) => x.status === "draft") || null,
  };
}
on("GET", "/api/leaders", ["manager"], async ({ user }, { store }) => {
  const { sups } = await managerTeam(user, store);
  const week = weekStart();
  const rows = [];
  for (const sup of sups) {
    const [trend, commitments, sessions] = await Promise.all([supMetricsFor(store, sup, 2), store.list("leader_commitments", { supervisor_id: sup.id }), store.list("leader_sessions", { supervisor_id: sup.id })]);
    const cur = commitments.find((c) => c.week_start === week) || commitments.find((c) => c.week_start > week) || null;
    const reviewed = commitments.filter((c) => c.status !== "open");
    rows.push({ id: sup.id, name: sup.name, lob: sup.lob, metrics: trend[0].metrics, last: trend[1].metrics, current: cur ? { ...cur, live: trend[0].metrics[cur.behavior] } : null,
      one_on_one: sessions.some((x) => x.status === "completed" && x.date >= week), met: reviewed.filter((c) => c.status === "met").length, reviewed: reviewed.length, weeks: commitments.length });
  }
  return { week, supervisors: rows };
});
on("GET", "/api/leaders/:id", ["manager", "supervisor"], async ({ user, params }, { store }) => leaderView(store, await mustSeeSupervisor(user, store, params.id)));
on("GET", "/api/my-coaching", ["supervisor"], async ({ user }, { store }) => leaderView(store, user));

on("POST", "/api/leader-sessions", ["manager"], async ({ user, body }, { store }) => {
  const sup = await mustSeeSupervisor(user, store, body.supervisor_id);
  const existing = (await store.list("leader_sessions", { supervisor_id: sup.id, status: "draft" }))[0];
  if (existing) return existing;
  const t = await supMetricsFor(store, sup, 2);
  const behavior = C.SUP_BEHAVIOR_BY_ID[body.behavior] ? body.behavior : S.suggestSupBehavior(t[1].metrics);
  const m = t[1].metrics[behavior];
  return store.insert("leader_sessions", { supervisor_id: sup.id, manager_id: user.id, date: body.date || today(), status: "draft", behavior, root_cause: null,
    evidence: `Last week in PULSE: ${m.text}${m.value != null ? ` (${m.value}%)` : ""}.`, metrics: { this_week: t[0].metrics, last_week: t[1].metrics }, notes: {} });
});
on("GET", "/api/leader-sessions/:id", ["manager", "supervisor"], async ({ user, params }, { store }) => {
  const s = await store.get("leader_sessions", params.id); if (!s) throw new HttpError(404, "Session not found.");
  const sup = await mustSeeSupervisor(user, store, s.supervisor_id);
  const commitment = (await store.list("leader_commitments", { session_id: s.id }))[0] || null;
  const last = (await store.list("leader_commitments", { supervisor_id: sup.id })).filter((c) => c.week_start < coachingWeek(s.date)).sort((a, b) => (a.week_start < b.week_start ? 1 : -1))[0] || null;
  return { session: s, supervisor: { id: sup.id, name: sup.name, lob: sup.lob }, commitment, last_commitment: last };
});
on("PATCH", "/api/leader-sessions/:id", ["manager"], async ({ user, params, body }, { store }) => {
  const s = await store.get("leader_sessions", params.id); if (!s) throw new HttpError(404, "Session not found.");
  await mustSeeSupervisor(user, store, s.supervisor_id);
  const allowed = ["date", "behavior", "root_cause", "evidence", "notes"];
  return store.update("leader_sessions", s.id, Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k))));
});
on("POST", "/api/leader-sessions/:id/complete", ["manager"], async ({ user, params, body }, { store }) => {
  const s = await store.get("leader_sessions", params.id); if (!s) throw new HttpError(404, "Session not found.");
  const sup = await mustSeeSupervisor(user, store, s.supervisor_id);
  const week = coachingWeek(s.date);
  if ((await store.list("leader_commitments", { supervisor_id: sup.id, week_start: week })).length) throw new HttpError(409, `${first(sup.name)} already has a commitment for that week. Review it on Friday or edit it.`);
  const c = { ...body.commitment, behavior: body.commitment?.behavior || s.behavior, root_cause: body.commitment?.root_cause || s.root_cause, evidence: s.evidence, session_id: s.id, week_start: week };
  if (!C.SUP_BEHAVIOR_BY_ID[c.behavior]) throw new HttpError(400, "Pick one of the six supervisor behaviors.");
  if (!C.ROOT_CAUSE_BY_ID[c.root_cause]) throw new HttpError(400, "Mark the root cause.");
  const check = S.leaderSmartCheck(c);
  if (!check.ok) throw new HttpError(422, "The commitment isn’t SMART yet: " + check.checks.filter((x) => !x.ok).map((x) => `${x.name} (${x.tip})`).join(" "));
  await store.update("leader_sessions", s.id, { status: "completed", behavior: c.behavior, root_cause: c.root_cause });
  const commitment = await store.insert("leader_commitments", {
    session_id: s.id, supervisor_id: sup.id, manager_id: user.id, behavior: c.behavior, root_cause: c.root_cause, week_start: week, action: String(c.action).trim(),
    measure_target: Math.round(Number(c.measure_target)), measure_total: 100, check_method: c.check_method, follow_up_date: c.follow_up_date, evidence: s.evidence,
    status: "open", result_value: null, sup_ack: false, sup_ack_at: null, review_notes: "",
  });
  await notify(store, sup.id, { type: "leader_session", title: `New 1:1 from ${first(user.name)}`, body: `Your commitment this week: “${commitment.action}” (target ${commitment.measure_target}%). Open My coaching to acknowledge it.`, link: { view: "my-coaching" } });
  return { commitment, smart: check };
});
on("POST", "/api/leader-commitments/:id/ack", ["supervisor"], async ({ user, params }, { store }) => {
  const c = await store.get("leader_commitments", params.id); if (!c || c.supervisor_id !== user.id) throw new HttpError(404, "Commitment not found.");
  const saved = await store.update("leader_commitments", c.id, { sup_ack: true, sup_ack_at: new Date().toISOString() });
  await notify(store, c.manager_id, { type: "leader_ack", title: `${user.name} acknowledged this week’s commitment`, body: `“${c.action}”`, link: { view: "leader", params: { id: user.id } } });
  return saved;
});
on("POST", "/api/leader-commitments/:id/review", ["manager"], async ({ user, params, body }, { store }) => {
  const c = await store.get("leader_commitments", params.id); if (!c) throw new HttpError(404, "Commitment not found.");
  const sup = await mustSeeSupervisor(user, store, c.supervisor_id);
  if (!["met", "partial", "not_met"].includes(body.status)) throw new HttpError(400, "Choose Met, Partially met or Not met.");
  const measured = (await supMetricsFor(store, sup, 1, c.week_start))[0].metrics[c.behavior]?.value ?? null;
  const saved = await store.update("leader_commitments", c.id, { status: body.status, result_value: body.result_value ?? measured, review_notes: String(body.review_notes || "") });
  const label = { met: "Met", partial: "Partially met", not_met: "Not met" }[body.status];
  await notify(store, sup.id, { type: "leader_review", title: `Your commitment was reviewed: ${label}`, body: `“${c.action}”${saved.result_value != null ? ` · measured ${Math.round(saved.result_value)}% (target ${c.measure_target}%)` : ""}${body.review_notes ? ` · ${body.review_notes}` : ""}`, link: { view: "my-coaching" } });
  return saved;
});

// ---------- sample data (placeholder numbers for the real roster) ----------
on("GET", "/api/sample", null, async ({ user }, { store }) => {
  const agents = await scopedAgents(user, store);
  const rows = agents.length ? await store.list("kpi_weekly", { agent_id: agents.map((a) => a.id), sample: true }) : [];
  return { on: rows.length > 0, rows: rows.length, agents: agents.length, can_toggle: user.role === "manager" };
});
on("POST", "/api/sample", ["manager"], async ({ user, body }, { store }) => {
  const { agents, sups } = await managerTeam(user, store);
  const team = { agents, sups, manager: user };
  if (!body.on) { await sampleOff(store, team); return { on: false }; }
  if (!agents.length) throw new HttpError(400, "There are no agents under you yet. Import the roster first.");
  const counts = await sampleOn(store, team, await store.list("kpi_goals"));
  return { on: true, counts };
});

// ---------- roster (EDB files) ----------
// The browser reads the .xlsx files and sends their sheets; the same parser runs in the CLI (npm run import-roster).
const rosterInput = (body) => {
  const files = (body.files || []).map((f) => ({ name: String(f.name || ""), sheets: (f.sheets || []).map((sh) => ({ name: String(sh.name || ""), rows: Array.isArray(sh.rows) ? sh.rows : [] })) }));
  if (!files.length) throw new HttpError(400, "Choose at least one roster file (.xlsx).");
  return parseRoster(files, { domain: body.domain || "pulse.com" });
};
on("POST", "/api/roster/preview", ["manager"], async ({ body }, { store }) => {
  const parsed = rosterInput(body);
  const plan = await applyRoster(store, parsed, { dryRun: true, removeDemo: !!body.remove_demo });
  return { stats: parsed.stats, issues: parsed.issues, tree: rosterTree(parsed.people), plan: plan.summary };
});
on("POST", "/api/roster/apply", ["manager"], async ({ body }, { store }) => {
  const parsed = rosterInput(body);
  const r = await applyRoster(store, parsed, { dryRun: false, removeDemo: !!body.remove_demo });
  return { stats: parsed.stats, plan: r.summary };
});

// ---------- DIRECT coaching sessions ----------
on("GET", "/api/sessions", ["manager", "supervisor"], async ({ user }, { store }) => {
  const agents = await scopedAgents(user, store);
  const where = user.role === "supervisor" ? { supervisor_id: user.id } : { agent_id: agents.map((a) => a.id) };
  const list = await store.list("coaching_sessions", where);
  return list.sort((a, b) => (a.date < b.date ? 1 : -1)).map((s) => ({ ...s, agent_name: agents.find((a) => a.id === s.agent_id)?.name }));
});
on("GET", "/api/sessions/:id", ["manager", "supervisor"], async ({ user, params }, { store }) => {
  const s = await store.get("coaching_sessions", params.id); if (!s) throw new HttpError(404, "Session not found.");
  const a = await mustSeeAgent(user, store, s.agent_id);
  const commitment = (await store.list("commitments", { session_id: s.id }))[0] || null;
  const weekly = commitment ? await store.list("weekly_sessions", { commitment_id: commitment.id }) : [];
  const last = (await store.list("commitments", { agent_id: a.id })).filter((c) => c.week_start < coachingWeek(s.date)).sort((x, y) => (x.week_start < y.week_start ? 1 : -1))[0] || null;
  return { session: s, agent: { id: a.id, name: a.name, lob: a.lob }, commitment, weekly, last_commitment: last };
});
on("POST", "/api/sessions", ["supervisor", "manager"], async ({ user, body }, { store }) => {
  const a = await mustSeeAgent(user, store, body.agent_id);
  if (body.behavior) mustUse(await bankFor(store, a), body.behavior);
  let ai = body.ai || null;
  const d = body.diagnosis_id ? await store.get("diagnoses", body.diagnosis_id) : null;
  if (d && d.agent_id === a.id) ai = { ...(ai || {}), listening: { calls: d.calls, lines: callLines(d.calls, (await bankFor(store, a)).all), tally: tallyCalls(d.calls, (await bankFor(store, a)).usable), sup_pick: d.sup_pick, sup_reason: d.sup_reason, ai_pick: d.ai_pick, final_pick: d.final_pick || d.sup_pick, final_reason: d.final_reason } };
  const s = await store.insert("coaching_sessions", { agent_id: a.id, supervisor_id: supervisorIdFor(user, a), date: body.date || today(), status: "draft", behavior: body.behavior || null, root_cause: body.root_cause || null, evidence: body.evidence || "", kpi_focus: body.kpi_focus || null, notes: body.notes || {}, ai });
  if (d && d.agent_id === a.id) await store.update("diagnoses", d.id, { session_id: s.id, ...(d.status === "final" ? {} : { status: "final", final_pick: body.behavior || d.sup_pick, final_reason: d.final_reason || d.sup_reason }) });
  return s;
});
on("PATCH", "/api/sessions/:id", ["supervisor", "manager"], async ({ user, params, body }, { store }) => {
  const s = await store.get("coaching_sessions", params.id); if (!s) throw new HttpError(404, "Session not found.");
  await mustSeeAgent(user, store, s.agent_id);
  const allowed = ["date", "behavior", "root_cause", "evidence", "kpi_focus", "notes", "ai"];
  return store.update("coaching_sessions", s.id, Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k))));
});
// Completing a session creates the SMART commitment and the week's four sessions.
on("POST", "/api/sessions/:id/complete", ["supervisor", "manager"], async ({ user, params, body }, { store }) => {
  const s = await store.get("coaching_sessions", params.id); if (!s) throw new HttpError(404, "Session not found.");
  const a = await mustSeeAgent(user, store, s.agent_id);
  const c = { ...body.commitment, behavior: body.commitment?.behavior || s.behavior, root_cause: body.commitment?.root_cause || s.root_cause, evidence: s.evidence, session_id: s.id, week_start: coachingWeek(s.date) };
  const bank = await bankFor(store, a);
  // Allowed: an active behavior for the agent's LOB, or the session's own behavior if it was retired since (same LOB rules).
  const inBank = bank.all.find((b) => b.id === c.behavior);
  const ok = bank.usable.some((b) => b.id === c.behavior) || (c.behavior === s.behavior && inBank && (!inBank.lobs?.length || inBank.lobs.includes(a.lob)));
  if (!c.behavior || !ok) throw new HttpError(400, "Pick one of your team’s behaviors.");
  if (!c.root_cause || !C.ROOT_CAUSE_BY_ID[c.root_cause]) throw new HttpError(400, "Mark the root cause.");
  const check = S.smartCheck(c);
  if (!check.ok && !body.force) throw new HttpError(422, "The commitment isn’t SMART yet: " + check.checks.filter((x) => !x.ok).map((x) => `${x.name} (${x.tip})`).join(" "));
  const missingNotes = C.DIRECT_STEPS.filter((d) => !(s.notes || {})[d.id]);
  await store.update("coaching_sessions", s.id, { status: "completed", behavior: c.behavior, root_cause: c.root_cause });
  const supId = supervisorIdFor(user, a);
  const commitment = await store.insert("commitments", {
    session_id: s.id, agent_id: a.id, supervisor_id: supId, behavior: c.behavior, root_cause: c.root_cause, week_start: c.week_start,
    action: c.action, measure_target: Number(c.measure_target), measure_total: Number(c.measure_total), check_method: c.check_method, follow_up_date: c.follow_up_date,
    evidence: s.evidence, status: "open", monitor_hits: null, monitor_total: null, self_hits: 0, agent_ack: false, agent_ack_at: null, review_notes: "",
  });
  const existing = (await store.list("weekly_sessions", { agent_id: a.id, week_start: c.week_start })).filter((e) => !e.sample); // never build real coaching on sample rows
  const planned = S.planWeek(commitment, supId).map((p) => {
    const ex = existing.find((e) => e.type === p.type);
    if (ex) return null; // keep sessions already planned
    if (p.type === "setting_goals") return { ...p, planned_date: c.week_start === weekStart(s.date) ? s.date : p.planned_date, status: "held", tool: (body.tools || {}).setting_goals || p.tool }; // this session is the Setting Goals session
    return { ...p, tool: (body.tools || {})[p.type] || p.tool };
  }).filter(Boolean);
  if (planned.length) await store.insertMany("weekly_sessions", planned);
  for (const ex of existing) if (!ex.commitment_id) await store.update("weekly_sessions", ex.id, { commitment_id: commitment.id });
  await notify(store, a.id, { type: "direct_session", title: `New DIRECT session from ${first(user.name)}`, body: `Your commitment this week: “${commitment.action}”. Open My week to acknowledge it.`, link: { view: "my-week" } });
  return { commitment, smart: check, missing_direct_notes: missingNotes.map((d) => d.name) };
});

// ---------- commitments ----------
on("GET", "/api/commitments", null, async ({ user, query }, { store }) => {
  const agents = user.role === "agent" ? [user] : await scopedAgents(user, store);
  const where = user.role === "agent" ? { agent_id: user.id } : user.role === "supervisor" ? { supervisor_id: user.id } : { agent_id: agents.map((a) => a.id) };
  if (query.week) where.week_start = query.week;
  const list = await store.list("commitments", where);
  return list.sort((a, b) => (a.week_start < b.week_start ? 1 : -1)).map((c) => ({ ...c, agent_name: agents.find((a) => a.id === c.agent_id)?.name, smart: S.smartCheck(c) }));
});
on("POST", "/api/commitments/smart-check", null, async ({ body }) => S.smartCheck(body));
on("PATCH", "/api/commitments/:id", ["supervisor", "manager"], async ({ user, params, body }, { store }) => {
  const c = await store.get("commitments", params.id); if (!c) throw new HttpError(404, "Commitment not found.");
  await mustSeeAgent(user, store, c.agent_id);
  const allowed = ["action", "measure_target", "measure_total", "check_method", "follow_up_date", "monitor_hits", "monitor_total", "behavior", "root_cause"];
  return store.update("commitments", c.id, Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k))));
});
on("POST", "/api/commitments/:id/ack", ["agent"], async ({ user, params }, { store }) => {
  const c = await store.get("commitments", params.id); if (!c || c.agent_id !== user.id) throw new HttpError(404, "Commitment not found.");
  return store.update("commitments", c.id, { agent_ack: true, agent_ack_at: new Date().toISOString() });
});
on("POST", "/api/commitments/:id/self-log", ["agent"], async ({ user, params, body }, { store }) => {
  const c = await store.get("commitments", params.id); if (!c || c.agent_id !== user.id) throw new HttpError(404, "Commitment not found.");
  return store.update("commitments", c.id, { self_hits: Math.max(0, (c.self_hits || 0) + (Number(body.delta) || 1)) });
});
on("POST", "/api/commitments/:id/review", ["supervisor", "manager"], async ({ user, params, body }, { store }) => {
  const c = await store.get("commitments", params.id); if (!c) throw new HttpError(404, "Commitment not found.");
  await mustSeeAgent(user, store, c.agent_id);
  if (!["met", "partial", "not_met"].includes(body.status)) throw new HttpError(400, "Choose Met, Partially met or Not met.");
  const ws = await store.list("weekly_sessions", { commitment_id: c.id });
  const monitor = ws.find((w) => w.type === "monitor");
  const warning = !monitor || monitor.status !== "held" ? "Monitor wasn’t marked as held, so this result has no call evidence." : null;
  const updated = await store.update("commitments", c.id, { status: body.status, monitor_hits: body.monitor_hits ?? c.monitor_hits, monitor_total: body.monitor_total ?? c.monitor_total ?? c.measure_total, review_notes: body.review_notes || "" });
  const kudos = ws.find((w) => w.type === "kudos_accountability");
  if (kudos && kudos.status !== "held") await store.update("weekly_sessions", kudos.id, { status: "held", planned_date: kudos.planned_date || today(), tool: body.tool || kudos.tool });
  const label = { met: "Met", partial: "Partially met", not_met: "Not met" }[body.status];
  await notify(store, c.agent_id, { type: "commitment_review", title: `Your commitment was reviewed: ${label}`, body: `“${c.action}”${updated.monitor_total ? ` · ${updated.monitor_hits} of ${updated.monitor_total} calls` : ""}${body.review_notes ? ` · ${body.review_notes}` : ""}`, link: { view: "my-progress" } });
  return { commitment: updated, warning };
});

// ---------- weekly sessions (the supervisor's commitment) ----------
on("GET", "/api/weekly", ["supervisor", "manager", "agent"], async ({ user, query }, { store }) => {
  const week = query.week || weekStart();
  const where = { week_start: week };
  if (user.role === "supervisor") where.supervisor_id = user.id;
  if (user.role === "agent") where.agent_id = user.id;
  if (user.role === "manager") { if (query.supervisor_id) where.supervisor_id = query.supervisor_id; where.agent_id = [...(await agentIdsFor(user, store))]; }
  const [list, agents, commitments] = await Promise.all([store.list("weekly_sessions", where), store.list("users", { role: "agent" }), store.list("commitments", { week_start: week })]);
  const sessions = list.map((s) => ({ ...s, agent_name: agents.find((a) => a.id === s.agent_id)?.name }));
  return { week, sessions, compliance: S.weeklyCompliance(list, commitments.filter((c) => list.some((s) => s.commitment_id === c.id) || c.supervisor_id === where.supervisor_id), week) };
});
on("POST", "/api/weekly", ["supervisor"], async ({ user, body }, { store }) => {
  const a = await mustSeeAgent(user, store, body.agent_id);
  if (!C.SESSION_TYPE_BY_ID[body.type]) throw new HttpError(400, "Unknown session type.");
  return store.insert("weekly_sessions", { supervisor_id: user.id, agent_id: a.id, commitment_id: body.commitment_id || null, week_start: weekStart(body.planned_date || today()), type: body.type, planned_date: body.planned_date, planned_time: body.planned_time || "", tool: body.tool || "", status: "planned", reason: "" });
});
on("PATCH", "/api/weekly/:id", ["supervisor"], async ({ user, params, body }, { store }) => {
  const w = await store.get("weekly_sessions", params.id); if (!w || w.supervisor_id !== user.id) throw new HttpError(404, "Session not found.");
  const allowed = ["planned_date", "planned_time", "tool", "status", "reason", "notes"];
  const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (patch.status && !["planned", "held", "rescheduled", "missed"].includes(patch.status)) throw new HttpError(400, "Unknown status.");
  if (patch.tool && !C.TOOL_NAMES.includes(patch.tool)) throw new HttpError(400, "Pick one of the 8 coaching tools.");
  if (patch.status === "missed" && !(patch.reason || w.reason)) throw new HttpError(400, "Add a reason for the missed session.");
  if (patch.planned_date) patch.week_start = weekStart(patch.planned_date);
  return store.update("weekly_sessions", w.id, patch);
});

// ---------- quizzes ----------
on("GET", "/api/quizzes", null, async ({ user }, { store }) => {
  const where = user.role === "agent" ? { agent_id: user.id } : user.role === "supervisor" ? { supervisor_id: user.id } : { agent_id: [...(await agentIdsFor(user, store))] };
  const [list, agents] = await Promise.all([store.list("quizzes", where), store.list("users", { role: "agent" })]);
  return list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((q) => {
    const out = { ...q, agent_name: agents.find((a) => a.id === q.agent_id)?.name };
    if (user.role === "agent" && q.status !== "completed") out.questions = q.questions.map(({ q: t, o }) => ({ q: t, o }));
    return out;
  });
});
on("POST", "/api/quizzes/:id/submit", ["agent"], async ({ user, params, body }, { store }) => {
  const q = await store.get("quizzes", params.id); if (!q || q.agent_id !== user.id) throw new HttpError(404, "Quiz not found.");
  if (q.status === "completed") throw new HttpError(409, "You already finished this quiz.");
  const answers = (body.answers || []).map(Number);
  const right = q.questions.filter((x, i) => answers[i] === x.a).length;
  const done = await store.update("quizzes", q.id, { answers, score: Math.round((right / q.questions.length) * 100), status: "completed", completed_at: new Date().toISOString() });
  await notify(store, q.supervisor_id, { type: "quiz_done", title: `${user.name} finished a quiz: ${done.score}%`, body: q.title, link: { view: "agent", params: { id: user.id } } });
  return done;
});

// ---------- AI ----------
async function aiContext(user, store, agentId) {
  const a = await mustSeeAgent(user, store, agentId);
  const { sums } = await summariesFor([a], store);
  const [verbatims, history] = await Promise.all([store.list("verbatims", { agent_id: a.id }), store.list("commitments", { agent_id: a.id })]);
  verbatims.sort((x, y) => (x.date < y.date ? 1 : -1)); history.sort((x, y) => (x.week_start < y.week_start ? 1 : -1));
  const bank = await bankFor(store, a);
  return { agent: a, summary: sums[0], verbatims: verbatims.filter((v) => v.date >= addDays(today(), -45)), history, behaviors: bank.usable, bank };
}
on("POST", "/api/ai/diagnose", ["supervisor", "manager"], async ({ user, body }, { store, ai }) => { const { bank, ...ctx } = await aiContext(user, store, body.agent_id); return AI.diagnose(ai, ctx); });
// ---------- behavior bank (managers edit; their supervisors and agents use it) ----------
on("GET", "/api/behaviors", null, async ({ user }, { store }) => {
  const managerId = await managerIdOf(store, user);
  const all = await bankOf(store, managerId);
  const manager = managerId && managerId !== user.id ? await store.get("users", managerId) : user.role === "manager" ? user : null;
  return { behaviors: all, editable: user.role === "manager", manager: manager ? { id: manager.id, name: manager.name } : null, lob: user.lob || null, max_active: MAX_ACTIVE };
});
async function ownBehavior(user, store, key) {
  await bankOf(store, user.id); // make sure the bank exists
  const row = (await store.list("behaviors", { manager_id: user.id, key }))[0];
  if (!row) throw new HttpError(404, "Behavior not found in your bank.");
  return row;
}
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
on("POST", "/api/behaviors", ["manager"], async ({ user, body }, { store }) => {
  const all = await bankOf(store, user.id);
  const { row, problem } = cleanBehavior(body);
  if (problem) throw new HttpError(400, problem);
  if (all.filter((b) => b.active).length >= MAX_ACTIVE) throw new HttpError(400, `Your bank already has ${MAX_ACTIVE} active behaviors. Retire one first: supervisors coach better with a short list.`);
  if (all.some((b) => b.active && sameName(b.name, row.name))) throw new HttpError(409, "There’s already a behavior with that name.");
  const saved = await store.insert("behaviors", { ...row, manager_id: user.id, key: newKey(row.name), active: true, position: Math.max(-1, ...all.map((b) => b.position)) + 1, ai_drafted: !!body.ai_drafted, updated_by: user.id });
  return normalize(saved);
});
on("PUT", "/api/behaviors/:key", ["manager"], async ({ user, params, body }, { store }) => {
  const current = await ownBehavior(user, store, params.key);
  const { row, problem } = cleanBehavior(body);
  if (problem) throw new HttpError(400, problem);
  const all = await bankOf(store, user.id);
  if (all.some((b) => b.active && b.id !== params.key && sameName(b.name, row.name))) throw new HttpError(409, "There’s already a behavior with that name.");
  return normalize(await store.update("behaviors", current.id, { ...row, ai_drafted: !!body.ai_drafted || current.ai_drafted, updated_by: user.id }));
});
// Retire (or bring back) a behavior. Retired ones disappear from pickers but stay in history.
on("POST", "/api/behaviors/:key/active", ["manager"], async ({ user, params, body }, { store }) => {
  const current = await ownBehavior(user, store, params.key);
  const all = await bankOf(store, user.id);
  const on_ = body.active !== false;
  if (!on_ && all.filter((b) => b.active && b.id !== params.key).length < 1) throw new HttpError(400, "Keep at least one active behavior.");
  if (on_ && all.filter((b) => b.active).length >= MAX_ACTIVE) throw new HttpError(400, `Your bank already has ${MAX_ACTIVE} active behaviors.`);
  return normalize(await store.update("behaviors", current.id, { active: on_, updated_by: user.id }));
});
on("POST", "/api/behaviors/order", ["manager"], async ({ user, body }, { store }) => {
  const rows = await store.list("behaviors", { manager_id: user.id });
  const keys = Array.isArray(body.keys) ? body.keys : [];
  for (const r of rows) { const i = keys.indexOf(r.key); if (i >= 0 && r.position !== i) await store.update("behaviors", r.id, { position: i }); }
  return bankOf(store, user.id);
});
// The AI drafts the fields from a name (and whatever the manager wrote). Nothing is saved.
on("POST", "/api/behaviors/suggest", ["manager"], async ({ user, body }, { store, ai }) => {
  const draft = body.draft || {};
  if (String(draft.name || "").trim().length < 2) throw new HttpError(400, "Write the behavior’s name first.");
  const all = await bankOf(store, user.id);
  return AI.suggestBehavior(ai, { draft, behaviors: all.filter((b) => b.active && b.id !== body.key) });
});

// ---------- supervisor-first diagnosis ----------
// 1) The supervisor marks what they heard on 3–5 calls and picks the behavior with a reason.
// 2) The AI decides from the data on its own and gives a second opinion on that pick.
// 3) The supervisor makes the final call (a reason is required to change their pick).
on("POST", "/api/diagnoses", ["supervisor", "manager"], async ({ user, body }, { store, ai }) => {
  const { bank, ...ctx } = await aiContext(user, store, body.agent_id);
  mustUse(bank, body.sup_pick, "Choose the behavior you would coach.");
  const reason = String(body.sup_reason || "").trim().slice(0, 1000);
  if (reason.length < 15) throw new HttpError(400, "Say in a sentence why: what you heard on the calls.");
  const { calls, problem } = cleanCalls(body.calls, bank.usable);
  if (problem) throw new HttpError(400, problem);
  const tally = tallyCalls(calls, bank.usable);
  const second = await AI.diagnose(ai, { ...ctx, supervisor: { pick: body.sup_pick, reason, calls: callLines(calls, bank.all), tally } });
  const { ranking, ...opinion } = second;
  const d = await store.insert("diagnoses", { supervisor_id: supervisorIdFor(user, ctx.agent), agent_id: ctx.agent.id, week_start: coachingWeek(today()), calls, evidence_top: tally.top, sup_pick: body.sup_pick, sup_reason: reason, ai_pick: second.behavior_id, ai: opinion, agrees: second.agrees_with_supervisor ?? null, final_pick: null, final_reason: null, status: "draft", session_id: null });
  return { ...d, tally };
});
async function mustSeeDiagnosis(user, store, id) {
  const d = await store.get("diagnoses", id); if (!d) throw new HttpError(404, "Diagnosis not found.");
  await mustSeeAgent(user, store, d.agent_id);
  return d;
}
on("POST", "/api/diagnoses/:id/final", ["supervisor", "manager"], async ({ user, params, body }, { store }) => {
  const d = await mustSeeDiagnosis(user, store, params.id);
  const bank = await bankFor(store, await store.get("users", d.agent_id));
  mustUse(bank, body.final_pick, "Choose the behavior you’ll coach.");
  const reason = String(body.final_reason || "").trim().slice(0, 1000);
  if (body.final_pick !== d.sup_pick && reason.length < 10) throw new HttpError(400, "You changed your pick: say what changed your mind.");
  return { ...(await store.update("diagnoses", d.id, { final_pick: body.final_pick, final_reason: reason || d.sup_reason, status: "final" })), tally: tallyCalls(d.calls, bank.usable) };
});
on("GET", "/api/diagnoses", ["supervisor", "manager"], async ({ user, query }, { store }) => {
  const ids = [...(await agentIdsFor(user, store))];
  const list = await store.list("diagnoses", { agent_id: query.agent_id && ids.includes(query.agent_id) ? query.agent_id : ids });
  const bank = await bankFor(store, user, null);
  return list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((d) => ({ ...d, tally: tallyCalls(d.calls, bank.all) }));
});
on("POST", "/api/ai/strategy", ["supervisor", "manager"], async ({ user, body }, { store, ai }) => {
  const { bank, ...ctx } = await aiContext(user, store, body.agent_id);
  mustUse(bank, body.behavior);
  return AI.strategy(ai, { ...ctx, behaviorId: body.behavior, rootCause: body.root_cause });
});
on("POST", "/api/ai/quiz", ["supervisor", "manager"], async ({ user, body }, { store, ai }) => {
  const { bank, ...ctx } = await aiContext(user, store, body.agent_id);
  mustUse(bank, body.behavior);
  const q = await AI.quiz(ai, { behaviors: ctx.behaviors, behaviorId: body.behavior, agent: ctx.agent, summary: ctx.summary, count: Math.min(8, Math.max(3, Number(body.count) || 5)), focus: body.focus });
  if (body.preview) return q;
  // Saving straight away (no review) keeps only questions with a known answer.
  const questions = q.questions.filter((x) => Number.isInteger(x.a)).map(({ ai_a, ...x }) => x);
  if (!questions.length) throw new HttpError(422, "The AI didn’t mark any right answers. Generate a preview and choose them yourself.");
  const saved = await store.insert("quizzes", { agent_id: ctx.agent.id, supervisor_id: supervisorIdFor(user, ctx.agent), behavior: body.behavior, title: q.title, questions, source: q.source, status: "assigned", answers: null, score: null });
  await notifyQuiz(store, user, saved);
  return saved;
});
// The supervisor reviews every question and picks the right answer before the quiz reaches the agent.
function cleanQuiz(body, bank) {
  const title = String(body.title || "").trim().slice(0, 120);
  if (!title) throw new HttpError(400, "Give the quiz a title.");
  mustUse(bank, body.behavior);
  const list = Array.isArray(body.questions) ? body.questions : [];
  if (!list.length || list.length > 10) throw new HttpError(400, "A quiz needs between 1 and 10 questions.");
  const questions = list.map((x, i) => {
    const n = i + 1;
    const q = String(x?.q || "").trim().slice(0, 500);
    const o = (Array.isArray(x?.o) ? x.o : []).map((t) => String(t ?? "").trim().slice(0, 300));
    if (!q) throw new HttpError(400, `Question ${n} has no text.`);
    if (o.length < 2 || o.length > 4 || o.some((t) => !t)) throw new HttpError(400, `Question ${n} needs 2 to 4 answer options, none of them empty.`);
    if (new Set(o.map((t) => t.toLowerCase())).size !== o.length) throw new HttpError(400, `Question ${n} has the same option twice.`);
    const a = x?.a == null || x.a === "" ? NaN : Number(x.a);
    if (!Number.isInteger(a) || a < 0 || a >= o.length) throw new HttpError(400, `Choose the right answer for question ${n}.`);
    return { q, o, a, why: String(x?.why || "").trim().slice(0, 400) };
  });
  return { title, questions };
}
on("POST", "/api/quizzes", ["supervisor", "manager"], async ({ user, body }, { store }) => {
  const a = await mustSeeAgent(user, store, body.agent_id);
  const { title, questions } = cleanQuiz(body, await bankFor(store, a));
  const saved = await store.insert("quizzes", { agent_id: a.id, supervisor_id: supervisorIdFor(user, a), behavior: body.behavior, title, questions, source: ["ai", "offline", "manual"].includes(body.source) ? body.source : "manual", status: "assigned", answers: null, score: null });
  await notifyQuiz(store, user, saved);
  return saved;
});
const notifyQuiz = (store, user, q) => notify(store, q.agent_id, { type: "quiz_assigned", title: `New quiz from ${first(user.name)}`, body: `${q.title} · ${q.questions.length} questions`, link: { view: "my-quizzes", params: { id: q.id } } });

// ---------- assigned roleplays ----------
on("POST", "/api/roleplay-assignments", ["supervisor", "manager"], async ({ user, body }, { store }) => {
  const a = await mustSeeAgent(user, store, body.agent_id);
  const channel = body.channel === "text" ? "text" : "voice";
  // A scenario the supervisor wrote or edited is used as is when the agent starts; otherwise one is generated then.
  const bank = await bankFor(store, a);
  let scenario = null;
  if (body.scenario) {
    const r = cleanScenario({ ...body.scenario, behavior: body.scenario.behavior || body.behavior }, { base: body.scenario.base || {}, channel, userId: user.id, behaviors: bank.usable });
    if (r.problem) throw new HttpError(400, r.problem);
    scenario = r.scenario;
  }
  const behavior = scenario?.behavior || body.behavior;
  mustUse(bank, behavior);
  const call = scenario ? scenario.call_type : C.CALL_TYPES.includes(body.call_type) ? body.call_type : C.CALL_TYPES[0];
  const difficulty = scenario?.difficulty || (["easy", "medium", "hard"].includes(body.difficulty) ? body.difficulty : "medium");
  const ra = await store.insert("roleplay_assignments", { agent_id: a.id, assigned_by: user.id, behavior, call_type: call, difficulty, channel, due_date: body.due_date || null, note: String(body.note || "").slice(0, 300), status: "assigned", scenario });
  await notify(store, a.id, { type: "roleplay_assigned", title: `${first(user.name)} assigned you a roleplay`, body: `${bank.BY[ra.behavior]?.name || ra.behavior} · ${ra.call_type}${ra.due_date ? ` · by ${new Date(`${ra.due_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : ""}${ra.note ? ` · “${ra.note}”` : ""}`, link: { view: "practice", params: { assignment: ra.id } } });
  return ra;
});
on("GET", "/api/roleplay-assignments", null, async ({ user, query }, { store }) => {
  const ids = user.role === "agent" ? [user.id] : [...(await agentIdsFor(user, store))];
  const where = { agent_id: query.agent_id && ids.includes(query.agent_id) ? query.agent_id : ids };
  const list = (await store.list("roleplay_assignments", where)).filter((r) => r.status !== "cancelled").sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  // Agents don't get the scenario in advance (it has the hidden need); they only see that their supervisor wrote it.
  return user.role === "agent" ? list.map(({ scenario, ...r }) => ({ ...r, custom: !!scenario })) : list.map((r) => ({ ...r, custom: !!r.scenario }));
});
on("DELETE", "/api/roleplay-assignments/:id", ["supervisor", "manager"], async ({ user, params }, { store }) => {
  const ra = await store.get("roleplay_assignments", params.id); if (!ra) throw new HttpError(404, "Assignment not found.");
  await mustSeeAgent(user, store, ra.agent_id);
  return store.update("roleplay_assignments", ra.id, { status: "cancelled" });
});

// A draft scenario for the supervisor to review and edit before starting or assigning it. Nothing is saved.
on("POST", "/api/ai/roleplay/scenario", ["supervisor", "manager"], async ({ user, body }, { store, ai }) => {
  const who = body.agent_id ? await mustSeeAgent(user, store, body.agent_id) : user;
  const bank = await bankFor(store, who);
  mustUse(bank, body.behavior);
  const channel = body.channel === "voice" ? "voice" : "text";
  return AI.roleplayStart(ai, { behaviorId: body.behavior, callType: body.call_type, difficulty: body.difficulty, channel, behaviors: bank.usable });
});
on("POST", "/api/ai/roleplay", null, async ({ user, body }, { store, ai }) => {
  let agentId = user.role === "agent" ? user.id : body.agent_id || null;
  const forAgent = agentId ? await mustSeeAgent(user, store, agentId) : null;
  const bank = await bankFor(store, forAgent || user);
  let channel = body.channel === "voice" ? "voice" : "text";
  let ra = null;
  if (body.assignment_id) { ra = await store.get("roleplay_assignments", body.assignment_id); if (!ra || ra.agent_id !== user.id || ra.status === "done" || ra.status === "cancelled") ra = null; }
  let scenario;
  if (ra?.scenario) scenario = { ...ra.scenario, channel: ra.scenario.channel === "voice" && channel === "voice" ? "voice" : "text" }; // the supervisor's own scenario
  else if (body.scenario && user.role !== "agent") {
    const r = cleanScenario({ ...body.scenario, behavior: body.scenario.behavior || body.behavior }, { base: body.scenario.base || {}, channel, userId: user.id, behaviors: bank.usable });
    if (r.problem) throw new HttpError(400, r.problem);
    scenario = r.scenario;
  } else {
    mustUse(bank, body.behavior);
    scenario = await AI.roleplayStart(ai, { behaviorId: body.behavior, callType: body.call_type, difficulty: body.difficulty, channel, behaviors: bank.usable });
  }
  const behavior = scenario.behavior || body.behavior;
  const now = new Date().toISOString();
  const rp = await store.insert("roleplays", { user_id: user.id, agent_id: agentId, behavior, scenario: ra ? { ...scenario, assignment_id: ra.id } : scenario, transcript: [{ who: "member", text: scenario.opening, mood: scenario.mood, at: now }], evaluation: null, status: "active" });
  if (ra) await store.update("roleplay_assignments", ra.id, { status: "started", roleplay_id: rp.id });
  return rp;
});
// ---------- practice log ----------
// Agents see their own practice; supervisors see their own and their agents'; managers see their team's.
async function practiceScope(user, store) {
  if (user.role === "agent") return { agents: new Set([user.id]), takers: new Set([user.id]) };
  const agents = await agentIdsFor(user, store);
  const takers = new Set([user.id]);
  if (user.role === "manager") (await managerTeam(user, store)).sups.forEach((x) => takers.add(x.id));
  return { agents, takers };
}
async function visiblePractice(user, store) {
  const { agents, takers } = await practiceScope(user, store);
  const [byAgent, byTaker] = await Promise.all([agents.size ? store.list("roleplays", { agent_id: [...agents] }) : [], store.list("roleplays", { user_id: [...takers] })]);
  const seen = new Map();
  for (const r of [...byAgent, ...byTaker]) if (!seen.has(r.id) && (user.role !== "agent" || r.agent_id === user.id || r.user_id === user.id)) seen.set(r.id, r);
  return [...seen.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
const nameMap = async (store) => Object.fromEntries((await store.list("users")).map((u) => [u.id, u.name]));
on("GET", "/api/roleplays", null, async ({ user }, { store }) => {
  const [list, names, bank] = await Promise.all([visiblePractice(user, store), nameMap(store), bankFor(store, user, null)]);
  return list.map((r) => practiceRow(r, names, bank.all));
});
async function mustSeePractice(user, store, id) {
  const rp = await store.get("roleplays", id);
  if (!rp) throw new HttpError(404, "Practice not found.");
  const { agents, takers } = await practiceScope(user, store);
  if (!(takers.has(rp.user_id) || (rp.agent_id && agents.has(rp.agent_id)))) throw new HttpError(404, "Practice not found.");
  return rp;
}
on("GET", "/api/roleplays/:id", null, async ({ user, params }, { store }) => {
  const rp = await mustSeePractice(user, store, params.id);
  const names = await nameMap(store);
  const bankAll = (await bankFor(store, rp.agent_id ? await store.get("users", rp.agent_id) : user, null)).all;
  const ra = rp.scenario?.assignment_id ? await store.get("roleplay_assignments", rp.scenario.assignment_id) : null;
  return {
    ...rp, ...practiceRow(rp, names, bankAll), transcript: undefined, evaluation: rp.evaluation, scenario: rp.scenario, facts: practiceFacts(rp, bankAll),
    coach_note_by_name: rp.coach_note_by ? names[rp.coach_note_by] || "" : "", edited_by_name: rp.scenario?.edited_by ? names[rp.scenario.edited_by] || "" : "",
    assignment: ra ? { id: ra.id, assigned_by: names[ra.assigned_by] || "", due_date: ra.due_date, note: ra.note, created_at: ra.created_at } : null,
    can_note: user.role !== "agent" && !!rp.agent_id,
  };
});
on("PUT", "/api/roleplays/:id/note", ["supervisor", "manager"], async ({ user, params, body }, { store }) => {
  const rp = await mustSeePractice(user, store, params.id);
  if (!rp.agent_id) throw new HttpError(400, "Notes are for an agent’s practice.");
  const note = String(body.note || "").trim().slice(0, 1000);
  const saved = await store.update("roleplays", rp.id, { coach_note: note || null, coach_note_by: note ? user.id : null, coach_note_at: note ? new Date().toISOString() : null });
  if (note && rp.agent_id !== user.id) await notify(store, rp.agent_id, { type: "roleplay_note", title: `${first(user.name)} left a note on your practice`, body: `${(await bankFor(store, user, null)).BY[rp.behavior]?.name || ""} · ${rp.scenario?.call_type || ""}`, link: { view: "practice-detail", params: { id: rp.id } } });
  return { ok: true, coach_note: saved.coach_note };
});
on("POST", "/api/ai/roleplay/:id/turn", null, async ({ user, params, body }, { store, ai }) => {
  const rp = await store.get("roleplays", params.id); if (!rp || rp.user_id !== user.id) throw new HttpError(404, "Roleplay not found.");
  if (rp.status !== "active") throw new HttpError(409, "This roleplay has ended.");
  const text = String(body.text || "").trim().slice(0, 1500); if (!text) throw new HttpError(400, "Say or type what you’d say to the member.");
  const voice = rp.scenario?.channel === "voice" ? cleanVoice(body.voice) : null;
  const transcript = [...rp.transcript, { who: "agent", text, ...(voice ? { voice } : {}), at: new Date().toISOString() }];
  const r = await AI.roleplayTurn(ai, { scenario: rp.scenario, transcript });
  const at = new Date().toISOString();
  transcript.push({ who: "member", text: r.reply, mood: r.mood, at, ...(r.ai_by ? { ai_by: r.ai_by } : {}) });
  return store.update("roleplays", rp.id, { transcript, mood: r.mood, status: r.end ? "ended" : "active", ...(r.end ? { ended_at: at } : {}) });
});
on("POST", "/api/ai/roleplay/:id/evaluate", null, async ({ user, params }, { store, ai }) => {
  const rp = await store.get("roleplays", params.id); if (!rp || rp.user_id !== user.id) throw new HttpError(404, "Roleplay not found.");
  const evalBank = await bankFor(store, rp.agent_id ? await store.get("users", rp.agent_id) : user, null);
  const evaluation = await AI.roleplayEvaluate(ai, { scenario: rp.scenario, transcript: rp.transcript, behaviors: evalBank.all.filter((b) => b.active || b.id === rp.behavior) });
  const saved = await store.update("roleplays", rp.id, { evaluation, status: "evaluated", ended_at: rp.ended_at || new Date().toISOString() });
  const raId = rp.scenario?.assignment_id;
  if (raId) {
    const ra = await store.get("roleplay_assignments", raId);
    if (ra && ra.status !== "done") {
      await store.update("roleplay_assignments", ra.id, { status: "done", score: evaluation.score, completed_at: new Date().toISOString(), roleplay_id: rp.id });
      await notify(store, ra.assigned_by, { type: "roleplay_done", title: `${user.name} finished the roleplay: ${evaluation.score}/5`, body: `${evalBank.BY[ra.behavior]?.name || ra.behavior} · ${ra.call_type}`, link: { view: "agent", params: { id: user.id } } });
    }
  }
  return saved;
});

on("POST", "/api/ai/review", ["supervisor", "manager"], async ({ user, body }, { store, ai }) => {
  const c = await store.get("commitments", body.commitment_id); if (!c) throw new HttpError(404, "Commitment not found.");
  const a = await mustSeeAgent(user, store, c.agent_id);
  return AI.review(ai, { agent: a, commitment: c, sessions: await store.list("weekly_sessions", { commitment_id: c.id }), behaviors: (await bankFor(store, a)).all });
});

// ---------- training library ----------
on("GET", "/api/training", null, async ({ user }, { store }) => {
  const mine = await store.list("training_completions", { user_id: user.id });
  return C.GUIDES.filter((g) => g.roles.includes(user.role)).map((g) => ({ ...g, completed_at: mine.find((m) => m.guide_id === g.id)?.completed_at || null }));
});
on("POST", "/api/training/:id/complete", null, async ({ user, params }, { store }) => {
  if (!C.GUIDES.some((g) => g.id === params.id)) throw new HttpError(404, "Guide not found.");
  const ex = await store.list("training_completions", { user_id: user.id, guide_id: params.id });
  if (ex.length) return ex[0];
  return store.insert("training_completions", { user_id: user.id, guide_id: params.id, completed_at: today() });
});
