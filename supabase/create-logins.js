// Creates a Supabase Auth login for every person in the `users` table who doesn't have one yet.
// Usage:  npm run create-logins -- --password=YourTempPass123
//         npm run create-logins -- --password=YourTempPass123 --roles=manager,supervisor
//         Add --demo to create logins for the fictional @pulse.demo people instead of real ones.
// Everyone created in one run gets the same temporary password. Ask real users to change it.
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(".env"); } catch {}
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = arg("password") || process.env.PULSE_LOGIN_PASSWORD;
const roles = (arg("roles") || "manager,supervisor,agent").split(",").map((r) => r.trim());

if (!url || !key) { console.log("✗ Add SUPABASE_URL and SUPABASE_SECRET_KEY to .env first."); process.exit(1); }
if (!password || password.length < 8) { console.log("✗ Add a temporary password of 8+ characters: npm run create-logins -- --password=YourTempPass123"); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const wantDemo = process.argv.includes("--demo");
const all = []; let error = null;
for (let from = 0; ; from += 1000) { // Supabase returns 1,000 rows per request
  const r = await db.from("users").select("*").in("role", roles).order("id").range(from, from + 999);
  if (r.error) { error = r.error; break; }
  all.push(...r.data); if (r.data.length < 1000) break;
}
const people = all.filter((p) => p.active !== false && /@pulse\.demo$/i.test(p.email) === wantDemo);
if (error) { console.log("✗ Couldn’t read the users table:", error.message, "\n  Did you run supabase/schema.sql and seed.sql?"); process.exit(1); }

// Existing logins, so we don't create duplicates.
const existing = new Map(); // email -> Supabase Auth UID
for (let page = 1; ; page++) {
  const { data, error: e } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (e) { console.log("✗ Couldn’t list logins:", e.message, "\n  Check that you used the secret key, not the publishable one."); process.exit(1); }
  data.users.forEach((u) => existing.set((u.email || "").toLowerCase(), u.id));
  if (data.users.length < 1000) break;
}

// Save the login's UID on the PULSE profile, so sign-in matches by UID instead of email.
const link = async (p, uid) => {
  if (p.auth_user_id === uid) return true;
  const { error: e } = await db.from("users").update({ auth_user_id: uid }).eq("id", p.id);
  if (e) console.log(`  ! Couldn’t save the UID for ${p.email}: ${e.message}${/auth_user_id/.test(e.message) ? " (run supabase/migrations/002_link_logins_by_uid.sql)" : ""}`);
  return !e;
};

let created = 0, linked = 0, failed = 0;
for (const p of people) {
  const email = p.email.toLowerCase();
  if (existing.has(email)) {
    const uid = existing.get(email);
    if (await link(p, uid)) { linked++; console.log(`· ${p.name.padEnd(22)} ${email} · already had a login, linked by UID ${uid.slice(0, 8)}…`); }
    continue;
  }
  const { data, error: e } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: p.name, role: p.role, pulse_user_id: p.id } });
  if (e) { failed++; console.log(`✗ ${p.name.padEnd(22)} ${email}: ${e.message}`); continue; }
  await link(p, data.user.id);
  const { error: fe } = await db.from("users").update({ must_change_password: true }).eq("id", p.id); // they choose their own password at first sign-in
  if (fe) console.log(`  ! ${p.email}: couldn’t mark the password as temporary (run supabase/migrations/004_first_password.sql)`);
  created++; console.log(`✓ ${p.name.padEnd(22)} ${email} · ${p.role}${p.lob ? " · " + p.lob : ""} · UID ${data.user.id.slice(0, 8)}…`);
}
console.log(`\nDone: ${created} created, ${linked} existing logins linked, ${failed} failed. New logins use the password you chose; each person sets their own at first sign-in.`);
