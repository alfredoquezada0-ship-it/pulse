import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { quiz } from "../web/core/ai.js";

const setup = () => {
  const seed = buildSeed(); seed.roleplays = []; // start each test with an empty log
  const store = createMemStore(seed);
  const call = async (user, method, path, body, ai = null) => handle({ method, path, query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user }, { store, ai, demo: true });
  return { store, call };
};
const people = async (store) => {
  const sups = await store.list("users", { role: "supervisor" });
  const sup = sups[0], other = sups.find((x) => x.id !== sup.id);
  const agent = (await store.list("users", { supervisor_id: sup.id }))[0];
  const manager = (await store.list("users", { role: "manager" }))[0];
  return { sup, other, agent, manager };
};

test("practice log: the agent's call is logged turn by turn and the right people can see it", async () => {
  const { store, call } = setup();
  const { sup, other, agent, manager } = await people(store);
  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "expectations", call_type: "ID card", difficulty: "medium", channel: "voice" });
  await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "I'm sorry about that. Let me take care of it: you'll get the new card in 7 to 10 business days.", voice: { speak_ms: 6000, delay_ms: 5200 } });
  await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "Is there anything else coming up, like an appointment?", voice: { speak_ms: 3000, delay_ms: 900, interrupted: true } });
  await call(agent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`);

  const mine = await call(agent, "GET", "/api/roleplays");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].transcript, undefined, "the list is light: no transcript");
  assert.equal(mine[0].turns, 2);
  for (const who of [sup, manager]) assert.ok((await call(who, "GET", "/api/roleplays")).some((r) => r.id === rp.id), `${who.role} sees the agent's practice`);
  assert.ok(!(await call(other, "GET", "/api/roleplays")).some((r) => r.id === rp.id), "another supervisor doesn't");
  await assert.rejects(call(other, "GET", `/api/roleplays/${rp.id}`), /not found/);

  const d = await call(sup, "GET", `/api/roleplays/${rp.id}`);
  assert.equal(d.facts.timeline.length, 5);
  assert.ok(d.facts.timeline.every((m) => m.at), "every line has a time");
  assert.equal(d.facts.timeline[1].voice.delay_ms, 5200);
  assert.equal(d.facts.delivery.dead_air, 1);
  assert.equal(d.facts.delivery.interruptions, 1);
  assert.equal(d.facts.asked_other_needs, true);
  assert.ok(d.ended_at && d.facts.duration_s != null);
  assert.equal(d.can_note, true);

  await assert.rejects(call(agent, "PUT", `/api/roleplays/${rp.id}/note`, { note: "self" }), /role/);
  await call(sup, "PUT", `/api/roleplays/${rp.id}/note`, { note: "Give the date first, then the reference number." });
  const seen = await call(agent, "GET", `/api/roleplays/${rp.id}`);
  assert.equal(seen.coach_note, "Give the date first, then the reference number.");
  assert.equal(seen.can_note, false);
  assert.ok((await store.list("notifications", { user_id: agent.id })).some((n) => n.type === "roleplay_note"));
});

test("scenario editor: the supervisor's edited scenario is what the agent practices and is scored on", async () => {
  const { store, call } = setup();
  const { sup, agent } = await people(store);
  const draft = await call(sup, "POST", "/api/ai/roleplay/scenario", { behavior: "ownership", call_type: "Claim status", channel: "voice" });
  assert.ok(draft.member_name && draft.opening);
  assert.equal((await store.list("roleplays")).length, 0, "a draft saves nothing");
  await assert.rejects(call(agent, "POST", "/api/ai/roleplay/scenario", { behavior: "ownership" }), /role/);

  const edited = { ...draft, behavior: "needs", member_name: "Dolores Ruiz", member_age: 81, mood: "worried", call_type: "Pharmacy refill", situation: "Member’s pharmacy says the refill needs prior authorization.", opening: "*sighs* The pharmacy won’t give me my pills.", hidden_need: "She is traveling next week.", member_notes: "Hard of hearing: asks the agent to repeat once.", success_criteria: ["Ask what else is coming up before closing", "Explain prior authorization in plain words", ""], base: { source: draft.source } };
  await assert.rejects(call(sup, "POST", "/api/roleplay-assignments", { agent_id: agent.id, channel: "voice", scenario: { ...edited, success_criteria: [] } }), /at least one/);
  await assert.rejects(call(sup, "POST", "/api/roleplay-assignments", { agent_id: agent.id, channel: "voice", scenario: { ...edited, member_age: 12 } }), /age/);
  const ra = await call(sup, "POST", "/api/roleplay-assignments", { agent_id: agent.id, channel: "voice", due_date: "2026-10-20", scenario: edited });
  assert.equal(ra.behavior, "needs");
  assert.equal(ra.call_type, "Pharmacy refill");

  const forAgent = (await call(agent, "GET", "/api/roleplay-assignments")).find((x) => x.id === ra.id);
  assert.equal(forAgent.scenario, undefined, "the agent doesn't get the hidden need in advance");
  assert.equal(forAgent.custom, true);

  const rp = await call(agent, "POST", "/api/ai/roleplay", { behavior: "expectations", assignment_id: ra.id, channel: "voice" });
  assert.equal(rp.behavior, "needs");
  assert.equal(rp.scenario.member_name, "Dolores Ruiz");
  assert.equal(rp.scenario.opening, "The pharmacy won’t give me my pills.", "stage directions are removed for the voice");
  assert.deepEqual(rp.scenario.success_criteria, ["Ask what else is coming up before closing", "Explain prior authorization in plain words"]);
  assert.equal(rp.scenario.edited, true);
  // Offline, the member still brings up the supervisor's hidden need when asked
  const t = await call(agent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "Is there anything else coming up?" });
  assert.match(t.transcript.at(-1).text, /traveling next week/);

  // The supervisor can also start a call right away with an edited scenario; agents can't send their own
  const own = await call(sup, "POST", "/api/ai/roleplay", { channel: "text", scenario: edited });
  assert.equal(own.scenario.member_name, "Dolores Ruiz");
  const agentTry = await call(agent, "POST", "/api/ai/roleplay", { behavior: "warm", channel: "text", scenario: edited });
  assert.notEqual(agentTry.scenario.member_name, "Dolores Ruiz");
});

test("quiz: the focus box leads the prompt", async () => {
  let prompt = "";
  const fake = { name: "groq", model: "m", async generate(req) { prompt = req.messages.at(-1).text; return JSON.stringify({ title: "Timelines on claim-status calls", questions: [{ q: "Q", o: ["a", "b"], answer: "a", why: "" }] }); } };
  const q = await quiz(fake, { behaviorId: "expectations", agent: { name: "Ana P", lob: "BVA" }, focus: "giving timelines on claim-status calls" });
  assert.match(prompt, /THE SUPERVISOR'S FOCUS[^\n]*giving timelines on claim-status calls/);
  assert.match(prompt, /Every question must test this focus/);
  assert.equal(q.focus, "giving timelines on claim-status calls");
  const off = await quiz(null, { behaviorId: "expectations", agent: { name: "Ana P", lob: "BVA" }, focus: "x" });
  assert.equal(off.focus_used, false);
});
