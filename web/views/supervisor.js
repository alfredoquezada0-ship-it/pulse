// Supervisor views: dashboard, agents, agent detail, DIRECT session list, weekly plan, commitments.
import { KPIS, QUARTILES, SESSION_TYPES, TOOL_NAMES, BEHAVIORS, COMMITMENT_STATUS } from "../core/constants.js";
import { weekStart, addDays, today } from "../core/util.js";
import { resetPasswordModal } from "./account.js";
import { assignRoleplayModal } from "./tools.js";
import { esc, $, $$, kpiTile, fmtKpi, spark, statusChip, quartileChip, bName, rcName, sName, dateLabel, weekLabel, options, sourceTag, modal } from "../ui.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;

export async function dashboard(main, params, { api, go, state }) {
  const q = params.supervisor_id ? `?supervisor_id=${params.supervisor_id}` : "";
  const d = await api("GET", "/api/dashboard/supervisor" + q);
  const isMgr = state.user.role === "manager";
  const name = isMgr ? d.supervisor.name + "’s team" : `Hi, ${esc(d.supervisor.name.split(" ")[0])}`;
  const c = d.compliance;
  const commitmentFor = (id) => d.commitments.find((x) => x.agent_id === id);
  main.innerHTML = head(name, `${esc(d.supervisor.lob)} · ${weekLabel(d.week)} · 4-week averages vs. goal`, isMgr ? `<button class="btn" data-back>← Overview</button>${state.config.authMode === "supabase" ? `<button class="btn ghost" data-reset>Reset ${esc(d.supervisor.name.split(" ")[0])}’s password</button>` : ""}` : `<button class="btn primary ai" data-go="prep">Prep a coaching session</button>`) +
  `<div class="kpis">${KPIS.map((k) => kpiTile(k.id, d.team[k.id], { withSpark: false })).join("")}</div>
  <div class="grid g-main mt">
    <div class="card"><div class="card-h"><h3>Who to coach first</h3><span class="small muted">Ranked by gap to goal, weighted toward MES NPS and FCR</span></div>
      <div class="tbl-wrap" style="border:0"><table class="tbl compact"><thead><tr><th>Agent</th><th>Below goal</th><th>MES NPS trend</th><th>This week</th><th></th></tr></thead><tbody>
      ${d.agents.map((a) => { const cm = commitmentFor(a.id); return `<tr class="click" data-agent="${a.id}"><td><b>${esc(a.name)}</b><div class="mt" style="margin-top:4px">${quartileChip(a.quartile)}</div></td>
        <td>${a.critical.length ? a.critical.slice(0, 3).map((k) => `<span class="chip bad">${esc(KPIS.find((x) => x.id === k).name)}</span>`).join(" ") : `<span class="chip ok">All on goal</span>`}</td>
        <td style="width:110px">${spark(a.kpis.nps.series, a.kpis.nps.goal, "nps")}</td>
        <td>${cm ? `${statusChip(cm.status)} <span class="small muted">${esc(bName(cm.behavior))}</span>` : `<span class="chip plain">No commitment</span>`}</td>
        <td>${isMgr ? "" : `<button class="btn sm ai" data-prep="${a.id}">Prep</button>`}</td></tr>`; }).join("")}
      </tbody></table></div></div>
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Weekly rhythm</h3><button class="btn sm ghost" data-go="weekly"${isMgr ? " hidden" : ""}>Open plan →</button></div>
        <div class="spread"><div><span class="eyebrow">Sessions held so far</span><div class="mono" style="font-size:1.8rem;font-weight:700">${c.heldDue}<span class="muted" style="font-size:1rem"> / ${c.due} due</span></div></div>
        <div style="text-align:right"><span class="eyebrow">Planned this week</span><div class="mono" style="font-size:1.2rem">${c.planned}</div></div></div>
        <div class="row mt"><span class="chip ${c.commitments.acknowledged === c.commitments.total ? "ok" : "warn"}">${c.commitments.acknowledged}/${c.commitments.total} commitments acknowledged</span><span class="chip ${c.commitments.smartOk === c.commitments.total ? "ok" : "warn"}">${c.commitments.smartOk}/${c.commitments.total} pass SMART</span></div>
        ${c.flags.length ? `<div class="list mt">${c.flags.slice(0, 5).map((f) => `<div class="li"><span class="dot medium"></span><div class="grow small">${esc(agentName(d, f.agent_id))}: ${esc(f.text)}</div></div>`).join("")}</div>` : `<p class="small muted mt">No rhythm issues this week.</p>`}
      </div>
      <div class="card"><h3>Alerts</h3>${d.alerts.length ? `<div class="list">${d.alerts.slice(0, 8).map((a) => `<div class="li"><span class="dot ${a.level}"></span><div class="grow small">${esc(a.text)}</div></div>`).join("")}</div>` : `<p class="muted small">Nothing needs attention.</p>`}</div>
    </div>
  </div>
  <div class="card mt"><div class="card-h"><h3>Performance groups by MES NPS</h3><span class="small muted">Equal groups by rank</span></div>
    <div class="board">${QUARTILES.map((qq) => { const list = d.agents.filter((a) => a.quartile === qq.id); return `<div class="lane"><div class="lane-h">${esc(qq.name)}<small>${list.length}</small></div><small class="muted">${esc(qq.action)}</small>
      ${list.map((a) => `<button class="ticket" data-agent="${a.id}"><b>${esc(a.name)}</b><span>NPS ${fmtKpi("nps", a.kpis.nps.value)} · CSAT ${fmtKpi("csat", a.kpis.csat.value)}</span></button>`).join("")}</div>`; }).join("")}</div></div>`;
  $$("[data-agent]", main).forEach((el) => (el.onclick = (e) => { if (e.target.closest("[data-prep]")) return; go("agent", { id: el.dataset.agent }); }));
  $$("[data-prep]", main).forEach((b) => (b.onclick = () => go("prep", { agent_id: b.dataset.prep })));
  $$("[data-go]", main).forEach((b) => (b.onclick = () => go(b.dataset.go)));
  const back = $("[data-back]", main); if (back) back.onclick = () => go("mgr-overview");
  const rs = $("[data-reset]", main); if (rs) rs.onclick = () => resetPasswordModal({ id: d.supervisor.id, name: d.supervisor.name }, { api });
}
const agentName = (d, id) => d.agents.find((a) => a.id === id)?.name || "Agent";

export async function agents(main, _p, { api, go, state }) {
  const list = await api("GET", "/api/agents");
  const isMgr = state.user.role === "manager";
  const training = list.filter((a) => a.in_production === false).length;
  let filter = "", showTraining = false;
  const draw = () => {
    const rows = list.filter((a) => (showTraining || a.in_production !== false) && (!filter || [a.name, a.supervisor_name, a.lob, a.sub_lob, a.employee_id].some((x) => String(x || "").toLowerCase().includes(filter)))).sort((a, b) => b.risk - a.risk);
    $("#count", main).textContent = `${rows.length} of ${list.length}`;
    $("#tb", main).innerHTML = rows.map((a) => `<tr class="click" data-agent="${a.id}"><td><b>${esc(a.name)}</b><div class="small muted">${esc(a.lob)}${a.sub_lob ? " · " + esc(a.sub_lob) : ""}${isMgr ? " · " + esc(a.supervisor_name || "") : ""}</div></td><td>${a.in_production === false ? `<span class="chip">In training</span>` : quartileChip(a.quartile) || `<span class="small muted">No surveys</span>`}</td>
      ${KPIS.map((k) => `<td class="num ${a.kpis[k.id].onGoal ? "" : "cell-bad"}">${fmtKpi(k.id, a.kpis[k.id].value)}</td>`).join("")}<td style="width:120px">${spark(a.kpis.nps.series, a.kpis.nps.goal, "nps")}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">No agents match.</td></tr>`;
    $$("[data-agent]", main).forEach((r) => (r.onclick = () => go("agent", { id: r.dataset.agent })));
  };
  main.innerHTML = head("My agents", "4-week averages. Red means below goal. Groups rank production agents within their line of business.", `<input class="in" id="flt" placeholder="Search name, CCMS, LOB${isMgr ? " or supervisor" : ""}" style="width:260px" aria-label="Search agents">`) +
    `<div class="row" style="margin-bottom:10px"><span class="small muted" id="count"></span>${training ? `<label class="ck"><input type="checkbox" id="trn"> Show ${training} agents in training</label>` : ""}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Agent</th><th>Group</th>${KPIS.map((k) => `<th>${esc(k.name)}</th>`).join("")}<th>NPS trend</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  $("#flt", main).oninput = (e) => { filter = e.target.value.toLowerCase(); draw(); };
  const trn = $("#trn", main); if (trn) trn.onchange = () => { showTraining = trn.checked; draw(); };
  draw();
}

export async function agentDetail(main, { id }, { api, go, state, toast }) {
  const canReset = state.config.authMode === "supabase";
  const [d, assigned] = await Promise.all([api("GET", `/api/agents/${id}`), api("GET", `/api/roleplay-assignments?agent_id=${id}`)]);
  const s = d.summary, canCoach = state.user.role === "supervisor";
  const cur = d.commitments.find((c) => c.week_start === weekStart());
  const eff = d.effectiveness;
  main.innerHTML = head(esc(d.agent.name), `${esc(d.agent.lob)} · ${d.supervisor ? "Supervisor " + esc(d.supervisor.name) : ""} ${s.quartile ? "· " + quartileChip(s.quartile) : ""}`,
    `<button class="btn" data-back>← Back</button>${canCoach ? `<button class="btn primary ai" data-act="prep">AI coaching prep</button><button class="btn" data-assign>Assign roleplay</button><button class="btn" data-act="quiz">Quiz</button>` : ""}${canReset ? `<button class="btn ghost" data-reset>Reset password</button>` : ""}`) +
  `<div class="kpis">${KPIS.map((k) => kpiTile(k.id, s.kpis[k.id])).join("")}</div>
  <div class="grid g2 mt">
    <div class="card"><h3>This week’s commitment</h3>${cur ? commitmentBlock(cur) : `<div class="empty">No commitment this week.${canCoach ? ` <button class="btn sm ai" data-act="prep">Prep one</button>` : ""}</div>`}
      ${eff ? `<hr><div class="eyebrow">Coaching effectiveness</div><p class="mt small">${esc(KPIS.find((k) => k.id === eff.kpi).name)} before coaching: <b class="mono">${fmtKpi(eff.kpi, eff.before)}</b> · after: <b class="mono">${fmtKpi(eff.kpi, eff.after)}</b> ${eff.improved ? `<span class="chip ok">Improved</span>` : eff.improved === false ? `<span class="chip bad">Not yet</span>` : ""}</p><p class="small muted">${eff.commitmentsMet} of ${eff.commitmentsReviewed} reviewed commitments met since ${dateLabel(eff.since)}.</p>` : ""}
    </div>
    <div class="card"><h3>Survey verbatims (last 45 days)</h3><div class="stack">${d.verbatims.slice(0, 6).map((v) => `<div class="verb"><span class="sc">${v.score ?? "?"}/10 · ${dateLabel(v.date)}</span><div>“${esc(v.text)}”</div></div>`).join("") || `<div class="empty">No verbatims uploaded.</div>`}</div></div>
  </div>
  <div class="card mt"><h3>Commitment history</h3>${d.commitments.length ? `<div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Week</th><th>Behavior</th><th>Root cause</th><th>Agreed action</th><th>Monitor</th><th>Result</th></tr></thead><tbody>
    ${d.commitments.map((c) => `<tr><td class="num">${dateLabel(c.week_start)}</td><td>${esc(bName(c.behavior))}</td><td>${esc(rcName(c.root_cause))}</td><td>${esc(c.action)}</td><td class="num">${c.monitor_total ? `${c.monitor_hits}/${c.monitor_total}` : "—"}</td><td>${statusChip(c.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No commitments yet.</div>`}</div>
  <div class="grid g3 mt">
    <div class="card"><h3>DIRECT sessions</h3>${d.sessions.length ? `<div class="list">${d.sessions.map((x) => `<div class="li"><div class="grow"><div class="t">${dateLabel(x.date)} · ${esc(bName(x.behavior))}</div><div class="small muted">${esc(x.evidence || "")}</div></div>${statusChip(x.status)}${canCoach ? `<button class="btn sm" data-session="${x.id}">Open</button>` : ""}</div>`).join("")}</div>` : `<div class="empty">No sessions yet.</div>`}</div>
    <div class="card"><div class="card-h"><h3>Assigned roleplays</h3><button class="btn ghost sm" data-plog>Practice log</button></div>${assigned.length ? `<div class="list">${assigned.map((x) => `<div class="li${x.roleplay_id ? " click" : ""}"${x.roleplay_id ? ` data-rp="${x.roleplay_id}" tabindex="0" role="button"` : ""}><div class="grow"><div class="t">${esc(bName(x.behavior))} · ${esc(x.call_type || "")}</div><div class="small muted">${x.channel === "voice" ? "Voice" : "Chat"} · ${esc(x.difficulty || "")}${x.due_date ? ` · by ${dateLabel(x.due_date)}` : ""}${x.custom ? " · custom scenario" : ""}${x.note ? ` · “${esc(x.note)}”` : ""}</div></div>${x.status === "done" ? `<span class="chip ${x.score >= 4 ? "ok" : "warn"}">${x.score}/5</span>` : statusChip(x.status)}</div>`).join("")}</div>` : `<div class="empty">No roleplays assigned.${canCoach ? "" : ""}</div>`}</div>
    <div class="card"><h3>Quizzes</h3>${d.quizzes.length ? `<div class="list">${d.quizzes.map((x) => `<div class="li"><div class="grow"><div class="t">${esc(x.title)}</div><div class="small muted">${esc(bName(x.behavior))}</div></div>${x.status === "completed" ? `<span class="chip ${x.score >= 80 ? "ok" : "warn"}">${x.score}%</span>` : statusChip(x.status)}</div>`).join("")}</div>` : `<div class="empty">No quizzes yet.</div>`}</div>
  </div>`;
  $("[data-back]", main).onclick = () => history.length && go(state.user.role === "manager" ? "agents" : "sup-dash");
  $$("[data-act]", main).forEach((b) => (b.onclick = () => go(b.dataset.act === "prep" ? "prep" : b.dataset.act === "roleplay" ? "roleplay" : "quizzes", { agent_id: id })));
  const rs = $("[data-reset]", main); if (rs) rs.onclick = () => resetPasswordModal({ id: d.agent.id, name: d.agent.name }, { api });
  $$("[data-rp]", main).forEach((li) => { const open = () => go("practice-detail", { id: li.dataset.rp }); li.onclick = open; li.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
  const pl = $("[data-plog]", main); if (pl) pl.onclick = () => go("practice-log", { agent_id: id, period: "all" });
  const as = $("[data-assign]", main); if (as) as.onclick = () => assignRoleplayModal(d.agent, { api, toast, go, behavior: cur?.behavior, onDone: () => go("agent", { id }) });
  $$("[data-session]", main).forEach((b) => (b.onclick = () => go("session", { id: b.dataset.session })));
}

export function commitmentBlock(c) {
  return `<div class="stack"><div class="row"><span class="chip teal">${esc(bName(c.behavior))}</span><span class="chip plain">Root cause: ${esc(rcName(c.root_cause))}</span>${statusChip(c.status)}${c.agent_ack ? `<span class="chip ok">Acknowledged</span>` : `<span class="chip warn">Not acknowledged</span>`}</div>
    <div class="sticky"><span class="eyebrow">Agreed on-call action</span><p style="font-weight:600;margin-top:4px">“${esc(c.action)}”</p></div>
    <div class="small"><b>Measure:</b> ${c.measure_target} of ${c.measure_total} calls · ${esc(c.check_method || "")}<br><b>Follow-up:</b> ${dateLabel(c.follow_up_date)} · <b>Agent self-log:</b> ${c.self_hits || 0} calls${c.monitor_total ? ` · <b>Monitor:</b> ${c.monitor_hits}/${c.monitor_total}` : ""}</div></div>`;
}

export async function sessions(main, _p, { api, go }) {
  const list = await api("GET", "/api/sessions");
  main.innerHTML = head("DIRECT sessions", "Every coaching conversation, documented with the behavior, root cause and commitment.", `<button class="btn primary ai" data-new>New session with AI prep</button>`) +
    (list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Agent</th><th>Behavior</th><th>Root cause</th><th>Evidence</th><th>Status</th></tr></thead><tbody>
    ${list.map((s) => `<tr class="click" data-id="${s.id}"><td class="num">${dateLabel(s.date)}</td><td><b>${esc(s.agent_name)}</b></td><td>${esc(bName(s.behavior))}</td><td>${esc(rcName(s.root_cause))}</td><td class="small">${esc((s.evidence || "").slice(0, 90))}</td><td>${statusChip(s.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No sessions yet. Start with AI coaching prep.</div>`);
  $("[data-new]", main).onclick = () => go("prep");
  $$("[data-id]", main).forEach((r) => (r.onclick = () => go("session", { id: r.dataset.id })));
}

export async function weekly(main, params, { api, toast, go }) {
  const week = params.week || weekStart();
  const [d, agentsList] = await Promise.all([api("GET", `/api/weekly?week=${week}`), api("GET", "/api/agents")]);
  const c = d.compliance;
  const byAgent = {};
  d.sessions.forEach((s) => ((byAgent[s.agent_id] ||= { name: s.agent_name, list: [] }).list.push(s)));
  const rows = Object.entries(byAgent).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const noPlan = agentsList.filter((a) => !byAgent[a.id]);
  const cell = (s) => !s ? `<div class="cell none">Not planned</div>` : `<div class="cell ${s.status}" data-id="${s.id}">
      <input type="date" value="${s.planned_date || ""}" data-f="planned_date" aria-label="Date"><input type="time" value="${s.planned_time || ""}" data-f="planned_time" aria-label="Time">
      <select data-f="tool" aria-label="Coaching tool">${options(TOOL_NAMES, s.tool, "Coaching tool")}</select>
      <div class="st">${["held", "rescheduled", "missed"].map((st) => `<button data-st="${st}" aria-pressed="${s.status === st}">${st[0].toUpperCase() + st.slice(1)}</button>`).join("")}</div>
      ${s.status === "missed" || s.status === "rescheduled" ? `<input data-f="reason" placeholder="Reason" value="${esc(s.reason || "")}" aria-label="Reason">` : ""}</div>`;
  main.innerHTML = head("Weekly plan", "Your weekly commitment: the four sessions per agent, the coaching tool for each, and whether it happened.",
    `<button class="btn" data-w="-7">← Prev</button><span class="chip plain">${weekLabel(week)}</span><button class="btn" data-w="7">Next →</button>`) +
  `<div class="kpis"><div class="kpi"><span class="k">Held vs. due</span><span class="v">${c.heldDue}/${c.due}</span><span class="meta">${c.rate == null ? "Nothing due yet" : c.rate + "% held"}</span></div>
    <div class="kpi"><span class="k">Planned</span><span class="v">${c.planned}</span><span class="meta">${rows.length} agents in the cycle</span></div>
    <div class="kpi"><span class="k">Commitments</span><span class="v">${c.commitments.total}</span><span class="meta">${c.commitments.acknowledged} acknowledged · ${c.commitments.smartOk} SMART</span></div>
    <div class="kpi"><span class="k">Rhythm flags</span><span class="v">${c.flags.length}</span><span class="meta">Mon–Tue · Wed–Thu · Fri</span></div></div>
  <div class="card mt"><div class="wk-wrap"><div class="wk">
    <div class="hd">Agent</div>${SESSION_TYPES.map((t) => `<div class="hd"><b>${esc(t.name)}</b>${esc(t.window)}</div>`).join("")}
    ${rows.map(([aid, r]) => `<div class="ag">${esc(r.name)}<span class="small muted">${r.list.filter((s) => s.status === "held").length}/4 held</span></div>${SESSION_TYPES.map((t) => cell(r.list.find((s) => s.type === t.id))).join("")}`).join("") || `<div class="empty" style="grid-column:1/-1">No sessions planned this week. Completing a DIRECT session plans all four automatically.</div>`}
  </div></div></div>
  ${c.flags.length ? `<div class="card mt"><h3>Rhythm flags</h3><div class="list">${c.flags.map((f) => `<div class="li"><span class="dot ${f.type === "unmarked" ? "low" : "medium"}"></span><div class="grow small">${esc(byAgent[f.agent_id]?.name || "")}: ${esc(f.text)}</div></div>`).join("")}</div></div>` : ""}
  ${noPlan.length ? `<div class="card mt"><h3>Agents without a plan this week</h3><div class="row">${noPlan.map((a) => `<button class="btn sm ai" data-prep="${a.id}">${esc(a.name)}</button>`).join("")}</div></div>` : ""}`;
  $$("[data-w]", main).forEach((b) => (b.onclick = () => go("weekly", { week: addDays(week, Number(b.dataset.w)) })));
  $$("[data-prep]", main).forEach((b) => (b.onclick = () => go("prep", { agent_id: b.dataset.prep })));
  const save = async (id, patch, rerender) => {
    try { await api("PATCH", `/api/weekly/${id}`, patch); if (rerender) go("weekly", { week }); else toast("Saved"); }
    catch (e) { toast(e.message, "err"); }
  };
  $$(".cell[data-id]", main).forEach((el) => {
    $$("[data-f]", el).forEach((inp) => (inp.onchange = () => save(el.dataset.id, { [inp.dataset.f]: inp.value }, inp.dataset.f === "planned_date")));
    $$("[data-st]", el).forEach((b) => (b.onclick = async () => {
      if (b.dataset.st === "missed") {
        const m = modal(`<h3>Why was this session missed?</h3><p class="small muted mt">Missed sessions need a reason so your manager can help.</p><input class="in mt" id="rsn" placeholder="e.g., Short-staffed on Wednesday"><div class="row mt"><button class="btn primary" id="ok">Mark missed</button><button class="btn" data-close>Cancel</button></div>`);
        $("#ok", m.el).onclick = () => { const r = $("#rsn", m.el).value.trim(); if (!r) return toast("Add a reason.", "err"); m.close(); save(el.dataset.id, { status: "missed", reason: r }, true); };
      } else save(el.dataset.id, { status: b.dataset.st }, true);
    }));
  });
}

export async function commitments(main, params, ctx) {
  const { api, go, toast } = ctx;
  const week = params.week || weekStart();
  const list = await api("GET", `/api/commitments?week=${week}`);
  main.innerHTML = head("Commitments", "SMART commitments on the 7 core behaviors. Review each one in Friday’s Kudos/Accountability.",
    `<button class="btn" data-w="-7">← Prev</button><span class="chip plain">${weekLabel(week)}</span><button class="btn" data-w="7">Next →</button>`) +
    (list.length ? `<div class="grid g2">${list.map((c) => `<div class="card"><div class="card-h"><h3>${esc(c.agent_name)}</h3><div class="row">${c.smart.ok ? `<span class="chip ok">SMART</span>` : `<span class="chip warn">Not SMART</span>`}</div></div>
      ${commitmentBlock(c)}
      <div class="row mt">${c.status === "open" ? `<button class="btn primary" data-review="${c.id}">Friday review</button>` : `<span class="small muted">${esc(c.review_notes || "")}</span>`}<button class="btn sm ghost" data-agent="${c.agent_id}">Agent profile →</button></div></div>`).join("")}</div>`
      : `<div class="empty">No commitments this week. They’re created when you complete a DIRECT session.</div>`);
  $$("[data-w]", main).forEach((b) => (b.onclick = () => go("commitments", { week: addDays(week, Number(b.dataset.w)) })));
  $$("[data-agent]", main).forEach((b) => (b.onclick = () => go("agent", { id: b.dataset.agent })));
  $$("[data-review]", main).forEach((b) => (b.onclick = () => reviewModal(list.find((c) => c.id === b.dataset.review), ctx, () => go("commitments", { week }))));
}

async function reviewModal(c, { api, toast }, done) {
  const m = modal(`<h3>Friday review · ${esc(c.agent_name)}</h3><p class="small muted mt">“${esc(c.action)}”</p>
    <div class="fgrid mt"><label class="f">Calls where it happened (Monitor)<input class="in" type="number" min="0" id="hits" value="${c.monitor_hits ?? ""}"></label><label class="f">Calls reviewed<input class="in" type="number" min="1" id="tot" value="${c.monitor_total ?? c.measure_total}"></label></div>
    <div class="mt"><button class="btn ai" id="ai">Suggest Kudos/Accountability</button></div><div id="sugg" class="mt"></div>
    <label class="f mt">Result<div class="seg" id="seg">${COMMITMENT_STATUS.filter((s) => s.id !== "open").map((s) => `<button type="button" data-s="${s.id}" aria-pressed="false">${esc(s.name)}</button>`).join("")}</div></label>
    <label class="f mt">Notes for next week<textarea class="in" id="notes" placeholder="What you recognized, what got in the way, what changes next week"></textarea></label>
    <div class="row mt"><button class="btn primary" id="save">Save review</button><button class="btn" data-close>Cancel</button></div>`);
  let status = null;
  $$("[data-s]", m.el).forEach((b) => (b.onclick = () => { status = b.dataset.s; $$("[data-s]", m.el).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
  $("#ai", m.el).onclick = async () => {
    const hits = $("#hits", m.el).value, tot = $("#tot", m.el).value;
    if (hits !== "") await api("PATCH", `/api/commitments/${c.id}`, { monitor_hits: Number(hits), monitor_total: Number(tot) });
    $("#sugg", m.el).innerHTML = `<div class="loading">Thinking…</div>`;
    try {
      const r = await api("POST", "/api/ai/review", { commitment_id: c.id });
      $("#sugg", m.el).innerHTML = `<div class="sticky"><div class="spread"><span class="eyebrow">Suggested outcome: ${esc((COMMITMENT_STATUS.find((s) => s.id === r.outcome) || {}).name || r.outcome)}</span>${sourceTag(r)}</div>
        <p class="mt small"><b>Kudos:</b> ${esc(r.kudos)}</p><p class="mt small"><b>Accountability:</b> ${esc(r.accountability)}</p><p class="mt small"><b>Next step:</b> ${esc(r.next_step)}</p><p class="mt small"><b>Next week’s action:</b> ${esc(r.next_week_action)}</p></div>`;
      const btn = $(`[data-s="${r.outcome}"]`, m.el); if (btn) btn.click();
      if (!$("#notes", m.el).value) $("#notes", m.el).value = r.next_step;
    } catch (e) { $("#sugg", m.el).innerHTML = ""; toast(e.message, "err"); }
  };
  $("#save", m.el).onclick = async () => {
    if (!status) return toast("Choose Met, Partially met or Not met.", "err");
    try {
      const r = await api("POST", `/api/commitments/${c.id}/review`, { status, monitor_hits: $("#hits", m.el).value === "" ? null : Number($("#hits", m.el).value), monitor_total: Number($("#tot", m.el).value), review_notes: $("#notes", m.el).value });
      m.close(); toast(r.warning || "Review saved. Kudos/Accountability marked as held.", r.warning ? "err" : ""); done();
    } catch (e) { toast(e.message, "err"); }
  };
}
