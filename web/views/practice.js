// Practice log: every roleplay, with the full details of how it went.
import { esc, $, $$, bName, options, sourceTag, icon, behaviorList, allBehaviors } from "../ui.js";

const head = (title, sub, actions = "") => `<div class="topline"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
const MOOD_CHIP = { calm: "ok", worried: "warn", frustrated: "warn", angry: "bad" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const len = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
const when = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`; };
const scoreChip = (s) => (s == null ? `<span class="chip plain">Not scored</span>` : `<span class="chip ${s >= 4 ? "ok" : s >= 3 ? "warn" : "bad"}">${s}/5</span>`);
const moodChip = (m) => (m ? `<span class="chip ${MOOD_CHIP[m] || "plain"} plain">${esc(cap(m))}</span>` : "");
const PERIODS = [{ id: "7", name: "Last 7 days" }, { id: "30", name: "Last 30 days" }, { id: "90", name: "Last 90 days" }, { id: "all", name: "All time" }];

// ---------------------------------------------------------------- List
export async function log(main, params, { api, go, state }) {
  const role = state.user.role;
  const [rows, agents] = await Promise.all([api("GET", "/api/roleplays"), role === "agent" ? [] : api("GET", "/api/agents")]);
  const f = { who: params.agent_id || "", behavior: params.behavior || "", mode: "", period: params.period || "30", status: "" };
  const people = role === "agent" ? [] : [{ id: "", name: "Everyone" }, ...agents.map((a) => ({ id: a.id, name: a.name })), { id: "_self", name: role === "manager" ? "Supervisors’ own practice" : "My own practice" }];

  main.innerHTML = head("Practice log", role === "agent" ? "Every practice call you’ve taken: how it went, your score, and your coach’s notes." : "Every roleplay your team has practiced. Open one to see the full call, the feedback and how it sounded.", `<button class="btn" id="csv">${icon("up")}Export CSV</button>`) +
    `<div class="card"><div class="fgrid">
      ${role === "agent" ? "" : `<label class="f">Agent<select class="in" data-f="who">${options(people, f.who)}</select></label>`}
      <label class="f">Core behavior<select class="in" data-f="behavior">${options([{ id: "", name: "All behaviors" }, ...behaviorList(null, f.behavior)], f.behavior)}</select></label>
      <label class="f">How<select class="in" data-f="mode">${options([{ id: "", name: "Voice and chat" }, { id: "voice", name: "Voice calls" }, { id: "text", name: "Chat" }], "")}</select></label>
      <label class="f">When<select class="in" data-f="period">${options(PERIODS, f.period)}</select></label>
      <label class="f">Status<select class="in" data-f="status">${options([{ id: "", name: "All" }, { id: "scored", name: "Scored" }, { id: "unscored", name: "Not scored yet" }, { id: "low", name: "Scored 1–2 (needs help)" }], "")}</select></label>
    </div></div><div id="out" class="mt"></div>`;

  const filtered = () => {
    const since = f.period === "all" ? "" : new Date(Date.now() - Number(f.period) * 86400000).toISOString();
    return rows.filter((r) =>
      (!f.who || (f.who === "_self" ? !r.agent_id : r.agent_id === f.who)) &&
      (!f.behavior || r.behavior === f.behavior) && (!f.mode || r.scenario.channel === f.mode) && (!since || r.created_at >= since) &&
      (!f.status || (f.status === "scored" ? r.evaluation : f.status === "unscored" ? !r.evaluation : r.evaluation && r.evaluation.score <= 2)));
  };
  const draw = () => {
    const list = filtered(), scored = list.filter((r) => r.evaluation);
    const avg = scored.length ? (scored.reduce((s, r) => s + r.evaluation.score, 0) / scored.length).toFixed(1) : "—";
    const good = scored.length ? Math.round((scored.filter((r) => r.evaluation.score >= 4).length / scored.length) * 100) : null;
    const lens = list.map((r) => r.duration_s).filter((x) => x != null);
    const voice = list.length ? Math.round((list.filter((r) => r.scenario.channel === "voice").length / list.length) * 100) : null;
    const byB = allBehaviors().map((b) => { const xs = list.filter((r) => r.behavior === b.id), sc = xs.filter((r) => r.evaluation); return { b, n: xs.length, avg: sc.length ? sc.reduce((s, r) => s + r.evaluation.score, 0) / sc.length : null }; }).filter((x) => x.n);
    $("#out", main).innerHTML = !list.length ? `<div class="card"><div class="empty">No practice matches these filters.${role === "agent" ? " Take a call under Practice and it shows up here." : ""}</div></div>` : `
      <div class="kpis">
        <div class="kpi"><span class="k">Practices</span><span class="v">${list.length}</span><span class="meta"><span>${scored.length} scored</span></span></div>
        <div class="kpi"><span class="k">Average score</span><span class="v">${avg}</span><span class="meta"><span>out of 5</span></span></div>
        <div class="kpi"><span class="k">Scored 4–5</span><span class="v">${good == null ? "—" : good + "%"}</span><span class="meta"><span>of scored calls</span></span></div>
        <div class="kpi"><span class="k">Average length</span><span class="v">${lens.length ? len(Math.round(lens.reduce((a, b) => a + b, 0) / lens.length)) : "—"}</span><span class="meta"><span>min:sec</span></span></div>
        <div class="kpi"><span class="k">Voice calls</span><span class="v">${voice == null ? "—" : voice + "%"}</span><span class="meta"><span>the rest by chat</span></span></div>
      </div>
      <div class="grid g-main mt">
        <div class="tbl-wrap"><table class="tbl plog"><thead><tr><th>When</th>${role === "agent" ? "" : "<th>Agent</th>"}<th>Practiced</th><th>Length</th><th>Member mood</th><th>Score</th></tr></thead><tbody>
          ${list.map((r) => `<tr class="click" data-id="${r.id}" tabindex="0">
            <td class="num">${esc(day(r.created_at))}<div class="small muted">${esc(time(r.created_at))}</div></td>
            ${role === "agent" ? "" : `<td>${esc(r.agent_name || r.taken_by || "—")}${r.agent_id && r.user_id !== r.agent_id ? `<div class="small muted">taken by ${esc(r.taken_by)}</div>` : !r.agent_id ? `<div class="small muted">own practice</div>` : ""}</td>`}
            <td><b>${esc(r.behavior_name)}</b><div class="small muted">${esc(r.scenario.call_type)} · ${r.scenario.channel === "voice" ? "Voice" : "Chat"} · ${esc(r.scenario.difficulty || "")}${r.scenario.edited ? " · custom" : ""}${r.sample ? " · sample" : ""}</div></td>
            <td class="num">${len(r.duration_s)}<div class="small muted">${r.turns} turn${r.turns === 1 ? "" : "s"}</div></td>
            <td>${r.mood_start ? `${moodChip(r.mood_start)}${r.mood_end && r.mood_end !== r.mood_start ? `<div class="small muted">→ ${esc(cap(r.mood_end))}</div>` : ""}` : "—"}</td>
            <td>${scoreChip(r.evaluation?.score)}${r.has_note ? `<div class="small muted">coach note</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="card"><h3>By behavior</h3><div class="list">${byB.map((x) => `<div class="li"><div class="grow"><div class="t">${esc(x.b.name)}</div><div class="small muted">${x.n} practice${x.n > 1 ? "s" : ""}</div></div><div class="pbar" title="Average ${x.avg == null ? "not scored" : x.avg.toFixed(1)}"><span style="width:${x.avg == null ? 0 : (x.avg / 5) * 100}%" class="${x.avg == null ? "" : x.avg >= 4 ? "ok" : x.avg >= 3 ? "warn" : "bad"}"></span></div><span class="mono small">${x.avg == null ? "—" : x.avg.toFixed(1)}</span></div>`).join("")}</div></div>
      </div>`;
    $$("tr.click", main).forEach((tr) => { const open = () => go("practice-detail", { id: tr.dataset.id }); tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
  };
  $$("[data-f]", main).forEach((s) => (s.onchange = () => { f[s.dataset.f] = s.value; draw(); }));
  $("#csv", main).onclick = () => {
    const cols = ["Date", "Agent", "Taken by", "Behavior", "Call type", "Mode", "Difficulty", "Custom scenario", "Length (s)", "Agent turns", "Mood start", "Mood end", "Score", "Pace (wpm)", "Long silences", "Talked over member", "Summary", "Coach note", "Sample"];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = filtered().map((r) => [r.created_at, r.agent_name, r.taken_by, r.behavior_name, r.scenario.call_type, r.scenario.channel === "voice" ? "Voice" : "Chat", r.scenario.difficulty, r.scenario.edited ? "yes" : "no", r.duration_s, r.turns, r.mood_start, r.mood_end, r.evaluation?.score, r.wpm, r.dead_air, r.interruptions, r.evaluation?.summary, r.has_note ? "yes" : "no", r.sample ? "yes" : "no"].map(q).join(","));
    const blob = new Blob(["﻿" + [cols.map(q).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `PULSE practice log ${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  draw();
}

// ---------------------------------------------------------------- One practice
export async function detail(main, { id }, { api, go, toast, state }) {
  const r = await api("GET", `/api/roleplays/${id}`);
  const sc = r.scenario || {}, ev = r.evaluation, fx = r.facts, d = fx.delivery;
  const isVoice = sc.channel === "voice";
  const memberFirst = String(sc.member_name || "Member").split(" ")[0];
  const agentLabel = r.agent_name || r.taken_by || "Agent";
  let lastMood = null;
  const lines = fx.timeline.map((m) => {
    const at = m.offset_ms != null ? `<span class="mono">${len(Math.round(m.offset_ms / 1000))}</span>` : "";
    if (m.who === "member") {
      const changed = m.mood && m.mood !== lastMood; lastMood = m.mood || lastMood;
      return `<div class="tl member"><div class="tl-h">${at}<b>${esc(memberFirst)}</b>${changed ? moodChip(m.mood) : ""}</div><p>${esc(m.text)}</p></div>`;
    }
    const v = m.voice || {};
    const meta = [v.delay_ms != null ? `<span class="${v.delay_ms > 4000 ? "slow" : ""}">answered after ${(v.delay_ms / 1000).toFixed(1)} s</span>` : "", v.speak_ms ? `<span>spoke ${Math.round(v.speak_ms / 1000)} s</span>` : "", v.interrupted ? `<span class="slow">talked over the member</span>` : ""].filter(Boolean).join(" · ");
    return `<div class="tl agent"><div class="tl-h">${at}<b>${esc(r.taken_by ? r.taken_by.split(" ")[0] : "Agent")}</b></div><p>${esc(m.text)}</p>${meta ? `<div class="tl-m">${meta}</div>` : ""}</div>`;
  }).join("");

  main.innerHTML = `<button class="btn ghost sm" id="back">← Practice log</button>` +
    head(`${esc(bName(r.behavior))} · ${esc(sc.call_type || "Practice")}`, `${esc(agentLabel)}${r.agent_id && r.user_id !== r.agent_id ? ` · taken by ${esc(r.taken_by)}` : ""} · ${esc(when(r.created_at))} · ${isVoice ? "Voice call" : "Chat"} · ${esc(sc.difficulty || "")}${r.sample ? " · sample data" : ""}`) +
    `<div class="kpis">
      <div class="kpi"><span class="k">Score</span><span class="v">${ev ? `${ev.score}<small class="muted">/5</small>` : "—"}</span><span class="meta"><span>${ev ? (ev.score >= 4 ? "Strong practice" : ev.score >= 3 ? "Getting there" : "Needs another try") : "Not scored yet"}</span></span></div>
      <div class="kpi"><span class="k">Length</span><span class="v">${len(fx.duration_s)}</span><span class="meta"><span>${fx.turns} agent turn${fx.turns === 1 ? "" : "s"}</span></span></div>
      <div class="kpi"><span class="k">Member mood</span><span class="v small-v">${fx.mood_start ? `${esc(cap(fx.mood_start))} → ${esc(cap(fx.mood_end))}` : "—"}</span><span class="meta"><span>${fx.mood_end === "calm" && fx.mood_start !== "calm" ? "Calmed down during the call" : fx.mood_end === fx.mood_start ? "No change" : ""}</span></span></div>
      <div class="kpi"><span class="k">Asked about other needs</span><span class="v small-v">${fx.asked_other_needs ? "Yes" : "No"}</span><span class="meta"><span>${sc.hidden_need ? (fx.asked_other_needs ? "The hidden need could come up" : "The hidden need never came up") : ""}</span></span></div>
    </div>
    <div class="grid g-main mt">
      <div class="stack">
        <div class="card"><div class="card-h"><h3>The call</h3><span class="small muted">${fx.timeline.some((m) => m.offset_ms != null) ? "min:sec from the start" : ""}</span></div><div class="timeline">${lines}</div>
          ${r.status === "active" ? `<p class="small muted mt">This call was left open${r.user_id === state.user.id ? ". Open it from Practice to finish it." : "."}</p>` : ""}</div>
        ${ev ? `<div class="ai-card"><div class="ai-h"><b>Feedback · ${ev.score}/5</b>${sourceTag(ev)}</div><div class="ai-b"><p>${esc(ev.summary || "")}</p>
          ${(ev.criteria || []).length ? `<span class="eyebrow">Scored on</span><ul class="crit-list">${ev.criteria.map((c) => `<li class="${c.met ? "met" : "miss"}"><b aria-label="${c.met ? "Met" : "Not met"}">${c.met ? "✓" : "✕"}</b><span>${esc(c.text)}${c.evidence ? `<small>${esc(c.evidence)}</small>` : ""}</span></li>`).join("")}</ul>` : ""}
          <div class="grid g2 mt"><div><span class="eyebrow">What worked</span><ul class="small">${(ev.did_well || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div><div><span class="eyebrow">Try next time</span><ul class="small">${(ev.improve || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>
          ${(ev.model_lines || []).length ? `<span class="eyebrow">Model lines</span><ul class="small">${ev.model_lines.map((x) => `<li>“${esc(x)}”</li>`).join("")}</ul>` : ""}
          <p class="small mt"><b>${esc(bName(r.behavior))}:</b> ${ev.behavior_seen === false ? "didn’t come through clearly" : "showed up in the call"}.${(ev.other_behaviors || []).length ? ` Also heard: ${ev.other_behaviors.map(esc).join(", ")}.` : ""}</p></div></div>`
          : `<div class="card"><h3>Feedback</h3><div class="empty">Not scored yet: the call ended before feedback was requested.${r.user_id === state.user.id && r.status !== "active" ? `<div class="row mt"><button class="btn primary" id="score">Get feedback now</button></div>` : ""}</div></div>`}
        ${d ? `<div class="card"><h3>How it sounded</h3><div class="dstats">
            <div><b class="mono">${d.wpm ?? "—"}</b><small>words / min<br>target 120–165</small></div>
            <div><b class="mono">${d.avg_response_s ?? "—"} s</b><small>average time to answer</small></div>
            <div class="${d.dead_air ? "warnv" : ""}"><b class="mono">${d.dead_air}</b><small>long silences (4 s+)</small></div>
            <div class="${d.interruptions ? "warnv" : ""}"><b class="mono">${d.interruptions}</b><small>times they talked over the member</small></div>
            <div><b class="mono">${d.talk_share ?? "—"}%</b><small>of the talking was the agent</small></div></div>
            ${ev?.delivery_tip ? `<p class="small mt"><b>Delivery tip:</b> ${esc(ev.delivery_tip)}</p>` : ""}
            <ul class="small">${d.notes.filter((n) => n !== ev?.delivery_tip).map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
            <p class="small muted">Timings come from speech recognition and are approximate.</p></div>` : ""}
      </div>
      <div class="stack">
        <div class="card"><h3>Coach note</h3>
          ${r.can_note ? `<textarea class="in" id="note" maxlength="1000" placeholder="What you noticed and what to practice next. ${esc((r.agent_name || "The agent").split(" ")[0])} sees this note.">${esc(r.coach_note || "")}</textarea>
            <div class="spread mt"><span class="small muted">${r.coach_note ? `Last saved by ${esc(r.coach_note_by_name)}` : "Not written yet"}</span><button class="btn primary sm" id="save-note">Save note</button></div>`
          : r.coach_note ? `<p>${esc(r.coach_note)}</p><p class="small muted">${esc(r.coach_note_by_name)}</p>` : `<div class="empty">No note from your coach yet.</div>`}</div>
        <div class="card"><div class="card-h"><h3>The scenario</h3>${sc.edited ? `<span class="chip teal">Custom</span>` : ""}</div>
          <dl class="kv">
            <dt>Member</dt><dd>${esc(sc.member_name || "")}${sc.member_age ? `, ${esc(sc.member_age)}` : ""} · starts ${esc(sc.mood || "")}</dd>
            <dt>Before the call</dt><dd>${esc(sc.situation || "")}</dd>
            <dt>First words</dt><dd>“${esc(sc.opening || "")}”</dd>
            ${sc.hidden_need ? `<dt>Hidden need</dt><dd>${esc(sc.hidden_need)}</dd>` : ""}
            ${sc.member_notes ? `<dt>Direction for the member</dt><dd>${esc(sc.member_notes)}</dd>` : ""}
            <dt>Scored on</dt><dd><ul class="small">${(sc.success_criteria || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></dd>
          </dl>
          <p class="small muted">${sc.edited ? `Written or edited by ${esc(r.edited_by_name || "the supervisor")}${sc.ai_by ? ` from a draft by ${esc(sc.ai_by)}` : ""}.` : sc.source === "ai" ? `Generated by ${esc(sc.ai_by || "AI")}.` : "Built-in practice scenario."}</p>
          ${r.assignment ? `<p class="small muted">Assigned by ${esc(r.assignment.assigned_by)}${r.assignment.note ? `: “${esc(r.assignment.note)}”` : ""}</p>` : ""}</div>
      </div>
    </div>`;

  $("#back", main).onclick = () => go("practice-log", r.agent_id && state.user.role !== "agent" ? { agent_id: r.agent_id } : {});
  const save = $("#save-note", main);
  if (save) save.onclick = async () => {
    save.disabled = true;
    try { await api("PUT", `/api/roleplays/${r.id}/note`, { note: $("#note", main).value }); toast($("#note", main).value.trim() ? `Note saved. ${(r.agent_name || "The agent").split(" ")[0]} was notified.` : "Note removed."); go("practice-detail", { id: r.id }); }
    catch (e) { toast(e.message, "err"); save.disabled = false; }
  };
  const sb = $("#score", main);
  if (sb) sb.onclick = async () => { sb.disabled = true; try { await api("POST", `/api/ai/roleplay/${r.id}/evaluate`); go("practice-detail", { id: r.id }); } catch (e) { toast(e.message, "err"); sb.disabled = false; } };
}
