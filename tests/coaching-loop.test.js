import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { supervisorMetrics, leaderSmartCheck, suggestSupBehavior } from "../web/core/services.js";
import { SUP_BEHAVIORS } from "../web/core/constants.js";
import { weekStart, addDays, today, coachingWeek } from "../web/core/util.js";

const setup = async () => {
  const store = createMemStore(buildSeed());
  const call = async (user, method, path, body) => handle({ method, path: path.split("?")[0], query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user: await store.get("users", user.id) }, { store, ai: null, demo: true });
  const [mgr] = await store.list("users", { role: "manager" });
  const sups = await store.list("users", { role: "supervisor" });
  const sup = sups[0], other = sups[1];
  const agent = (await store.list("users", { role: "agent", supervisor_id: sup.id }))[3]; // not in the seeded coaching cycle
  return { store, call, mgr, sup, other, agent };
};
const unread = async (call, u) => (await call(u, "GET", "/api/notifications")).items.filter((n) => !n.read_at);

test("agents are notified of a DIRECT session, a quiz and a roleplay; supervisors get the results", async () => {
  const { call, sup, agent } = await setup();
  const s = await call(sup, "POST", "/api/sessions", { agent_id: agent.id, behavior: "empathy", root_cause: "skill", date: weekStart() });
  await call(sup, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "When a member is upset, I’ll acknowledge the feeling in one sentence before solving", measure_target: 4, measure_total: 5, check_method: "Remote Call Listening", follow_up_date: addDays(weekStart(), 4) }, force: true });
  const q = await call(sup, "POST", "/api/ai/quiz", { agent_id: agent.id, behavior: "empathy" });
  const ra = await call(sup, "POST", "/api/roleplay-assignments", { agent_id: agent.id, behavior: "empathy", call_type: "Claim denial", difficulty: "hard", channel: "voice", note: "Before Monitor" });
  const mine = await unread(call, agent);
  assert.deepEqual(mine.map((n) => n.type).sort(), ["direct_session", "quiz_assigned", "roleplay_assigned"]);
  assert.deepEqual(mine.find((n) => n.type === "roleplay_assigned").link, { view: "practice", params: { assignment: ra.id } });

  await call(agent, "POST", `/api/quizzes/${q.id}/submit`, { answers: q.questions.map((x) => x.a) });
  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "empathy", call_type: "Claim denial", channel: "voice", assignment_id: ra.id });
  assert.equal((await call(agent, "GET", "/api/roleplay-assignments"))[0].status, "started");
  await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "I’m so sorry, I understand how stressful that is. Let me check the denial for you." });
  const ev = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`);
  const done = (await call(sup, "GET", `/api/roleplay-assignments?agent_id=${agent.id}`))[0];
  assert.equal(done.status, "done"); assert.equal(done.score, ev.evaluation.score);
  const supN = await unread(call, sup);
  assert.ok(supN.some((n) => n.type === "quiz_done" && /100%/.test(n.title)));
  assert.ok(supN.some((n) => n.type === "roleplay_done"));

  // Marking read
  await call(agent, "POST", "/api/notifications/read", { all: true });
  assert.equal((await call(agent, "GET", "/api/notifications")).unread, 0);
});

test("an agent can't use someone else's assignment, and other teams can't assign", async () => {
  const { store, call, sup, other, agent } = await setup();
  const ra = await call(sup, "POST", "/api/roleplay-assignments", { agent_id: agent.id, behavior: "lara" });
  const otherAgent = (await store.list("users", { role: "agent", supervisor_id: other.id }))[0];
  await call(otherAgent, "POST", "/api/ai/roleplay", { behavior: "lara", assignment_id: ra.id });
  assert.equal((await store.get("roleplay_assignments", ra.id)).status, "assigned");
  await assert.rejects(call(other, "POST", "/api/roleplay-assignments", { agent_id: agent.id, behavior: "lara" }), /isn’t on your team/);
});

test("supervisor behaviors are measured from coaching data", () => {
  const week = "2026-10-05", now = "2026-10-10";
  const weekly = [
    { week_start: week, agent_id: "a", commitment_id: "c1", type: "setting_goals", planned_date: "2026-10-05", status: "held", tool: "Self Tape" },
    { week_start: week, agent_id: "a", commitment_id: "c1", type: "monitor", planned_date: "2026-10-07", status: "held", tool: "SBS" },
    { week_start: week, agent_id: "a", commitment_id: "c1", type: "skill_transfer", planned_date: "2026-10-06", status: "planned", tool: "Discuss" },
  ];
  const notes = { D: "rapport ok", I: "focus set", R: "recognized", E: "asked", C: "skill gap", T: "agreed plan" };
  const coaching = [{ status: "completed", date: "2026-10-05", notes }, { status: "completed", date: "2026-10-06", notes: { D: "hi" } }];
  const commitments = [
    { id: "c1", agent_id: "a", week_start: week, behavior: "empathy", root_cause: "skill", action: "When a member is upset, I’ll acknowledge the feeling first", measure_target: 4, measure_total: 5, check_method: "SBS", follow_up_date: "2026-10-09", evidence: "x", agent_ack: true, status: "met" },
    { id: "p1", agent_id: "a", week_start: "2026-09-28", root_cause: "will", behavior: "empathy", status: "not_met" },
    { id: "p2", agent_id: "a", week_start: "2026-09-21", root_cause: "will", behavior: "empathy", status: "not_met" },
  ];
  const m = supervisorMetrics({ weekly, commitments, coaching, week, now });
  assert.equal(m.rhythm.value, 67);        // 2 of 3 due were held
  assert.equal(m.direct.value, 50);        // 1 of 2 sessions has all six steps
  assert.equal(m.smart.value, 100);
  assert.equal(m.root_cause.value, 100);   // missed twice under "will", re-diagnosed as "skill"
  assert.equal(m.tool.value, 67);          // Discuss doesn't fit Skill for skill transfer
  assert.equal(m.followup.value, 100);
  assert.equal(suggestSupBehavior(m), "direct");
  for (const b of SUP_BEHAVIORS) for (const action of b.actions) assert.ok(leaderSmartCheck({ behavior: b.id, root_cause: "skill", action, measure_target: 90, measure_total: 100, check_method: "PULSE", follow_up_date: "2026-10-09", week_start: week, evidence: "x" }).ok, action);
});

test("manager 1:1 with a supervisor: DIRECT session, SMART commitment, acknowledgment and Friday review", async () => {
  const { store, call, mgr, sup, other } = await setup();
  const list = await call(mgr, "GET", "/api/leaders");
  assert.equal(list.supervisors.length, 4);
  assert.ok(list.supervisors[0].metrics.rhythm);
  const s = await call(mgr, "POST", "/api/leader-sessions", { supervisor_id: sup.id });
  assert.ok(s.behavior && s.evidence.startsWith("Last week in PULSE"));
  assert.equal((await call(mgr, "POST", "/api/leader-sessions", { supervisor_id: sup.id })).id, s.id); // reuses the draft
  await call(mgr, "PATCH", `/api/leader-sessions/${s.id}`, { root_cause: "will", notes: { D: "Check-in", I: "Focus", R: "Kudos", E: "Asked", C: "Will", T: "Agreed" } });
  const bad = { behavior: "rhythm", action: "be better", measure_target: 100, check_method: "PULSE", follow_up_date: addDays(coachingWeek(today()), 4) }; // a weekend 1:1 sets up next week
  await assert.rejects(call(mgr, "POST", `/api/leader-sessions/${s.id}/complete`, { commitment: bad }), /isn’t SMART/);
  const good = { ...bad, action: "I’ll hold Monitor for every agent by Thursday and mark it the same day" };
  const { commitment } = await call(mgr, "POST", `/api/leader-sessions/${s.id}/complete`, { commitment: good });
  assert.equal(commitment.measure_target, 100);
  await assert.rejects(call(mgr, "POST", `/api/leader-sessions/${(await call(mgr, "POST", "/api/leader-sessions", { supervisor_id: sup.id })).id}/complete`, { commitment: good }), /already has a commitment/);

  const my = await call(sup, "GET", "/api/my-coaching");
  assert.equal(my.current.id, commitment.id);
  assert.ok(my.current.live);
  assert.ok((await unread(call, sup)).some((n) => n.type === "leader_session"));
  await call(sup, "POST", `/api/leader-commitments/${commitment.id}/ack`);
  assert.ok((await unread(call, mgr)).some((n) => n.type === "leader_ack"));
  const r = await call(mgr, "POST", `/api/leader-commitments/${commitment.id}/review`, { status: "partial", review_notes: "Close" });
  assert.equal(r.status, "partial"); assert.ok("result_value" in r);
  assert.ok((await unread(call, sup)).some((n) => n.type === "leader_review"));

  await assert.rejects(call(other, "GET", `/api/leaders/${sup.id}`), /isn’t on your team/);   // a supervisor sees only their own page
  const mgr2 = await store.insert("users", { name: "Other Manager", email: "om@pulse.demo", role: "manager", lob: "All" });
  await assert.rejects(call(mgr2, "GET", `/api/leaders/${sup.id}`), /isn’t on your team/);
});

test("manager reminders: unmarked sessions and missing 1:1s, without repeating", async () => {
  const { store, call, mgr, sup } = await setup();
  const agents = await store.list("users", { role: "agent", supervisor_id: sup.id });
  const yesterday = addDays(today(), -1);
  for (const a of agents.slice(0, 3)) await store.insert("weekly_sessions", { supervisor_id: sup.id, agent_id: a.id, week_start: weekStart(), type: "monitor", planned_date: yesterday < weekStart() ? weekStart() : yesterday, status: "planned" });
  const n = await call(mgr, "GET", "/api/notifications");
  const types = n.items.map((x) => x.type);
  if (yesterday >= weekStart()) assert.ok(types.includes("sup_unmarked"));
  const before = n.items.length;
  assert.equal((await call(mgr, "GET", "/api/notifications")).items.length, before); // no repeats
});
