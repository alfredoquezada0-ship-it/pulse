import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { cleanBehavior, forLob, normalize, behaviorContext } from "../web/core/bank.js";
import { evaluateOffline } from "../web/core/ai.js";

const setup = () => {
  const store = createMemStore(buildSeed());
  const call = async (user, method, path, body, ai = null) => handle({ method, path, query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user }, { store, ai, demo: true });
  return { store, call };
};
const WARM_TRANSFER = {
  name: "Warm Transfer", desc: "When a transfer is needed, stay on the line and hand the member over with a full summary.", lobs: ["BVA"], when: ["hold"],
  how: ["Tell the member why the transfer helps and who they’ll talk to.", "Stay on the line and give the next agent the full summary.", "Introduce the member by name before you drop off."],
  sounds: ["I’m going to stay on the line and introduce you, so you won’t have to repeat anything."], avoid: ["Cold transfers"], driver: "Being bounced around and repeating the story.",
  kpis: ["fcr", "nps"], keywords: ["transferred", "bounced"], actions: ["Stay on the line for every transfer and give the summary myself."], listen_for: ["No cold transfer", "The member never repeats the story"],
};

test("bank validation keeps it usable", () => {
  assert.match(cleanBehavior({ name: "X" }).problem, /name/);
  assert.match(cleanBehavior({ ...WARM_TRANSFER, how: [] }).problem, /step/);
  assert.match(cleanBehavior({ ...WARM_TRANSFER, kpis: ["bogus"] }).problem, /KPI/);
  const { row } = cleanBehavior({ ...WARM_TRANSFER, how: "1. First step\n- Second step\n\n", lobs: ["BVA", "Nope"] });
  assert.deepEqual(row.how, ["First step", "Second step"]);
  assert.deepEqual(row.lobs, ["BVA"]);
  const b = normalize({ ...row, key: "warm-transfer-x1", id: "uuid" });
  assert.equal(b.id, "warm-transfer-x1");
  assert.equal(b.desc, WARM_TRANSFER.desc);
  assert.match(behaviorContext(b), /How the manager wants it done on the call \(Holds and transfers\): 1\) First step 2\) Second step/);
  assert.deepEqual(forLob([b], "NPG"), []);
  assert.equal(forLob([b], "BVA").length, 1);
});

test("the manager owns the bank; supervisors and agents use it, filtered by LOB", async () => {
  const { store, call } = setup();
  const manager = (await store.list("users", { role: "manager" }))[0];
  const sups = await store.list("users", { role: "supervisor" });
  const bvaSup = sups.find((s) => s.lob === "BVA"), npgSup = sups.find((s) => s.lob === "NPG");
  const bvaAgent = (await store.list("users", { supervisor_id: bvaSup.id }))[0], npgAgent = (await store.list("users", { supervisor_id: npgSup.id }))[0];

  const first = await call(manager, "GET", "/api/behaviors");
  assert.equal(first.editable, true);
  assert.equal(first.behaviors.length, 7, "starts as a copy of the 7");
  assert.ok(first.behaviors[0].how.length, "with how-to steps");
  assert.equal((await store.list("behaviors", { manager_id: manager.id })).length, 7);
  const supView = await call(bvaSup, "GET", "/api/behaviors");
  assert.equal(supView.editable, false);
  assert.equal(supView.manager.name, manager.name);
  await assert.rejects(call(bvaSup, "POST", "/api/behaviors", WARM_TRANSFER), /role/);
  await assert.rejects(call(bvaAgent, "PUT", "/api/behaviors/lara", WARM_TRANSFER), /role/);

  const wt = await call(manager, "POST", "/api/behaviors", WARM_TRANSFER);
  assert.match(wt.id, /^warm-transfer-/);
  await assert.rejects(call(manager, "POST", "/api/behaviors", WARM_TRANSFER), /already/);

  // A BVA agent can be coached on it; an NPG agent can't
  const s = await call(bvaSup, "POST", "/api/sessions", { agent_id: bvaAgent.id, behavior: wt.id, root_cause: "skill" });
  const done = await call(bvaSup, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "I will stay on the line for every transfer and give the summary myself, on 4 of 5 calls", measure_target: 4, measure_total: 5, check_method: "Remote Call Listening", follow_up_date: "2026-12-31" }, force: true });
  assert.ok(done);
  await assert.rejects(call(npgSup, "POST", "/api/sessions", { agent_id: npgAgent.id, behavior: wt.id, root_cause: "skill" }), /your team’s behaviors/);
  const s2 = await call(npgSup, "POST", "/api/sessions", { agent_id: npgAgent.id, behavior: "lara", root_cause: "skill" });
  await assert.rejects(call(npgSup, "POST", `/api/sessions/${s2.id}/complete`, { commitment: { behavior: wt.id, action: "I will do it", measure_target: 4, measure_total: 5, check_method: "x", follow_up_date: "2026-12-31" }, force: true }), /your team’s behaviors/);
  const calls = [1, 2, 3].map((i) => ({ label: `Call ${i}`, marks: { [wt.id]: "missed" } }));
  const dx = await call(bvaSup, "POST", "/api/diagnoses", { agent_id: bvaAgent.id, calls, sup_pick: wt.id, sup_reason: "Two cold transfers out of three calls this week." });
  assert.equal(dx.evidence_top, wt.id);
  await assert.rejects(call(npgSup, "POST", "/api/diagnoses", { agent_id: npgAgent.id, calls, sup_pick: wt.id, sup_reason: "Two cold transfers out of three calls this week." }), /behavior you would coach/);

  // Roleplay on it: offline scenario uses the manager's listen-for list, scoring hears the manager's example line
  const rp = await call(bvaAgent, "POST", "/api/ai/roleplay", { behavior: wt.id, call_type: "Claim status", channel: "text" });
  assert.deepEqual(rp.scenario.success_criteria, WARM_TRANSFER.listen_for);
  await call(bvaAgent, "POST", `/api/ai/roleplay/${rp.id}/turn`, { text: "I’m going to stay on the line and introduce you, so you won’t have to repeat anything." });
  const ev = await call(bvaAgent, "POST", `/api/ai/roleplay/${rp.id}/evaluate`);
  assert.equal(ev.evaluation.behavior_seen, true);

  // Edit, reorder, retire: retired behaviors leave the pickers but keep their name in history
  const edited = await call(manager, "PUT", `/api/behaviors/${wt.id}`, { ...WARM_TRANSFER, name: "Warm Transfer (BVA)" });
  assert.equal(edited.name, "Warm Transfer (BVA)");
  await call(manager, "POST", `/api/behaviors/${wt.id}/active`, { active: false });
  const after = await call(bvaSup, "GET", "/api/behaviors");
  assert.equal(after.behaviors.find((b) => b.id === wt.id).active, false);
  const log = await call(bvaSup, "GET", "/api/roleplays");
  assert.ok(log.some((r) => r.behavior_name === "Warm Transfer (BVA)"), "history keeps the name");
  await assert.rejects(call(bvaSup, "POST", "/api/ai/roleplay", { agent_id: bvaAgent.id, behavior: wt.id, channel: "text" }), /your team’s behaviors/);
  const keys = (await call(manager, "GET", "/api/behaviors")).behaviors.filter((b) => b.active).map((b) => b.id).reverse();
  const ordered = await call(manager, "POST", "/api/behaviors/order", { keys });
  assert.equal(ordered.filter((b) => b.active)[0].id, keys[0]);
  for (const k of keys.slice(1)) await call(manager, "POST", `/api/behaviors/${k}/active`, { active: false });
  await assert.rejects(call(manager, "POST", `/api/behaviors/${keys[0]}/active`, { active: false }), /at least one/);

  // Another manager's team never sees this bank
  const other = await store.insert("users", { name: "Pat Lopez", email: "pat@pulse.demo", role: "manager", lob: "All" });
  const otherBank = await call(other, "GET", "/api/behaviors");
  assert.equal(otherBank.behaviors.length, 7);
  assert.ok(!otherBank.behaviors.some((b) => b.id === wt.id));
});

test("the AI gets the manager's standard; suggestions work offline", async () => {
  const { store, call } = setup();
  const manager = (await store.list("users", { role: "manager" }))[0];
  const sup = (await store.list("users", { role: "supervisor" })).find((s) => s.lob === "BVA");
  const agent = (await store.list("users", { supervisor_id: sup.id }))[0];
  const wt = await call(manager, "POST", "/api/behaviors", WARM_TRANSFER);
  const seen = [];
  const fake = { name: "groq", model: "m", async generate(req) { seen.push(req); return JSON.stringify({ tools: {}, direct: {}, smart_draft: { action: "x", measure_target: 5, measure_total: 5, check_method: "y" } }); } };
  await call(sup, "POST", "/api/ai/strategy", { agent_id: agent.id, behavior: wt.id, root_cause: "skill" }, fake);
  assert.match(seen[0].messages.at(-1).text, /THE MANAGER'S STANDARD[\s\S]*Stay on the line and give the next agent the full summary/);
  assert.match(seen[0].system, /warm-transfer-.* = Warm Transfer/);
  const sg = await call(manager, "POST", "/api/behaviors/suggest", { draft: { name: "Callback Promise", desc: "Keep every callback promise." } });
  assert.equal(sg.source, "offline");
  assert.ok(sg.how.length && sg.actions.length);
  await assert.rejects(call(sup, "POST", "/api/behaviors/suggest", { draft: { name: "x y" } }), /role/);
});

test("offline scoring hears custom behaviors through their example lines", () => {
  const b = normalize({ key: "callback-x", name: "Callback Promise", desc: "d", sounds: ["I will call you back by 3 pm today"], how: ["a"], actions: ["a"], kpis: ["fcr"] });
  const ev = evaluateOffline({ behavior: b.id }, [{ who: "member", text: "Hi" }, { who: "agent", text: "I will call you back by 3 pm today with the answer." }], [b]);
  assert.equal(ev.behavior_seen, true);
});
