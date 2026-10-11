import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { readXlsx } from "../web/core/xlsx.js";
import { parseRoster, applyRoster, parseName, sameName } from "../web/core/roster.js";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";
import { handle } from "../web/core/router.js";

const FIX = new URL("./fixtures/IFM - EDB 10122026.xlsx", import.meta.url);
const load = async () => [{ name: "IFM - EDB 10122026.xlsx", sheets: (await readXlsx(fs.readFileSync(FIX), async (u) => zlib.inflateRawSync(u))).sheets }];

test("xlsx reader reads every sheet, hidden ones too, with raw numbers", async () => {
  const [f] = await load();
  assert.deepEqual(f.sheets.map((s) => s.name), ["EDB", "EDB SUPS", "OPS Ditros"]);
  assert.equal(f.sheets[1].state, "hidden");
  assert.equal(f.sheets[0].rows[2][0], 1001);
  assert.equal(f.sheets[0].rows[2][15], 400);
  assert.equal(f.sheets[0].rows[4][6], "Díaz, Rosa");
});

test("name matching handles 'Last, First M', joined surnames and nicknames in other columns", () => {
  assert.equal(parseName("Pineda Rios, Marta L").display, "Marta Pineda Rios");
  assert.ok(sameName(parseName("Soto, Ramon"), parseName("Soto Vega, Ramon")));
  assert.ok(sameName(parseName("Hector Bello Cruz"), parseName("Bello, Hector")));
  assert.ok(!sameName(parseName("Soto, Ramon"), parseName("Soto, Rosa")));
});

test("roster parse builds managers, supervisors and agents with logins on the chosen domain", async () => {
  const r = parseRoster(await load(), { domain: "pulse.com" });
  const by = (n) => r.people.find((p) => p.name === n);
  assert.equal(r.stats.roster_date, "2026-10-12");
  assert.deepEqual([r.stats.managers, r.stats.supervisors, r.stats.agents], [2, 3, 5]);
  assert.equal(by("Ramon Soto Vega").role, "manager");
  const marta = by("Marta Pineda Rios");
  assert.equal(marta.email, "marta_pineda_rios@pulse.com");
  assert.equal(marta.employee_id, "2001");
  assert.ok(r.issues.some((i) => /Wrong, Name/.test(i.text)));         // name doesn't match the email
  assert.equal(by("Ines Roca").manager_key, by("Ramon Soto Vega").roster_key); // no agents: boss from EDB SUPS
  assert.equal(by("Luis Mena").in_production, false);                  // OJT
  assert.equal(by("Luis Mena").sub_lob, "OJT");
  assert.equal(by("Ana Torres").hire_date, "2025-09-07");               // 400 days before the roster date
  assert.equal(by("Ana Torres").email, "ana_lucia_torres@pulse.com");
  assert.equal(by("Sara Vidal").supervisor_key, marta.roster_key);       // later row wins when the team lead differs
  assert.ok(r.issues.some((i) => /lower row/.test(i.text)));
  assert.ok(r.people.find((p) => p.name === "Carla Nunez").email_generated);
});

test("applying the roster creates people, updates moves, marks leavers and removes demo data", async () => {
  const store = createMemStore(buildSeed());
  const files = await load();
  const preview = await applyRoster(store, parseRoster(files), { dryRun: true, removeDemo: true });
  assert.equal(preview.summary.create, 10);
  assert.ok(preview.summary.demo > 10);
  assert.equal((await store.list("users")).filter((u) => u.source === "roster").length, 0); // dry run wrote nothing
  await applyRoster(store, parseRoster(files), { dryRun: false, removeDemo: true });
  const users = await store.list("users");
  assert.equal(users.length, 10);
  assert.equal((await store.list("kpi_weekly")).length, 0);
  const sara = users.find((u) => u.name === "Sara Vidal"), marta = users.find((u) => u.name === "Marta Pineda Rios");
  assert.equal(sara.supervisor_id, marta.id);
  // Next month: Sara moves to Hector, Rosa leaves.
  files[0].sheets[0].rows = files[0].sheets[0].rows.filter((r) => r[0] !== 1003).map((r) => (r[0] === 1005 ? Object.assign([...r], { 8: "Hector Bello Cruz", 9: "Nunez, Carla" }) : r));
  const again = await applyRoster(store, parseRoster(files), { dryRun: false });
  assert.equal(again.summary.create, 0);
  assert.equal(again.summary.deactivate, 1);
  const after = await store.list("users");
  assert.equal(after.find((u) => u.employee_id === "1003").active, false);
  assert.equal(after.find((u) => u.name === "Sara Vidal").supervisor_id, after.find((u) => u.name === "Hector Bello Cruz").id);
});

test("managers only see their own teams; uploads match by CCMS, client email or name", async () => {
  const store = createMemStore(buildSeed());
  await applyRoster(store, parseRoster(await load()), { dryRun: false, removeDemo: true });
  const users = await store.list("users");
  const ramon = users.find((u) => u.name === "Ramon Soto Vega"), carla = users.find((u) => u.name === "Carla Nunez");
  const call = (user, method, path, body) => handle({ method, path, query: Object.fromEntries(new URL("http://x" + path).searchParams), body, user }, { store, ai: null, demo: true });
  const mine = await call(ramon, "GET", "/api/agents");
  // Hector's agents list two floor managers; he goes under the first, so his team shows for Ramon.
  assert.deepEqual(mine.map((a) => a.name).sort(), ["Ana Torres", "Luis Mena", "Pedro Gil", "Rosa Díaz", "Sara Vidal"]);
  assert.equal(mine.find((a) => a.name === "Luis Mena").quartile, null); // in training: not ranked
  const ana = users.find((u) => u.name === "Ana Torres");
  await assert.rejects(call(carla, "GET", `/api/agents/${ana.id}`), /isn’t on your team/);
  const dash = await call(carla, "GET", "/api/dashboard/manager");
  assert.equal(dash.people.agents, 1);
  const up = await call(ramon, "POST", "/api/upload/kpis", { rows: [
    { ccms: "1001", week_start: "2026-10-05", nps: 40 },
    { agent_email: "Rosa_Diaz_Peña@client.com", week_start: "2026-10-05", nps: 30 },
    { agent_name: "Vidal, Sara", week_start: "2026-10-05", nps: 50 },
    { agent_name: "Nobody, Real", week_start: "2026-10-05", nps: 50 },
  ] });
  assert.equal(up.added, 3);
  assert.equal(up.skipped.length, 1);
  const demo = await call(null, "GET", "/api/demo-users");
  assert.equal(demo.length, 0); // real people are hidden from demo sign-in unless the server allows it
});
