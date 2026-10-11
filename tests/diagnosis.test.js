import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { tallyCalls, cleanCalls, calibration } from "../web/core/diagnosis.js";

const setup = () => {
  const seed = buildSeed(); seed.diagnoses = [];
  const store = createMemStore(seed);
  const call = async (user, method, path, body, ai = null) => handle({ method, path, query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user }, { store, ai, demo: true });
  return { store, call };
};
const callsFor = (missed, n = 3) => Array.from({ length: n }, (_, i) => ({ label: `Call ${i + 1}`, marks: { [missed]: "missed", warm: "shown", ...(i === 0 ? { lara: "missed" } : {}) }, note: i === 0 ? "Member asked “so when?” twice" : "" }));

test("call listening tally finds the most-missed behavior", () => {
  const t = tallyCalls(callsFor("expectations", 4));
  assert.equal(t.top, "expectations");
  assert.equal(t.rows.find((r) => r.id === "expectations").missed, 4);
  assert.equal(t.rows.find((r) => r.id === "warm").shown, 4);
  assert.match(cleanCalls(callsFor("needs", 2)).problem, /at least 3/);
  assert.equal(cleanCalls([...callsFor("needs", 3), { label: "empty", marks: {} }]).calls.length, 3, "empty calls are dropped");
  assert.equal(cleanCalls([{ marks: { bogus: "missed", needs: "maybe" } }, ...callsFor("needs", 3)]).calls.length, 3, "unknown behaviors and marks are dropped");
});

test("supervisor first: their pick is saved, the AI gives a second opinion, and changing the pick needs a reason", async () => {
  const { store, call } = setup();
  const [sup] = await store.list("users", { role: "supervisor" });
  const other = (await store.list("users", { role: "supervisor" })).find((x) => x.id !== sup.id);
  const agent = (await store.list("users", { supervisor_id: sup.id }))[0];
  const manager = (await store.list("users", { role: "manager" }))[0];
  const body = { agent_id: agent.id, calls: callsFor("expectations"), sup_pick: "expectations", sup_reason: "She fixes it but never says when; members ask “so when?”." };

  await assert.rejects(call(sup, "POST", "/api/diagnoses", { ...body, calls: callsFor("expectations", 2) }), /at least 3/);
  await assert.rejects(call(sup, "POST", "/api/diagnoses", { ...body, sup_reason: "because" }), /why/);
  await assert.rejects(call(sup, "POST", "/api/diagnoses", { ...body, sup_pick: "" }), /Choose/);
  await assert.rejects(call(other, "POST", "/api/diagnoses", body), /team/);

  const d = await call(sup, "POST", "/api/diagnoses", body);
  assert.equal(d.status, "draft");
  assert.equal(d.sup_pick, "expectations");
  assert.equal(d.evidence_top, "expectations");
  assert.ok(d.ai_pick && d.ai.comparison && d.ai.check_next, "second opinion");
  assert.equal(typeof d.agrees, "boolean");
  assert.equal(d.ai.ranking, undefined, "the ranking isn't stored");

  const otherPick = d.ai_pick === "expectations" ? "empathy" : d.ai_pick;
  await assert.rejects(call(sup, "POST", `/api/diagnoses/${d.id}/final`, { final_pick: otherPick, final_reason: "" }), /changed your mind/);
  const fin = await call(sup, "POST", `/api/diagnoses/${d.id}/final`, { final_pick: otherPick, final_reason: "The verbatims about call-backs convinced me." });
  assert.equal(fin.status, "final");
  assert.equal(fin.final_pick, otherPick);

  const s = await call(sup, "POST", "/api/sessions", { agent_id: agent.id, behavior: otherPick, root_cause: "skill", diagnosis_id: d.id });
  assert.equal(s.ai.listening.sup_pick, "expectations");
  assert.equal(s.ai.listening.lines.length, 3);
  assert.equal((await store.get("diagnoses", d.id)).session_id, s.id);

  // Completing the session and reviewing the commitment feeds the manager's calibration view
  const done = await call(sup, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "I will give the member the date and the reference number before closing, on 4 of 5 calls", measure_target: 4, measure_total: 5, check_method: "Remote Call Listening", follow_up_date: "2026-12-31" }, force: true });
  const c = (await store.list("commitments", { session_id: s.id }))[0];
  await store.update("commitments", c.id, { status: "met" });
  const view = await call(manager, "GET", `/api/leaders/${sup.id}`);
  assert.equal(view.diagnosis.diagnoses, 1);
  assert.equal(view.diagnosis.calls_avg, 3);
  assert.equal(view.diagnosis.followed_evidence, 100);
  assert.equal(view.diagnosis.changed_pick.met, 1);
  assert.equal(view.diagnosis.recent[0].agent_name, agent.name);
  assert.ok(done);
  const mine = await call(sup, "GET", "/api/my-coaching");
  assert.equal(mine.diagnosis.diagnoses, 1, "the supervisor sees the same view");
  await assert.rejects(call(agent, "GET", "/api/diagnoses"), /role/);
});

test("calibration math", () => {
  const ds = [
    { status: "final", calls: [1, 2, 3], evidence_top: "needs", sup_pick: "needs", ai_pick: "needs", agrees: true, final_pick: "needs", session_id: "s1" },
    { status: "final", calls: [1, 2, 3, 4, 5], evidence_top: "lara", sup_pick: "warm", ai_pick: "lara", agrees: false, final_pick: "lara", session_id: "s2" },
    { status: "draft", calls: [], sup_pick: "warm" },
  ];
  const cs = [{ session_id: "s1", status: "met" }, { session_id: "s2", status: "not_met" }];
  const x = calibration(ds, cs);
  assert.equal(x.diagnoses, 2);
  assert.equal(x.calls_avg, 4);
  assert.equal(x.followed_evidence, 50);
  assert.equal(x.ai_agreed, 50);
  assert.equal(x.switched_to_ai, 50);
  assert.deepEqual(x.own_pick, { reviewed: 1, met: 1, rate: 100 });
  assert.deepEqual(x.changed_pick, { reviewed: 1, met: 0, rate: 0 });
});
