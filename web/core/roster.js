// Roster import: turns EDB (employee database) workbooks into PULSE people.
//   Agents   = rows of the EDB sheet.
//   Supervisors = the "Team Lead" column (matched to the EDB SUPS sheet for their CCMS and email).
//   Managers = the "Floor Manager" column.
// parseRoster() is pure; applyRoster() writes to any PULSE store (Supabase, file or memory).
import { addDays } from "./util.js";

export const NOT_IN_PRODUCTION = /^(ojt|training|uptraining|nesting|new hire)/i;
const OTHER_NON_PRODUCTION = /^(staff)$/i;
const LOB_FROM_TEXT = [[/medicare|med ?supp/i, "MedSupp"], [/\bbva\b|bva/i, "BVA"], [/\bifm\b|ifm/i, "IFM"], [/\bnpg\b|npg/i, "NPG"]];

export const lobFromText = (s) => LOB_FROM_TEXT.find(([re]) => re.test(String(s || "")))?.[1] || null;
export function rosterDateFromName(name) {
  const m = String(name || "").match(/(\d{2})(\d{2})(20\d{2})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31 ? `${yyyy}-${mm}-${dd}` : null;
}

// ---------- names ----------
const clean = (v) => {
  if (v == null || typeof v === "boolean") return "";
  const s = String(v).replace(/ /g, " ").replace(/\s+/g, " ").trim();
  return /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NULL!|NUM!)$/i.test(s) || s === "0" ? "" : s;
};
// The part before the @, without accents: "Rosa_Diaz_Peña@x.com" -> "rosa_diaz_pena"
export const emailLocal = (email) => fold(String(email || "").split("@")[0]).replace(/[^a-z0-9._-]/g, "");
export const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s) => clean(s).split(/[\s.]+/).filter(Boolean);
const isInitial = (w) => /^[A-Za-zÀ-ÿ]$/.test(w);
const cap = (w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);

// "Feliz Diaz, Jordy R" -> { first: ["Jordy"], last: ["Feliz","Diaz"], display: "Jordy Feliz Diaz" }
// "Oscar Medrano Jimenez" -> { first: ["Oscar"], last: ["Medrano","Jimenez"], display: "Oscar Medrano Jimenez" }
export function parseName(raw) {
  const s = clean(raw);
  if (!s) return null;
  let first, last;
  if (s.includes(",")) {
    const [l, ...f] = s.split(",");
    last = words(l); first = words(f.join(" ")).filter((w) => !isInitial(w));
  } else {
    const w = words(s); first = w.slice(0, 1); last = w.slice(1);
  }
  if (!first.length && last.length) { first = last.slice(0, 1); last = last.slice(1); }
  const display = [...first, ...last].map(cap).join(" ");
  return { raw: s, first: first.map(fold), last: last.map(fold).filter((w) => w.length > 1), display };
}
// Name from an email like "Hillary_mercedes_Ramosvasquez@x.com" -> "Hillary Mercedes Ramosvasquez"
const nameFromEmail = (email) => String(email || "").split("@")[0].split(/[._-]+/).filter(Boolean).map(cap).join(" ");
const emailTokens = (email) => fold(String(email || "").split("@")[0]).split(/[._-]+/).filter(Boolean);

// Two spellings of the same person: same first name and at least one shared surname.
export function sameName(a, b) {
  if (!a || !b || !a.first[0] || !b.first[0]) return false;
  if (a.first[0] !== b.first[0]) return false;
  const la = a.last, lb = b.last;
  if (!la.length || !lb.length) return !la.length && !lb.length;
  const all = (x) => [...x.first.slice(1), ...x.last];
  return la.some((w) => all(b).includes(w)) || lb.some((w) => all(a).includes(w)) || la.join("").includes(lb.join("")) || lb.join("").includes(la.join(""));
}
// Does this email belong to this name? Handles joined surnames: hillary_mercedes_ramosvasquez = "Ramos Vasquez, Hillary M".
export function nameMatchesEmail(n, email) {
  if (!n || !email) return false;
  const t = emailTokens(email);
  if (!t.length || t[0] !== n.first[0]) return false;
  const rest = t.slice(1).join("");
  return !n.last.length || n.last.some((w) => w.length >= 3 && rest.includes(w));
}

// ---------- sheets ----------
const HEADERS = {
  ccms: /^ccms$/, ntLogin: /^nt ?login$/, email: /^client ?e-?mail$|^e-?mail$/, name: /^(agent |employee )?name$/, location: /^location$/,
  teamLead: /^(team ?lead|supervisor|coach)$/, floorManager: /^(floor ?manager|ops ?lead|manager)$/, lob: /^lob$/, wave: /^wave$/,
  tenureDays: /^countable ?bucket$|^tenure ?days$/, tenureBucket: /^tenure ?bucket$/, site: /^site$/, hours: /^paid weekly hours$/,
};
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] || []).map((c) => fold(clean(c)));
    if (cells.includes("ccms") && cells.some((c) => HEADERS.name.test(c))) {
      const cols = {};
      cells.forEach((c, j) => { for (const [k, re] of Object.entries(HEADERS)) if (cols[k] == null && re.test(c)) cols[k] = j; });
      return { index: i, cols };
    }
  }
  return null;
}

// files: [{ name: "IFM - EDB 10122026.xlsx", sheets: [{ name, rows }] }]
export function parseRoster(files, { domain = "pulse.com", rosterDate = null } = {}) {
  domain = String(domain || "pulse.com").replace(/^@/, "").trim().toLowerCase();
  const issues = [];
  const warn = (text, level = "warn") => issues.push({ level, text });
  const agentRows = [], leaderRows = [], lobs = new Set();
  let date = rosterDate;

  for (const f of files) {
    const fileLob = lobFromText(f.name);
    date ||= rosterDateFromName(f.name);
    let used = 0;
    for (const sh of f.sheets) {
      const h = findHeader(sh.rows);
      if (!h || h.cols.name == null) continue;
      const leaders = /sup|lead|leader|manager/i.test(sh.name);
      for (let r = h.index + 1; r < sh.rows.length; r++) {
        const row = sh.rows[r] || [];
        const get = (k) => (h.cols[k] == null ? null : row[h.cols[k]]);
        const name = clean(get("name")), ccms = clean(get("ccms"));
        if (!name && !ccms) continue;
        if (/^(start|end)$/i.test(name)) continue;
        const lobCell = clean(get("lob"));
        const lob = fileLob || lobFromText(lobCell);
        const rec = {
          file: f.name, sheet: sh.name, line: r + 1, ccms: ccms.replace(/\.0+$/, ""), name, email: clean(get("email")).toLowerCase(),
          teamLead: clean(get("teamLead")), floorManager: clean(get("floorManager")), lobCell, lob,
          site: clean(get("site")) || clean(get("location")), tenureBucket: clean(get("tenureBucket")),
          tenureDays: typeof get("tenureDays") === "number" && get("tenureDays") >= 0 && get("tenureDays") < 20000 ? Math.round(get("tenureDays")) : null,
        };
        if (!rec.lob) { warn(`${f.name} line ${r + 1}: can’t tell the line of business for ${name}. Put BVA, IFM, Medicare or NPG in the file name.`); continue; }
        (leaders ? leaderRows : agentRows).push(rec);
        if (!leaders) lobs.add(rec.lob);
        used++;
      }
    }
    if (!used) warn(`${f.name}: no roster rows found. The sheet needs a header row with CCMS, Name, Team Lead and Floor Manager.`);
  }

  // ---------- duplicates ----------
  // Same CCMS twice in one file: identical rows are dropped quietly; if the team lead differs, the lower row wins
  // (rosters are usually edited by adding the new assignment below). Same CCMS in two files: the first file wins.
  {
    const keep = new Map(), moved = [], copies = { n: 0 }, cross = [];
    const out = [];
    for (const a of agentRows) {
      if (!a.ccms) { out.push(a); continue; }
      const b = keep.get(a.ccms);
      if (!b) { keep.set(a.ccms, a); out.push(a); continue; }
      if (b.file !== a.file) { cross.push(`${a.name} (CCMS ${a.ccms}) is in ${b.file} and ${a.file}; kept ${b.lob}`); continue; }
      if (fold(b.teamLead) === fold(a.teamLead) && fold(b.floorManager) === fold(a.floorManager) && b.lobCell === a.lobCell) { copies.n++; continue; }
      moved.push(`${parseName(a.name)?.display || a.name}: ${parseName(b.teamLead)?.display || "no team lead"} → ${parseName(a.teamLead)?.display || "no team lead"}`);
      out[out.indexOf(b)] = a; keep.set(a.ccms, a);
    }
    agentRows.length = 0; agentRows.push(...out);
    if (copies.n) warn(`${copies.n} agents were listed twice with the same details. Each was loaded once.`, "info");
    if (moved.length) warn(`${moved.length} agents appear twice in the same file under different team leads. PULSE kept the lower row (the newer assignment): ${moved.join("; ")}. If the upper rows are the current ones, fix the file and import again.`);
    cross.forEach((t) => warn(t));
  }

  // ---------- leaders (supervisors and floor managers) ----------
  const leaders = [];
  const findLeader = (n) => leaders.find((l) => l.names.some((x) => sameName(x, n)) || (l.email && nameMatchesEmail(n, l.email)));
  const leader = (raw, role) => {
    const n = parseName(raw); if (!n) return null;
    let l = findLeader(n);
    if (!l) { l = { names: [n], display: n.display, roles: new Set(), email: "", ccms: "", agentLobs: {}, agentFms: {}, bossName: "", lobHint: "", site: "", fromSups: false }; leaders.push(l); }
    else if (!l.names.some((x) => x.raw === n.raw)) { l.names.push(n); if (n.display.split(" ").length > l.display.split(" ").length) l.display = n.display; }
    l.roles.add(role);
    return l;
  };
  for (const a of agentRows) {
    a.tl = a.teamLead ? leader(a.teamLead, "supervisor") : null;
    a.fm = a.floorManager ? leader(a.floorManager, "manager") : null;
  }
  for (const a of agentRows) {
    if (a.tl) { a.tl.agentLobs[a.lob] = (a.tl.agentLobs[a.lob] || 0) + 1; if (a.fm) a.tl.agentFms[idOf(a.fm)] = (a.tl.agentFms[idOf(a.fm)] || 0) + 1; if (!a.tl.site && a.site) a.tl.site = a.site; }
    if (a.fm) { a.fm.agentLobs[a.lob] = (a.fm.agentLobs[a.lob] || 0) + 1; }
  }
  function idOf(l) { return leaders.indexOf(l); }

  // Attach the EDB SUPS rows (CCMS + email) to the leaders found above. The email is the most reliable field.
  for (const s of leaderRows) {
    const nameCol = parseName(s.name);
    let l = leaders.find((x) => x.names.some((n) => nameMatchesEmail(n, s.email)));
    if (!l && nameCol && (!s.email || nameMatchesEmail(nameCol, s.email))) l = findLeader(nameCol);
    const nameOk = nameCol && (!s.email || nameMatchesEmail(nameCol, s.email));
    if (s.email && nameCol && !nameOk) warn(`${s.file} › ${s.sheet} line ${s.line}: the name “${s.name}” doesn’t match the email ${s.email}. PULSE used the email.`);
    if (!l) {
      const display = nameOk ? nameCol.display : nameFromEmail(s.email) || s.name;
      const n = parseName(display);
      l = { names: n ? [n] : [], display, roles: new Set(["supervisor"]), email: "", ccms: "", agentLobs: {}, agentFms: {}, bossName: "", lobHint: "", site: "", fromSups: true };
      leaders.push(l);
    }
    if (s.email) l.email ||= s.email;
    if (s.ccms) l.ccms ||= s.ccms;
    l.lobHint ||= s.lob; l.site ||= s.site;
    l.bossName ||= s.teamLead; // in EDB SUPS, "Team Lead" is the leader's own boss
    l.supsRow = s;
  }

  // ---------- roles, reporting lines ----------
  const people = [];
  const majority = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];
  const keyFor = (p) => (p.ccms ? `ccms:${p.ccms}` : `name:${p.names[0]?.first[0] || ""}|${(p.names[0]?.last || []).join("_")}`);
  for (const l of leaders) {
    l.role = l.roles.has("manager") ? "manager" : "supervisor";
    const lobList = Object.keys(l.agentLobs);
    l.lob = l.role === "manager" ? (lobList.length === 1 ? lobList[0] : "All") : (majority(l.agentLobs)?.[0] || l.lobHint || null);
    l.key = keyFor(l);
  }
  for (const l of leaders.filter((x) => x.role === "supervisor")) {
    const top = majority(l.agentFms);
    const total = Object.values(l.agentFms).reduce((a, b) => a + b, 0);
    if (top) {
      l.manager = leaders[top[0]];
      if (top[1] < total) warn(`${l.display}: ${total - top[1]} of ${total} agents list a different floor manager. PULSE put ${l.display} under ${l.manager.display}.`, "info");
    } else if (l.bossName) {
      const boss = parseName(l.bossName);
      l.manager = leaders.find((x) => x.role === "manager" && x.names.some((n) => sameName(n, boss))) || null;
    }
    const agents = Object.values(l.agentLobs).reduce((a, b) => a + b, 0);
    if (!agents) warn(`${l.display} is in the supervisors sheet but has no agents in these files.${l.manager ? ` Added under ${l.manager.display}.` : ` No floor manager found (their sheet lists ${l.bossName || "nobody"}).`}`, "info");
    if (agents > 35) warn(`${l.display} has ${agents} agents. Check whether this is a trainer or a placeholder team lead.`, "info");
  }
  for (const l of leaders.filter((x) => x.role === "manager")) {
    const n = Object.values(l.agentLobs).reduce((a, b) => a + b, 0);
    if (n && n < 5) warn(`${l.display} is floor manager for only ${n} agent${n > 1 ? "s" : ""}. Check that those agents are assigned correctly.`);
  }

  // Agents. A person listed as a leader isn't also loaded as an agent.
  const leaderCcms = new Set(leaders.map((l) => l.ccms).filter(Boolean));
  const agents = [];
  for (const a of agentRows) {
    if (a.ccms && leaderCcms.has(a.ccms)) { warn(`${parseName(a.name)?.display || a.name} (CCMS ${a.ccms}) is listed as an agent and as a leader. Loaded as a leader only.`, "info"); continue; }
    if (!a.tl) warn(`${a.file} line ${a.line}: ${a.name} has no team lead.`);
    if (!a.ccms) warn(`${a.file} line ${a.line}: ${a.name} has no CCMS, so future roster updates can’t match them reliably.`);
    agents.push(a);
  }

  // ---------- emails (login IDs) ----------
  const used = new Set();
  const loginEmail = (clientEmail, display, who) => {
    const local = clientEmail ? emailLocal(clientEmail) : fold(display).replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "_");
    let e = `${local}@${domain}`, i = 2;
    while (used.has(e)) e = `${local}${i++}@${domain}`;
    if (i > 2) warn(`Two people would get the login ${local}@${domain}. ${who} got ${e}.`);
    used.add(e);
    return e;
  };
  const tenure = (days) => (days == null || !date ? null : addDays(date, -days));

  for (const l of [...leaders].sort((a, b) => (a.role === b.role ? 0 : a.role === "manager" ? -1 : 1))) {
    const generated = !l.email;
    people.push({
      roster_key: l.key, employee_id: l.ccms || null, name: l.display, email: loginEmail(l.email, l.display, l.display), email_generated: generated,
      role: l.role, lob: l.lob, sub_lob: null, in_production: true, site: l.site || null, tenure_days: null, tenure_bucket: null, hire_date: null,
      manager_key: l.role === "supervisor" ? l.manager?.key || null : null, supervisor_key: null,
    });
  }
  for (const a of agents) {
    const n = parseName(a.name);
    const sub = a.lobCell && fold(a.lobCell) !== fold(a.lob) && lobFromText(a.lobCell) !== a.lob ? a.lobCell : null;
    people.push({
      roster_key: a.ccms ? `ccms:${a.ccms}` : `name:${n.first[0]}|${n.last.join("_")}`, employee_id: a.ccms || null, name: n.display,
      email: loginEmail(a.email, n.display, n.display), email_generated: !a.email,
      role: "agent", lob: a.lob, sub_lob: sub, in_production: !(sub && (NOT_IN_PRODUCTION.test(sub) || OTHER_NON_PRODUCTION.test(sub))),
      site: a.site || null, tenure_days: a.tenureDays, tenure_bucket: a.tenureBucket || null, hire_date: tenure(a.tenureDays),
      supervisor_key: a.tl?.key || null, manager_key: a.fm?.key || null,
    });
  }
  const gen = people.filter((p) => p.email_generated);
  if (gen.length) warn(`${gen.length} people had no email in the files, so PULSE made one from their name: ${gen.map((p) => `${p.name} → ${p.email}`).join("; ")}.`, "info");

  const stats = {
    roster_date: date, domain, lobs: [...lobs],
    managers: people.filter((p) => p.role === "manager").length, supervisors: people.filter((p) => p.role === "supervisor").length,
    agents: people.filter((p) => p.role === "agent").length, not_in_production: people.filter((p) => p.role === "agent" && !p.in_production).length,
  };
  return { people, issues, stats };
}

// ---------- tree for the preview ----------
export function rosterTree(people) {
  const byKey = Object.fromEntries(people.map((p) => [p.roster_key, p]));
  return people.filter((p) => p.role === "manager").map((m) => ({
    name: m.name, email: m.email, lob: m.lob,
    supervisors: people.filter((s) => s.role === "supervisor" && s.manager_key === m.roster_key).map((s) => {
      const team = people.filter((a) => a.role === "agent" && a.supervisor_key === s.roster_key);
      return { name: s.name, email: s.email, lob: s.lob, agents: team.length, not_in_production: team.filter((a) => !a.in_production).length, sub_lobs: [...new Set(team.map((a) => a.sub_lob).filter(Boolean))] };
    }).sort((a, b) => b.agents - a.agents),
    direct_agents: people.filter((a) => a.role === "agent" && a.manager_key === m.roster_key && !(byKey[a.supervisor_key]?.role === "supervisor")).length,
  })).concat((() => {
    const orphans = people.filter((s) => s.role === "supervisor" && !s.manager_key);
    return orphans.length ? [{ name: "No floor manager", email: "", lob: "", supervisors: orphans.map((s) => ({ name: s.name, email: s.email, lob: s.lob, agents: people.filter((a) => a.supervisor_key === s.roster_key).length, not_in_production: 0, sub_lobs: [] })), direct_agents: 0 }] : [];
  })());
}

// ---------- write to the store ----------
const FIELDS = ["name", "email", "role", "lob", "sub_lob", "in_production", "site", "tenure_days", "tenure_bucket", "hire_date", "employee_id", "roster_key"];
const isDemo = (u) => /@pulse\.demo$/i.test(u.email || "");

export async function applyRoster(store, parsed, { dryRun = true, removeDemo = false } = {}) {
  const { people, stats } = parsed;
  const existing = await store.list("users");
  const byKey = new Map(), byCcms = new Map(), byEmail = new Map();
  for (const u of existing) {
    if (u.roster_key) byKey.set(u.roster_key, u);
    if (u.employee_id) byCcms.set(String(u.employee_id), u);
    if (u.email) byEmail.set(u.email.toLowerCase(), u);
  }
  const match = (p) => byKey.get(p.roster_key) || (p.employee_id && byCcms.get(p.employee_id)) || byEmail.get(p.email) || null;
  const plan = { create: [], update: [], same: [], deactivate: [], demo: existing.filter(isDemo), keep: [] };
  const matched = new Set(), pairs = [], idToKey = new Map();
  for (const p of people) {
    const u = match(p);
    if (u && !matched.has(u.id)) { matched.add(u.id); pairs.push({ p, u }); idToKey.set(u.id, p.roster_key); }
    else plan.create.push({ p });
  }
  for (const { p, u } of pairs) {
    const patch = {};
    for (const f of FIELDS) if ((u[f] ?? null) !== (p[f] ?? null)) patch[f] = p[f];
    if (u.active === false) patch.active = true;
    // Reporting lines: compare by roster person, since new leaders don't have an id yet.
    if ((idToKey.get(u.manager_id) ?? null) !== (p.manager_key ?? null)) patch.manager = p.manager_key;
    if ((idToKey.get(u.supervisor_id) ?? null) !== (p.role === "agent" ? p.supervisor_key ?? null : null)) patch.supervisor = p.supervisor_key;
    (Object.keys(patch).length ? plan.update : plan.same).push({ p, u, patch });
  }
  const lobs = new Set(stats.lobs);
  for (const u of existing) {
    if (matched.has(u.id) || isDemo(u)) continue;
    if (u.source === "roster" && u.active !== false && (u.role === "agent" || u.role === "supervisor") && lobs.has(u.lob)) plan.deactivate.push(u);
    else if (u.active !== false) plan.keep.push(u);
  }
  const summary = {
    ...stats,
    create: plan.create.length, update: plan.update.length, same: plan.same.length, deactivate: plan.deactivate.length,
    demo: plan.demo.length, remove_demo: removeDemo && plan.demo.length > 0,
    deactivate_list: plan.deactivate.map((u) => `${u.name} (${u.role}, ${u.lob})`),
    kept_list: plan.keep.map((u) => `${u.name} · ${u.email} (${u.role})`),
    changes: plan.update.slice(0, 60).map(({ u, patch }) => `${u.name}: ${Object.keys(patch).filter((k) => k !== "roster_key").map((k) => k.replace(/_/g, " ")).join(", ") || "linked to the roster"}`),
  };
  if (dryRun) return { dryRun: true, summary };

  const now = new Date().toISOString();
  const ids = new Map(); // roster_key -> user id
  for (const { p, u } of [...plan.update, ...plan.same]) ids.set(p.roster_key, u.id);
  const row = (p) => {
    const r = Object.fromEntries(FIELDS.map((f) => [f, p[f] ?? null]));
    return { ...r, active: true, source: "roster", roster_date: stats.roster_date, manager_id: ids.get(p.manager_key) || null, supervisor_id: p.role === "agent" ? ids.get(p.supervisor_key) || null : null };
  };
  try {
    // Managers first, then supervisors, then agents, so every reporting line points at a saved person.
    for (const role of ["manager", "supervisor", "agent"]) {
      const fresh = plan.create.filter((x) => x.p.role === role).map((x) => x.p);
      for (let i = 0; i < fresh.length; i += 200) {
        const saved = await store.insertMany("users", fresh.slice(i, i + 200).map((p) => ({ ...row(p), created_at: now })));
        saved.forEach((s, j) => ids.set(fresh[i + j].roster_key, s.id));
      }
      for (const { p, u } of [...plan.update, ...plan.same].filter((x) => x.p.role === role)) {
        const target = row(p);
        const patch = Object.fromEntries(Object.entries(target).filter(([k, v]) => (u[k] ?? null) !== (v ?? null)));
        if (Object.keys(patch).some((k) => k !== "roster_date")) await store.update("users", u.id, patch); // a new roster date alone isn't worth a write
      }
    }
    for (const u of plan.deactivate) await store.update("users", u.id, { active: false });
    if (removeDemo && plan.demo.length) await removeDemoPeople(store, plan.demo);
  } catch (e) {
    if (/column|schema cache/i.test(e.message)) throw Object.assign(new Error(`${e.message}. Run supabase/migrations/003_roster.sql in the Supabase SQL editor, then import again.`), { status: 400 });
    throw e;
  }
  return { dryRun: false, summary };
}

// Fictional demo people (@pulse.demo) and everything attached to them. Agents first, then supervisors, then managers.
async function removeDemoPeople(store, demo) {
  const ids = demo.map((u) => u.id);
  if (store.kind !== "supabase") { // Supabase deletes the attached rows itself (on delete cascade)
    for (const [table, col] of [["kpi_weekly", "agent_id"], ["verbatims", "agent_id"], ["coaching_sessions", "agent_id"], ["commitments", "agent_id"], ["weekly_sessions", "agent_id"], ["quizzes", "agent_id"], ["roleplays", "user_id"], ["training_completions", "user_id"]]) {
      for (const r of await store.list(table, { [col]: ids })) await store.remove(table, r.id);
    }
  }
  for (const role of ["agent", "supervisor", "manager"]) for (const u of demo.filter((x) => x.role === role)) await store.remove("users", u.id);
}

