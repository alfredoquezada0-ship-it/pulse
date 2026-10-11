// Manager → supervisor coaching: a weekly DIRECT 1:1 and a Friday review, measured from the supervisor's own coaching data.
// Managers: "Supervisor coaching" (all supervisors), a supervisor's page, and the 1:1 form.
// Supervisors: "My coaching" (the same page, read-only, with Acknowledge).
import { SUP_BEHAVIORS, SUP_BEHAVIOR_BY_ID, ROOT_CAUSES, DIRECT_STEPS, LEADER_DIRECT } from "../core/constants.js";
import { leaderSmartCheck } from "../core/services.js";
import { addDays, coachingWeek } from "../core/util.js";
import { esc, $, $$, statusChip, dateLabel, weekLabel, options, rcName, bName } from "../ui.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
const tone = (v) => (v == null ? "" : v >= 90 ? "ok" : v >= 70 ? "warn" : "bad");
const pctChip = (v) => (v == null ? `<span class="chip plain">—</span>` : `<span class="chip ${tone(v)}">${v}%</span>`);
const first = (n) => String(n || "").split(" ")[0];
const supName = (id) => SUP_BEHAVIOR_BY_ID[id]?.name || "—";

// ---------------------------------------------------------------- list (manager)
export async function leaders(main, _p, { api, go }) {
  const d = await api("GET", "/api/leaders");
  const rows = [...d.supervisors].sort((a, b) => Number(a.one_on_one) - Number(b.one_on_one) || a.name.localeCompare(b.name));
  const done = rows.filter((r) => r.one_on_one).length;
  main.innerHTML = head("Supervisor coaching", `${weekLabel(d.week)} · weekly 1:1 with each supervisor, reviewed Friday · ${done} of ${rows.length} 1:1s held`) +
    `<p class="small muted" style="margin:-6px 0 14px">PULSE measures six supervisor behaviors from the coaching your supervisors already log. Coach the lowest one, the same way supervisors coach agents with DIRECT and a SMART commitment.</p>` +
    (rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Supervisor</th>${SUP_BEHAVIORS.map((b) => `<th title="${esc(b.measure)}">${esc(b.short)}</th>`).join("")}<th>This week’s commitment</th><th>1:1</th><th>Met</th></tr></thead><tbody>
      ${rows.map((r) => { const c = r.current; return `<tr class="click" data-sup="${r.id}"><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.lob || "")}</div></td>
        ${SUP_BEHAVIORS.map((b) => `<td>${pctChip(r.metrics[b.id].value)}<div class="small muted mono">last ${r.last[b.id].value ?? "—"}${r.last[b.id].value != null ? "%" : ""}</div></td>`).join("")}
        <td>${c ? `<div class="small"><b>${esc(SUP_BEHAVIOR_BY_ID[c.behavior].short)}</b> · now ${c.live?.value ?? "—"}% of ${c.measure_target}%</div><div class="row" style="margin-top:4px">${statusChip(c.status)}${c.sup_ack ? `<span class="chip ok">Acknowledged</span>` : `<span class="chip warn">Not acknowledged</span>`}</div>` : `<span class="small muted">None yet</span>`}</td>
        <td>${r.one_on_one ? `<span class="chip ok">Held</span>` : `<button class="btn sm primary" data-start="${r.id}">Hold 1:1</button>`}</td>
        <td class="num">${r.reviewed ? `${r.met}/${r.reviewed}` : "—"}</td></tr>`; }).join("")}</tbody></table></div>`
      : `<div class="card"><div class="empty">No supervisors under you yet. Import the roster in Data upload.</div></div>`);
  $$("[data-sup]", main).forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest("[data-start]")) go("leader", { id: tr.dataset.sup }); }));
  $$("[data-start]", main).forEach((b) => (b.onclick = async () => { const s = await api("POST", "/api/leader-sessions", { supervisor_id: b.dataset.start }); go("leader-session", { id: s.id }); }));
}

// ---------------------------------------------------------------- one supervisor (manager) / my coaching (supervisor)
export async function leader(main, { id }, ctx) { render(main, await ctx.api("GET", `/api/leaders/${id}`), ctx, true); }
export async function myCoaching(main, _p, ctx) { render(main, await ctx.api("GET", "/api/my-coaching"), ctx, false); }

function bars(trend, id) {
  const pts = [...trend].reverse().map((t) => t.metrics[id].value);
  return `<div class="mbars" aria-hidden="true">${pts.map((v) => `<span class="${tone(v)}" style="height:${v == null ? 6 : Math.max(8, v)}%" title="${v ?? "—"}"></span>`).join("")}</div>`;
}

// How the supervisor picks the behavior to coach: their own call listening vs. the AI's second opinion, and the results.
function calibrationCard(d, isMgr, s) {
  const x = d.diagnosis; if (!x) return "";
  const who = isMgr ? first(s.name) : "you";
  const stat = (k, v, sub) => `<div class="kpi"><span class="k">${k}</span><span class="v">${v ?? "—"}</span><span class="meta"><span>${sub}</span></span></div>`;
  const rate = (o) => (o.reviewed ? `${o.rate}%` : "—");
  return `<div class="card mt"><div class="card-h"><h3>How ${esc(who)} ${isMgr ? "picks" : "pick"} the behavior to coach</h3><span class="small muted">Last 8 weeks · ${x.diagnoses} diagnos${x.diagnoses === 1 ? "is" : "es"}</span></div>
    ${!x.diagnoses ? `<div class="empty">No diagnoses yet. They’re saved from Coaching prep: listen to 3–5 calls, pick the behavior, then compare with the AI.</div>` : `
    <div class="kpis six">
      ${stat("Calls listened", x.calls_avg, "per diagnosis (3–5 expected)")}
      ${stat("Followed own evidence", x.followed_evidence == null ? null : x.followed_evidence + "%", "picked the most-missed behavior")}
      ${stat("AI agreed", x.ai_agreed == null ? null : x.ai_agreed + "%", "with the first pick")}
      ${stat("Switched to the AI", x.switched_to_ai == null ? null : x.switched_to_ai + "%", "changed their pick")}
      ${stat("Met: own pick", rate(x.own_pick), `${x.own_pick.met} of ${x.own_pick.reviewed} commitments reviewed`)}
      ${stat("Met: changed pick", rate(x.changed_pick), `${x.changed_pick.met} of ${x.changed_pick.reviewed} reviewed`)}
    </div>
    <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Week</th><th>Agent</th><th>Calls</th><th>Most missed</th><th>${isMgr ? "Their" : "Your"} pick</th><th>AI</th><th>Coached</th><th>Result</th></tr></thead><tbody>
      ${x.recent.map((r) => `<tr><td class="num">${dateLabel(r.week_start)}</td><td>${esc(r.agent_name)}</td><td class="num">${r.calls}</td><td>${r.evidence_top ? esc(bName(r.evidence_top)) : "—"}</td><td>${esc(bName(r.sup_pick))}</td><td>${r.ai_pick ? `${esc(bName(r.ai_pick))}${r.agrees ? ` <span class="chip ok plain">agrees</span>` : ""}` : "—"}</td><td><b>${esc(bName(r.final_pick))}</b></td><td>${r.outcome ? statusChip(r.outcome) : "—"}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="small muted mt">${isMgr ? `Use it in the 1:1: when ${esc(who)}’s own pick gets commitments met, trust the listening; when they mostly switch to the AI or skip the calls, coach the diagnosis step.` : "Your manager sees this too. Picks backed by 3–5 calls tend to hold up."}</p>`}</div>`;
}

function render(main, d, { api, go, toast }, isMgr) {
  const s = d.supervisor, c = d.current, last = d.last_week;
  const startBtn = isMgr ? (d.draft ? `<button class="btn primary" data-session="${d.draft.id}">Continue the 1:1</button>` : c ? "" : `<button class="btn primary" id="start">Hold this week’s 1:1</button>`) : "";
  main.innerHTML = head(isMgr ? esc(s.name) : "My coaching", `${isMgr ? `${esc(s.lob || "")} · ${s.agents} agents · ` : `Your weekly 1:1 with your manager · `}${weekLabel(d.week)}`, `${isMgr ? `<button class="btn" data-back>← Supervisor coaching</button>` : ""}${startBtn}`) +
  `<div class="card"><div class="card-h"><h3>${isMgr ? `How ${esc(first(s.name))} is coaching` : "How you’re coaching"}</h3><span class="small muted">This week so far · bars show the last 5 weeks</span></div>
    <div class="sbgrid">${SUP_BEHAVIORS.map((b) => { const m = d.metrics[b.id]; return `<div class="sb${d.suggested === b.id ? " sugg-focus" : ""}">
      <span class="k">${esc(b.name)}</span>${d.suggested === b.id ? `<span><span class="chip focus">Suggested focus</span></span>` : ""}
      <div class="spread mt"><b class="v ${tone(m.value)}">${m.value ?? "—"}${m.value != null ? "%" : ""}</b>${bars(d.trend, b.id)}</div>
      <div class="small muted">${esc(m.text)}${last ? ` · last week ${last[b.id].value ?? "—"}${last[b.id].value != null ? "%" : ""}` : ""}</div></div>`; }).join("")}</div></div>
  ${calibrationCard(d, isMgr, s)}
  <div class="grid g-main mt"><div class="stack">
    <div class="card"><div class="card-h"><h3>This week’s commitment</h3>${c ? statusChip(c.status) : ""}</div>
      ${c ? `<div class="row"><span class="chip teal">${esc(supName(c.behavior))}</span><span class="chip">Root cause: ${esc(rcName(c.root_cause))}</span>${c.sup_ack ? `<span class="chip ok">Acknowledged</span>` : `<span class="chip warn">Not acknowledged yet</span>`}</div>
        <div class="sticky mt"><span class="eyebrow">Agreed action</span><p style="font-weight:650;font-size:1.05rem;margin-top:4px">“${esc(c.action)}”</p></div>
        <p class="small mt"><b>Target:</b> ${c.measure_target}% · <b>Checked by:</b> ${esc(c.check_method || "")} · <b>Review:</b> ${dateLabel(c.follow_up_date)}</p>
        <div class="progress mt" title="Measured now"><span class="${tone(c.live?.value)}" style="width:${Math.min(100, c.live?.value ?? 0)}%"></span><i style="left:${c.measure_target}%"></i></div>
        <p class="small mt"><b>Measured now: ${c.live?.value ?? "—"}${c.live?.value != null ? "%" : ""}</b> · ${esc(c.live?.text || "")}${c.result_value != null ? ` · Friday result: ${Math.round(c.result_value)}%` : ""}</p>
        ${c.review_notes ? `<p class="small mt"><b>Review:</b> ${esc(c.review_notes)}</p>` : ""}
        ${!isMgr && !c.sup_ack ? `<div class="row mt"><button class="btn primary" id="ack">I agree to this commitment</button></div>` : ""}
        ${isMgr && c.status === "open" ? reviewForm(c) : ""}`
      : `<div class="empty">${isMgr ? `No 1:1 with ${esc(first(s.name))} this week yet.` : "Your manager hasn’t held this week’s 1:1 yet."}</div>`}</div>
    <div class="card"><h3>Commitment history</h3>${d.commitments.length ? `<div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Week</th><th>Behavior</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>
      ${d.commitments.map((x) => `<tr><td class="num">${dateLabel(x.week_start)}</td><td>${esc(SUP_BEHAVIOR_BY_ID[x.behavior]?.short || "")}</td><td>${esc(x.action)}</td><td class="num">${x.measure_target}%</td><td><div class="mono small">${x.result_value != null ? Math.round(x.result_value) + "%" : "—"}</div>${statusChip(x.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No commitments yet.</div>`}</div>
  </div><div class="stack">
    <div class="card"><h3>1:1 sessions</h3>${d.sessions.length ? `<div class="list">${d.sessions.map((x) => `<details class="li1"><summary><b>${dateLabel(x.date)}</b> · ${esc(SUP_BEHAVIOR_BY_ID[x.behavior]?.short || "No focus yet")} ${statusChip(x.status)}</summary>
      <div class="small mt">${x.evidence ? `<p><b>Evidence:</b> ${esc(x.evidence)}</p>` : ""}${DIRECT_STEPS.filter((st) => (x.notes || {})[st.id]).map((st) => `<p><b>${st.id} · ${esc(st.name)}:</b> ${esc(x.notes[st.id])}</p>`).join("")}</div>
      ${isMgr && x.status === "draft" ? `<button class="btn sm mt" data-session="${x.id}">Continue</button>` : ""}</details>`).join("")}</div>` : `<div class="empty">No 1:1s yet.</div>`}</div>
    <div class="card"><h3>The six behaviors</h3><div class="list">${SUP_BEHAVIORS.map((b) => `<div class="li"><div class="grow"><div class="t">${esc(b.name)}</div><div class="small muted">${esc(b.desc)}</div></div></div>`).join("")}</div></div>
  </div></div>`;

  const back = $("[data-back]", main); if (back) back.onclick = () => go("leaders");
  $$("[data-session]", main).forEach((b) => (b.onclick = () => go("leader-session", { id: b.dataset.session })));
  const start = $("#start", main); if (start) start.onclick = async () => { const x = await api("POST", "/api/leader-sessions", { supervisor_id: s.id }); go("leader-session", { id: x.id }); };
  const ack = $("#ack", main); if (ack) ack.onclick = async () => { try { await api("POST", `/api/leader-commitments/${c.id}/ack`); toast("Thanks. Your manager can see you agreed."); go("my-coaching"); } catch (e) { toast(e.message, "err"); } };
  const rf = $("#review", main);
  if (rf) rf.onsubmit = async (e) => {
    e.preventDefault();
    const status = $("input[name=rs]:checked", rf)?.value;
    if (!status) return toast("Choose Met, Partially met or Not met.", "err");
    try { await api("POST", `/api/leader-commitments/${c.id}/review`, { status, review_notes: $("#rn", rf).value }); toast("Review saved. The supervisor was notified."); go("leader", { id: s.id }); }
    catch (err) { toast(err.message, "err"); }
  };
}

function reviewForm(c) {
  const v = c.live?.value, sug = v == null ? "" : v >= c.measure_target ? "met" : v >= c.measure_target - 15 ? "partial" : "not_met";
  const opt = (id, label) => `<label class="ck"><input type="radio" name="rs" value="${id}" ${sug === id ? "checked" : ""}> ${label}${sug === id ? ` <span class="small muted">(suggested from ${v}%)</span>` : ""}</label>`;
  return `<form id="review" class="mt"><hr><h3>Friday review</h3><p class="small muted">PULSE measured ${v ?? "—"}${v != null ? "%" : ""} against a ${c.measure_target}% target. Give kudos if it’s met; if not, hold the line and adjust next week’s plan.</p>
    <div class="stack mt" style="gap:6px">${opt("met", "Met")}${opt("partial", "Partially met")}${opt("not_met", "Not met")}</div>
    <label class="f mt">Notes for ${esc("the supervisor")}<textarea class="in" id="rn" placeholder="What you recognized, what changes next week"></textarea></label>
    <div class="row mt"><button class="btn primary">Save review</button></div></form>`;
}

// ---------------------------------------------------------------- the 1:1 (manager)
export async function leaderSession(main, { id }, { api, go, toast }) {
  const d = await api("GET", `/api/leader-sessions/${id}`);
  const s = d.session, done = s.status === "completed", sup = d.supervisor;
  const wk = coachingWeek(s.date), friday = addDays(wk, 4);
  const lastM = s.metrics?.last_week || {}, thisM = s.metrics?.this_week || {};
  const label = (b) => `${b.name}${lastM[b.id]?.value != null ? ` · last week ${lastM[b.id].value}%` : ""}`;
  main.innerHTML = head(`1:1 · ${esc(sup.name)}`, `${dateLabel(s.date)} · DIRECT, for the week of ${dateLabel(wk)}`, `<button class="btn" data-back>← ${esc(first(sup.name))}</button>${statusChip(s.status)}`) +
  (d.last_commitment ? `<div class="sticky"><span class="eyebrow">For the I step: last commitment</span><p class="mt small">${esc(supName(d.last_commitment.behavior))} · “${esc(d.last_commitment.action)}” · ${d.last_commitment.status.replace("_", " ")}${d.last_commitment.result_value != null ? ` (${Math.round(d.last_commitment.result_value)}% of ${d.last_commitment.measure_target}%)` : ""}</p></div>` : "") +
  `<div class="grid g-main mt"><div class="stack">
    <div class="card"><h3>Focus</h3><div class="fgrid">
      <label class="f">Supervisor behavior<select class="in" id="beh" ${done ? "disabled" : ""}>${options(SUP_BEHAVIORS.map((b) => ({ id: b.id, name: label(b) })), s.behavior, "Pick one")}</select></label>
      <label class="f">Root cause (why it slips)<select class="in" id="rc" ${done ? "disabled" : ""}>${options(ROOT_CAUSES, s.root_cause, "Pick one")}</select></label>
      <label class="f wide">Evidence (what PULSE measured, what you saw)<textarea class="in" id="ev" ${done ? "disabled" : ""}>${esc(s.evidence || "")}</textarea></label></div>
      <p class="small muted mt" id="bdesc"></p></div>
    <div class="card"><div class="card-h"><h3>DIRECT notes</h3><span class="small muted">The same six steps, aimed at the supervisor’s coaching</span></div><div class="steps">
      ${DIRECT_STEPS.map((st) => `<div class="step"><span class="L">${st.id}</span><div><div class="nm">${esc(st.name)}</div><div class="small muted">${esc(LEADER_DIRECT[st.id])}</div>
        <textarea class="in mt" data-step="${st.id}" aria-label="${esc(st.name)} notes" ${done ? "disabled" : ""}>${esc((s.notes || {})[st.id] || "")}</textarea></div></div>`).join("")}</div></div>
  </div><div class="stack">${done ? `<div class="card"><h3>Commitment</h3>${d.commitment ? `<div class="sticky"><p style="font-weight:600">“${esc(d.commitment.action)}”</p><p class="small mt">Target ${d.commitment.measure_target}% · ${esc(d.commitment.check_method || "")} · review ${dateLabel(d.commitment.follow_up_date)}</p></div><div class="row mt">${statusChip(d.commitment.status)}${d.commitment.sup_ack ? `<span class="chip ok">Acknowledged</span>` : `<span class="chip warn">Waiting for ${esc(first(sup.name))}</span>`}</div>` : ""}<button class="btn mt" data-open>Open ${esc(first(sup.name))}’s page</button></div>` : `
    <div class="card"><h3>T · SMART commitment</h3><p class="small muted">One thing ${esc(first(sup.name))} will do this week, in their words. PULSE measures it, and you review it Friday.</p>
      <div class="sugg mt" id="ideas"></div>
      <div class="fgrid mt"><label class="f wide">Agreed action<textarea class="in" id="act"></textarea></label>
      <label class="f">Target<select class="in" id="tg">${options([{ id: "100", name: "100%" }, { id: "90", name: "90%" }, { id: "80", name: "80%" }], "90")}</select></label>
      <label class="f">Friday review<input class="in" type="date" id="fu" value="${friday}"></label>
      <label class="f wide">How it’s checked<input class="in" id="cm"></label></div>
      <div class="smart mt" id="smart"></div></div>
    <div class="card"><h3>This week so far</h3><div class="list">${SUP_BEHAVIORS.map((b) => `<div class="li"><div class="grow small">${esc(b.short)}</div>${pctChip(thisM[b.id]?.value ?? null)}</div>`).join("")}</div></div>
    <div class="row"><button class="btn" id="save">Save draft</button><button class="btn primary" id="complete">Complete 1:1</button></div>`}
  </div></div>`;

  $("[data-back]", main).onclick = () => go("leader", { id: sup.id });
  const op = $("[data-open]", main); if (op) op.onclick = () => go("leader", { id: sup.id });
  const val = (sel) => $(sel, main)?.value;
  const showBehavior = () => {
    const b = SUP_BEHAVIOR_BY_ID[val("#beh")];
    $("#bdesc", main).textContent = b ? `${b.desc} Measured as: ${b.measure.toLowerCase()}.` : "";
    if (done || !b) return;
    $("#ideas", main).innerHTML = b.actions.map((a) => `<button type="button" data-idea>${esc(a)}</button>`).join("");
    $$("[data-idea]", main).forEach((x) => (x.onclick = () => { $("#act", main).value = x.textContent; drawSmart(); }));
    $("#cm", main).value = `Measured in PULSE: ${b.measure.toLowerCase()}`;
    $("#tg", main).value = b.id === "followup" ? "100" : "90";
    const m = lastM[b.id];
    if (m && (!$("#ev", main).value || /^Last week in PULSE/.test($("#ev", main).value))) $("#ev", main).value = `Last week in PULSE: ${m.text}${m.value != null ? ` (${m.value}%)` : ""}.`;
    drawSmart();
  };
  const commitment = () => ({ behavior: val("#beh"), root_cause: val("#rc"), action: val("#act"), measure_target: Number(val("#tg")), measure_total: 100, check_method: val("#cm"), follow_up_date: val("#fu"), week_start: wk, evidence: val("#ev"), session_id: s.id });
  const drawSmart = () => { if (done) return; const r = leaderSmartCheck(commitment()); $("#smart", main).innerHTML = r.checks.map((x) => `<div class="${x.ok ? "ok" : "no"}" title="${esc(x.tip)}"><b>${x.id}</b>${x.ok ? "✓ " + esc(x.name) : esc(x.tip)}</div>`).join(""); };
  $("#beh", main).addEventListener("change", showBehavior);
  showBehavior();
  if (done) return;
  $$("input,textarea,select", main).forEach((el) => el.addEventListener("input", drawSmart));
  const patch = () => ({ behavior: val("#beh") || null, root_cause: val("#rc") || null, evidence: val("#ev"), notes: Object.fromEntries($$("[data-step]", main).map((t) => [t.dataset.step, t.value])) });
  $("#save", main).onclick = async () => { try { await api("PATCH", `/api/leader-sessions/${s.id}`, patch()); toast("Draft saved"); } catch (e) { toast(e.message, "err"); } };
  $("#complete", main).onclick = async () => {
    try {
      await api("PATCH", `/api/leader-sessions/${s.id}`, patch());
      await api("POST", `/api/leader-sessions/${s.id}/complete`, { commitment: commitment() });
      toast(`1:1 completed. ${first(sup.name)} was notified to acknowledge the commitment.`);
      go("leader", { id: sup.id });
    } catch (e) { toast(e.message, "err"); }
  };
  drawSmart();
}
