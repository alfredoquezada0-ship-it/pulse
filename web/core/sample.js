// Sample data: made-up KPIs, survey comments and coaching history for the REAL roster, so every screen can be
// explored before real numbers are loaded. Every row is tagged sample: true and can be removed in one step.
// Agents in training get no sample numbers (they aren't ranked anyway). Real rows are never overwritten.
import { BEHAVIORS, BEHAVIOR_BY_ID, ROOT_CAUSES, TOOL_PLAN, SESSION_TYPES, SUP_BEHAVIOR_BY_ID } from "./constants.js";
import { quizOffline } from "./ai.js";
import { buildPractices } from "./sample-practice.js";
import { buildDiagnoses } from "./sample-diagnosis.js";
import { rng, uid, weekStart, addDays, today } from "./util.js";
import { goalsFor, supervisorMetrics, suggestSupBehavior } from "./services.js";

export const SAMPLE_TABLES = ["diagnoses", "roleplays", "weekly_sessions", "commitments", "coaching_sessions", "quizzes", "verbatims", "kpi_weekly"]; // delete order

const NEG = {
  lara: ["I had to repeat my issue three times.", "They used terms I didn't understand.", "Felt like nobody was listening."],
  ownership: ["I got transferred and sent right back.", "They said they'd call me back and never did.", "Nobody owned my problem."],
  expectations: ["Nobody told me what happens next.", "I had no idea when my card would arrive.", "Still waiting and nobody said how long it takes."],
  needs: ["They were saying goodbye before I could ask my other question.", "I had to call again for a second issue."],
  warm: ["The agent sounded cold, like a robot.", "Very short with me."],
  appreciation: ["Long hold with no explanation.", "Dead air, I felt like a ticket number."],
  empathy: ["My claim was denied and they didn't seem to care.", "I was upset about the bill and got no sympathy."],
};
const POS = ["Took care of everything and explained it clearly.", "Very friendly and patient, thank you!", "Told me exactly what happens next.", "Fast, kind and helpful."];
// FNV-1a plus a finalizer, so ids that look alike (a1, a2…) still get unrelated random streams.
const hash = (s) => {
  let h = [...String(s)].reduce((x, c) => Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
  return h >>> 0;
};

// agents: active roster agents in scope; existing: { kpi_weekly: rows already in the database } (real weeks are skipped)
export function buildSample(agents, goals, existingKpi = []) {
  const now = today(), thisWeek = weekStart(now), lastWeek = addDays(thisWeek, -7);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (8 - i)));
  const realWeeks = new Set(existingKpi.filter((r) => !r.sample).map((r) => `${r.agent_id}|${r.week_start}`));
  const out = Object.fromEntries(SAMPLE_TABLES.map((t) => [t, []]));
  const tag = { sample: true };
  agents.filter((a) => a.in_production !== false).forEach((a, i) => {
    const r = rng(hash(a.id)); r(); r(); // skip the first draws of the generator
    const between = (x, y) => x + r() * (y - x);
    const g = goalsFor(goals, a.lob);
    const weak = BEHAVIORS[Math.floor(r() * BEHAVIORS.length)];
    const strength = between(-1, 1);
    // About 8 in 10 agents are in the weekly coaching cycle; the rest show up as "not coached" (and some as Outliers).
    const coached = !!a.supervisor_id && r() < 0.8;
    const improving = coached && r() < 0.65;
    const hit = (k) => (weak.kpis.includes(k) ? 1 : 0);
    weeks.forEach((w, wi) => {
      if (realWeeks.has(`${a.id}|${w}`)) return;
      const lift = improving && wi >= 5 ? (wi - 4) * 2 : 0;
      out.kpi_weekly.push({
        id: uid(), agent_id: a.id, week_start: w, ...tag,
        nps: Math.round(g.nps.goal + 7 + strength * 15 - hit("nps") * 10 + lift * 1.6 + between(-6, 6)),
        csat: +Math.min(100, g.csat.goal + 3 + strength * 5 - hit("csat") * 4 + lift * 0.6 + between(-2, 2)).toFixed(1),
        fcr: +Math.min(100, g.fcr.goal + 0.9 + strength * 4 - hit("fcr") * 4 + lift * 0.5 + between(-1.5, 1.5)).toFixed(1),
        aht: Math.round(g.aht.goal - strength * 60 + (weak.id === "appreciation" ? 70 : 0) - lift * 4 + between(-30, 30)),
        qa: +Math.min(100, g.qa.goal + 2 + strength * 5 - between(0, 4)).toFixed(1),
        surveys: Math.round(between(5, 15)),
      });
    });
    const neg = NEG[weak.id];
    for (let v = 0; v < (strength > 0.5 ? 1 : 2); v++) out.verbatims.push({ id: uid(), agent_id: a.id, date: addDays(now, -Math.round(between(2, 20))), score: Math.round(between(0, 6)), text: neg[v % neg.length], ...tag });
    out.verbatims.push({ id: uid(), agent_id: a.id, date: addDays(now, -Math.round(between(2, 20))), score: 9 + (i % 2), text: POS[Math.floor(r() * POS.length)], ...tag });
    if (!coached) return;
    coachingHistory(out, a, { r, between, weak, improving, neg, now, thisWeek });
  });
  return out;
}

// ---------- coaching history ----------
// Commitments in the agent's own words: one observable action, so they pass the SMART check.
const ACTIONS = {
  lara: ["Before I research, I’ll repeat the member’s issue back in one sentence", "After I answer, I’ll ask ‘Did that answer your question?’", "I’ll explain plan terms with the member’s own numbers instead of codes"],
  ownership: ["I’ll say ‘I’ll handle this for you’ and stay on the line until it’s solved", "Before any transfer, I’ll explain why and stay on until the next person picks up", "When I promise a callback, I’ll give the day and time and log it while we talk"],
  expectations: ["Before closing, I’ll tell the member the next step and the date it happens", "On claim calls, I’ll give the timeline in days and what to do if nothing arrives", "I’ll give a reference number and what to say if they call back"],
  needs: ["Before closing, I’ll ask ‘Is there anything else coming up, like an appointment or a refill?’", "I’ll ask what prompted the call before giving the answer", "I’ll check for a second need when the member mentions a doctor or a bill"],
  warm: ["I’ll greet the member by name and say ‘I’m happy to help’ in the first 15 seconds", "I’ll use the member’s name at least twice during the call", "I’ll close with a warm line that matches what we solved"],
  appreciation: ["I’ll thank the member for holding every time I come back to the line", "Before any hold, I’ll say why and for how long", "I’ll thank the member for their patience before giving the resolution"],
  empathy: ["When a member is upset, I’ll acknowledge the feeling in one sentence before solving", "On denial calls, I’ll say ‘I understand how stressful that is’ before explaining options", "When money is a worry, I’ll name it and explain the options in plain words"],
};
const D_NOTES = ["Asked how the new schedule is going; {first} is settling in.", "Talked about the weekend and the team huddle; good energy.", "Checked in on the training {first} finished last week.", "Opened with what’s going well this month on the floor."];
const R_NOTES = ["Recognized clean verification and a calm tone on a tough call.", "Called out a great close on a billing call from Tuesday.", "Recognized that {first} kept the member informed during a long hold.", "Praised the warm greeting on 4 of the 5 calls reviewed."];
const E_NOTES = ["{first} spotted the gap when we replayed the last 30 seconds of the call.", "Asked what the member needed at that moment; {first} named it right away.", "{first} said the busy afternoons are when it slips.", "We compared the call with a model call and {first} heard the difference."];
const MISSED = ["Short-staffed, moved to the floor", "Agent out sick", "Team meeting ran long", "Supervisor in client call"];
const REVIEW = {
  met: ["{hits} of {total}. Kudos given in front of the team.", "{hits} of {total}. Great consistency; raise the bar next week.", "{hits} of {total}. Keep it one more week to make it stick."],
  partial: ["{hits} of {total}. Slips on busy afternoons; keep the behavior and add SBS.", "{hits} of {total}. Good start; practice the line in Skill Transfer again.", "{hits} of {total}. Better than last week; same commitment, new tool."],
  not_met: ["{hits} of {total}. Not happening yet; re-check the root cause.", "{hits} of {total}. Agent says the screen flow gets in the way; escalated.", "{hits} of {total}. Held accountable; agreed on a smaller step."],
};
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");

function coachingHistory(out, a, { r, between, weak, improving, neg, now, thisWeek }) {
  const tag = { sample: true };
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const first = a.name.split(" ")[0];
  const sup = a.supervisor_id;
  const second = BEHAVIORS.filter((b) => b.id !== weak.id)[Math.floor(r() * (BEHAVIORS.length - 1))];
  const pMet = improving ? between(0.55, 0.85) : between(0.25, 0.5);
  const weeks = 3 + Math.floor(r() * 5); // 3 to 7 past weeks of history, plus this week
  let behavior = weak, actionIdx = 0, rc = pick(ROOT_CAUSES).id, metRow = 0, missRow = 0, last = null;

  for (let k = weeks; k >= 0; k--) {
    const wk = addDays(thisWeek, -7 * k), current = k === 0;
    const friday = addDays(wk, 4);
    const reviewed = !current || (friday < now && r() < 0.65); // some of this week's reviews are still pending
    const total = 5;
    const roll = r() + (weeks - k) * 0.03; // a little better every week
    const status = !reviewed ? "open" : roll < pMet ? "met" : roll < pMet + 0.25 ? "partial" : "not_met";
    const hits = status === "met" ? (r() < 0.6 ? 5 : 4) : status === "partial" ? 3 : Math.floor(r() * 3);
    const tool = TOOL_PLAN[rc];
    const action = ACTIONS[behavior.id][actionIdx % ACTIONS[behavior.id].length];
    const sessionDate = addDays(wk, r() < 0.7 ? 0 : 1);
    const lastLine = last ? `Last week: “${last.action}”, ${last.status === "met" ? "met" : last.status === "partial" ? "partly met" : "not met"} (${last.monitor_hits} of ${last.monitor_total}).` : "First coaching on this behavior.";
    const s = {
      id: uid(), agent_id: a.id, supervisor_id: sup, date: sessionDate, status: "completed", behavior: behavior.id, root_cause: rc, kpi_focus: behavior.kpis[0], ...tag,
      evidence: last && last.behavior === behavior.id ? `${lastLine} Verbatim: “${pick(NEG[behavior.id])}”` : `${5 - Math.min(4, 1 + Math.floor(r() * 3))} of 5 reviewed calls had the gap. Verbatim: “${neg[0]}”`,
      notes: {
        D: fill(pick(D_NOTES), { first }),
        I: `Focus on ${behavior.name}. ${lastLine}`,
        R: fill(pick(R_NOTES), { first }),
        E: fill(pick(E_NOTES), { first }),
        C: `Root cause: ${ROOT_CAUSES.find((x) => x.id === rc).name}. ${ROOT_CAUSES.find((x) => x.id === rc).sign}`,
        T: `Agreed: “${action}”, on ${total} calls. ${tool.skill_transfer} in Skill Transfer, ${tool.monitor} Wed–Thu, review Friday.`,
      },
    };
    out.coaching_sessions.push(s);
    const c = {
      id: uid(), session_id: s.id, agent_id: a.id, supervisor_id: sup, behavior: behavior.id, root_cause: rc, week_start: wk, ...tag,
      action, measure_target: status === "not_met" && missRow ? 3 : 4 + (r() < 0.5 ? 1 : 0), measure_total: total, check_method: `${tool.monitor}, ${total} calls`, follow_up_date: friday, evidence: s.evidence,
      status, monitor_hits: reviewed ? hits : null, monitor_total: reviewed ? total : null, self_hits: reviewed ? Math.min(total + 2, hits + Math.floor(r() * 3)) : Math.floor(r() * 4),
      agent_ack: !current || reviewed || r() < 0.85, agent_ack_at: null, review_notes: reviewed ? fill(pick(REVIEW[status]), { hits, total }) : "",
    };
    if (c.measure_target > total) c.measure_target = total;
    if (c.agent_ack) c.agent_ack_at = `${sessionDate}T16:00:00`;
    out.commitments.push(c);
    SESSION_TYPES.forEach((t, ti) => {
      const d = t.id === "setting_goals" ? sessionDate : addDays(wk, t.days[r() < 0.6 ? 0 : t.days.length - 1] - 1);
      let st = d > now ? "planned" : "held", reason = "";
      if (st === "held" && t.id !== "setting_goals") { const x = r(); if (x < 0.06) { st = "missed"; reason = pick(MISSED); } else if (current && x < 0.1) st = "planned"; } // a few unmarked this week
      if (t.id === "kudos_accountability" && current && !reviewed && st === "held") st = "planned";
      out.weekly_sessions.push({ id: uid(), supervisor_id: sup, agent_id: a.id, commitment_id: c.id, week_start: wk, type: t.id, planned_date: d, planned_time: ["09:30", "10:00", "11:00", "14:00", "15:30"][Math.floor(r() * 5)], tool: tool[t.id], status: st, reason, notes: st === "held" && t.id === "monitor" && reviewed ? `${hits} of ${total} calls` : "", ...tag });
    });

    // A quiz most weeks the root cause is Knowledge, sometimes otherwise; this week's may still be waiting.
    if (rc === "knowledge" || r() < 0.3) {
      const qz = quizOffline(behavior, 4 + Math.floor(r() * 2), r);
      const done = !current || r() < 0.5;
      const skill = improving ? 0.85 : 0.65;
      const answers = done ? qz.questions.map((q) => (r() < skill ? q.a : (q.a + 1) % q.o.length)) : null;
      out.quizzes.push({ id: uid(), agent_id: a.id, supervisor_id: sup, behavior: behavior.id, title: qz.title, questions: qz.questions, source: "sample", ...tag,
        status: done ? "completed" : "assigned", answers, score: done ? Math.round((answers.filter((x, i) => x === qz.questions[i].a).length / qz.questions.length) * 100) : null,
        completed_at: done ? `${addDays(sessionDate, 1)}T12:00:00` : null, created_at: `${sessionDate}T17:00:00` });
    }

    // What happens next week: raise the bar after two met weeks, re-diagnose after two misses.
    metRow = status === "met" ? metRow + 1 : 0;
    missRow = status === "not_met" ? missRow + 1 : 0;
    if (metRow >= 2) { metRow = 0; actionIdx++; if (actionIdx >= 2) { behavior = behavior.id === weak.id ? second : weak; actionIdx = 0; } }
    if (missRow >= 2) { missRow = 0; rc = ROOT_CAUSES.filter((x) => x.id !== rc)[Math.floor(r() * 3)].id; }
    last = c;
  }
}

// ---------- assigned roleplays, notifications and manager → supervisor coaching ----------
const niceDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const DIGEST_TYPES = ["sup_unmarked", "sup_overdue", "leader_review_due", "leader_not_ack", "leader_missing"];
const CALLS = ["Claim status", "Benefits question", "Eligibility", "Billing / premium", "ID card", "Claim denial"];

function teamExtras(team, data, goalsNow = today()) {
  const out = { roleplay_assignments: [], roleplays: [], diagnoses: [], notifications: [], leader_sessions: [], leader_commitments: [] };
  const now = goalsNow, thisWeek = weekStart(now), tag = { sample: true };
  const supName = Object.fromEntries(team.sups.map((x) => [x.id, x.name]));
  const firstOf = (n) => String(n || "").split(" ")[0];
  const note = (user_id, n, at, read = false) => out.notifications.push({ id: uid(), user_id, type: n.type, title: n.title, body: n.body || "", link: n.link || null, key: null, read_at: read ? at : null, created_at: at, ...tag });
  const r = rng(hash(team.manager?.id || "team")); r(); r();
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  // Agents: this week's DIRECT session, quizzes and roleplays, as they would have been notified.
  const byAgent = Object.fromEntries(team.agents.map((a) => [a.id, a]));
  for (const c of data.commitments.filter((x) => x.week_start === thisWeek)) {
    const s = data.coaching_sessions.find((x) => x.id === c.session_id);
    note(c.agent_id, { type: "direct_session", title: `New DIRECT session from ${firstOf(supName[c.supervisor_id])}`, body: `Your commitment this week: “${c.action}”. Open My week to acknowledge it.`, link: { view: "my-week" } }, `${s?.date || thisWeek}T16:05:00`, c.agent_ack);
  }
  for (const q of data.quizzes.filter((x) => String(x.created_at).slice(0, 10) >= thisWeek)) {
    note(q.agent_id, { type: "quiz_assigned", title: `New quiz from ${firstOf(supName[q.supervisor_id])}`, body: `${q.title} · ${q.questions.length} questions`, link: { view: "my-quizzes", params: { id: q.id } } }, q.created_at, q.status === "completed");
    if (q.status === "completed") note(q.supervisor_id, { type: "quiz_done", title: `${byAgent[q.agent_id]?.name} finished a quiz: ${q.score}%`, body: q.title, link: { view: "agent", params: { id: q.agent_id } } }, q.completed_at, r() < 0.4);
  }
  const coached = [...new Set(data.commitments.map((c) => c.agent_id))];
  for (const id of coached) {
    const a = byAgent[id]; if (!a?.supervisor_id) continue;
    const cur = data.commitments.find((c) => c.agent_id === id && c.week_start === thisWeek);
    const x = r();
    if (x < 0.25) { // assigned this week, waiting
      const ra = { id: uid(), agent_id: id, assigned_by: a.supervisor_id, behavior: cur?.behavior || pick(BEHAVIORS).id, call_type: pick(CALLS), difficulty: pick(["easy", "medium", "medium", "hard"]), channel: r() < 0.7 ? "voice" : "text", due_date: addDays(thisWeek, 3), note: pick(["Practice it before Monitor on Wednesday.", "Try it by voice, like a real call.", "Focus on the close.", ""]), status: "assigned", roleplay_id: null, score: null, completed_at: null, created_at: `${addDays(thisWeek, 1)}T11:00:00`, ...tag };
      out.roleplay_assignments.push(ra);
      note(id, { type: "roleplay_assigned", title: `${firstOf(supName[a.supervisor_id])} assigned you a roleplay`, body: `${BEHAVIOR_BY_ID[ra.behavior].name} · ${ra.call_type} · by ${niceDate(ra.due_date)}${ra.note ? ` · “${ra.note}”` : ""}`, link: { view: "practice", params: { assignment: ra.id } } }, ra.created_at);
    } else if (x < 0.4) { // done last week
      const lw = addDays(thisWeek, -7), score = 2 + Math.floor(r() * 4);
      const ra = { id: uid(), agent_id: id, assigned_by: a.supervisor_id, behavior: pick(BEHAVIORS).id, call_type: pick(CALLS), difficulty: "medium", channel: "voice", due_date: addDays(lw, 3), note: "", status: "done", roleplay_id: null, score, completed_at: `${addDays(lw, 2)}T15:00:00`, created_at: `${addDays(lw, 1)}T11:00:00`, ...tag };
      out.roleplay_assignments.push(ra);
      note(a.supervisor_id, { type: "roleplay_done", title: `${a.name} finished the roleplay: ${score}/5`, body: `${BEHAVIOR_BY_ID[ra.behavior].name} · ${ra.call_type}`, link: { view: "agent", params: { id } } }, ra.completed_at, true);
    }
  }

  // Practice log: a few scripted practice calls per coached agent, and one for each finished assignment.
  const focus = Object.fromEntries(data.commitments.filter((c) => c.week_start === thisWeek).map((c) => [c.agent_id, c.behavior]));
  const supsById = Object.fromEntries(team.sups.map((x) => [x.id, x]));
  out.roleplays = buildPractices({ agents: coached.map((id) => byAgent[id]).filter((a) => a?.supervisor_id), focus, done: out.roleplay_assignments.filter((x) => x.status === "done"), sups: supsById, now: new Date(`${now}T18:00:00`), seed: team.manager?.id || "team" })
    .map((rp) => ({ ...rp, ...tag }));

  // Supervisor-first diagnoses behind the DIRECT sessions (call listening, their pick, the AI's second opinion).
  out.diagnoses = buildDiagnoses({ sessions: data.coaching_sessions.filter((x) => x.status === "completed"), commitments: data.commitments, seed: team.manager?.id || "team" }).map((d) => ({ ...d, ...tag }));

  // Supervisors: a weekly 1:1 with their manager, measured from the coaching data above.
  if (team.manager) for (const sup of team.sups) {
    const mine = (row) => row.supervisor_id === sup.id;
    const weekly = data.weekly_sessions.filter(mine), commitments = data.commitments.filter(mine), coaching = data.coaching_sessions.filter(mine);
    if (!commitments.length) continue;
    const weeks = 3 + Math.floor(r() * 4);
    let prev = null, rc = pick(ROOT_CAUSES).id, sameWeeks = 0;
    for (let k = weeks; k >= 0; k--) {
      const wk = addDays(thisWeek, -7 * k), current = k === 0;
      const lastWeekM = supervisorMetrics({ weekly, commitments, coaching, week: addDays(wk, -7), now: wk });
      // Stay on a behavior while it's not met yet (up to 2 weeks); otherwise move to one of the two lowest measured behaviors.
      const lowest = Object.entries(lastWeekM).filter(([id, m]) => m.value != null && id !== prev?.behavior).sort((a, b) => a[1].value - b[1].value).slice(0, 2).map(([id]) => id);
      const behavior = prev && prev.status !== "met" && sameWeeks < 2 ? prev.behavior : lowest.length ? pick(lowest) : suggestSupBehavior(lastWeekM);
      sameWeeks = prev && behavior === prev.behavior ? sameWeeks + 1 : 0;
      const b = SUP_BEHAVIOR_BY_ID[behavior];
      if (prev && prev.status === "not_met" && prev.behavior === behavior) rc = ROOT_CAUSES.filter((x) => x.id !== rc)[Math.floor(r() * 3)].id;
      const date = addDays(wk, r() < 0.6 ? 0 : 1);
      if (date > now) continue;
      const lm = lastWeekM[behavior];
      const target = behavior === "followup" ? 100 : 90;
      const s = { id: uid(), supervisor_id: sup.id, manager_id: team.manager.id, date, status: "completed", behavior, root_cause: rc, metrics: lastWeekM, ...tag,
        evidence: `Last week in PULSE: ${lm.text}${lm.value != null ? ` (${lm.value}%)` : ""}.`,
        notes: {
          D: pick(["Checked in on the team’s workload and the new hires.", "Talked about the floor this week; staffing is tight on Thursdays.", "Opened with the wins from last week’s huddle."]),
          I: `Focus: ${b.name}. ${prev ? `Last week’s commitment was ${prev.status === "met" ? "met" : prev.status === "partial" ? "partly met" : "not met"} (${prev.result_value ?? "—"}% of ${prev.measure_target}%).` : "First 1:1 on this behavior."}`,
          R: pick(["Recognized the coaching on a tough agent this week.", "Two agents met their commitment two weeks in a row: called it out.", "Recognized the rhythm kept during a short-staffed week."]),
          E: pick(["Asked what the numbers say; they named the Thursday gap first.", "Asked which agents worry them most and why.", "Asked what they’d change next week; they picked the Friday reviews."]),
          C: `Root cause: ${ROOT_CAUSES.find((x) => x.id === rc).name}.`,
          T: `Agreed on one action for ${b.short.toLowerCase()}, target ${target}%, review Friday.`,
        } };
      out.leader_sessions.push(s);
      const thisM = supervisorMetrics({ weekly, commitments, coaching, week: wk, now: current ? now : addDays(wk, 7) });
      const value = thisM[behavior].value;
      const reviewed = !current || (addDays(wk, 4) < now && r() < 0.5);
      const status = !reviewed ? "open" : value == null ? "partial" : value >= target ? "met" : value >= target - 15 ? "partial" : "not_met";
      const c = { id: uid(), session_id: s.id, supervisor_id: sup.id, manager_id: team.manager.id, behavior, root_cause: rc, week_start: wk, ...tag,
        action: pick(b.actions), measure_target: target, measure_total: 100, check_method: `Measured in PULSE: ${b.measure.toLowerCase()}`, follow_up_date: addDays(wk, 4), evidence: s.evidence,
        status, result_value: reviewed ? value : null, sup_ack: !current || r() < 0.8, sup_ack_at: null,
        review_notes: reviewed ? (status === "met" ? "Measured result hit the target. Kudos." : status === "partial" ? "Close. Same behavior next week with a smaller step." : "Not there yet. Re-check the root cause together.") : "" };
      if (c.sup_ack) c.sup_ack_at = `${date}T17:00:00`;
      out.leader_commitments.push(c);
      if (current) {
        note(sup.id, { type: "leader_session", title: `New 1:1 from ${firstOf(team.manager.name)}`, body: `Your commitment this week: “${c.action}” (target ${target}%). Open My coaching to acknowledge it.`, link: { view: "my-coaching" } }, `${date}T16:30:00`, c.sup_ack);
        if (c.sup_ack) note(team.manager.id, { type: "leader_ack", title: `${sup.name} acknowledged this week’s commitment`, body: `“${c.action}”`, link: { view: "leader", params: { id: sup.id } } }, c.sup_ack_at, r() < 0.5);
      } else if (k === 1) note(sup.id, { type: "leader_review", title: `Your commitment was reviewed: ${{ met: "Met", partial: "Partially met", not_met: "Not met" }[status]}`, body: `“${c.action}”${value != null ? ` · measured ${value}% (target ${target}%)` : ""}`, link: { view: "my-coaching" } }, `${addDays(wk, 4)}T15:00:00`, true);
      prev = c;
    }
  }
  return out;
}

// Tables are inserted in dependency order: sessions before commitments before the weekly rhythm.
// team = { agents, sups, manager }
export async function sampleOn(store, team, goals) {
  await sampleOff(store, team);
  const ids = team.agents.map((a) => a.id);
  const data = buildSample(team.agents, goals, await store.list("kpi_weekly", { agent_id: ids }));
  Object.assign(data, teamExtras(team, data));
  for (const t of ["coaching_sessions", "diagnoses", "commitments", "weekly_sessions", "kpi_weekly", "verbatims", "quizzes", "roleplays", "roleplay_assignments", "leader_sessions", "leader_commitments", "notifications"]) {
    for (let i = 0; i < data[t].length; i += 500) await store.insertMany(t, data[t].slice(i, i + 500));
  }
  return Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length]));
}

export async function sampleOff(store, team) {
  const ids = team.agents.map((a) => a.id), sups = team.sups.map((x) => x.id);
  const people = [...ids, ...sups, ...(team.manager ? [team.manager.id] : [])];
  if (people.length) await store.removeWhere("notifications", { user_id: people, sample: true });
  if (team.manager) for (const type of DIGEST_TYPES) await store.removeWhere("notifications", { user_id: team.manager.id, type }); // reminders about sample sessions
  if (sups.length) { await store.removeWhere("leader_commitments", { supervisor_id: sups, sample: true }); await store.removeWhere("leader_sessions", { supervisor_id: sups, sample: true }); }
  if (!ids.length) return;
  await store.removeWhere("roleplay_assignments", { agent_id: ids, sample: true });
  for (const t of SAMPLE_TABLES) await store.removeWhere(t, { agent_id: ids, sample: true });
}
