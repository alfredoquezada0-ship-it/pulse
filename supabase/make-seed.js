// Prints SQL that loads the fictional demo data into Supabase: npm run seed:sql
import { buildSeed } from "../web/core/seed.js";
import { TABLES } from "../web/core/memstore.js";

const data = buildSeed();
const now = new Date().toISOString();
const esc = (s) => s.replace(/'/g, "''");
console.log("-- Fictional PULSE demo data. Generated " + now);
console.log("begin;");
for (const t of TABLES) {
  const rows = (data[t] || []).map((r) => ({ created_at: now, ...r }));
  if (!rows.length) continue;
  // Users reference each other, so insert managers, then supervisors, then agents.
  const ordered = t === "users" ? [...rows].sort((a, b) => ["manager", "supervisor", "agent"].indexOf(a.role) - ["manager", "supervisor", "agent"].indexOf(b.role)) : rows;
  console.log(`insert into ${t} select * from json_populate_recordset(null::${t}, '${esc(JSON.stringify(ordered))}');`);
}
console.log("commit;");
