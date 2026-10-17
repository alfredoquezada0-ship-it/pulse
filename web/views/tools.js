// Coaching tools shared across roles: AI prep, DIRECT session, roleplay, quizzes, training, data upload.
import { KPIS, ROOT_CAUSES, TOOLS, TOOL_NAMES, SESSION_TYPES, TOOL_PLAN, DIRECT_STEPS, CALL_TYPES, GUIDES } from "../core/constants.js";
import { smartCheck } from "../core/services.js";
import { weekStart, addDays, today, parseCSV, coachingWeek } from "../core/util.js";
import { esc, $, $$, fmtKpi, statusChip, bName, rcName, sName, dateLabel, options, sourceTag, modal, icon, behaviorList, behaviorOf, allBehaviors, bankInfo } from "../ui.js";
import * as Voice from "../voice.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
// Loading message with a live seconds counter, so a slow AI answer never looks frozen.
const busy = (el, text = "Working…") => {
  el.innerHTML = `<div class="loading" aria-live="polite">${esc(text)} <span class="mono" data-secs></span></div>`;
  const span = el.querySelector("[data-secs]"), t0 = Date.now();
  const id = setInterval(() => { if (!span.isConnected) return clearInterval(id); const s = Math.round((Date.now() - t0) / 1000); span.textContent = s >= 2 ? `${s}s` : ""; if (s === 12) span.insertAdjacentText("afterend", " · the AI is busier than usual"); }, 1000);
};

// ---------------------------------------------------------------- Coaching prep (supervisor first, AI second)
// The supervisor listens to 3–5 calls and marks each behavior as shown or missing, picks the behavior and says why,
// and only then sees the AI's second opinion. The supervisor makes the final call.
const MARK_NEXT = { "": "shown", shown: "missed", missed: "" };
const MARK_LABEL = { "": "—", shown: "✓", missed: "✕" };
const MARK_NAME = { "": "not heard", shown: "showed up", missed: "missing" };
export async function prep(main, params, { api, go, toast }) {
  const agents = (await api("GET", "/api/agents")).sort((a, b) => b.risk - a.risk);
  main.innerHTML = head("Coaching prep", "You listen and decide; the AI gives a second opinion. Mark what you heard on 3–5 calls, choose the behavior to coach, then compare with what the data says.") +
    `<div class="card"><div class="fgrid"><label class="f">Agent<select class="in" id="ag">${options(agents.map((a) => ({ id: a.id, name: `${a.name} · ${a.critical.length ? a.critical.length + " KPI below goal" : "on goal"}` })), params.agent_id, "Choose an agent")}</select></label></div><div id="ctx" class="mt"></div></div>
    <div id="listen" class="mt"></div><div id="diag" class="mt"></div><div id="decide" class="mt"></div><div id="plan" class="mt"></div>`;
  const sel = $("#ag", main);
  let detail = null, diag = null, strat = null, pending = null, dx = null;
  let calls = [], pick = "", pickTouched = false, reason = "";
  const first = () => (detail?.agent?.name || "the agent").split(" ")[0];
  const clearBelow = () => { ["#listen", "#diag", "#decide", "#plan"].forEach((x) => ($(x, main).innerHTML = "")); diag = strat = dx = null; pending = null; };
  const newCalls = () => Array.from({ length: 3 }, (_, i) => ({ label: `Call ${i + 1}`, marks: {}, note: "" }));

  const loadAgent = async () => {
    clearBelow();
    if (!sel.value) { $("#ctx", main).innerHTML = ""; return; }
    busy($("#ctx", main), "Loading agent…");
    const [d, past] = await Promise.all([api("GET", `/api/agents/${sel.value}`), api("GET", `/api/diagnoses?agent_id=${sel.value}`)]);
    detail = d;
    const s = detail.summary, cur = detail.commitments[0];
    const low = (detail.verbatims || []).filter((v) => v.score != null && v.score <= 6).slice(0, 4);
    const thisWeek = past.find((x) => x.week_start === coachingWeek(today()) && x.status === "final");
    $("#ctx", main).innerHTML = `<div class="row">${KPIS.map((k) => `<span class="chip ${s.kpis[k.id].onGoal ? "ok" : "bad"}">${esc(k.name)} ${fmtKpi(k.id, s.kpis[k.id].value)}</span>`).join("")}</div>
      ${cur ? `<p class="small mt"><b>Last commitment:</b> ${esc(bName(cur.behavior))} · “${esc(cur.action)}” · ${statusChip(cur.status)}</p>` : `<p class="small muted mt">No previous commitments.</p>`}
      ${low.length ? `<details class="mt"><summary class="small"><b>Recent low survey comments (${low.length})</b></summary><ul class="small">${low.map((v) => `<li>(${v.score}/10) ${esc(v.text)}</li>`).join("")}</ul></details>` : ""}
      ${thisWeek ? `<div class="sticky small mt"><b>Already diagnosed for this coaching week:</b> you picked ${esc(bName(thisWeek.sup_pick))}, the AI ${thisWeek.agrees ? "agreed" : `suggested ${esc(bName(thisWeek.ai_pick))}`}, and you went with <b>${esc(bName(thisWeek.final_pick))}</b>.
        <div class="row mt"><button class="btn sm primary" id="reuse">Use it and build the plan</button><button class="btn sm" id="redo">Start a new diagnosis</button></div></div>` : ""}`;
    calls = newCalls(); pick = ""; pickTouched = false; reason = "";
    if (thisWeek) {
      $("#reuse", main).onclick = () => { dx = thisWeek; diag = thisWeek.ai; drawLocked(); drawSecond(); drawDecision(true); };
      $("#redo", main).onclick = () => { $("#reuse", main).closest(".sticky").remove(); drawListen(); };
    } else drawListen();
  };

  // ---- Step 1 and 2: the supervisor's own evidence and pick ----
  const myBehaviors = () => behaviorList(detail?.agent?.lob);
  const tally = () => myBehaviors().map((b) => ({ b, shown: calls.filter((c) => c.marks[b.id] === "shown").length, missed: calls.filter((c) => c.marks[b.id] === "missed").length }));
  const topMissed = () => { const t = tally().sort((x, y) => y.missed - x.missed || x.shown - y.shown); return t[0].missed ? t[0].b.id : ""; };
  const marked = () => calls.filter((c) => Object.keys(c.marks).length).length;
  const drawListen = () => {
    const top = topMissed();
    if (!pickTouched) pick = top;
    $("#listen", main).innerHTML = `<div class="card"><div class="card-h"><h3>Step 1 · What you heard on ${esc(first())}’s calls</h3><span class="chip ${marked() >= 3 ? "ok" : "plain"}">${marked()} of 3–5 calls marked</span></div>
      <p class="small muted">Listen to 3–5 calls. Click a box once if the behavior <b>showed up</b> (✓), twice if it was <b>missing</b> when it should have been there (✕), three times to clear it.</p>
      <div class="tbl-wrap mt"><table class="tbl lgrid"><thead><tr><th>Behavior</th>${calls.map((c, i) => `<th><input class="in sm-in" data-label="${i}" value="${esc(c.label)}" aria-label="Call ${i + 1} name" maxlength="80"></th>`).join("")}<th>Missing / showed</th></tr></thead><tbody>
        ${tally().map(({ b, shown, missed }) => `<tr class="${top === b.id ? "top" : ""}"><td><b>${esc(b.name)}</b></td>${calls.map((c, i) => { const m = c.marks[b.id] || ""; return `<td><button type="button" class="mk ${m}" data-c="${i}" data-b="${b.id}" aria-label="${esc(b.name)}, ${esc(c.label)}: ${MARK_NAME[m]}">${MARK_LABEL[m]}</button></td>`; }).join("")}<td class="num">${missed ? `<span class="miss-n">✕ ${missed}</span>` : "✕ 0"} · ✓ ${shown}</td></tr>`).join("")}
        <tr><td class="small muted">Note (optional)</td>${calls.map((c, i) => `<td><textarea class="in sm-in" data-note="${i}" rows="2" maxlength="500" placeholder="What happened?">${esc(c.note)}</textarea></td>`).join("")}<td></td></tr>
      </tbody></table></div>
      <div class="row mt">${calls.length < 5 ? `<button class="btn sm" id="addcall">+ Add a call</button>` : ""}${calls.length > 3 ? `<button class="btn ghost sm" id="delcall">Remove the last call</button>` : ""}</div></div>
      <div class="card mt"><h3>Step 2 · Your pick</h3>
        <div class="fgrid"><label class="f">The behavior you’d coach<select class="in" id="mypick">${options([{ id: "", name: "Choose one" }, ...myBehaviors()], pick)}</select></label>
          <div class="f"><span class="small muted">${top ? `Most missed in your calls: <b>${esc(bName(top))}</b>` : "Mark the calls to see which behavior was missed most."}</span></div>
          <label class="f wide">Why this one? <small class="muted">(what you heard: the moment, what the member said or how they reacted)</small><textarea class="in" id="myreason" rows="3" maxlength="1000" placeholder="e.g. On 3 of 4 calls she fixed the issue but never said when the member would hear back; two members asked “so when?”">${esc(reason)}</textarea></label></div>
        <div class="spread mt"><span class="small muted" id="lockhint"></span><button class="btn primary ai" id="lock">Lock in my pick and see the AI’s second opinion</button></div></div>`;
    $$("[data-c]", main).forEach((btn) => (btn.onclick = () => { const c = calls[+btn.dataset.c]; const m = MARK_NEXT[c.marks[btn.dataset.b] || ""]; if (m) c.marks[btn.dataset.b] = m; else delete c.marks[btn.dataset.b]; keepFocus(btn, drawListen); }));
    $$("[data-label]", main).forEach((inp) => (inp.oninput = () => { calls[+inp.dataset.label].label = inp.value; }));
    $$("[data-note]", main).forEach((inp) => (inp.oninput = () => { calls[+inp.dataset.note].note = inp.value; }));
    const add = $("#addcall", main); if (add) add.onclick = () => { calls.push({ label: `Call ${calls.length + 1}`, marks: {}, note: "" }); drawListen(); };
    const del = $("#delcall", main); if (del) del.onclick = () => { calls.pop(); drawListen(); };
    $("#mypick", main).onchange = (e) => { pick = e.target.value; pickTouched = true; check(); };
    $("#myreason", main).oninput = (e) => { reason = e.target.value; check(); };
    $("#lock", main).onclick = lock;
    check();
  };
  const keepFocus = (btn, redraw) => { const key = `[data-c="${btn.dataset.c}"][data-b="${btn.dataset.b}"]`; redraw(); $(key, main)?.focus(); };
  const problem = () => marked() < 3 ? `Mark at least 3 calls (${marked()} so far).` : !pick ? "Choose the behavior you’d coach." : reason.trim().length < 15 ? "Say in a sentence why." : null;
  const check = () => { const p = problem(); $("#lockhint", main).textContent = p || "Your pick is saved before you see the AI’s view."; $("#lock", main).disabled = !!p; };

  const lock = async () => {
    const p = problem(); if (p) return toast(p, "err");
    $("#lock", main).disabled = true;
    busy($("#diag", main), "Comparing your pick with the KPIs, verbatims and history…");
    try { dx = await api("POST", "/api/diagnoses", { agent_id: sel.value, calls, sup_pick: pick, sup_reason: reason }); diag = dx.ai; }
    catch (e) { $("#diag", main).innerHTML = ""; $("#lock", main).disabled = false; return toast(e.message, "err"); }
    drawLocked(); drawSecond(); drawDecision();
  };
  // After locking, the supervisor's evidence is shown read-only, so the first judgment stays their own.
  const drawLocked = () => {
    const t = dx.tally || { rows: [] };
    $("#listen", main).innerHTML = `<div class="card"><div class="card-h"><h3>Your diagnosis</h3><span class="chip teal">Locked in</span></div>
      <p><b>${esc(bName(dx.sup_pick))}</b> · from ${dx.calls.length} calls${dx.evidence_top ? ` · most missed: ${esc(bName(dx.evidence_top))}` : ""}</p><p class="small mt">“${esc(dx.sup_reason)}”</p>
      <details class="mt"><summary class="small">What you marked on each call</summary><ul class="small">${dx.calls.map((c) => `<li><b>${esc(c.label)}:</b> ${Object.entries(c.marks).map(([b, m]) => `${m === "missed" ? "✕" : "✓"} ${esc(bName(b))}`).join(", ")}${c.note ? ` · ${esc(c.note)}` : ""}</li>`).join("")}</ul></details></div>`;
  };
  // ---- Step 3: the AI's second opinion ----
  const drawSecond = () => {
    const agrees = dx.agrees ?? diag.behavior_id === dx.sup_pick;
    $("#diag", main).innerHTML = `<div class="ai-card"><div class="ai-h"><b>Step 3 · AI second opinion</b>${sourceTag(diag)}</div><div class="ai-b">
      <div class="verdict ${agrees ? "ok" : "warn"}"><b>${agrees ? `Agrees with you: ${esc(bName(dx.sup_pick))}` : `Sees it differently: ${esc(bName(diag.behavior_id))}`}</b>${diag.comparison ? `<p class="small">${esc(diag.comparison)}</p>` : ""}</div>
      <div class="grid g2 mt"><div><span class="eyebrow">What the data says · ${esc(diag.confidence || "")} confidence</span><p class="small mt">${esc(diag.why || "")}</p>
          <ul class="small">${(diag.evidence || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>
        <div>${diag.check_next ? `<span class="eyebrow">To settle it on the next calls</span><p class="small mt">${esc(diag.check_next)}</p>` : ""}
          <span class="eyebrow">Listen for</span><ul class="small">${(diag.listen_for || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div></div></div></div>`;
  };
  // ---- Step 4: the supervisor's final call ----
  const drawDecision = (done = false) => {
    const differs = diag.behavior_id !== dx.sup_pick;
    const evidence = [...(dx.calls || []).map((c) => { const miss = Object.entries(c.marks).filter(([, m]) => m === "missed").map(([b]) => bName(b)); return `${c.label}: missing ${miss.join(", ") || "—"}${c.note ? ` (${c.note})` : ""}`; }), ...(diag.evidence || [])].join("\n");
    $("#decide", main).innerHTML = `<div class="card"><h3>Step 4 · Your decision</h3>
      <div class="choice mt">
        <label><input type="radio" name="fin" value="mine" ${!done || dx.final_pick === dx.sup_pick ? "checked" : ""}><span><b>Keep my pick: ${esc(bName(dx.sup_pick))}</b><small>You heard the calls; go with your judgment.</small></span></label>
        ${differs ? `<label><input type="radio" name="fin" value="ai" ${done && dx.final_pick === diag.behavior_id ? "checked" : ""}><span><b>Switch to ${esc(bName(diag.behavior_id))}</b><small>The data convinced you.</small></span></label>` : ""}
        <label><input type="radio" name="fin" value="other" ${done && dx.final_pick !== dx.sup_pick && dx.final_pick !== diag.behavior_id ? "checked" : ""}><span><b>Something else</b><small><select class="in" id="other">${options(myBehaviors(), done ? dx.final_pick : dx.sup_pick)}</select></small></span></label>
      </div>
      <label class="f mt" id="why-wrap" hidden>What changed your mind? <small class="muted">(required when you change your pick)</small><textarea class="in" id="finwhy" rows="2" maxlength="1000">${esc(done && dx.final_pick !== dx.sup_pick ? dx.final_reason || "" : "")}</textarea></label>
      <select id="beh" hidden>${options(behaviorList(detail?.agent?.lob, dx.final_pick || dx.sup_pick), dx.final_pick || dx.sup_pick)}</select>
      <div class="fgrid mt"><label class="f">Root cause to confirm in the session<select class="in" id="rc">${options(ROOT_CAUSES, diag.root_cause_hypothesis?.id || "skill")}</select></label>
        <label class="f wide">Evidence for the session<textarea class="in" id="ev" rows="4">${esc(evidence)}</textarea></label></div>
      <p class="small muted mt">${esc(diag.root_cause_hypothesis?.why || "")}</p>
      <div class="row mt"><button class="btn primary ai" id="go-plan">Confirm and build the coaching plan</button><button class="btn" id="go-direct">Confirm and go to the DIRECT session</button><button class="btn ghost" id="restart">Start over</button></div></div>`;
    const finalPick = () => { const v = $("input[name=fin]:checked", main).value; return v === "mine" ? dx.sup_pick : v === "ai" ? diag.behavior_id : $("#other", main).value; };
    const sync = () => { const f = finalPick(); $("#beh", main).value = f; $("#why-wrap", main).hidden = f === dx.sup_pick; };
    $$("input[name=fin]", main).forEach((r) => (r.onchange = sync)); $("#other", main).onchange = () => { $("input[name=fin][value=other]", main).checked = true; sync(); };
    sync();
    const confirm = async () => {
      const f = finalPick(), why = $("#finwhy", main).value.trim();
      if (f !== dx.sup_pick && why.length < 10) { toast("You changed your pick: say what changed your mind.", "err"); $("#finwhy", main).focus(); return false; }
      try { dx = { ...dx, ...(await api("POST", `/api/diagnoses/${dx.id}/final`, { final_pick: f, final_reason: why })) }; return true; }
      catch (e) { toast(e.message, "err"); return false; }
    };
    $("#go-plan", main).onclick = async () => { if (await confirm()) runPlan(); };
    $("#go-direct", main).onclick = async () => { if (await confirm()) startSession(); };
    $("#restart", main).onclick = () => { clearBelow(); calls = newCalls(); pick = ""; pickTouched = false; reason = ""; drawListen(); };
  };
  const runPlan = async () => {
    busy($("#plan", main), "Building this week’s plan…");
    const k = `${$("#beh", main).value}|${$("#rc", main).value}`;
    try { strat = await (pending && pending.key === k ? pending.promise : api("POST", "/api/ai/strategy", { agent_id: sel.value, behavior: $("#beh", main).value, root_cause: $("#rc", main).value })); }
    catch (e) { pending = null; $("#plan", main).innerHTML = ""; return toast(e.message, "err"); }
    $("#plan", main).innerHTML = `<div class="ai-card"><div class="ai-h"><b>Step 5 · How to coach it this week</b>${sourceTag(strat)}</div><div class="ai-b">
      <div class="grid g4">${SESSION_TYPES.map((t) => `<div class="card" style="padding:14px"><span class="eyebrow">${esc(t.window)}</span><h3 style="margin:4px 0 6px">${esc(t.name)}</h3><span class="chip teal">${esc(strat.tools[t.id]?.tool || "")}</span><p class="small mt">${esc(strat.tools[t.id]?.how || "")}</p></div>`).join("")}</div>
      <h3 class="mt2">DIRECT talk track</h3><div class="steps mt">${DIRECT_STEPS.map((s) => `<div class="step"><span class="L">${s.id}</span><div><div class="nm">${esc(s.name)}</div><div class="sugg">${(strat.direct[s.id]?.say || []).map((x) => `<button type="button" tabindex="-1">“${esc(x)}”</button>`).join("")}${(strat.direct[s.id]?.avoid || []).map((x) => `<button type="button" class="avoid" tabindex="-1">Avoid: ${esc(x)}</button>`).join("")}</div></div></div>`).join("")}</div>
      <div class="grid g2 mt2"><div class="sticky"><span class="eyebrow">SMART commitment draft (agree on it in the agent’s words)</span><p style="font-weight:600;margin-top:6px">“${esc(strat.smart_draft.action)}”</p><p class="small mt">${strat.smart_draft.measure_target} of ${strat.smart_draft.measure_total} calls · ${esc(strat.smart_draft.check_method)}</p></div>
        <div><span class="eyebrow">Skill Transfer practice</span><ul class="small">${(strat.practice || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div></div>
      <div class="row mt2"><button class="btn primary" id="go-session">Start the DIRECT session with this plan</button><button class="btn ai" id="go-quiz">Generate a quiz</button><button class="btn" id="go-rp">Practice in a roleplay</button></div></div></div>`;
    $("#go-session", main).onclick = startSession;
    $("#go-quiz", main).onclick = () => go("quizzes", { agent_id: sel.value, behavior: $("#beh", main).value });
    $("#go-rp", main).onclick = () => go("roleplay", { agent_id: sel.value, behavior: $("#beh", main).value });
  };
  const startSession = async () => {
    try {
      const behavior = $("#beh", main).value;
      const s = await api("POST", "/api/sessions", { agent_id: sel.value, date: today(), behavior, root_cause: $("#rc", main).value, evidence: $("#ev", main).value, kpi_focus: behaviorOf(behavior)?.kpis?.[0] || "nps", ai: { diagnosis: diag, strategy: strat }, diagnosis_id: dx?.id });
      go("session", { id: s.id });
    } catch (e) { toast(e.message, "err"); }
  };
  sel.onchange = loadAgent;
  if (params.agent_id) loadAgent();
}

// ---------------------------------------------------------------- DIRECT session
export async function session(main, { id }, { api, go, toast }) {
  const d = await api("GET", `/api/sessions/${id}`);
  const s = d.session, done = s.status === "completed";
  const strat = s.ai?.strategy || null;
  const wk = coachingWeek(s.date), friday = addDays(wk, 4);
  const draft = { action: strat?.smart_draft?.action || "", measure_target: strat?.smart_draft?.measure_target || 5, measure_total: strat?.smart_draft?.measure_total || 5, check_method: strat?.smart_draft?.check_method || "Remote Call Listening, 5 calls on Wed–Thu", follow_up_date: friday };
  const toolsDefault = (rc) => Object.fromEntries(SESSION_TYPES.map((t) => [t.id, strat?.tools?.[t.id]?.tool || (TOOL_PLAN[rc] || TOOL_PLAN.skill)[t.id]]));
  main.innerHTML = head(`DIRECT session · ${esc(d.agent.name)}`, `${dateLabel(s.date)} · Setting Goals for the week of ${dateLabel(wk)}`, `<button class="btn" data-back>← Sessions</button>${statusChip(s.status)}`) +
  (s.ai?.listening ? `<div class="card" style="margin-bottom:12px"><span class="eyebrow">For the I step: what you heard on the calls</span>
    <p class="small mt"><b>${esc(bName(s.ai.listening.final_pick))}</b>${s.ai.listening.ai_pick && s.ai.listening.ai_pick !== s.ai.listening.final_pick ? ` (the AI suggested ${esc(bName(s.ai.listening.ai_pick))})` : ""} · “${esc(s.ai.listening.final_reason || s.ai.listening.sup_reason || "")}”</p>
    <ul class="small">${(s.ai.listening.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>` : "") +
  (d.last_commitment ? `<div class="sticky"><span class="eyebrow">For the I step: last commitment</span><p class="mt small">${esc(bName(d.last_commitment.behavior))} · “${esc(d.last_commitment.action)}” · ${d.last_commitment.status.replace("_", " ")}${d.last_commitment.monitor_total ? ` (${d.last_commitment.monitor_hits}/${d.last_commitment.monitor_total} calls)` : ""}</p></div>` : "") +
  `<div class="grid g-main mt"><div class="stack">
    <div class="card"><h3>Focus</h3><div class="fgrid">
      <label class="f">Core behavior<select class="in" id="beh" ${done ? "disabled" : ""}>${options(behaviorList(d.agent?.lob, s.behavior), s.behavior, "Pick one")}</select></label>
      <label class="f">Root cause (why this behavior)<select class="in" id="rc" ${done ? "disabled" : ""}>${options(ROOT_CAUSES, s.root_cause, "Pick one")}</select></label>
      <label class="f">KPI it should move<select class="in" id="kf" ${done ? "disabled" : ""}>${options(KPIS, s.kpi_focus)}</select></label>
      <label class="f wide">Evidence (calls, counts, verbatims)<textarea class="in" id="ev" ${done ? "disabled" : ""}>${esc(s.evidence || "")}</textarea></label></div></div>
    <div class="card"><div class="card-h"><h3>DIRECT notes</h3><span class="small muted">Tap a yellow line to add it to your notes</span></div><div class="steps">
      ${DIRECT_STEPS.map((st) => `<div class="step"><span class="L">${st.id}</span><div><div class="nm">${esc(st.name)}</div><div class="small muted">${esc(st.desc)}</div>
        ${strat?.direct?.[st.id] ? `<div class="sugg">${(strat.direct[st.id].say || []).map((x) => `<button type="button" data-ins="${st.id}" ${done ? "disabled" : ""}>“${esc(x)}”</button>`).join("")}${(strat.direct[st.id].avoid || []).map((x) => `<button type="button" class="avoid" tabindex="-1">Avoid: ${esc(x)}</button>`).join("")}</div>` : ""}
        <textarea class="in mt" data-step="${st.id}" aria-label="${esc(st.name)} notes" ${done ? "disabled" : ""}>${esc((s.notes || {})[st.id] || "")}</textarea></div></div>`).join("")}
    </div></div></div>
    <div class="stack">${done ? doneBlock(d) : `
      <div class="card"><h3>T · SMART commitment</h3><p class="small muted">Write it in the agent’s words. It must be something you can hear on a call.</p>
        <div class="fgrid mt"><label class="f wide">Agreed on-call action<textarea class="in" id="act">${esc(draft.action)}</textarea></label>
        <label class="f">Target calls<input class="in" type="number" min="1" id="mt" value="${draft.measure_target}"></label><label class="f">Out of<input class="in" type="number" min="1" id="mo" value="${draft.measure_total}"></label>
        <label class="f wide">How it’s checked<input class="in" id="cm" value="${esc(draft.check_method)}"></label>
        <label class="f">Follow-up (Friday review)<input class="in" type="date" id="fu" value="${draft.follow_up_date}"></label></div>
        <div class="smart mt" id="smart"></div></div>
      <div class="card"><h3>This week’s sessions</h3><p class="small muted">Completing the session plans all four. This one counts as Setting Goals.</p><div class="stack mt" id="tools"></div></div>
      <div class="row"><button class="btn" id="save">Save draft</button><button class="btn primary" id="complete">Complete session</button></div>`}
    </div></div>`;
  $("[data-back]", main).onclick = () => go("sessions");
  if (done) return;
  const val = (sel) => $(sel, main).value;
  const commitment = () => ({ behavior: val("#beh"), root_cause: val("#rc"), action: val("#act"), measure_target: Number(val("#mt")), measure_total: Number(val("#mo")), check_method: val("#cm"), follow_up_date: val("#fu"), week_start: wk, evidence: val("#ev"), session_id: s.id });
  const drawSmart = () => { const r = smartCheck(commitment()); $("#smart", main).innerHTML = r.checks.map((c) => `<div class="${c.ok ? "ok" : "no"}" title="${esc(c.tip)}"><b>${c.id}</b>${c.ok ? "✓ " + esc(c.name) : esc(c.tip)}</div>`).join(""); };
  const drawTools = () => { const t = toolsDefault(val("#rc")); $("#tools", main).innerHTML = SESSION_TYPES.map((st) => `<label class="f">${esc(st.name)} · ${esc(st.window)}<select class="in" data-tool="${st.id}">${options(TOOL_NAMES, t[st.id])}</select></label>`).join(""); };
  $$("input,textarea,select", main).forEach((el) => el.addEventListener("input", drawSmart));
  $("#rc", main).addEventListener("change", drawTools);
  $$("[data-ins]", main).forEach((b) => (b.onclick = () => { const ta = $(`[data-step="${b.dataset.ins}"]`, main); ta.value = (ta.value ? ta.value + "\n" : "") + b.textContent.replace(/^“|”$/g, ""); }));
  const patch = () => ({ behavior: val("#beh") || null, root_cause: val("#rc") || null, kpi_focus: val("#kf"), evidence: val("#ev"), notes: Object.fromEntries($$("[data-step]", main).map((t) => [t.dataset.step, t.value])) });
  $("#save", main).onclick = async () => { try { await api("PATCH", `/api/sessions/${s.id}`, patch()); toast("Draft saved"); } catch (e) { toast(e.message, "err"); } };
  $("#complete", main).onclick = async () => {
    try {
      await api("PATCH", `/api/sessions/${s.id}`, patch());
      const tools = Object.fromEntries($$("[data-tool]", main).map((x) => [x.dataset.tool, x.value]));
      const r = await api("POST", `/api/sessions/${s.id}/complete`, { commitment: commitment(), tools });
      toast(r.missing_direct_notes.length ? `Completed. Notes missing for: ${r.missing_direct_notes.join(", ")}.` : "Session completed. Commitment and weekly sessions created.");
      go("session", { id: s.id });
    } catch (e) { toast(e.message, "err"); }
  };
  drawSmart(); drawTools();
}

function doneBlock(d) {
  const c = d.commitment;
  return `<div class="card"><h3>Commitment</h3>${c ? `<div class="sticky"><p style="font-weight:600">“${esc(c.action)}”</p><p class="small mt">${c.measure_target} of ${c.measure_total} calls · ${esc(c.check_method)} · review ${dateLabel(c.follow_up_date)}</p></div><div class="row mt">${statusChip(c.status)}${c.agent_ack ? `<span class="chip ok">Acknowledged</span>` : `<span class="chip warn">Waiting for agent</span>`}</div>` : `<p class="muted">No commitment linked.</p>`}</div>
  <div class="card"><h3>This week’s sessions</h3><div class="list">${d.weekly.sort((a, b) => SESSION_TYPES.findIndex((t) => t.id === a.type) - SESSION_TYPES.findIndex((t) => t.id === b.type)).map((w) => `<div class="li"><div class="grow"><div class="t">${esc(sName(w.type))}</div><div class="small muted">${dateLabel(w.planned_date)} ${esc(w.planned_time || "")} · ${esc(w.tool || "No tool")}</div></div>${statusChip(w.status)}</div>`).join("")}</div></div>`;
}

// ---------------------------------------------------------------- Assign a roleplay (supervisor → agent)
// scenario: a scenario the supervisor already reviewed in the editor (assigned exactly as written).
export function assignRoleplayModal(agent, { api, toast, onDone, behavior, scenario = null, channel = "voice", go = null }) {
  const due = addDays(today(), 2);
  const m = modal(`<h3>Assign a roleplay to ${esc(agent.name.split(" ")[0])}</h3>
    <p class="small muted mt">${esc(agent.name)} gets a notification and finds it under Practice. You’re notified with the score when they finish.</p>
    <form id="ra" class="fgrid mt">
      ${scenario ? `<div class="wide sticky small"><b>Your scenario:</b> ${esc(scenario.member_name)} · ${esc(scenario.call_type)} · ${esc(scenario.mood)}<br><b>Practicing:</b> ${esc(bName(scenario.behavior))} · scored on ${scenario.success_criteria.length} thing${scenario.success_criteria.length > 1 ? "s" : ""} to do</div>`
        : `<label class="f">Core behavior<select class="in" id="ra-b">${options(behaviorList(agent.lob), behavior || behaviorList(agent.lob)[0]?.id)}</select></label>
      <label class="f">Call type<select class="in" id="ra-c">${options(CALL_TYPES, CALL_TYPES[0])}</select></label>
      <label class="f">Difficulty<select class="in" id="ra-d">${options([{ id: "easy", name: "Easy" }, { id: "medium", name: "Medium" }, { id: "hard", name: "Hard (angry member)" }], "medium")}</select></label>`}
      <label class="f">How<select class="in" id="ra-ch">${options([{ id: "voice", name: "Voice call" }, { id: "text", name: "Chat" }], channel)}</select></label>
      <label class="f">Do it by<input class="in" type="date" id="ra-due" value="${due}"></label>
      <label class="f wide">Note for the agent (optional)<input class="in" id="ra-n" maxlength="300" placeholder="e.g. Practice the close before Monitor on Wednesday"></label>
      <div class="row wide"><button class="btn primary">Assign</button>${!scenario && go ? `<button class="btn" type="button" id="ra-edit">Write or edit the scenario first</button>` : ""}<button class="btn ghost" type="button" data-close>Cancel</button></div></form>`);
  const ed = $("#ra-edit", m.el);
  if (ed) ed.onclick = () => { m.close(); go("roleplay", { agent_id: agent.id, behavior: $("#ra-b", m.el).value, call_type: $("#ra-c", m.el).value, difficulty: $("#ra-d", m.el).value, edit: 1 }); };
  $("#ra", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const body = { agent_id: agent.id, channel: $("#ra-ch", m.el).value, due_date: $("#ra-due", m.el).value, note: $("#ra-n", m.el).value };
    if (scenario) Object.assign(body, { scenario, behavior: scenario.behavior });
    else Object.assign(body, { behavior: $("#ra-b", m.el).value, call_type: $("#ra-c", m.el).value, difficulty: $("#ra-d", m.el).value });
    try {
      await api("POST", "/api/roleplay-assignments", body);
      m.close(); toast(`Roleplay assigned. ${agent.name.split(" ")[0]} was notified.`); onDone?.();
    } catch (err) { toast(err.message, "err"); }
  };
}

// ---------------------------------------------------------------- Scenario editor (supervisors and managers)
// The AI drafts the scenario; the supervisor can change the member, the context, and what the agent practices and is scored on.
const MOOD_OPTS = [{ id: "calm", name: "Calm" }, { id: "worried", name: "Worried" }, { id: "frustrated", name: "Frustrated" }, { id: "angry", name: "Angry" }];
const DIFF_OPTS = [{ id: "easy", name: "Easy" }, { id: "medium", name: "Medium" }, { id: "hard", name: "Hard (angry member)" }];
export function scenarioEditor(el, base, { agent, channel, start, assign, regenerate, toast }) {
  const d = {
    behavior: base.behavior, difficulty: base.difficulty || "medium", call_type: base.call_type || CALL_TYPES[0],
    member_name: base.member_name || "", member_gender: base.member_gender || "female", member_age: base.member_age || 66, mood: base.mood || "frustrated",
    situation: base.situation || "", opening: base.opening || "", hidden_need: base.hidden_need || "", member_notes: base.member_notes || "",
    success_criteria: [...(base.success_criteria || [])],
  };
  const payload = () => ({ ...d, success_criteria: d.success_criteria.map((x) => x.trim()).filter(Boolean), base: { source: base.source, ai_by: base.ai_by, call_type: base.call_type, difficulty: base.difficulty } });
  const problem = () => {
    const p = payload();
    if (p.member_name.trim().length < 2) return "Give the member a (fictional) name.";
    if (!(p.member_age >= 25 && p.member_age <= 95)) return "The member’s age must be between 25 and 95.";
    if (p.situation.trim().length < 10) return "Describe the situation the agent sees before the call.";
    if (p.opening.trim().length < 3) return "Write the member’s first line.";
    if (!p.success_criteria.length) return "Add at least one thing the agent should do.";
    return null;
  };
  const crit = () => d.success_criteria.map((x, i) => `<div class="crit"><span class="k">${i + 1}</span><input class="in" data-c="${i}" value="${esc(x)}" maxlength="200" placeholder="Something the agent can be heard doing">${d.success_criteria.length > 1 ? `<button class="btn ghost sm" type="button" data-cdel="${i}" aria-label="Remove">Remove</button>` : ""}</div>`).join("");
  el.innerHTML = `<div class="ai-card"><div class="ai-h"><b>Review the scenario</b>${base.source ? sourceTag(base) : ""}</div><div class="ai-b">
    <p class="small muted">Change anything: who the member is, what happened, and what ${agent ? esc(agent.name.split(" ")[0]) : "the agent"} practices and gets scored on. Keep it fictional: no real member names, IDs or health details.</p>
    <h4 class="eyebrow mt">What they practice</h4>
    <div class="fgrid">
      <label class="f">Core behavior<select class="in" data-f="behavior">${options(behaviorList(agent?.lob, d.behavior), d.behavior)}</select></label>
      <label class="f">Difficulty<select class="in" data-f="difficulty">${options(DIFF_OPTS, d.difficulty)}</select></label>
      <label class="f">Call type<input class="in" data-f="call_type" list="ct-list" value="${esc(d.call_type)}" maxlength="60"><datalist id="ct-list">${CALL_TYPES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label></div>
    <span class="f mt">Scored on: what the agent should do <small class="muted">(the feedback checks these)</small></span>
    <div id="crit">${crit()}</div>
    <div class="row mt"><button class="btn sm" type="button" id="addc">+ Add one</button><button class="btn ghost sm" type="button" id="stdc">Use the bank’s listen-for list for this behavior</button></div>
    <h4 class="eyebrow mt2">The member</h4>
    <div class="fgrid">
      <label class="f">Name (fictional)<input class="in" data-f="member_name" value="${esc(d.member_name)}" maxlength="60"></label>
      <label class="f">Voice<select class="in" data-f="member_gender">${options([{ id: "female", name: "Female" }, { id: "male", name: "Male" }], d.member_gender)}</select></label>
      <label class="f">Age<input class="in" type="number" min="25" max="95" data-f="member_age" value="${esc(d.member_age)}"></label>
      <label class="f">Mood at the start<select class="in" data-f="mood">${options(MOOD_OPTS, d.mood)}</select></label></div>
    <h4 class="eyebrow mt2">The context</h4>
    <label class="f">What the agent sees before the call<textarea class="in" data-f="situation" maxlength="600" rows="3">${esc(d.situation)}</textarea></label>
    <label class="f mt">The member’s first words<textarea class="in" data-f="opening" maxlength="400" rows="2">${esc(d.opening)}</textarea></label>
    <label class="f mt">Hidden need <small class="muted">(the member only brings it up if the agent asks about anything else)</small><input class="in" data-f="hidden_need" value="${esc(d.hidden_need)}" maxlength="300"></label>
    <label class="f mt">Direction for the AI member <small class="muted">(optional: how the member should act)</small><textarea class="in" data-f="member_notes" maxlength="400" rows="2" placeholder="e.g. Hard of hearing: asks the agent to repeat once. Gets upset if put on hold.">${esc(d.member_notes)}</textarea></label>
    <div class="spread mt2"><span class="small muted" id="sc-prob"></span><span class="row">${regenerate ? `<button class="btn" type="button" id="sc-again">Regenerate</button>` : ""}${assign ? `<button class="btn" type="button" id="sc-assign">Assign to ${agent ? esc(agent.name.split(" ")[0]) : "the agent"}</button>` : ""}<button class="btn primary" type="button" id="sc-start">Start the call</button></span></div>
  </div></div>`;
  const check = () => { const p = problem(); $("#sc-prob", el).textContent = p || ""; [$("#sc-start", el), $("#sc-assign", el)].forEach((b) => b && (b.disabled = !!p)); };
  const bindCrit = () => {
    $$("[data-c]", el).forEach((inp) => (inp.oninput = () => { d.success_criteria[+inp.dataset.c] = inp.value; check(); }));
    $$("[data-cdel]", el).forEach((b) => (b.onclick = () => { d.success_criteria.splice(+b.dataset.cdel, 1); redrawCrit(); }));
  };
  const redrawCrit = () => { $("#crit", el).innerHTML = crit(); bindCrit(); check(); };
  $$("[data-f]", el).forEach((inp) => (inp.oninput = inp.onchange = () => { d[inp.dataset.f] = inp.dataset.f === "member_age" ? Number(inp.value) : inp.value; check(); }));
  $("#addc", el).onclick = () => { if (d.success_criteria.length >= 5) return toast?.("5 at most: keep the practice focused.", "err"); d.success_criteria.push(""); redrawCrit(); $$("[data-c]", el).at(-1)?.focus(); };
  $("#stdc", el).onclick = () => { const b = behaviorOf(d.behavior); if (!b) return; d.success_criteria = b.listen_for?.length >= 2 ? b.listen_for.slice(0, 4) : [...b.actions.slice(0, 2), "Close with the next step and the timeline."]; redrawCrit(); };
  const again = $("#sc-again", el); if (again) again.onclick = () => regenerate({ behavior: d.behavior, call_type: CALL_TYPES.includes(d.call_type) ? d.call_type : CALL_TYPES[0], difficulty: d.difficulty });
  $("#sc-start", el).onclick = () => { const p = problem(); if (p) return toast?.(p, "err"); start(payload()); };
  const asg = $("#sc-assign", el); if (asg) asg.onclick = () => { const p = problem(); if (p) return toast?.(p, "err"); assign(payload()); };
  bindCrit(); check();
}

// ---------------------------------------------------------------- Roleplay (text or voice)
const VOICE_KEY = "pulse-voice-settings";
const VOICE_DEFAULTS = { voice: "", speed: 1, handsFree: true, pauseMs: 1600, captions: true, headset: false, channel: "" };
const loadVoiceSettings = () => { try { return { ...VOICE_DEFAULTS, ...JSON.parse(localStorage.getItem(VOICE_KEY) || "{}") }; } catch { return { ...VOICE_DEFAULTS }; } };
const saveVoiceSettings = (v) => { try { localStorage.setItem(VOICE_KEY, JSON.stringify(v)); } catch {} };
const MOOD_CHIP = { calm: "ok", worried: "warn", frustrated: "warn", angry: "bad" };
const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const VOICE_ERRORS = {
  "mic-blocked": "The microphone is blocked. Allow it from the lock icon in the address bar, or type your answers below.",
  "no-mic": "No microphone found. Plug in a headset, or type your answers below.",
  network: "Speech recognition needs an internet connection. Type your answers below for now.",
  "not-allowed": "The browser blocked the member’s voice. Click “Repeat” to play it.",
};

export async function roleplay(main, params, { api, state, toast, go, onLeave }) {
  const isAgent = state.user.role === "agent";
  let agents = [], defBehavior = params.behavior || "";
  if (!isAgent) agents = await api("GET", "/api/agents");
  else { const d = await api("GET", "/api/dashboard/agent"); defBehavior ||= d.current?.behavior || d.history[0]?.behavior || "expectations"; }
  const past = await api("GET", "/api/roleplays");
  const assigned = isAgent ? (await api("GET", "/api/roleplay-assignments")).filter((x) => x.status === "assigned" || x.status === "started") : [];
  const can = Voice.support();
  const settings = loadVoiceSettings();
  const cleanup = new Set();
  onLeave?.(() => cleanup.forEach((fn) => fn()));

  main.innerHTML = head(isAgent ? "Practice" : "Roleplay", "The AI plays a fictional member. You play the agent. Take the call by voice or by chat, practice one core behavior, then get feedback.") +
    `<div class="grid g-main"><div id="stage"></div><div class="card"><div class="card-h"><h3>Past practice</h3>${past.length ? `<button class="btn ghost sm" id="all-practice">See the full log</button>` : ""}</div>${past.length ? `<div class="list">${past.slice(0, 8).map((r) => `<div class="li click" data-rp="${r.id}" tabindex="0" role="button"><div class="grow"><div class="t">${esc(bName(r.behavior))} · ${esc(r.scenario?.call_type || "")}</div><div class="small muted">${dateLabel((r.created_at || "").slice(0, 10))}${r.scenario?.channel === "voice" ? " · Voice" : ""}</div></div>${r.evaluation ? `<span class="chip ${r.evaluation.score >= 4 ? "ok" : "warn"}">${r.evaluation.score}/5</span>` : r.status === "active" ? statusChip("open") : `<span class="chip plain">Not scored</span>`}</div>`).join("")}</div>` : `<div class="empty">No practice yet.</div>`}</div></div>`;
  const stage = $("#stage", main);
  $$("[data-rp]", main).forEach((li) => { const open = () => go("practice-detail", { id: li.dataset.rp }); li.onclick = open; li.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
  const allP = $("#all-practice", main); if (allP) allP.onclick = () => go("practice-log");

  const startCall = async (body) => {
    defBehavior = body.behavior; settings.channel = body.channel; saveVoiceSettings(settings);
    if (body.channel === "voice") Voice.loadVoices(); // warm up the voice list while the scenario is generated
    busy(stage, "Setting up the member…");
    try { const rp = await api("POST", "/api/ai/roleplay", body); call(rp); }
    catch (e) { toast(e.message, "err"); setup(); }
  };
  const assignedCard = () => !assigned.length ? "" : `<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Assigned to you</h3><span class="chip teal">${assigned.length}</span></div><div class="list">
    ${assigned.map((x) => `<div class="li${x.id === params.assignment ? " hl" : ""}"><div class="grow"><div class="t">${esc(bName(x.behavior))} · ${esc(x.call_type || "")}</div>
      <div class="small muted">${x.channel === "voice" ? "Voice call" : "Chat"} · ${esc(x.difficulty || "medium")}${x.due_date ? ` · by ${dateLabel(x.due_date)}` : ""}${x.custom ? " · scenario written by your supervisor" : ""}${x.note ? ` · “${esc(x.note)}”` : ""}</div></div>
      <button class="btn sm primary" data-ra="${x.id}">Start</button></div>`).join("")}</div></div>`;
  // Supervisors: draft a scenario with the AI, edit it, then start the call or assign it.
  const openEditor = async (o, base = null) => {
    busy(stage, "Writing a scenario…");
    try {
      const sc = base || (await api("POST", "/api/ai/roleplay/scenario", o));
      const agent = agents.find((a) => a.id === o.agent_id) || null;
      stage.innerHTML = `<div id="sced"></div><div class="row mt"><button class="btn ghost" id="back">Back to the call setup</button></div>`;
      scenarioEditor($("#sced", stage), { ...sc, behavior: sc.behavior || o.behavior }, {
        agent, channel: o.channel, toast,
        start: (scenario) => startCall({ agent_id: o.agent_id || undefined, behavior: scenario.behavior, channel: o.channel, scenario }),
        assign: agent ? (scenario) => assignRoleplayModal(agent, { api, toast, scenario, channel: o.channel, onDone: () => go("agent", { id: agent.id }) }) : null,
        regenerate: (x) => openEditor({ ...o, ...x }),
      });
      $("#back", stage).onclick = setup;
    } catch (e) { toast(e.message, "err"); setup(); }
  };
  const setup = () => {
    const voiceOk = can.speak;
    const defChannel = voiceOk ? (settings.channel || "voice") : "text";
    stage.innerHTML = assignedCard() + `<div class="card"><h3>${assigned.length ? "Or practice on your own" : "Set up the call"}</h3><div class="fgrid">
      ${isAgent ? "" : `<label class="f">Practicing for<select class="in" id="ag">${options(agents.map((a) => ({ id: a.id, name: a.name })), params.agent_id, "Myself (supervisor practice)")}</select></label>`}
      <label class="f">Core behavior<select class="in" id="beh">${options(behaviorList(state.user.lob), defBehavior || behaviorList(state.user.lob)[0]?.id)}</select></label>
      <label class="f">Call type<select class="in" id="ct">${options(CALL_TYPES, CALL_TYPES[0])}</select></label>
      <label class="f">Difficulty<select class="in" id="df">${options([{ id: "easy", name: "Easy" }, { id: "medium", name: "Medium" }, { id: "hard", name: "Hard (angry member)" }], "medium")}</select></label></div>
      <fieldset class="modes mt" aria-label="Call mode"><legend class="eyebrow">How do you want to take the call?</legend>
        <label><input type="radio" name="ch" value="voice" ${defChannel === "voice" ? "checked" : ""} ${voiceOk ? "" : "disabled"}><span>${icon("phone")}<b>Voice call</b><small>The member talks out loud${can.listen ? " and you answer with your voice" : "; you type your answers"}</small></span></label>
        <label><input type="radio" name="ch" value="text" ${defChannel === "text" ? "checked" : ""}><span>${icon("chat")}<b>Chat</b><small>Read and type, no audio</small></span></label>
      </fieldset>
      <p class="small muted mt" id="ch-note"></p>
      <div class="row mt"><button class="btn primary ai" id="start">Start the call</button>${isAgent ? "" : `<button class="btn ai" id="edit">Review and edit the scenario first</button><button class="btn" id="assign" hidden>Assign it to the agent instead</button>`}</div></div>`;
    $$("[data-ra]", stage).forEach((b) => (b.onclick = () => {
      const x = assigned.find((a) => a.id === b.dataset.ra);
      startCall({ behavior: x.behavior, call_type: x.call_type, difficulty: x.difficulty, channel: x.channel === "voice" && voiceOk ? "voice" : "text", assignment_id: x.id });
    }));
    const ag = $("#ag", stage), asg = $("#assign", stage);
    if (ag && asg) {
      const showAssign = () => { asg.hidden = !ag.value; };
      ag.addEventListener("change", showAssign); showAssign();
      asg.onclick = () => { const a = agents.find((x) => x.id === ag.value); if (a) assignRoleplayModal(a, { api, toast, go, behavior: $("#beh", stage).value }); };
    }
    const note = () => {
      const v = $("input[name=ch]:checked", stage)?.value === "voice";
      $("#ch-note", stage).textContent = !voiceOk ? "This browser can’t play voices. Use Chrome or Edge for voice calls."
        : !v ? "" : !can.listen ? "This browser can play the member but can’t hear you, so you’ll type your answers. Chrome or Edge let you answer by voice."
        : !can.secure ? "Answering by voice needs a secure page (https or localhost)."
        : "Use a headset in a quiet spot. The browser asks for your microphone the first time. Practice calls are fictional: never say real member information.";
    };
    $$("input[name=ch]", stage).forEach((r) => (r.onchange = note)); note();
    const edit = $("#edit", stage);
    if (edit) edit.onclick = () => openEditor({ agent_id: ag?.value || "", behavior: $("#beh", stage).value, call_type: $("#ct", stage).value, difficulty: $("#df", stage).value, channel: $("input[name=ch]:checked", stage)?.value || "text" });
    $("#start", stage).onclick = () => {
      const channel = $("input[name=ch]:checked", stage)?.value || "text";
      startCall({ agent_id: isAgent ? undefined : $("#ag", stage)?.value || undefined, behavior: $("#beh", stage).value, call_type: $("#ct", stage).value, difficulty: $("#df", stage).value, channel });
    };
  };

  const call = (rp) => {
    const sc = rp.scenario, first = sc.member_name.split(" ")[0];
    const isVoice = sc.channel === "voice" && can.speak;
    const talk = isVoice && can.listen && can.secure;
    let memberVoice = null, voices = [], ended = false, scored = false, interruptedTurn = false, phase = "ring", startedAt = 0, clock = null, listener = null, barge = null, memberEndedAt = null;

    stage.innerHTML = `<div class="card${isVoice ? " call" : ""}"><div class="card-h"><h3>${esc(sc.member_name)} · ${esc(sc.call_type || "")}</h3>${sourceTag(sc)}</div>
      <div class="sticky small"><b>Before you answer:</b> ${esc(sc.situation)}<br><b>Practicing:</b> ${esc(bName(rp.behavior))}. Try to: ${(sc.success_criteria || []).map((x) => esc(String(x).replace(/[.;\s]+$/, ""))).join("; ")}.</div>
      ${isVoice ? `<div class="callbar mt" id="callbar">
        <div class="avatar" id="av" data-state="idle" aria-hidden="true"><span>${esc(initials(sc.member_name))}</span></div>
        <div class="grow"><div class="t" id="status" role="status" aria-live="polite">Incoming call</div><div class="small muted"><span class="mono" id="clock">00:00</span> · <span id="mood"></span></div></div>
        <button class="btn primary" id="answer">${icon("phone")}Answer the call</button></div>` : ""}
      <div class="chat mt${isVoice && !settings.captions ? " nocap" : ""}" id="log" aria-live="polite"${isVoice ? " hidden" : ""}></div>
      ${talk ? `<div class="heard" id="heard" hidden><span class="eyebrow">Hearing you</span><span id="heard-t"></span></div>` : ""}
      <div id="controls" class="row mt"${isVoice ? " hidden" : ""}>
        ${talk ? `<button class="mic" id="mic" aria-pressed="false">${icon("mic")}<span id="mic-l">Talk</span></button>` : ""}
        ${isVoice ? `<button class="btn" id="skip" hidden>Skip ahead</button><button class="btn" id="repeat">${icon("play")}Repeat</button>` : ""}
        <button class="btn" id="end">${isVoice ? icon("hang") : ""}${isVoice ? "Hang up and get feedback" : "End call and get feedback"}</button><button class="btn ghost" id="new">New call</button></div>
      <form id="say" class="row mt"${isVoice ? " hidden" : ""}><input class="in" id="msg" placeholder="${talk ? "Or type your answer" : "Type what you’d say to the member"}" autocomplete="off" style="flex:1"><button class="btn primary">Send</button></form>
      ${isVoice ? `<details class="vset mt"><summary>Voice settings</summary><div class="fgrid mt">
        <label class="f">Member voice<select class="in" id="vs-voice"><option value="">Automatic (matches the member)</option></select></label>
        <label class="f">Member speed <span class="mono" id="vs-speed-v">${settings.speed.toFixed(2)}×</span><input type="range" id="vs-speed" min="0.75" max="1.25" step="0.05" value="${settings.speed}"></label>
        ${talk ? `<label class="f">Pause before sending<select class="in" id="vs-pause">${options([{ id: "1100", name: "Short (1 s)" }, { id: "1600", name: "Normal (1.5 s)" }, { id: "2500", name: "Long (2.5 s)" }], String(settings.pauseMs))}</select></label>` : ""}
        <div class="checks">
          ${talk ? `<label class="ck"><input type="checkbox" id="vs-hands" ${settings.handsFree ? "checked" : ""}> Hands-free: open the mic when the member stops and send when I pause</label>
          <label class="ck"><input type="checkbox" id="vs-headset" ${settings.headset ? "checked" : ""}> I’m wearing a headset (lets me talk over the member, like a real call)</label>` : ""}
          <label class="ck"><input type="checkbox" id="vs-cap" ${settings.captions ? "checked" : ""}> Show the member’s words (turn off to practice listening)</label>
        </div></div>
        <p class="small muted mt">${talk ? "Your voice is turned into text by your browser’s speech service (Google in Chrome, Microsoft in Edge). " : ""}Practice calls are fictional. Never say real member names, IDs or health details.${talk ? " Shortcut: press Space to talk or send." : ""}</p></details>` : ""}
      <div id="fb" class="mt"></div></div>`;

    const log = $("#log", stage);
    const draw = (t) => {
      log.innerHTML = t.map((m, i) => {
        const v = m.who === "agent" ? m.voice : null;
        const meta = v?.interrupted ? `<span class="vm slow">talked over the member</span>` : v?.delay_ms != null ? `<span class="vm${v.delay_ms > 4000 ? " slow" : ""}">answered in ${(v.delay_ms / 1000).toFixed(1)} s</span>` : "";
        const play = m.who === "member" && can.speak && m.text !== "…" ? `<button type="button" class="replay" data-i="${i}" aria-label="Play this line">${icon("play")}</button>` : "";
        return `<div class="msg ${m.who}"><span class="w">${m.who === "member" ? esc(first) : "You"}${play}</span><span class="tx" tabindex="${isVoice && m.who === "member" ? 0 : -1}">${esc(m.text)}</span>${meta}</div>`;
      }).join("");
      log.scrollTop = log.scrollHeight;
      $$(".replay", log).forEach((b) => (b.onclick = () => sayMember(t[+b.dataset.i].text, t[+b.dataset.i].mood)));
      $$(".nocap .msg.member .tx", stage).forEach((x) => (x.onclick = () => x.classList.toggle("shown")));
    };
    draw(rp.transcript);

    // ---------- voice plumbing
    const setPhase = (p, text) => {
      phase = p;
      if (!isVoice) return;
      $("#av", stage).dataset.state = p === "member" ? "speaking" : p === "thinking" ? "thinking" : p === "listening" ? "listening" : "idle";
      $("#status", stage).textContent = text;
      const skip = $("#skip", stage); if (skip) skip.hidden = p !== "member";
      const mic = $("#mic", stage);
      if (mic) {
        mic.disabled = ended || p === "thinking" || p === "ring";
        mic.setAttribute("aria-pressed", p === "listening" ? "true" : "false");
        $("#mic-l", stage).textContent = p === "listening" ? (settings.handsFree ? "Send now" : "Done talking") : p === "member" && settings.headset ? "Cut in" : "Talk";
      }
    };
    const setMood = (m) => { const el = $("#mood", stage); if (el) el.innerHTML = `<span class="chip ${MOOD_CHIP[m] || ""}">${esc(m || "calm")}</span>`; };
    const heard = (t) => { const h = $("#heard", stage); if (!h) return; h.hidden = !t; $("#heard-t", stage).textContent = t || ""; };

    const sayMember = async (text, mood) => {
      // Chat mode, or replaying a line after the call: just play it.
      if (!isVoice || scored) { if (can.speak) Voice.speak(text, { voice: memberVoice, mood, age: sc.member_age, speed: settings.speed }); return; }
      listener?.cancel(); heard("");
      setPhase("member", `${first} is talking…`); setMood(mood || rp.mood || sc.mood);
      if (settings.headset && talk) barge?.start();
      const r = await Voice.speak(text, { voice: memberVoice, mood: mood || sc.mood, age: sc.member_age, speed: settings.speed });
      barge?.stop();
      if (!stage.isConnected || phase !== "member") return; // skipped, barged in or left the page
      if (r.reason === "not-allowed") toast(VOICE_ERRORS["not-allowed"], "err");
      memberEndedAt = performance.now();
      if (ended) return finishCall();
      yourTurn();
    };
    const yourTurn = () => {
      if (talk && settings.handsFree) { setPhase("listening", "Your turn. Go ahead, I’m listening."); listener.start({ since: memberEndedAt }); }
      else setPhase("idle", talk ? "Your turn. Click Talk (or press Space) and answer." : "Your turn. Type your answer below.");
      if (!talk) $("#msg", stage)?.focus();
    };

    const send = async (text, voice = null) => {
      if (ended) return;
      window.dispatchEvent(new Event("pulse:activity")); // a hands-free voice call counts as activity
      heard("");
      const shown = [...rp.transcript, { who: "agent", text, ...(voice ? { voice } : {}) }, { who: "member", text: "…" }];
      draw(shown); setPhase("thinking", `${first} is thinking…`);
      try {
        rp = await api("POST", `/api/ai/roleplay/${rp.id}/turn`, { text, voice });
        if (!stage.isConnected) return;
        draw(rp.transcript);
        const last = rp.transcript.at(-1);
        if (rp.status === "ended") ended = true;
        if (isVoice) await sayMember(last.text, last.mood);
        else if (ended) finishCall();
      } catch (err) { toast(err.message, "err"); draw(rp.transcript); setPhase("idle", "That didn’t go through. Try again."); }
    };

    const finishCall = () => {
      if (scored) return;
      toast(`${first} ended the call.`);
      evaluate();
    };

    if (isVoice) {
      if (talk) {
        listener = Voice.createListener({
          pauseMs: settings.pauseMs, autoSend: settings.handsFree,
          onText: (t) => heard(t),
          onState: (s) => { if (s === "idle" && phase === "listening") setPhase("idle", "Mic is off. Click Talk to answer."); },
          onDone: (t, timing) => { const v = interruptedTurn ? { ...timing, interrupted: true } : timing; interruptedTurn = false; send(t, v); },
          onError: (code) => {
            if (code === "nothing-heard") { setPhase("idle", "I didn’t catch that. Click Talk and try again."); return; }
            setPhase("idle", "Type your answer below."); toast(VOICE_ERRORS[code] || `Speech recognition stopped (${code}). Type your answer below.`, "err");
            $("#say", stage).hidden = false; $("#msg", stage).focus();
          },
        });
        barge = Voice.createBargeIn({ onSpeech: (t) => {
          if (phase !== "member") return;
          Voice.stopSpeaking(); setPhase("listening", "You cut in. Go ahead.");
          interruptedTurn = true; listener.start({ since: null, seed: t });
        } });
      }

      cleanup.add(() => { ended = true; clearInterval(clock); listener?.cancel(); barge?.stop(); Voice.stopSpeaking(); });

      // Voice list in settings. The member keeps the same voice for the whole call.
      const fillVoiceList = () => {
        const sel = $("#vs-voice", stage); if (!sel) return;
        const en = Voice.englishVoices(voices);
        sel.innerHTML = `<option value="">Automatic (${esc(memberVoice?.name || "browser default")})</option>` + en.map((v) => `<option value="${esc(v.name)}" ${v.name === settings.voice ? "selected" : ""}>${esc(v.name)} · ${esc(v.lang)}</option>`).join("");
        sel.onchange = () => { settings.voice = sel.value; saveVoiceSettings(settings); memberVoice = Voice.pickVoice(voices, { gender: sc.member_gender, seed: sc.member_name, preferred: settings.voice }); };
      };
      $("#answer", stage).onclick = async () => {
        $("#answer", stage).remove();
        log.hidden = false; $("#controls", stage).hidden = false; $("#say", stage).hidden = false; // typing always works as a backup
        startedAt = Date.now(); clock = setInterval(() => { const c = $("#clock", stage); if (!c) return clearInterval(clock); c.textContent = mmss(Date.now() - startedAt); }, 500);
        voices = await Voice.loadVoices();
        memberVoice = Voice.pickVoice(voices, { gender: sc.member_gender, seed: sc.member_name, preferred: settings.voice });
        fillVoiceList();
        sayMember(rp.transcript.at(-1).text, rp.transcript.at(-1).mood || sc.mood);
      };
      setMood(sc.mood);

      const mic = $("#mic", stage);
      if (mic) mic.onclick = () => {
        if (phase === "listening") return listener.finish();
        const cutIn = phase === "member";
        if (cutIn) { Voice.stopSpeaking(); barge?.stop(); memberEndedAt = performance.now(); }
        interruptedTurn = cutIn && settings.headset; // with a headset this is talking over the member; without one it's a skip
        setPhase("listening", "Listening…"); listener.start({ since: interruptedTurn ? null : memberEndedAt });
      };
      $("#skip", stage).onclick = () => { Voice.stopSpeaking(); barge?.stop(); memberEndedAt = performance.now(); setPhase("idle", ""); yourTurn(); };
      $("#repeat", stage).onclick = () => { const m = [...rp.transcript].reverse().find((x) => x.who === "member"); if (m) sayMember(m.text, m.mood); };

      const onKey = (e) => {
        if (e.code !== "Space" || !stage.isConnected || e.repeat) return;
        const tag = document.activeElement?.tagName;
        if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY"].includes(tag)) return;
        if (mic && !mic.disabled) { e.preventDefault(); mic.click(); }
      };
      document.addEventListener("keydown", onKey); cleanup.add(() => document.removeEventListener("keydown", onKey));

      Voice.loadVoices().then((v) => { voices = v; if (!memberVoice) memberVoice = Voice.pickVoice(v, { gender: sc.member_gender, seed: sc.member_name, preferred: settings.voice }); fillVoiceList(); });
      $("#vs-speed", stage).oninput = (e) => { settings.speed = +e.target.value; $("#vs-speed-v", stage).textContent = settings.speed.toFixed(2) + "×"; saveVoiceSettings(settings); };
      const pause = $("#vs-pause", stage); if (pause) pause.onchange = () => { settings.pauseMs = +pause.value; listener?.set({ pauseMs: settings.pauseMs }); saveVoiceSettings(settings); };
      const hands = $("#vs-hands", stage); if (hands) hands.onchange = () => { settings.handsFree = hands.checked; listener?.set({ autoSend: hands.checked }); saveVoiceSettings(settings); setPhase(phase, $("#status", stage).textContent); };
      const hs = $("#vs-headset", stage); if (hs) hs.onchange = () => { settings.headset = hs.checked; saveVoiceSettings(settings); if (!hs.checked) barge?.stop(); };
      $("#vs-cap", stage).onchange = (e) => { settings.captions = e.target.checked; saveVoiceSettings(settings); log.classList.toggle("nocap", !settings.captions); draw(rp.transcript); };
    }

    $("#say", stage).onsubmit = async (e) => {
      e.preventDefault(); const inp = $("#msg", stage); const text = inp.value.trim(); if (!text) return;
      if (phase === "thinking") return toast(`Wait for ${first} to answer first.`);
      inp.value = ""; listener?.cancel(); Voice.stopSpeaking(); barge?.stop();
      send(text, null);
    };

    const evaluate = async () => {
      if (scored) return; scored = true;
      ended = true; clearInterval(clock); listener?.cancel(); barge?.stop(); Voice.stopSpeaking();
      if (isVoice) { setPhase("done", "Call ended"); heard(""); }
      busy($("#fb", stage), "Scoring the call…");
      try {
        const r = await api("POST", `/api/ai/roleplay/${rp.id}/evaluate`); const ev = r.evaluation;
        $("#say", stage).hidden = true; $("#end", stage).hidden = true;
        ["#mic", "#skip", "#repeat"].forEach((s) => { const el = $(s, stage); if (el) el.hidden = true; });
        log.classList.remove("nocap");
        const d = ev.delivery;
        $("#fb", stage).innerHTML = `<div class="ai-card"><div class="ai-h"><b>Feedback · ${ev.score}/5 on ${esc(bName(rp.behavior))}</b>${sourceTag(ev)}</div><div class="ai-b"><p>${esc(ev.summary)}</p>
          ${(ev.criteria || []).length ? `<span class="eyebrow">Scored on</span><ul class="crit-list">${ev.criteria.map((c) => `<li class="${c.met ? "met" : "miss"}"><b aria-label="${c.met ? "Met" : "Not met"}">${c.met ? "✓" : "✕"}</b><span>${esc(c.text)}${c.evidence ? `<small>${esc(c.evidence)}</small>` : ""}</span></li>`).join("")}</ul>` : ""}
          <div class="grid g2 mt"><div><span class="eyebrow">What worked</span><ul class="small">${(ev.did_well || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div><span class="eyebrow">Try next time</span><ul class="small">${(ev.improve || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
          ${d ? `<span class="eyebrow">How you sounded</span><div class="dstats">
            <div><b class="mono">${d.wpm ?? "—"}</b><small>words / min<br>target 120–165</small></div>
            <div><b class="mono">${d.avg_response_s ?? "—"} s</b><small>average time to answer</small></div>
            <div class="${d.dead_air ? "warnv" : ""}"><b class="mono">${d.dead_air}</b><small>long silences (4 s+)</small></div>
            <div class="${d.interruptions ? "warnv" : ""}"><b class="mono">${d.interruptions}</b><small>times you talked over the member</small></div>
            <div><b class="mono">${d.talk_share ?? "—"}%</b><small>of the talking was you</small></div></div>
            ${ev.delivery_tip ? `<p class="small mt"><b>Delivery tip:</b> ${esc(ev.delivery_tip)}</p>` : ""}
            <ul class="small">${d.notes.filter((n) => n !== ev.delivery_tip).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
            <p class="small muted">Timings come from speech recognition and are approximate.</p>` : ""}
          <span class="eyebrow">Model lines${can.speak ? " · click one to hear it" : ""}</span><div class="sugg">${(ev.model_lines || []).map((x) => `<button type="button" class="ml">${can.speak ? icon("play") : ""}“${esc(x)}”</button>`).join("")}</div></div></div>`;
        if (can.speak) {
          if (!voices.length) voices = await Voice.loadVoices();
          const agentVoice = Voice.pickVoice(voices, { seed: state.user.name, exclude: memberVoice?.name });
          $$(".ml", stage).forEach((b) => (b.onclick = () => Voice.speak(b.textContent.replace(/^“|”$/g, ""), { voice: agentVoice, mood: "calm" })));
        }
      } catch (e) { scored = false; toast(e.message, "err"); $("#fb", stage).innerHTML = ""; }
    };
    $("#end", stage).onclick = evaluate;
    $("#new", stage).onclick = () => go(isAgent ? "practice" : "roleplay", params);
    if (!isVoice && can.speak) Voice.loadVoices().then((v) => (memberVoice = Voice.pickVoice(v, { gender: sc.member_gender, seed: sc.member_name, preferred: settings.voice })));
  };
  setup();
  if (params.edit && !isAgent) openEditor({ agent_id: params.agent_id || "", behavior: params.behavior || defBehavior || "expectations", call_type: params.call_type || CALL_TYPES[0], difficulty: params.difficulty || "medium", channel: can.speak ? settings.channel || "voice" : "text" });
}

// ---------------------------------------------------------------- Quizzes (supervisor)
export async function quizzes(main, params, { api, toast, go, state }) {
  const [agents, list] = await Promise.all([api("GET", "/api/agents"), api("GET", "/api/quizzes")]);
  main.innerHTML = head("Quizzes", "Generate a short quiz on the agent’s opportunity, review it, then assign it. Agents take it from their own view.") +
    `<div class="grid g-main"><div class="stack"><div class="card"><h3>Generate a quiz</h3><div class="fgrid">
      <label class="f">Agent<select class="in" id="ag">${options(agents.map((a) => ({ id: a.id, name: a.name })), params.agent_id, "Choose an agent")}</select></label>
      <label class="f">Core behavior<select class="in" id="beh">${options(behaviorList(state.user.lob), params.behavior || "")}</select></label>
      <label class="f">Questions<select class="in" id="n">${options(["3", "5", "8"], "5")}</select></label>
      <label class="f wide">Focus: what the quiz should be about (optional)<input class="in" id="fc" maxlength="300" placeholder="e.g., giving timelines on claim-status calls"></label></div>
      <div class="row mt"><button class="btn primary ai" id="gen">Generate</button></div></div><div id="pv"></div></div>
      <div class="card"><h3>Assigned quizzes</h3>${list.length ? `<div class="list">${list.map((q) => `<div class="li"><div class="grow"><div class="t">${esc(q.agent_name)}</div><div class="small muted">${esc(q.title)}</div></div>${q.status === "completed" ? `<span class="chip ${q.score >= 80 ? "ok" : "warn"}">${q.score}%</span>` : statusChip("assigned")}</div>`).join("")}</div>` : `<div class="empty">No quizzes yet.</div>`}</div></div>`;
  const ag = $("#ag", main);
  ag.onchange = async () => { if (!ag.value || params.behavior) return; const d = await api("GET", `/api/agents/${ag.value}`); if (d.commitments[0]) $("#beh", main).value = d.commitments[0].behavior; };
  if (params.agent_id && !params.behavior) ag.onchange();
  $("#gen", main).onclick = async () => {
    if (!ag.value) return toast("Choose an agent.", "err");
    const pv = $("#pv", main); busy(pv, "Writing questions…");
    try {
      const q = await api("POST", "/api/ai/quiz", { agent_id: ag.value, behavior: $("#beh", main).value, count: Number($("#n", main).value), focus: $("#fc", main).value, preview: true });
      quizEditor(pv, q, {
        regenerate: () => $("#gen", main).click(),
        assign: async (draft) => { await api("POST", "/api/quizzes", { agent_id: ag.value, behavior: $("#beh", main).value, ...draft, source: q.source }); toast("Quiz assigned."); go("quizzes"); },
        toast,
      });
    } catch (e) { pv.innerHTML = ""; toast(e.message, "err"); }
  };
}

// Review screen: the supervisor can edit every question and option, and picks the right answer.
// AI answers aren't trusted blindly: for AI quizzes no answer is pre-selected; the AI's pick shows as a hint.
export function quizEditor(el, q, { assign, regenerate, toast }) {
  const fromAI = q.source === "ai";
  const draft = {
    title: q.title || "",
    questions: q.questions.map((x) => ({ q: x.q, o: [...x.o, "", "", "", ""].slice(0, Math.max(4, x.o.length)), a: fromAI ? null : x.a ?? null, ai: fromAI ? x.ai_a ?? x.a ?? null : null, why: x.why || "" })),
  };
  const filled = (x) => x.o.map((t, j) => [t.trim(), j]).filter(([t]) => t);
  const problems = () => draft.questions.map((x, i) => {
    const n = i + 1, opts = filled(x);
    if (!x.q.trim()) return `Question ${n} has no text.`;
    if (opts.length < 2) return `Question ${n} needs at least 2 options.`;
    if (x.a == null) return `Choose the right answer for question ${n}.`;
    if (!x.o[x.a]?.trim()) return `The right answer for question ${n} is empty.`;
    return null;
  }).filter(Boolean);
  const status = () => {
    const chosen = draft.questions.filter((x) => x.a != null).length, total = draft.questions.length;
    const p = problems();
    $("#qcount", el).textContent = `${chosen} of ${total} answers chosen`;
    $("#assign", el).disabled = !!p.length || !draft.title.trim() || !total;
    $("#assign", el).title = p[0] || "";
  };
  const block = (x, i) => `<div class="qq qe" data-i="${i}">
      <div class="spread"><b>Question ${i + 1}</b><span class="row">${x.ai != null ? `<span class="chip plain" title="Check it: AI answers can be wrong">AI suggests ${"ABCD"[x.ai]}</span>` : ""}${draft.questions.length > 1 ? `<button class="btn ghost sm" data-del>Remove</button>` : ""}</span></div>
      <textarea class="in mt" data-q aria-label="Question ${i + 1}" rows="2">${esc(x.q)}</textarea>
      <div class="qopts" role="radiogroup" aria-label="Right answer for question ${i + 1}">${x.o.map((t, j) => `<label class="qopt ${x.a === j ? "right" : ""}"><input type="radio" name="ans-${i}" value="${j}" ${x.a === j ? "checked" : ""} aria-label="Option ${"ABCD"[j]} is the right answer"><span class="k">${"ABCD"[j]}</span><input class="in" data-o="${j}" value="${esc(t)}" placeholder="${j < 2 ? "Option" : "Option (optional)"}"></label>`).join("")}</div>
      <label class="f mt small">Explanation the agent sees after finishing<input class="in" data-why value="${esc(x.why)}" placeholder="Why the right answer is right"></label>
    </div>`;
  const draw = () => {
    $("#qs", el).innerHTML = draft.questions.map(block).join("");
    $$(".qe", el).forEach((b) => {
      const x = draft.questions[+b.dataset.i];
      $("[data-q]", b).oninput = (e) => { x.q = e.target.value; status(); };
      $("[data-why]", b).oninput = (e) => { x.why = e.target.value; };
      $$("[data-o]", b).forEach((inp) => (inp.oninput = () => { x.o[+inp.dataset.o] = inp.value; status(); }));
      $$("input[type=radio]", b).forEach((r) => (r.onchange = () => { x.a = +r.value; $$(".qopt", b).forEach((l, j) => l.classList.toggle("right", j === x.a)); status(); }));
      const del = $("[data-del]", b); if (del) del.onclick = () => { draft.questions.splice(+b.dataset.i, 1); draw(); };
    });
    status();
  };
  el.innerHTML = `<div class="ai-card"><div class="ai-h"><b>Review the quiz</b>${sourceTag(q)}</div><div class="ai-b">
      ${q.focus ? `<div class="sticky small"><b>Your focus:</b> ${esc(q.focus)}${q.focus_used === false ? `<br>The AI wasn’t available, so these are the built-in questions for the behavior, not tailored to your focus. Edit them or try Regenerate in a minute.` : ""}</div>` : ""}
      <p class="small muted${q.focus ? " mt" : ""}">Edit anything and choose the right answer for each question${fromAI ? " (the AI’s pick is only a hint)" : ""}. The agent sees the quiz only after you assign it.</p>
      <label class="f mt">Title<input class="in" id="qt" value="${esc(draft.title)}"></label>
      <div id="qs" class="mt"></div>
      <div class="row mt"><button class="btn sm" id="addq">+ Add a question</button></div>
      <div class="spread mt2"><span class="small muted" id="qcount"></span><span class="row"><button class="btn" id="again">Regenerate</button><button class="btn primary" id="assign">Assign to agent</button></span></div>
    </div></div>`;
  $("#qt", el).oninput = (e) => { draft.title = e.target.value; status(); };
  $("#addq", el).onclick = () => { if (draft.questions.length >= 10) return toast?.("10 questions at most.", "err"); draft.questions.push({ q: "", o: ["", "", "", ""], a: null, ai: null, why: "" }); draw(); $$(".qe [data-q]", el).at(-1)?.focus(); };
  $("#again", el).onclick = () => regenerate();
  $("#assign", el).onclick = async () => {
    const p = problems(); if (p.length) return toast?.(p[0], "err");
    // Drop empty options and keep the right answer pointing at the same text.
    const questions = draft.questions.map((x) => { const opts = filled(x); return { q: x.q.trim(), o: opts.map(([t]) => t), a: opts.findIndex(([, j]) => j === x.a), why: x.why.trim() }; });
    $("#assign", el).disabled = true;
    try { await assign({ title: draft.title.trim(), questions }); } catch (e) { toast?.(e.message, "err"); status(); }
  };
  draw();
}

// ---------------------------------------------------------------- Training library
export async function training(main, _p, { api, toast, go, state }) {
  const list = await api("GET", "/api/training");
  main.innerHTML = head("Training", "The interactive guides behind PULSE, plus a quick reference for the floor.") +
    `<div class="grid g2">${list.map((g) => `<div class="card"><div class="card-h"><h3>${esc(g.title)}</h3>${g.completed_at ? `<span class="chip ok">Completed ${dateLabel(g.completed_at)}</span>` : `<span class="chip plain">${g.minutes} min</span>`}</div>
      <p class="small">${esc(g.desc)}</p><div class="row mt"><a class="btn primary" href="${esc(g.file)}" target="_blank" rel="noopener">Open guide</a>${g.completed_at ? "" : `<button class="btn" data-done="${g.id}">Mark as completed</button>`}</div></div>`).join("")}</div>
    <div class="grid g2 mt2">
      <div class="card"><div class="card-h"><h3>Our behaviors</h3>${state.user.role !== "agent" ? `<button class="btn ghost sm" data-go-bank>See the full guide</button>` : ""}</div><div class="list">${behaviorList(state.user.lob).map((b) => `<div class="li"><div class="grow"><div class="t">${esc(b.name)}${b.full !== b.name ? ` <span class="small muted">(${esc(b.full)})</span>` : ""}</div><div class="small">${esc(b.desc)}</div>
        ${b.how?.length ? `<details><summary class="small">How to do it on the call</summary><ol class="small steps-ol">${b.how.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></details>` : ""}<div class="small muted">${esc(b.sounds)}</div></div></div>`).join("")}</div></div>
      <div class="stack"><div class="card"><h3>The weekly rhythm</h3><div class="list">${SESSION_TYPES.map((t) => `<div class="li"><span class="chip teal">${esc(t.window)}</span><div class="grow"><div class="t">${esc(t.name)}</div><div class="small">${esc(t.desc)}</div></div></div>`).join("")}</div></div>
      ${state.user.role !== "agent" ? `<div class="card"><h3>The 8 coaching tools</h3><div class="list">${TOOLS.map((t) => `<div class="li"><div class="grow"><div class="t">${esc(t.name)}</div><div class="small">${esc(t.desc)} ${esc(t.how)}</div></div></div>`).join("")}</div></div>` : ""}</div></div>`;
  $$("[data-done]", main).forEach((b) => (b.onclick = async () => { await api("POST", `/api/training/${b.dataset.done}/complete`); toast("Marked as completed."); go("training"); }));
  const gb = $("[data-go-bank]", main); if (gb) gb.onclick = () => go("bank");
}

// ---------------------------------------------------------------- Data upload
const TEMPLATES = {
  kpis: "ccms,agent_email,week_start,nps,csat,fcr,aht,qa,surveys\n5268201,,2026-10-05,38,91.5,93.2,575,94,12\n,daniela.cruz@pulse.demo,2026-10-05,41,92,94,560,95,9",
  verbatims: "ccms,agent_email,date,score,text\n5268201,,2026-10-07,4,\"Nobody told me when my card would arrive.\"",
};
// A CSV your Excel opens directly: one row per agent for this week, numbers left blank.
function downloadKpiTemplate(agents, who) {
  const week = weekStart(today());
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["ccms", "agent_name", "supervisor", "lob", "sub_lob", "in_production", "week_start", "nps", "csat", "fcr", "aht", "qa", "surveys"];
  const lines = [...agents].sort((a, b) => (a.supervisor_name || "").localeCompare(b.supervisor_name || "") || a.name.localeCompare(b.name))
    .map((a) => [a.employee_id || "", a.name, a.supervisor_name || "", a.lob, a.sub_lob || "", a.in_production === false ? "no" : "yes", week, "", "", "", "", "", ""].map(q).join(","));
  const blob = new Blob(["\ufeff" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = `PULSE KPI template - ${who} - ${week}.csv`;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
export async function upload(main, params, { api, toast, state }) {
  const isMgr = state.user.role === "manager";
  const agents = await api("GET", "/api/agents");
  let kind = ["roster", "sample"].includes(params.kind) && isMgr ? params.kind : params.kind === "verbatims" ? "verbatims" : "kpis", rows = [];
  main.innerHTML = head("Data upload", "Load the roster (EDB files), weekly KPIs or survey verbatims.") +
    `<div class="seg" id="kind">${isMgr ? `<button data-k="roster">Roster (EDB)</button>` : ""}<button data-k="kpis">Weekly KPIs</button><button data-k="verbatims">Survey verbatims</button>${isMgr ? `<button data-k="sample">Sample data</button>` : ""}</div><div id="pane" class="mt"></div>`;
  const pane = $("#pane", main);

  const csvPane = () => {
    pane.innerHTML = `<div class="grid g-main"><div class="card">
      <p class="small muted">From a CSV export (Excel: Save As › CSV). Rows are matched to agents by <b>CCMS</b>, by <b>email</b> (the PULSE login or the client email), or by <b>name</b> (“Last, First”).</p>
      <div class="fgrid mt"><label class="f">CSV file<input class="in" type="file" id="file" accept=".csv,text/csv"></label></div>
      <label class="f mt">Or paste CSV<textarea class="in" id="paste" style="min-height:140px;font-family:var(--f-mono);font-size:.8rem"></textarea></label>
      <div class="row mt"><button class="btn" id="prev">Preview</button><button class="btn primary" id="up" disabled>Upload</button></div><div id="pv" class="mt"></div></div>
      <div class="stack"><div class="card"><h3>Template</h3><pre class="verb" id="tpl" style="white-space:pre-wrap;font-family:var(--f-mono);font-size:.76rem;margin:0"></pre><p class="small muted mt">Fill one of ccms, agent_email or agent_name. AHT in seconds. Week = the Monday of the week. Score = survey score 0–10.</p><div class="row mt"><button class="btn sm" id="copy">Copy template</button>${kind === "kpis" && agents.length ? `<button class="btn sm primary" id="dl">Download for my ${agents.length} agents</button>` : ""}</div>
        ${kind === "kpis" && agents.length ? `<p class="small muted mt">The download lists your agents with their CCMS, supervisor and this week’s Monday. Fill in the numbers in Excel, save as CSV and upload it here.</p>` : ""}</div>
      <div class="card"><h3>Agents (${agents.length})</h3><div class="small" style="max-height:240px;overflow:auto">${agents.map((a) => `<div>${esc(a.name)} · <span class="mono">${esc(a.employee_id || a.email || "")}</span></div>`).join("")}</div></div></div></div>`;
    $("#tpl", pane).textContent = TEMPLATES[kind];
    $("#file", pane).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!/\.(csv|txt)$/i.test(f.name)) { e.target.value = ""; return toast("Choose a .csv file.", "err"); }
      if (f.size > 5 * 1024 * 1024) { e.target.value = ""; return toast("That file is larger than 5 MB. Split it by week.", "err"); }
      $("#paste", pane).value = await f.text(); preview();
    };
    const preview = () => {
      rows = parseCSV($("#paste", pane).value);
      if (!rows.length) { $("#pv", pane).innerHTML = `<div class="empty">No rows found. The first line must be the header.</div>`; $("#up", pane).disabled = true; return; }
      const cols = Object.keys(rows[0]);
      $("#pv", pane).innerHTML = `<p class="small"><b>${rows.length}</b> rows. First ${Math.min(8, rows.length)}:</p><div class="tbl-wrap mt"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(0, 8).map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      $("#up", pane).disabled = false;
    };
    $("#prev", pane).onclick = preview;
    $("#up", pane).onclick = async () => {
      try {
        const r = await api("POST", `/api/upload/${kind}`, { rows });
        $("#pv", pane).innerHTML = `<div class="sticky"><b>${kind === "kpis" ? `${r.added} added, ${r.updated} updated${r.blank ? `, ${r.blank} empty rows ignored` : ""}` : `${r.added} verbatims added`}.</b>${r.skipped.length ? `<br>${r.skipped.length} skipped:<br>${r.skipped.slice(0, 10).map(esc).join("<br>")}` : ""}</div>`;
        toast("Upload finished.");
      } catch (e) { toast(e.message, "err"); }
    };
    const dl = $("#dl", pane); if (dl) dl.onclick = () => downloadKpiTemplate(agents, state.user.name);
    $("#copy", pane).onclick = async () => { try { await navigator.clipboard.writeText(TEMPLATES[kind]); toast("Template copied."); } catch { $("#paste", pane).value = TEMPLATES[kind]; toast("Template pasted below."); } };
  };

  const rosterPane = () => {
    let files = null;
    pane.innerHTML = `<div class="grid g-main"><div class="card"><h3>Import the roster</h3>
      <p class="small muted">Choose the EDB workbooks (one per line of business). PULSE reads agents from the EDB sheet, supervisors from <b>Team Lead</b> (with their CCMS and email from EDB SUPS) and managers from <b>Floor Manager</b>. Put BVA, IFM, Medicare or NPG in each file name.</p>
      <div class="fgrid mt"><label class="f wide">EDB files (.xlsx)<input class="in" type="file" id="rfiles" accept=".xlsx" multiple></label>
        <label class="f">Login email domain<input class="in" id="dom" value="pulse.com" autocomplete="off"></label></div>
      <label class="ck mt"><input type="checkbox" id="nodemo" checked> Remove the fictional demo people (@pulse.demo) and their data</label>
      <div class="row mt"><button class="btn" id="rprev" disabled>Preview</button><button class="btn primary" id="rapply" disabled>Import</button></div>
      <div id="rpv" class="mt"></div></div>
      <div class="stack"><div class="card"><h3>How it works</h3><ul class="small">
        <li>Each person’s login is the name part of their client email with your domain, for example <span class="mono">jordy_feliz_diaz@pulse.com</span>. People with no email get one made from their name.</li>
        <li>People are matched by <b>CCMS</b> on later imports, so a new month’s EDB updates teams, moves and new hires.</li>
        <li>Agents in Training, OJT, Uptraining or Staff are tagged and left out of rankings and team results until they’re in production.</li>
        <li>Agents and supervisors missing from a new EDB of the same line of business are marked as <b>left</b> and can’t sign in. Nothing is deleted.</li>
        <li>Then create the logins: <span class="mono">npm run create-logins -- --password=…</span></li></ul></div>
        <div class="card"><h3>Before you load real people</h3><p class="small">This is employee data. Get the OK from IT or compliance before it goes into a cloud database, and sign people in with Supabase (AUTH_MODE=supabase), never demo mode.</p></div></div></div>`;
    const body = () => ({ files, domain: $("#dom", pane).value.trim() || "pulse.com", remove_demo: $("#nodemo", pane).checked });
    $("#rfiles", pane).onchange = async (e) => {
      const list = [...e.target.files];
      $("#rapply", pane).disabled = true;
      if (!list.length) { files = null; $("#rprev", pane).disabled = true; return; }
      busy($("#rpv", pane), "Reading the files…");
      try {
        const { readXlsx, browserInflate } = await import("../core/xlsx.js");
        files = [];
        // Only Excel workbooks, up to 6 files of 10 MB each. They're read here in the browser; only the rows are sent.
        if (list.length > 6) throw new Error("Choose up to 6 EDB files at a time.");
        for (const f of list) {
          if (!/\.xlsx$/i.test(f.name)) throw new Error(`${f.name} isn’t an Excel (.xlsx) file.`);
          if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is larger than 10 MB.`);
          const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
          if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error(`${f.name} isn’t a real .xlsx file.`); // .xlsx files are zip archives ("PK")
          const wb = await readXlsx(new Uint8Array(await f.arrayBuffer()), browserInflate);
          files.push({ name: f.name, sheets: wb.sheets.map((sh) => ({ name: sh.name, rows: sh.rows.map((r) => r.slice(0, 40)) })) });
        }
        $("#rprev", pane).disabled = false; preview();
      } catch (err) { files = null; $("#rpv", pane).innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    };
    const preview = async () => {
      busy($("#rpv", pane), "Checking the roster…");
      try { showPlan(await api("POST", "/api/roster/preview", body())); $("#rapply", pane).disabled = false; }
      catch (err) { $("#rpv", pane).innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    };
    $("#rprev", pane).onclick = preview;
    $("#dom", pane).onchange = () => files && preview();
    $("#nodemo", pane).onchange = () => files && preview();
    const showPlan = (r) => {
      const st = r.stats, p = r.plan;
      const warns = r.issues.filter((i) => i.level === "warn"), infos = r.issues.filter((i) => i.level !== "warn");
      $("#rpv", pane).innerHTML = `<div class="dstats">
          <div><b class="mono">${st.managers}</b><small>floor managers</small></div><div><b class="mono">${st.supervisors}</b><small>supervisors</small></div>
          <div><b class="mono">${st.agents}</b><small>agents</small></div><div><b class="mono">${st.not_in_production}</b><small>agents in training (not ranked)</small></div></div>
        <p class="small">Roster date <b>${esc(st.roster_date ? dateLabel(st.roster_date) : "unknown")}</b> · ${st.lobs.map(esc).join(", ")}. Importing will add <b>${p.create}</b>, update <b>${p.update}</b>, leave <b>${p.same}</b> unchanged and mark <b>${p.deactivate}</b> as left${p.demo ? `, and ${p.remove_demo ? "remove" : "keep"} <b>${p.demo}</b> demo people` : ""}.</p>
        ${p.deactivate_list.length ? `<details class="mt"><summary class="small"><b>Will be marked as left (${p.deactivate_list.length})</b></summary><p class="small">${p.deactivate_list.map(esc).join("<br>")}</p></details>` : ""}
        ${p.changes.length ? `<details class="mt"><summary class="small"><b>Changes to people already in PULSE (${p.update})</b></summary><p class="small">${p.changes.map(esc).join("<br>")}</p></details>` : ""}
        ${p.kept_list.length ? `<details class="mt"><summary class="small"><b>In PULSE but not in these files (kept as they are: ${p.kept_list.length})</b></summary><p class="small">${p.kept_list.map(esc).join("<br>")}</p></details>` : ""}
        ${warns.length ? `<div class="sticky small mt"><b>Check these (${warns.length})</b><ul>${warns.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul></div>` : ""}
        ${infos.length ? `<details class="mt"><summary class="small"><b>Notes (${infos.length})</b></summary><ul class="small">${infos.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul></details>` : ""}
        <h3 class="mt2">Who reports to whom</h3>
        ${r.tree.map((m) => `<details class="tree mt"${m.name.startsWith("Alfredo") || r.tree.length < 3 ? " open" : ""}><summary><b>${esc(m.name)}</b> <span class="small muted">${esc(m.email)} · ${m.supervisors.length} supervisors · ${m.supervisors.reduce((a, s) => a + s.agents, 0)} agents</span></summary>
          <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Supervisor</th><th>LOB</th><th>Agents</th><th>In training</th><th>Sub-LOBs</th></tr></thead><tbody>
          ${m.supervisors.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="small muted mono">${esc(x.email)}</div></td><td>${esc(x.lob || "")}</td><td class="num">${x.agents}</td><td class="num">${x.not_in_production || ""}</td><td class="small">${x.sub_lobs.map(esc).join(", ")}</td></tr>`).join("")}</tbody></table></div></details>`).join("")}`;
    };
    $("#rapply", pane).onclick = async () => {
      if (!files) return;
      $("#rapply", pane).disabled = true;
      busy($("#rpv", pane), "Importing… this can take a minute on Supabase.");
      try {
        const r = await api("POST", "/api/roster/apply", body());
        const p = r.plan;
        $("#rpv", pane).innerHTML = `<div class="sticky"><b>Roster imported.</b> ${p.create} added, ${p.update} updated, ${p.same} unchanged, ${p.deactivate} marked as left${p.remove_demo ? `, ${p.demo} demo people removed` : ""}.<br>Next: create their logins with <span class="mono">npm run create-logins -- --password=YourTempPass123</span>, then share the temporary password privately.</div>`;
        toast("Roster imported.");
      } catch (err) { toast(err.message, "err"); $("#rpv", pane).innerHTML = `<div class="empty">${esc(err.message)}</div>`; $("#rapply", pane).disabled = false; }
    };
  };

  const samplePane = async () => {
    pane.innerHTML = `<div class="loading">Checking…</div>`;
    const st = await api("GET", "/api/sample");
    pane.innerHTML = `<div class="grid g-main"><div class="card"><div class="card-h"><h3>Sample data</h3></div>
      <label class="switch mt"><input type="checkbox" id="smp" ${st.on ? "checked" : ""} ${st.agents ? "" : "disabled"}><span class="track" aria-hidden="true"></span><span><b>${st.on ? "On" : "Off"}</b> · made-up numbers and coaching history for your ${st.agents} agents</span></label>
      <p class="small mt" id="smp-msg">${st.on ? `On: ${st.rows} sample KPI weeks are loaded. A banner shows on every page while it’s on.` : st.agents ? "Off: screens show only real data." : "Import the roster first."}</p></div>
      <div class="stack"><div class="card"><h3>What it loads</h3><ul class="small">
        <li>8 weeks of MES NPS, CSAT, FCR, AHT and Quality for every agent in production, around your goals</li>
        <li>Survey comments that match each agent’s weak behavior</li>
        <li>Coaching history for about 4 in 10 agents: DIRECT sessions, SMART commitments, the 4 weekly sessions and some quizzes</li>
        <li>Agents in training get none (they aren’t ranked)</li></ul></div>
        <div class="card"><h3>Safe to remove</h3><p class="small">Every sample row is tagged. Turning it off deletes only sample rows. Real KPIs you upload replace the sample week for that agent, and real coaching is never attached to sample rows. Turn it off before supervisors start real coaching, so nobody coaches on made-up numbers.</p></div></div></div>`;
    const sw = $("#smp", pane);
    sw.onchange = async () => {
      sw.disabled = true; $("#smp-msg", pane).textContent = sw.checked ? "Loading sample data… this can take a minute on Supabase." : "Removing sample data…";
      try { await api("POST", "/api/sample", { on: sw.checked }); toast(sw.checked ? "Sample data is on." : "Sample data removed."); window.dispatchEvent(new Event("pulse:sample-changed")); }
      catch (e) { toast(e.message, "err"); }
      samplePane();
    };
  };
  const show = () => {
    $$("[data-k]", main).forEach((x) => x.setAttribute("aria-pressed", x.dataset.k === kind));
    if (kind === "roster") rosterPane(); else if (kind === "sample") samplePane(); else csvPane();
  };
  $$("[data-k]", main).forEach((b) => (b.onclick = () => { kind = b.dataset.k; show(); }));
  show();
}
