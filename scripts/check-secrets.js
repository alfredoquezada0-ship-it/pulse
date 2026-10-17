// Fails if anything that must never be committed is in the project: API keys, the Supabase secret key,
// .env files, private keys, or real roster/KPI files. Run before every push: npm run check-secrets
// (GitHub runs it too, on every push, in .github/workflows/ci.yml).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PATTERNS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabase secret key"],
  [/eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "JWT (Supabase service_role or session token)"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google (Gemini) API key"],
  [/gsk_[A-Za-z0-9]{30,}/, "Groq API key"],
  [/nvapi-[A-Za-z0-9_-]{30,}/, "NVIDIA API key"],
  [/sk-[A-Za-z0-9]{32,}/, "API key"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
];
const ALLOWED_DATA = [/^tests\/fixtures\//];

let files;
// The files git would upload (tracked, plus new files not covered by .gitignore).
try { files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean); }
catch {
  // Not a git folder: scan everything except what .gitignore keeps out anyway.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (["node_modules", ".git", "data", "roster", ".env"].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  files = walk(".").map((f) => f.replace(/^\.\//, ""));
}
const problems = [];
for (const f of files) {
  const name = f.replace(/\\/g, "/");
  if (/(^|\/)\.env(\.|$)/.test(name) && !name.endsWith(".env.example")) problems.push(`${name}: .env files hold secrets and must not be committed`);
  if (/(^|\/)roster\//i.test(name) || (/\.(xlsx|xls|csv)$/i.test(name) && !ALLOWED_DATA.some((re) => re.test(name)))) problems.push(`${name}: roster or KPI files have employee data and must not be committed`);
  if (/\.(png|jpe?g|gif|ico|woff2?|zip|xlsx)$/i.test(name)) continue;
  let text = ""; try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  for (const [re, what] of PATTERNS) if (re.test(text)) problems.push(`${name}: looks like it contains a ${what}`);
}
if (problems.length) { console.error("✗ Don't push this:\n  " + problems.join("\n  ")); process.exit(1); }
console.log(`✓ No secrets or employee data files in ${files.length} files.`);
