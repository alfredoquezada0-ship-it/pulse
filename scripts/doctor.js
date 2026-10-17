// PULSE doctor: checks your setup and opens the main pages as a given person, printing the exact error if one fails.
//   npm run doctor
//   npm run doctor -- --as=alfredo_quezada_diaz@pulse.com
// It only reads; nothing is changed.
import { createClient } from "@supabase/supabase-js";
import { createSupabaseStore } from "../backend/store/supabase.js";
import { handle } from "../web/core/router.js";

if (!globalThis.__pulseDoctorClient) { try { process.loadEnvFile(".env"); } catch { console.log("! No .env file in this folder. Run this from the PULSE project folder."); } }
const env = process.env;
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const ok = (t) => console.log(`  ✓ ${t}`), bad = (t) => console.log(`  ✗ ${t}`), note = (t) => console.log(`  · ${t}`);
let problems = 0; const fail = (t) => { problems++; bad(t); };

console.log("\n1. Settings (.env)");
const url = env.SUPABASE_URL, secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, pub = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
url ? ok(`SUPABASE_URL ${url}`) : fail("SUPABASE_URL is missing");
if (!secret) fail("SUPABASE_SECRET_KEY is missing");
else if (/^sb_publishable_/.test(secret)) fail("SUPABASE_SECRET_KEY holds the PUBLISHABLE key. Copy the secret key (sb_secret_…) from Project Settings › API Keys.");
else ok(`secret key ${secret.slice(0, 10)}…`);
pub ? (/^sb_secret_/.test(pub) ? fail("SUPABASE_PUBLISHABLE_KEY holds the SECRET key. Never put the secret key there.") : ok(`publishable key ${pub.slice(0, 15)}…`)) : fail("SUPABASE_PUBLISHABLE_KEY is missing (the sign-in page needs it)");
(env.AUTH_MODE || "") === "supabase" ? ok("AUTH_MODE=supabase") : fail(`AUTH_MODE is "${env.AUTH_MODE || "(not set)"}". Set AUTH_MODE=supabase to sign in with Supabase.`);
env.GEMINI_API_KEY ? ok("GEMINI_API_KEY is set") : note("GEMINI_API_KEY isn’t set: AI features use offline suggestions");
if (!url || !secret) { console.log(`\nFix the settings above, then run npm run doctor again.`); process.exit(1); }

const db = globalThis.__pulseDoctorClient || createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }); // tests pass a stand-in
const store = createSupabaseStore({ client: db });

console.log("\n2. Database tables and migrations");
const tables = ["users", "kpi_goals", "kpi_weekly", "verbatims", "coaching_sessions", "commitments", "weekly_sessions", "quizzes", "roleplays", "training_completions"];
for (const t of tables) { const { error } = await db.from(t).select("id").limit(1); error ? fail(`${t}: ${error.message}${/does not exist|schema cache/.test(error.message) ? " → run supabase/schema.sql" : ""}`) : ok(t); }
const cols = [
  ["users", "auth_user_id", "002_link_logins_by_uid.sql"], ["users", "employee_id,roster_key,active,sub_lob,in_production,source", "003_roster.sql"],
  ["users", "must_change_password", "004_first_password.sql"], ["kpi_weekly", "sample", "005_sample_data.sql"], ["coaching_sessions", "sample", "005_sample_data.sql"],
];
const newer = [["notifications", "id", "006_notifications_and_leader_coaching.sql"], ["roleplays", "coach_note", "007_practice_log.sql"], ["diagnoses", "id", "008_supervisor_diagnosis.sql"], ["behaviors", "id", "009_behavior_bank.sql"]];
cols.push(...newer);
for (const [t, c, mig] of cols) { const { error } = await db.from(t).select(c).limit(1); error ? fail(`${t}.${c.split(",")[0]}… missing → run supabase/migrations/${mig}`) : ok(`${t}: ${c.split(",").length > 1 ? "roster columns" : c}`); }

// The browser's public key must not be able to read any table (row-level security, migration 010).
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (publishable && !globalThis.__pulseDoctorClient) {
  const pub = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const open = [];
  for (const t of [...tables, "notifications", "roleplay_assignments", "leader_sessions", "leader_commitments", "diagnoses", "behaviors"]) { const { data, error } = await pub.from(t).select("id").limit(1); if (!error && data?.length) open.push(t); }
  open.length ? fail(`the public key can read ${open.join(", ")} → run supabase/migrations/010_lock_down.sql`) : ok("the public key can’t read any table (row-level security is on)");
}

console.log("\n3. People");
let users = [];
try { users = await store.list("users"); } catch (e) { fail(`can’t read users: ${e.message}`); }
const count = (f) => users.filter(f).length;
const activeU = users.filter((u) => u.active !== false);
note(`${users.length} people: ${count((u) => u.role === "manager")} managers, ${count((u) => u.role === "supervisor")} supervisors, ${count((u) => u.role === "agent")} agents (${users.length - activeU.length} marked as left)`);
note(`${count((u) => u.source === "roster")} from the roster, ${count((u) => /@pulse\.demo$/.test(u.email))} demo (@pulse.demo), ${count((u) => u.auth_user_id)} with a login, ${count((u) => u.must_change_password)} still on a temporary password`);
if (!count((u) => u.source === "roster")) note("No roster people yet. Import the EDB files (npm run import-roster -- … --apply).");
for (const m of activeU.filter((u) => u.role === "manager")) {
  const sups = activeU.filter((u) => u.role === "supervisor" && u.manager_id === m.id);
  const agents = activeU.filter((u) => u.role === "agent" && (u.manager_id === m.id || sups.some((s) => s.id === u.supervisor_id)));
  note(`${m.name} <${m.email}>: ${sups.length} supervisors, ${agents.length} agents${m.auth_user_id ? "" : " · no login yet"}`);
}
try {
  const kpi = await store.list("kpi_weekly");
  note(`${kpi.length} weekly KPI rows (${kpi.filter((r) => r.sample).length} sample), ${(await store.list("kpi_goals")).length} KPI goals`);
} catch (e) { fail(`can’t read KPIs: ${e.message}`); }

const who = arg("as");
if (who) {
  console.log(`\n4. Opening PULSE as ${who}`);
  const q = who.toLowerCase();
  const u = users.find((x) => (x.email || "").toLowerCase() === q) || users.find((x) => (x.name || "").toLowerCase().includes(q));
  if (!u) fail(`nobody with that email or name in the users table`);
  else {
    note(`${u.name} · ${u.role} · ${u.lob || ""} · ${u.email}${u.active === false ? " · MARKED AS LEFT (can’t sign in)" : ""}`);
    if (!u.auth_user_id) fail("no login linked yet → run npm run create-logins -- --password=…");
    else {
      const { data, error } = await db.auth.admin.getUserById(u.auth_user_id);
      error || !data?.user ? fail(`login ${u.auth_user_id} not found in Authentication › Users`) : ok(`login ${data.user.email}${data.user.email !== u.email ? ` (differs from the profile email ${u.email}: sign in with ${data.user.email})` : ""}`);
    }
    if (u.must_change_password) note("still on a temporary password: after signing in, PULSE first asks them to choose their own");
    const pages = {
      manager: ["/api/me", "/api/dashboard/manager", "/api/agents", "/api/supervisors", "/api/sessions", "/api/commitments", "/api/weekly", "/api/quizzes", "/api/sample"],
      supervisor: ["/api/me", "/api/dashboard/supervisor", "/api/agents", "/api/sessions", "/api/commitments", "/api/weekly", "/api/quizzes", "/api/sample"],
      agent: ["/api/me", "/api/dashboard/agent", `/api/agents/${u.id}`, "/api/commitments", "/api/weekly", "/api/quizzes", "/api/sample"],
    }[u.role] || [];
    for (const p of pages) {
      const t0 = Date.now();
      try {
        const r = await handle({ method: "GET", path: p, query: {}, body: {}, user: u }, { store, ai: null, demo: false });
        const size = Array.isArray(r) ? `${r.length} rows` : r?.agents ? `${r.agents.length ?? r.people?.agents} agents` : "ok";
        ok(`${p} · ${size} · ${Date.now() - t0} ms`);
      } catch (e) { fail(`${p}: ${e.message}`); if (!e.status) console.log(String(e.stack).split("\n").slice(1, 4).join("\n")); }
    }
  }
}
console.log(problems ? `\n${problems} problem${problems > 1 ? "s" : ""} found. Fix the ✗ lines from the top down.` : "\nNo problems found.");
