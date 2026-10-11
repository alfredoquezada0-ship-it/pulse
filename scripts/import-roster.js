// Import the real roster (EDB .xlsx files) into PULSE from the command line.
//   npm run import-roster -- "BVA EDB 10122026.xlsx" "IFM - EDB 10122026.xlsx" "Medicare - EDB 10122026.xlsx"
//   ...add --apply to save it. Without --apply it only shows what would change.
// Options: --domain=pulse.com (login email domain) · --keep-demo (keep the fictional demo people)
// Writes to Supabase when SUPABASE_URL and the secret key are in .env; otherwise to data/local-db.json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { readXlsx } from "../web/core/xlsx.js";
import { parseRoster, rosterTree, applyRoster } from "../web/core/roster.js";

try { process.loadEnvFile(".env"); } catch {}
const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const flag = (n) => args.includes(`--${n}`);
const paths = args.filter((a) => !a.startsWith("--"));
if (!paths.length) { console.log('Usage: npm run import-roster -- "BVA EDB.xlsx" "IFM - EDB.xlsx" "Medicare - EDB.xlsx" [--apply] [--domain=pulse.com] [--keep-demo]'); process.exit(1); }

const files = [];
for (const p of paths) {
  if (!fs.existsSync(p)) { console.log(`✗ File not found: ${p}`); process.exit(1); }
  const wb = await readXlsx(fs.readFileSync(p), async (u) => zlib.inflateRawSync(u));
  files.push({ name: path.basename(p), sheets: wb.sheets });
}
const parsed = parseRoster(files, { domain: opt("domain") || "pulse.com" });
const s = parsed.stats;
console.log(`\nRoster of ${s.roster_date || "unknown date"} · ${s.lobs.join(", ")}`);
console.log(`${s.managers} floor managers · ${s.supervisors} supervisors · ${s.agents} agents (${s.not_in_production} not in production yet)\n`);
for (const m of rosterTree(parsed.people)) {
  console.log(`${m.name}${m.email ? `  <${m.email}>` : ""}`);
  for (const sup of m.supervisors) console.log(`   ${sup.name.padEnd(34)} ${String(sup.agents).padStart(3)} agents${sup.not_in_production ? ` (${sup.not_in_production} in training)` : ""}  ${sup.lob || ""}`);
}
if (parsed.issues.length) { console.log("\nCheck these:"); parsed.issues.forEach((i) => console.log(`${i.level === "warn" ? " !" : " ·"} ${i.text}`)); }

const { createApp } = await import("../backend/server.js");
const { store } = createApp({ ai: null });
const result = await applyRoster(store, parsed, { dryRun: !flag("apply"), removeDemo: !flag("keep-demo") });
const r = result.summary;
console.log(`\n${result.dryRun ? "Would change" : "Saved"} in ${store.kind === "supabase" ? "Supabase" : "data/local-db.json"}: ${r.create} new, ${r.update} updated, ${r.same} unchanged, ${r.deactivate} marked as left${r.demo ? `, ${r.remove_demo ? "" : "keeping "}${r.demo} demo people${r.remove_demo ? " removed" : ""}` : ""}.`);
if (r.deactivate_list.length) console.log("Left the roster:", r.deactivate_list.join("; "));
if (r.kept_list.length) console.log("Not in these files (kept as they are):", r.kept_list.join("; "));
if (result.dryRun) console.log("\nNothing was saved. Add --apply to import.");
else console.log(`\nNext: create their logins with  npm run create-logins -- --password=YourTempPass123`);
if (store.kind !== "supabase") await new Promise((res) => setTimeout(res, 400)); // let the file store finish writing
