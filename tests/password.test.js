import test from "node:test";
import assert from "node:assert/strict";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { passwordProblems, tempPassword } from "../web/core/password.js";

// Fake Supabase password service: remembers one password per login.
const fakePasswords = () => {
  const pw = new Map();
  return { pw, async set(u, p) { pw.set(u.auth_user_id, p); }, async check(u, p) { return pw.get(u.auth_user_id) === p; } };
};
const setup = async () => {
  const store = createMemStore(buildSeed());
  const passwords = fakePasswords();
  for (const u of await store.list("users")) { await store.update("users", u.id, { auth_user_id: "auth-" + u.id }); passwords.pw.set("auth-" + u.id, "Temp2026pass"); }
  const call = async (user, method, path, body, deps = {}) => handle({ method, path, query: {}, body, user: user && (await store.get("users", user.id)) }, { store, ai: null, demo: false, passwords, ...deps });
  return { store, passwords, call };
};

test("password rules: length, letters and a number, not the person's name or login", () => {
  const who = { name: "Jordy Feliz Diaz", email: "jordy_feliz_diaz@pulse.com" };
  assert.deepEqual(passwordProblems("Sunrise2026", who), []);
  assert.equal(passwordProblems("short1", who).length, 1);
  assert.ok(passwordProblems("sunriseonly", who).some((p) => /number/.test(p)));
  assert.ok(passwordProblems("Jordy2026!", who).some((p) => /name/.test(p)));
  assert.match(tempPassword(), /^[A-Za-z]+\d{4}$/);
});

test("a temporary password blocks everything until the person sets their own", async () => {
  const { store, passwords, call } = await setup();
  const [agent] = await store.list("users", { role: "agent" });
  await store.update("users", agent.id, { must_change_password: true });
  await assert.rejects(call(agent, "GET", "/api/dashboard/agent"), (e) => e.status === 428);
  assert.equal((await call(agent, "GET", "/api/me")).must_change_password, true);
  await assert.rejects(call(agent, "POST", "/api/me/password", { password: "abc" }), /8 characters/);
  await assert.rejects(call(agent, "POST", "/api/me/password", { password: "Temp2026pass" }), /different/);
  const me = await call(agent, "POST", "/api/me/password", { password: "Sunrise2026" });
  assert.equal(me.must_change_password, false);
  assert.equal(passwords.pw.get(agent.auth_user_id), "Sunrise2026");
  assert.ok(await call(agent, "GET", "/api/dashboard/agent"));
});

test("changing your password later needs the current one", async () => {
  const { store, call } = await setup();
  const [sup] = await store.list("users", { role: "supervisor" });
  await assert.rejects(call(sup, "POST", "/api/me/password", { password: "Harbor2027x" }), /current password/);
  await assert.rejects(call(sup, "POST", "/api/me/password", { current: "nope", password: "Harbor2027x" }), /current password/);
  assert.equal((await call(sup, "POST", "/api/me/password", { current: "Temp2026pass", password: "Harbor2027x" })).must_change_password, false);
});

test("leaders reset passwords only for their own team; the person must choose a new one", async () => {
  const { store, passwords, call } = await setup();
  const [sup, other] = await store.list("users", { role: "supervisor" });
  const mine = (await store.list("users", { role: "agent", supervisor_id: sup.id }))[0];
  const notMine = (await store.list("users", { role: "agent", supervisor_id: other.id }))[0];
  const r = await call(sup, "POST", `/api/people/${mine.id}/reset-password`, { password: "Coach1234x" });
  assert.equal(r.ok, true);
  assert.equal((await store.get("users", mine.id)).must_change_password, true);
  assert.equal(passwords.pw.get(mine.auth_user_id), "Coach1234x");
  await assert.rejects(call(sup, "POST", `/api/people/${notMine.id}/reset-password`, { password: "Coach1234x" }), /your team/);
  await assert.rejects(call(sup, "POST", `/api/people/${other.id}/reset-password`, { password: "Coach1234x" }), /your team/);
  const [mgr] = await store.list("users", { role: "manager" });
  assert.equal((await call(mgr, "POST", `/api/people/${sup.id}/reset-password`, { password: "Coach1234x" })).ok, true);
  await assert.rejects(call(mgr, "POST", `/api/people/${mine.id}/reset-password`, { password: "short" }), /8\+ characters/);
});

test("demo mode has no passwords and is never blocked", async () => {
  const { store, call } = await setup();
  const [agent] = await store.list("users", { role: "agent" });
  await store.update("users", agent.id, { must_change_password: true });
  assert.ok(await call(agent, "GET", "/api/dashboard/agent", null, { passwords: null }));
  await assert.rejects(call(agent, "POST", "/api/me/password", { password: "Sunrise2026" }, { passwords: null }), /Supabase/);
});
