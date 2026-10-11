import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { readXlsx } from "../web/core/xlsx.js";
import { parseRoster, applyRoster } from "../web/core/roster.js";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";
import { weekStart, addDays } from "../web/core/util.js";

const FIX = new URL("./fixtures/IFM - EDB 10122026.xlsx", import.meta.url);
async function setup() {
  const store = createMemStore(buildSeed());
  const files = [{ name: "IFM - EDB 10122026.xlsx", sheets: (await readXlsx(fs.readFileSync(FIX), async (u) => zlib.inflateRawSync(u))).sheets }];
  await applyRoster(store, parseRoster(files), { dryRun: false, removeDemo: true });
  const users = await store.list("users");
  const call = (user, method, path, body) => handle({ method, path, query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user }, { store, ai: null, demo: true });
  return { store, users, call, ramon: users.find((u) => u.name === "Ramon Soto Vega") };
}

test("sample data fills the real roster, skips agents in training, and shows everywhere", async () => {
  const { store, users, call, ramon } = await setup();
  assert.equal((await call(ramon, "GET", "/api/sample")).on, false);
  const r = await call(ramon, "POST", "/api/sample", { on: true });
  assert.ok(r.counts.kpi_weekly > 0 && r.counts.verbatims > 0);
  const luis = users.find((u) => u.name === "Luis Mena"); // OJT
  assert.equal((await store.list("kpi_weekly", { agent_id: luis.id })).length, 0);
  const dash = await call(ramon, "GET", "/api/dashboard/manager");
  assert.ok(dash.org.nps.value != null);
  const agent = users.find((u) => u.name === "Ana Torres");
  assert.equal((await call(agent, "GET", "/api/sample")).on, true);           // agents see the banner too
  assert.equal((await call(agent, "GET", "/api/sample")).can_toggle, false);
  await assert.rejects(call(agent, "POST", "/api/sample", { on: false }), /role/);
  const carla = users.find((u) => u.name === "Carla Nunez");                 // another manager's team is untouched
  const pedro = users.find((u) => u.name === "Pedro Gil");
  assert.equal((await store.list("kpi_weekly", { agent_id: pedro.id, sample: true })).length, (await store.list("kpi_weekly", { agent_id: pedro.id })).length);
  assert.equal((await call(carla, "GET", "/api/sample")).on, true);           // Pedro's supervisor sits under Ramon
});

test("real uploads replace sample weeks, real coaching ignores sample rows, and turning off removes only sample rows", async () => {
  const { store, users, call, ramon } = await setup();
  await call(ramon, "POST", "/api/sample", { on: true });
  const ana = users.find((u) => u.name === "Ana Torres");
  const week = addDays(weekStart(), -7);
  await call(ramon, "POST", "/api/upload/kpis", { rows: [{ ccms: "1001", week_start: week, nps: 44 }] });
  const row = (await store.list("kpi_weekly", { agent_id: ana.id })).find((x) => x.week_start === week);
  assert.equal(row.nps, 44); assert.ok(!row.sample); assert.equal(row.csat, undefined); // no leftover sample numbers
  const marta = users.find((u) => u.name === "Marta Pineda Rios");
  const s = await call(marta, "POST", "/api/sessions", { agent_id: ana.id, behavior: "empathy", root_cause: "skill", date: weekStart() });
  const done = await call(marta, "POST", `/api/sessions/${s.id}/complete`, { commitment: { action: "Say “I understand how frustrating that is” before solving, on 4 of 5 calls", measure_target: 4, measure_total: 5, check_method: "Remote Call Listening", follow_up_date: addDays(weekStart(), 4) }, force: true });
  await call(ramon, "POST", "/api/sample", { on: false });
  assert.equal((await store.list("kpi_weekly", { sample: true })).length, 0);
  assert.equal((await store.list("coaching_sessions", { sample: true })).length, 0);
  assert.equal((await store.list("kpi_weekly", { agent_id: ana.id })).length, 1);      // the real week stays
  assert.ok(await store.get("commitments", done.commitment.id));
  assert.equal((await store.list("weekly_sessions", { commitment_id: done.commitment.id })).length, 4); // its own 4 weekly sessions survive
  assert.equal((await call(ramon, "GET", "/api/sample")).on, false);
});

test("KPI template uploads: empty rows ignored, Spanish Excel CSV, decimal commas and AHT as mm:ss", async () => {
  const { store, users, call, ramon } = await setup();
  const { parseCSV } = await import("../web/core/util.js");
  const rows = parseCSV("﻿ccms;agent_name;week_start;nps;csat;fcr;aht;qa;surveys\r\n1001;Ana Torres;2026-10-05;38;91,5;93,2;9:35;94%;12\r\n1003;Rosa Díaz;2026-10-05;;;;;;\r\n1005;Sara Vidal;2026-10-05;abc;;;;;\r\n");
  const r = await call(ramon, "POST", "/api/upload/kpis", { rows });
  assert.deepEqual([r.added, r.blank, r.skipped.length], [1, 1, 1]);
  const ana = users.find((u) => u.name === "Ana Torres");
  const [k] = await store.list("kpi_weekly", { agent_id: ana.id });
  assert.deepEqual([k.csat, k.fcr, k.aht, k.qa], [91.5, 93.2, 575, 94]);
});
