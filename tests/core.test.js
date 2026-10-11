import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { smartCheck, weeklyCompliance } from "../web/core/services.js";
import { weekStart, addDays, parseCSV, redact } from "../web/core/util.js";
import { createApp } from "../backend/server.js";

const setup = () => {
  const store = createMemStore(buildSeed());
  const call = async (user, method, path, body, ai = null) => handle({ method, path, query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user }, { store, ai, demo: true });
  return { store, call };
};
const usersBy = async (store, role) => store.list("users", { role });

test("supervisor sees only their own agents", async () => {
  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agents = await call(sup, "GET", "/api/agents");
  assert.equal(agents.length, 5);
  assert.ok(agents.every((a) => a.supervisor_id === sup.id));
  const other = (await usersBy(store, "agent")).find((a) => a.supervisor_id !== sup.id);
  await assert.rejects(call(sup, "GET", `/api/agents/${other.id}`), /isn’t on your team/);
});

test("agents can't open supervisor routes", async () => {
  const { store, call } = setup();
  const [agent] = await usersBy(store, "agent");
  await assert.rejects(call(agent, "GET", "/api/agents"), /role/);
  const dash = await call(agent, "GET", "/api/dashboard/agent");
  assert.equal(dash.me.id, agent.id);
});

test("offline AI diagnosis picks one of the 7 behaviors with evidence", async () => {
  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[3];
  const d = await call(sup, "POST", "/api/ai/diagnose", { agent_id: agent.id });
  assert.equal(d.source, "offline");
  assert.ok(["lara", "ownership", "expectations", "needs", "warm", "appreciation", "empathy"].includes(d.behavior_id));
  assert.ok(d.evidence.length >= 1);
  assert.ok(d.listen_for.length >= 3);
});

test("AI provider output is used when valid, and falls back when it fails", async () => {
  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[0];
  const good = { generate: async () => JSON.stringify({ behavior_id: "empathy", confidence: "high", why: "x", evidence: ["a"], listen_for: ["b"], questions_to_ask: ["c"], root_cause_hypothesis: { id: "skill", why: "y" } }) };
  assert.equal((await call(sup, "POST", "/api/ai/diagnose", { agent_id: agent.id }, good)).source, "ai");
  const bad = { generate: async () => { throw new Error("429"); } };
  assert.equal((await call(sup, "POST", "/api/ai/diagnose", { agent_id: agent.id }, bad)).source, "offline");
  const junk = { generate: async () => JSON.stringify({ behavior_id: "not-a-behavior" }) };
  assert.equal((await call(sup, "POST", "/api/ai/diagnose", { agent_id: agent.id }, junk)).source, "offline");
});

test("SMART check rejects KPI results and accepts on-call actions", () => {
  const base = { behavior: "expectations", root_cause: "skill", measure_target: 5, measure_total: 5, check_method: "Remote Call Listening", week_start: "2026-10-05", follow_up_date: "2026-10-09", evidence: "3 of 5 calls" };
  assert.equal(smartCheck({ ...base, action: "Raise my CSAT to 90% this week please" }).ok, false);
  assert.equal(smartCheck({ ...base, action: "I'll try to be better on calls" }).ok, false);
  assert.equal(smartCheck({ ...base, action: "Before closing every billing call, I'll tell the member when the payment posts." }).ok, true);
  assert.equal(smartCheck({ ...base, action: "Before closing every billing call, I'll tell the member when the payment posts.", follow_up_date: "2026-10-30" }).ok, false);
});

test("full weekly cycle: DIRECT session -> SMART commitment -> 4 sessions -> agent ack -> Friday review", async () => {
  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[4]; // not in a cycle yet
  const monday = weekStart();
  const s = await call(sup, "POST", "/api/sessions", { agent_id: agent.id, date: monday, behavior: "ownership", root_cause: "will", evidence: "4 of 5 calls transferred" });
  await call(sup, "PATCH", `/api/sessions/${s.id}`, { notes: { D: "a", I: "b", R: "c", E: "d", C: "e", T: "f" } });
  await assert.rejects(call(sup, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "Improve my NPS", measure_target: 5, measure_total: 5, check_method: "RCL", follow_up_date: addDays(monday, 4) } }), /isn’t SMART/);
  const done = await call(sup, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "I will stay on the line during the claim check instead of transferring.", measure_target: 5, measure_total: 5, check_method: "Remote Call Listening, 5 calls Wed–Thu", follow_up_date: addDays(monday, 4) } });
  assert.equal(done.smart.ok, true);
  const weekly = await store.list("weekly_sessions", { commitment_id: done.commitment.id });
  assert.equal(weekly.length, 4);
  assert.equal(weekly.find((w) => w.type === "skill_transfer").tool, "Discuss"); // tool fits the Will root cause
  assert.equal(weekly.find((w) => w.type === "setting_goals").status, "held");
  const ack = await call(agent, "POST", `/api/commitments/${done.commitment.id}/ack`);
  assert.equal(ack.agent_ack, true);
  const monitor = weekly.find((w) => w.type === "monitor");
  await assert.rejects(call(sup, "PATCH", `/api/weekly/${monitor.id}`, { status: "missed" }), /reason/);
  await call(sup, "PATCH", `/api/weekly/${monitor.id}`, { status: "held" });
  const rev = await call(sup, "POST", `/api/commitments/${done.commitment.id}/review`, { status: "met", monitor_hits: 5, monitor_total: 5 });
  assert.equal(rev.commitment.status, "met");
  assert.equal(rev.warning, null);
  const kudos = (await store.list("weekly_sessions", { commitment_id: done.commitment.id })).find((w) => w.type === "kudos_accountability");
  assert.equal(kudos.status, "held");
});

test("compliance flags kudos without monitor and sessions outside their window", () => {
  const week = "2026-10-05";
  const sessions = [
    { agent_id: "a", week_start: week, type: "setting_goals", planned_date: "2026-10-05", status: "held" },
    { agent_id: "a", week_start: week, type: "skill_transfer", planned_date: "2026-10-08", status: "held" },
    { agent_id: "a", week_start: week, type: "monitor", planned_date: "2026-10-07", status: "missed", reason: "" },
    { agent_id: "a", week_start: week, type: "kudos_accountability", planned_date: "2026-10-09", status: "held" },
  ];
  const c = weeklyCompliance(sessions, [], week, "2026-10-10");
  const types = c.flags.map((f) => f.type);
  assert.ok(types.includes("wrong_window"));
  assert.ok(types.includes("kudos_without_monitor"));
  assert.ok(types.includes("missed"));
});

test("quiz generation, assignment and agent submission", async () => {
  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[1];
  const q = await call(sup, "POST", "/api/ai/quiz", { agent_id: agent.id, behavior: "lara", count: 5 });
  assert.equal(q.status, "assigned");
  const seen = (await call(agent, "GET", "/api/quizzes")).find((x) => x.id === q.id);
  assert.equal(seen.questions[0].a, undefined, "answers are hidden from the agent");
  const answers = q.questions.map((x) => x.a);
  const res = await call(agent, "POST", `/api/quizzes/${q.id}/submit`, { answers });
  assert.equal(res.score, 100);
});

test("roleplay runs turns and gets evaluated offline", async () => {
  const { store, call } = setup();
  const [agent] = await usersBy(store, "agent");
  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "expectations", call_type: "ID card" });
  assert.equal(rp.transcript[0].who, "member");
  const t1 = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "I'm sorry about that, I'll take care of it. Your new card ships today and arrives in 7 to 10 business days." });
  assert.equal(t1.transcript.length, 3);
  const ev = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`);
  assert.equal(ev.evaluation.behavior_seen, true);
});

test("manager dashboard rolls up supervisors, compliance and effectiveness", async () => {
  const { store, call } = setup();
  const [mgr] = await usersBy(store, "manager");
  const d = await call(mgr, "GET", "/api/dashboard/manager");
  assert.equal(d.supervisors.length, 4);
  assert.ok(d.supervisors.every((s) => s.compliance.planned > 0));
  assert.ok(d.effectiveness.agents > 0);
  assert.equal(d.behaviors.length, 7);
});

test("CSV upload maps rows to the right agents", async () => {
  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[0];
  const rows = parseCSV(`agent_email,week_start,nps,csat,fcr,aht,qa,surveys\n${agent.email},${weekStart()},44,93,94,560,95,12\nnobody@x.com,${weekStart()},1,1,1,1,1,1`);
  const r = await call(sup, "POST", "/api/upload/kpis", { rows });
  assert.equal(r.added + r.updated, 1);
  assert.equal(r.skipped.length, 1);
});

test("redact removes identifiers before text goes to the AI", () => {
  assert.equal(redact("call me at 809-555-1234 about claim 123456789 or a@b.com"), "call me at [phone] about claim [number] or [email]");
});

test("HTTP server: demo login and authenticated request", async () => {
  const { app, store } = createApp({ dataFile: null, ai: null, authMode: "demo", store: createMemStore(buildSeed()) });
  const server = app.listen(0); const port = server.address().port;
  try {
    const base = `http://127.0.0.1:${port}`;
    const [sup] = await usersBy(store, "supervisor");
    const { token } = await (await fetch(`${base}/api/auth/demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: sup.id }) })).json();
    const r = await fetch(`${base}/api/dashboard/supervisor`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.agents.length, 5);
    assert.equal((await fetch(`${base}/api/dashboard/supervisor`)).status, 401);
    assert.equal((await fetch(`${base}/api/dashboard/supervisor`, { headers: { Authorization: "Bearer forged.token.here" } })).status, 401);
  } finally { server.close(); }
});

test("Gemini client retries a busy model, then falls back to the next model", async () => {
  const { createGemini } = await import("../backend/ai/gemini.js");
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes("busy-model")) return { ok: false, status: 503, json: async () => ({ error: { message: "high demand" } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }) };
  };
  const g = createGemini({ apiKey: "k", model: "busy-model", fallbacks: ["backup-model"], retries: 1, fetchImpl: fake, log: {} });
  const out = await g.generate({ system: "s", messages: [{ role: "user", text: "hi" }] });
  assert.equal(out, '{"ok":true}');
  assert.equal(calls.filter((u) => u.includes("busy-model")).length, 2);
  assert.equal(g.stats.lastModel, "backup-model");
});

test("Gemini client sends a low thinking level and drops it if the model rejects it", async () => {
  const { createGemini } = await import("../backend/ai/gemini.js");
  const bodies = [];
  const fake = async (_url, opts) => {
    const b = JSON.parse(opts.body); bodies.push(b);
    if (b.generationConfig.thinkingConfig) return { ok: false, status: 400, json: async () => ({ error: { message: "thinkingLevel is not supported for this model" } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) };
  };
  const g = createGemini({ apiKey: "k", model: "m", fetchImpl: fake, log: {} });
  assert.equal(await g.generate({ system: "s", messages: [{ role: "user", text: "hi" }], fast: true }), "ok");
  assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
});

test("Supabase sign-in links the PULSE profile by Auth UID, using email only the first time", async () => {
  const { createAuth } = await import("../backend/auth.js");
  const store = createMemStore(buildSeed());
  const [mgr] = await store.list("users", { role: "manager" });
  let authUser = { id: "11111111-1111-1111-1111-111111111111", email: mgr.email.toUpperCase() };
  store.client = { auth: { getUser: async () => ({ data: { user: authUser }, error: null }) } };
  const auth = createAuth({ mode: "supabase", store });
  const req = { headers: { authorization: "Bearer t" } };
  const first = await auth(req);
  assert.equal(first.id, mgr.id);
  assert.equal((await store.get("users", mgr.id)).auth_user_id, authUser.id);
  authUser = { ...authUser, email: "new.address@company.com" }; // email changed in Supabase: still the same person
  assert.equal((await auth(req)).id, mgr.id);
  authUser = { id: "22222222-2222-2222-2222-222222222222", email: mgr.email }; // a different login with the same email can't take over
  assert.equal(await auth(req), null);
});

test("quiz review: the AI's answer is found by its text, and the supervisor must choose every answer", async () => {
  const { normalizeQuiz } = await import("../web/core/ai.js");
  let seed = 0; const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  // A small model said a: 0 but the answer text is the third option; letters and "B)" prefixes are handled too
  const qs = normalizeQuiz([
    { q: "Which line shows ownership?", o: ["It's in process.", "Hold on.", "I'll take care of this claim today.", "Call another department."], a: 0, answer: "I'll take care of this claim today" },
    { q: "Q2", o: ["A) one", "B) two", "C) three"], answer: "B" },
    { q: "Q3", o: ["x", "y"], answer: "something else entirely" },
    { q: "", o: ["a", "b"] },
  ], rand);
  assert.equal(qs.length, 3);
  assert.equal(qs[0].o[qs[0].a], "I'll take care of this claim today.");
  assert.equal(qs[0].ai_a, qs[0].a);
  assert.equal(qs[1].o[qs[1].a], "B) two");
  assert.equal(qs[2].a, null); // unknown: the supervisor picks it

  const { store, call } = setup();
  const [sup] = await usersBy(store, "supervisor");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[0];
  const base = { agent_id: agent.id, behavior: "ownership", title: "Ownership check", source: "ai" };
  await assert.rejects(call(sup, "POST", "/api/quizzes", { ...base, questions: [{ q: "Q", o: ["a", "b"], a: null }] }), /Choose the right answer for question 1/);
  await assert.rejects(call(sup, "POST", "/api/quizzes", { ...base, questions: [{ q: "Q", o: ["a", ""], a: 0 }] }), /none of them empty/);
  await assert.rejects(call(sup, "POST", "/api/quizzes", { ...base, title: " ", questions: [{ q: "Q", o: ["a", "b"], a: 0 }] }), /title/);
  const saved = await call(sup, "POST", "/api/quizzes", { ...base, questions: [{ q: " Edited question ", o: ["right one", "wrong one", "another"], a: 0, why: "because", ai_a: 2, junk: true }] });
  assert.deepEqual(saved.questions, [{ q: "Edited question", o: ["right one", "wrong one", "another"], a: 0, why: "because" }]);
  const res = await call(agent, "POST", `/api/quizzes/${saved.id}/submit`, { answers: [0] });
  assert.equal(res.score, 100);
});
