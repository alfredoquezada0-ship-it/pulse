// Runs the main PULSE flows through the real Supabase store adapter, against a strict fake of the
// Supabase REST API built from supabase/schema.sql. Catches problems that only show up on Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { createFakeSupabase, loadSchema } from "./helpers/fake-supabase.js";
import { createSupabaseStore } from "../backend/store/supabase.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { readXlsx } from "../web/core/xlsx.js";
import { parseRoster, applyRoster } from "../web/core/roster.js";
import { weekStart, addDays } from "../web/core/util.js";

async function seeded() {
  const fake = createFakeSupabase(loadSchema());
  const store = createSupabaseStore({ client: fake });
  const seed = buildSeed();
  const byRole = (r) => seed.users.filter((u) => u.role === r);
  for (const [t, rows] of [["kpi_goals", seed.kpi_goals], ["users", byRole("manager")], ["users", byRole("supervisor")], ["users", byRole("agent")],
    ["kpi_weekly", seed.kpi_weekly], ["verbatims", seed.verbatims], ["coaching_sessions", seed.coaching_sessions], ["commitments", seed.commitments],
    ["weekly_sessions", seed.weekly_sessions], ["quizzes", seed.quizzes], ["training_completions", seed.training_completions]]) await store.insertMany(t, rows);
  const call = async (user, method, path, body) => handle({ method, path: path.split("?")[0], query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user: user && (await store.get("users", user.id)) }, { store, ai: null, demo: false });
  return { fake, store, call };
}
const views = {
  manager: (u) => ["/api/me", "/api/dashboard/manager", "/api/agents", "/api/supervisors", "/api/sessions", "/api/commitments", "/api/weekly", "/api/quizzes", "/api/sample", "/api/roleplays", "/api/goals", "/api/leaders", "/api/notifications", "/api/roleplay-assignments", "/api/behaviors"],
  supervisor: (u) => ["/api/me", `/api/dashboard/supervisor`, "/api/agents", "/api/sessions", "/api/commitments", "/api/weekly", "/api/quizzes", "/api/sample", "/api/roleplays", "/api/my-coaching", "/api/notifications", "/api/roleplay-assignments", "/api/behaviors"],
  agent: (u) => ["/api/me", "/api/dashboard/agent", `/api/agents/${u.id}`, "/api/commitments", "/api/weekly", "/api/quizzes", "/api/sample", "/api/roleplays", "/api/notifications", "/api/roleplay-assignments", "/api/behaviors"],
};
async function openAll(call, user) {
  const failed = [];
  for (const p of views[user.role](user)) { try { await call(user, "GET", p); } catch (e) { failed.push(`${user.role} GET ${p}: ${e.message}`); } }
  return failed;
}

test("Supabase: every main view loads for the demo manager, supervisors and agents", async () => {
  const { store, call } = await seeded();
  const failed = [];
  for (const u of await store.list("users")) failed.push(...(await openAll(call, u)));
  const mgr = (await store.list("users", { role: "manager" }))[0];
  for (const s of await store.list("users", { role: "supervisor" })) { try { await call(mgr, "GET", `/api/dashboard/supervisor?supervisor_id=${s.id}`); } catch (e) { failed.push(`manager sup-dash: ${e.message}`); } }
  for (const a of await store.list("users", { role: "agent" })) { try { await call(mgr, "GET", `/api/agents/${a.id}`); } catch (e) { failed.push(`manager agent page: ${e.message}`); } }
  assert.deepEqual(failed, []);
});

test("Supabase: roster import (removing demo people), sample data on/off and real uploads", async () => {
  const { fake, store, call } = await seeded();
  const files = [{ name: "IFM - EDB 10122026.xlsx", sheets: (await readXlsx(fs.readFileSync(new URL("./fixtures/IFM - EDB 10122026.xlsx", import.meta.url)), async (u) => zlib.inflateRawSync(u))).sheets }];
  await applyRoster(store, parseRoster(files), { dryRun: false, removeDemo: true });
  const users = await store.list("users");
  assert.equal(users.length, 10);
  const ramon = users.find((u) => u.name === "Ramon Soto Vega"), marta = users.find((u) => u.name === "Marta Pineda Rios"), ana = users.find((u) => u.name === "Ana Torres");
  const failed = [];
  for (const u of users) failed.push(...(await openAll(call, u)));
  assert.deepEqual(failed, [], "views with the real roster and no KPIs");
  await call(ramon, "POST", "/api/sample", { on: true });
  for (const u of users) failed.push(...(await openAll(call, u)));
  assert.deepEqual(failed, [], "views with sample data");
  assert.ok(fake.data.leader_commitments.length > 0 && fake.data.notifications.length > 0);
  for (const sup of users.filter((u) => u.role === "supervisor" && u.manager_id === ramon.id)) { try { await call(ramon, "GET", `/api/leaders/${sup.id}`); } catch (e) { failed.push(`leader page: ${e.message}`); } }
  assert.deepEqual(failed, [], "supervisor coaching pages with sample data");
  assert.ok(fake.data.roleplays.filter((r) => r.sample).length > 0, "sample practice calls");
  assert.ok(fake.data.diagnoses.filter((r) => r.sample).length > 0, "sample diagnoses");
  for (const u of users.filter((x) => x.role !== "agent")) for (const r of await call(u, "GET", "/api/roleplays")) { try { await call(u, "GET", `/api/roleplays/${r.id}`); } catch (e) { failed.push(`practice ${r.id} as ${u.name}: ${e.message}`); } }
  assert.deepEqual(failed, [], "practice log details with sample data");
  await call(ramon, "POST", "/api/upload/kpis", { rows: [{ ccms: "1001", week_start: addDays(weekStart(), -7), nps: 41, csat: "91,5", aht: "9:35" }] });
  const s = await call(marta, "POST", "/api/sessions", { agent_id: ana.id, behavior: "empathy", root_cause: "skill", date: weekStart() });
  await call(marta, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "Say “I understand how frustrating that is” before solving, on 4 of 5 calls", measure_target: 4, measure_total: 5, check_method: "Remote Call Listening", follow_up_date: addDays(weekStart(), 4) }, force: true });
  await call(ramon, "POST", "/api/sample", { on: false });
  assert.equal(fake.data.kpi_weekly.filter((r) => r.sample).length, 0);
  for (const t of ["notifications", "leader_commitments", "leader_sessions", "roleplay_assignments", "roleplays", "diagnoses"]) assert.equal(fake.data[t].filter((r) => r.sample).length, 0, t);
  for (const u of users) failed.push(...(await openAll(call, u)));
  assert.deepEqual(failed, [], "views after sample data is removed");
  // Re-import is idempotent.
  const again = await applyRoster(store, parseRoster(files), { dryRun: false });
  assert.equal(again.summary.create, 0);
});
