// Manager views: overview, daily inspection, effectiveness, KPI goals.
import { KPIS, LOBS, GUIDES } from "../core/constants.js";
import { esc, $, $$, kpiTile, fmtKpi, statusChip, bName, rcName, sName, dateLabel, weekLabel, toast } from "../ui.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const pctChip = (v, good = 80, ok = 60) => (v == null ? `<span class="chip plain">—</span>` : `<span class="chip ${v >= good ? "ok" : v >= ok ? "warn" : "bad"}">${v}%</span>`);

export async function overview(main, params, { api, go }) {
  const d = await api("GET", `/api/dashboard/manager${params.lob ? `?lob=${encodeURIComponent(params.lob)}` : ""}`);
  const maxB = Math.max(1, ...d.behaviors.map((b) => b.count));
  const lobTabs = d.lobs.length > 1 ? `<div class="seg" role="group" aria-label="Line of business"><button data-lob="" aria-pressed="${!d.lob}">All</button>${d.lobs.map((l) => `<button data-lob="${esc(l)}" aria-pressed="${d.lob === l}">${esc(l)} <span class="mono">${d.lob_counts[l]}</span></button>`).join("")}</div>` : "";
  main.innerHTML = head("Operations overview", `${weekLabel(d.week)} · ${d.people.supervisors} supervisors · ${d.people.agents} agents${d.people.agents - d.people.in_production ? ` (${d.people.agents - d.people.in_production} in training)` : ""}${!d.lob && d.lobs.length > 1 ? ` · KPI tiles use ${esc(d.lobs[0])} goals` : ""}`, lobTabs) +
  (!d.people.agents ? `<div class="sticky mt">No agents under you yet. Import the roster in <button class="btn sm" data-go="upload">Data upload › Roster</button></div>`
    : KPIS.every((k) => d.org[k.id].value == null) ? `<div class="card mt" style="margin-bottom:16px"><h3>No KPI numbers yet</h3><p class="small muted mt">Your agents are loaded, but PULSE has no weekly KPIs for them, so groups, alerts and “who to coach first” are empty.</p>
      <div class="row mt"><button class="btn primary" data-up="kpis">Upload real KPIs</button><button class="btn" data-up="sample">Turn on sample data to explore</button></div></div>` : "") +
  `<div class="kpis">${KPIS.map((k) => kpiTile(k.id, d.org[k.id], { withSpark: false })).join("")}</div>
  <div class="card mt"><div class="card-h"><h3>Supervisors this week</h3><span class="small muted">Rhythm = sessions held of those due. Met = reviewed commitments met.</span></div>
    <div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Supervisor</th><th>MES NPS</th><th>CSAT</th><th>DD FCR</th><th>Rhythm</th><th>Commitments</th><th>Acknowledged</th><th>Met</th><th>Documented</th><th>Training</th><th>Alerts</th></tr></thead><tbody>
    ${d.supervisors.map((s) => { const c = s.compliance; return `<tr class="click" data-sup="${s.id}"><td><b>${esc(s.name)}</b><div class="small muted">${esc(s.lob)} · ${s.agents} agents</div></td>
      ${["nps", "csat", "fcr"].map((k) => `<td class="num ${s.team[k].value == null ? "" : s.team[k].onGoal ? "cell-ok" : "cell-bad"}">${fmtKpi(k, s.team[k].value)}</td>`).join("")}
      <td>${pctChip(c.rate)} <span class="small muted mono">${c.heldDue}/${c.due}</span></td><td class="num">${s.commitments.thisWeek}</td>
      <td>${pctChip(pct(c.commitments.acknowledged, c.commitments.total))}</td><td>${pctChip(pct(s.commitments.met, s.commitments.reviewed), 70, 50)}</td>
      <td>${pctChip(s.documented)}</td><td class="num">${s.training.length}/${GUIDES.length}</td><td>${s.alerts ? `<span class="chip warn">${s.alerts}</span>` : `<span class="chip ok">0</span>`}</td></tr>`; }).join("")}
    </tbody></table></div></div>
  <div class="grid g3 mt">
    <div class="card"><h3>Behaviors being coached</h3><div class="bars">${d.behaviors.sort((a, b) => b.count - a.count).map((b) => `<div class="bar-row"><span>${esc(b.name)}</span><div class="bar-track" title="${b.count} commitments, ${b.met} met"><div class="bar-fill" style="width:${(b.count / maxB) * 100}%"></div></div><span class="mono small">${b.count}</span></div>`).join("")}</div><p class="small muted mt">All commitments to date, by core behavior.</p></div>
    <div class="card"><h3>Met rate by root cause</h3><div class="bars">${d.byRootCause.map((r) => { const p = pct(r.met, r.reviewed); return `<div class="bar-row"><span>${esc(r.name)}</span><div class="bar-track" title="${r.met} of ${r.reviewed} met"><div class="bar-fill" style="width:${p || 0}%"></div></div><span class="mono small">${p == null ? "—" : p + "%"}</span></div>`; }).join("")}</div><p class="small muted mt">Low rates point to a cause being misdiagnosed or the wrong tool.</p></div>
    <div class="card"><h3>Performance groups</h3><div class="list">${d.quartiles.map((q) => `<div class="li"><span class="chip plain q-${q.id}">${esc(q.name)}</span><div class="grow small">${esc(q.action)}</div><b class="mono">${q.count}</b></div>`).join("")}</div>
      <hr><p class="small"><b>${d.effectiveness.improved}</b> of <b>${d.effectiveness.agents}</b> coached agents improved on their focus KPI. <button class="btn sm ghost" data-go="effect">Details →</button></p></div>
  </div>`;
  $$("[data-sup]", main).forEach((r) => (r.onclick = () => go("sup-dash", { supervisor_id: r.dataset.sup })));
  $$("[data-go]", main).forEach((b) => (b.onclick = () => go(b.dataset.go, b.dataset.go === "upload" ? { kind: "roster" } : {})));
  $$("[data-lob]", main).forEach((b) => (b.onclick = () => go("mgr-overview", b.dataset.lob ? { lob: b.dataset.lob } : {})));
  $$("[data-up]", main).forEach((b) => (b.onclick = () => go("upload", { kind: b.dataset.up })));
}

export async function inspection(main, _p, { api, go }) {
  const d = await api("GET", "/api/dashboard/manager");
  const ins = d.inspection;
  const bySup = {};
  ins.sessions.forEach((s) => (bySup[s.supervisor_name] ||= []).push(s));
  main.innerHTML = head("Daily inspection", `Coaching actions from ${dateLabel(ins.date)}: how many agents were coached, on what, how, and when the loop closes.`) +
    (Object.keys(bySup).length ? `<div class="grid g2">${Object.entries(bySup).map(([sup, list]) => `<div class="card"><div class="card-h"><h3>${esc(sup)}</h3><span class="chip ${list.every((x) => x.status === "held") ? "ok" : "warn"}">${list.filter((x) => x.status === "held").length}/${list.length} held</span></div>
      <div class="list">${list.map((s) => `<div class="li"><div class="grow"><div class="t">${esc(s.agent_name)} · ${esc(sName(s.type))}</div>
        <div class="small">${s.commitment ? `${esc(bName(s.commitment.behavior))} (${esc(rcName(s.commitment.root_cause))}) · “${esc(s.commitment.action)}”` : "No commitment linked"}</div>
        <div class="small muted">How: ${esc(s.tool || "no tool")} · Loop closes: ${s.commitment ? dateLabel(s.commitment.follow_up_date) : "—"}${s.reason ? ` · Reason: ${esc(s.reason)}` : ""}</div></div>${statusChip(s.status)}</div>`).join("")}</div></div>`).join("")}</div>`
      : `<div class="empty">No coaching sessions were planned for ${dateLabel(ins.date)}.</div>`) +
    `<div class="card mt"><h3>Questions for the inspection call</h3><ul class="small"><li>How many agents did you coach, and why those agents?</li><li>Which core behavior, and what root cause did you mark?</li><li>Which coaching tool did you use, and why that one?</li><li>When does the loop close, and what evidence will you bring on Friday?</li><li>What trend did you hear in the calls you reviewed?</li></ul></div>`;
}

export async function effectiveness(main, _p, { api, go }) {
  const d = await api("GET", "/api/dashboard/manager");
  const list = d.effectiveness.list.sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999));
  main.innerHTML = head("Coaching effectiveness", "Focus KPI before the first coaching session (4 weeks) vs. after it, per agent.") +
    `<div class="kpis"><div class="kpi"><span class="k">Agents coached</span><span class="v">${d.effectiveness.agents}</span></div><div class="kpi"><span class="k">Improved on focus KPI</span><span class="v">${d.effectiveness.improved}</span><span class="meta">${pct(d.effectiveness.improved, d.effectiveness.agents) ?? "—"}%</span></div></div>
    <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Agent</th><th>Behavior</th><th>Focus KPI</th><th>Before</th><th>After</th><th>Change</th><th>Commitments met</th></tr></thead><tbody>
    ${list.map((e) => `<tr class="click" data-agent="${e.agent_id}"><td><b>${esc(e.name)}</b><div class="small muted">since ${dateLabel(e.since)}</div></td><td>${esc(bName(e.behavior))}</td><td>${esc(KPIS.find((k) => k.id === e.kpi).name)}</td>
      <td class="num">${fmtKpi(e.kpi, e.before)}</td><td class="num">${fmtKpi(e.kpi, e.after)}</td><td>${e.improved ? `<span class="chip ok">${e.delta > 0 ? "+" : ""}${e.delta}</span>` : `<span class="chip bad">${e.delta ?? "—"}</span>`}</td><td class="num">${e.commitmentsMet}/${e.commitmentsReviewed}</td></tr>`).join("")}</tbody></table></div>
    <p class="small muted mt">Survey KPIs lag and small samples are noisy. Read this next to the behavior counts from Monitor.</p>`;
  $$("[data-agent]", main).forEach((r) => (r.onclick = () => go("agent", { id: r.dataset.agent })));
}

export async function goals(main, _p, { api }) {
  const list = await api("GET", "/api/goals");
  main.innerHTML = head("KPI goals", "Goals per line of business. Every dashboard and alert compares against these.") +
    `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>KPI</th>${LOBS.map((l) => `<th>${esc(l)}</th>`).join("")}</tr></thead><tbody>
    ${KPIS.map((k) => `<tr><td><b>${esc(k.name)}</b><div class="small muted">${k.dir === "higher" ? "Higher is better" : "Lower is better"}${k.id === "aht" ? " · seconds" : ""}</div></td>${LOBS.map((l) => { const g = list.find((x) => x.lob === l && x.kpi === k.id); return `<td>${g ? `<input class="in" type="number" step="0.1" style="width:96px" data-id="${g.id}" value="${g.goal}" aria-label="${esc(k.name)} goal for ${esc(l)}">` : "—"}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="small muted mt">AHT and Quality goals are placeholders until you set your account’s targets.</p>`;
  $$("[data-id]", main).forEach((inp) => (inp.onchange = async () => { try { await api("PATCH", `/api/goals/${inp.dataset.id}`, { goal: Number(inp.value) }); toast("Goal saved."); } catch (e) { toast(e.message, "err"); } }));
}
