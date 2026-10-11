// Business logic: KPI analysis, quartiles, SMART checks, weekly compliance, alerts, effectiveness.
import { KPIS, KPI_BY_ID, BEHAVIORS, BEHAVIOR_BY_ID, SESSION_TYPES, SESSION_TYPE_BY_ID, QUARTILES, TOOL_PLAN, SUP_BEHAVIORS, SUP_BEHAVIOR_BY_ID, ROOT_CAUSES, ROOT_CAUSE_BY_ID, DIRECT_STEPS } from "./constants.js";
import { avg, round, today, weekStart, addDays, isoWeekday } from "./util.js";

export function goalsFor(goals, lob) {
  const out = {};
  KPIS.forEach((k) => {
    const g = goals.find((x) => x.lob === lob && x.kpi === k.id);
    out[k.id] = { goal: g ? Number(g.goal) : k.goal, dir: g ? g.dir : k.dir };
  });
  return out;
}

// Gap as a fraction of the goal; positive = below goal (bad).
export function gap(kpi, value, goal) {
  if (value == null) return 0;
  const k = KPI_BY_ID[kpi];
  const span = kpi === "nps" ? 100 : Math.max(Math.abs(goal), 1);
  return k.dir === "higher" ? (goal - value) / span : (value - goal) / span;
}

export function agentSummary(agent, rows, goals) {
  const sorted = [...rows].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const last4 = sorted.slice(-4), prev4 = sorted.slice(-8, -4);
  const latest = sorted[sorted.length - 1] || null;
  const g = goalsFor(goals, agent.lob);
  const kpis = {};
  KPIS.forEach((k) => {
    const cur = avg(last4.map((r) => r[k.id]));
    const before = avg(prev4.map((r) => r[k.id]));
    const gp = gap(k.id, cur, g[k.id].goal);
    kpis[k.id] = { value: round(cur), latest: latest ? latest[k.id] : null, prev: round(before), delta: cur != null && before != null ? round(cur - before) : null, goal: g[k.id].goal, dir: g[k.id].dir, gap: round(gp, 3), onGoal: gp <= 0, series: sorted.map((r) => r[k.id]) };
  });
  const weights = { nps: 1.4, csat: 1, fcr: 1.2, aht: 0.6, qa: 0.6 };
  const risk = round(KPIS.reduce((s, k) => s + Math.max(0, kpis[k.id].gap || 0) * weights[k.id], 0), 3);
  const critical = KPIS.filter((k) => !kpis[k.id].onGoal).sort((a, b) => kpis[b.id].gap * weights[b.id] - kpis[a.id].gap * weights[a.id]).map((k) => k.id);
  return { id: agent.id, name: agent.name, lob: agent.lob, sub_lob: agent.sub_lob || null, in_production: agent.in_production !== false, supervisor_id: agent.supervisor_id, kpis, risk, critical, weeks: sorted.map((r) => r.week_start) };
}

// Equal groups by MES NPS rank (the quadrant model).
// Ranked within each line of business (goals differ), production agents with MES NPS data only.
// Agents in training or with no surveys yet get no group.
export function assignQuartiles(summaries) {
  summaries.forEach((s) => (s.quartile = null));
  const byLob = {};
  summaries.filter((s) => s.in_production !== false && s.kpis.nps.value != null).forEach((s) => (byLob[s.lob] ||= []).push(s));
  for (const list of Object.values(byLob)) {
    const ranked = list.sort((a, b) => b.kpis.nps.value - a.kpis.nps.value);
    ranked.forEach((s, i) => { s.quartile = QUARTILES[Math.min(3, Math.floor((i * 4) / ranked.length))].id; });
  }
  return summaries;
}

export function teamKpis(summaries, goals, lob) {
  const g = goalsFor(goals, lob);
  summaries = summaries.filter((s) => s.in_production !== false); // agents in training don't count toward team results
  const out = {};
  KPIS.forEach((k) => {
    const v = avg(summaries.map((s) => s.kpis[k.id].value));
    const p = avg(summaries.map((s) => s.kpis[k.id].prev));
    out[k.id] = { value: round(v), prev: round(p), delta: v != null && p != null ? round(v - p) : null, goal: g[k.id].goal, dir: g[k.id].dir, onGoal: gap(k.id, v, g[k.id].goal) <= 0 };
  });
  return out;
}

// ---------- SMART check for a commitment ----------
const KPI_WORDS = /\b(csat|nps|fcr|aht|qa|score|kpi|survey|quality score|handle time)\b|%/i;
const VAGUE = /\b(better|more|improve|try|work on|be (more )?(positive|nice|careful)|care)\b/i;
export function smartCheck(c = {}) {
  const action = (c.action || "").trim();
  const checks = [
    { id: "S", name: "Specific", ok: action.length >= 20 && !VAGUE.test(action) && !KPI_WORDS.test(action) && !!c.behavior,
      tip: !c.behavior ? "Pick one of the 7 core behaviors." : KPI_WORDS.test(action) ? "That’s a KPI result. Write the on-call action that moves it." : "Write one action you can hear on a call, in the agent’s words." },
    { id: "M", name: "Measurable", ok: Number(c.measure_target) > 0 && Number(c.measure_total) >= Number(c.measure_target) && !!(c.check_method || "").trim(),
      tip: "Add a number (e.g., 5 of 5 calls) and how it’s checked." },
    { id: "A", name: "Achievable", ok: !!c.root_cause && Number(c.measure_total || 0) <= 20,
      tip: !c.root_cause ? "Mark the root cause so the plan fits the agent." : "Keep it to a number of calls you can check this week." },
    { id: "R", name: "Relevant", ok: !!c.behavior && !!c.root_cause && !!(c.evidence || c.session_id),
      tip: "Tie it to the behavior and the evidence (calls, verbatims)." },
    { id: "T", name: "Time-bound", ok: !!c.follow_up_date && (!c.week_start || (c.follow_up_date >= c.week_start && c.follow_up_date <= addDays(c.week_start, 6))),
      tip: "Set a follow-up date inside the week (Friday’s Kudos/Accountability)." },
  ];
  return { ok: checks.every((x) => x.ok), checks };
}

// ---------- Weekly rhythm compliance ----------
export function weeklyCompliance(sessions, commitments, week, now = today()) {
  const ws = sessions.filter((s) => s.week_start === week);
  const byAgent = {};
  ws.forEach((s) => { (byAgent[s.agent_id] ||= []).push(s); });
  const flags = [];
  const agents = Object.entries(byAgent).map(([agentId, list]) => {
    const types = Object.fromEntries(SESSION_TYPES.map((t) => [t.id, list.find((s) => s.type === t.id) || null]));
    SESSION_TYPES.forEach((t) => {
      const s = types[t.id];
      if (!s) { flags.push({ agent_id: agentId, type: "missing_session", session: t.id, text: `No ${t.name} planned.` }); return; }
      if (s.planned_date && !t.days.includes(isoWeekday(s.planned_date))) flags.push({ agent_id: agentId, type: "wrong_window", session: t.id, text: `${t.name} is planned outside ${t.window}.` });
      if (s.status === "planned" && s.planned_date && s.planned_date < now) flags.push({ agent_id: agentId, type: "unmarked", session: t.id, text: `${t.name} on ${s.planned_date} is still unmarked.` });
      if (s.status === "missed") flags.push({ agent_id: agentId, type: "missed", session: t.id, text: `${t.name} missed${s.reason ? `: ${s.reason}` : " with no reason"}.` });
    });
    const k = types.kudos_accountability, m = types.monitor;
    if (k && k.status === "held" && (!m || m.status !== "held")) flags.push({ agent_id: agentId, type: "kudos_without_monitor", text: "Kudos/Accountability held without Monitor evidence." });
    const held = list.filter((s) => s.status === "held").length;
    return { agent_id: agentId, types, held, planned: list.length };
  });
  const planned = ws.length, held = ws.filter((s) => s.status === "held").length;
  const due = ws.filter((s) => s.planned_date && s.planned_date < now).length;
  const heldDue = ws.filter((s) => s.planned_date && s.planned_date < now && s.status === "held").length;
  const wc = commitments.filter((c) => c.week_start === week);
  return {
    week, planned, held, due, heldDue,
    rate: due ? round((heldDue / due) * 100, 0) : null,
    agents, flags,
    commitments: { total: wc.length, acknowledged: wc.filter((c) => c.agent_ack).length, smartOk: wc.filter((c) => smartCheck(c).ok).length },
  };
}

// Default weekly plan for a commitment, with tools that fit the root cause.
export function planWeek(commitment, supervisorId) {
  const ws = commitment.week_start;
  const times = ["10:00", "14:00", "11:00", "15:00"];
  return SESSION_TYPES.map((t, i) => ({
    supervisor_id: supervisorId, agent_id: commitment.agent_id, commitment_id: commitment.id, week_start: ws, type: t.id,
    planned_date: addDays(ws, t.days[0] - 1), planned_time: times[i], tool: (TOOL_PLAN[commitment.root_cause] || TOOL_PLAN.skill)[t.id], status: "planned", reason: "",
  }));
}

// ---------- Alerts ----------
export function buildAlerts({ agents, summaries, commitments, sessions, week, now = today() }) {
  const out = [];
  const name = (id) => (agents.find((a) => a.id === id) || {}).name || "Agent";
  const byAgent = {};
  commitments.forEach((c) => (byAgent[c.agent_id] ||= []).push(c));
  Object.entries(byAgent).forEach(([agentId, list]) => {
    list.sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
    const open = list.filter((c) => c.status === "open");
    open.forEach((c) => {
      if (c.follow_up_date && c.follow_up_date < now) out.push({ level: "high", type: "overdue_review", agent_id: agentId, ref: c.id, text: `${name(agentId)}: Friday review overdue since ${c.follow_up_date}.` });
      if (!c.agent_ack) out.push({ level: "medium", type: "not_acknowledged", agent_id: agentId, ref: c.id, text: `${name(agentId)} hasn’t acknowledged this week’s commitment.` });
      if (!smartCheck(c).ok) out.push({ level: "medium", type: "not_smart", agent_id: agentId, ref: c.id, text: `${name(agentId)}’s commitment doesn’t pass the SMART check.` });
    });
    const reviewed = list.filter((c) => c.status !== "open");
    const lastTwo = reviewed.slice(0, 2);
    if (lastTwo.length === 2 && lastTwo.every((c) => c.status === "not_met" && c.behavior === lastTwo[0].behavior)) out.push({ level: "high", type: "rediagnose", agent_id: agentId, text: `${name(agentId)}: ${BEHAVIOR_BY_ID[lastTwo[0].behavior]?.name} not met two weeks in a row. Re-diagnose the root cause or change the tool.` });
    const sameBehavior = list.slice(0, 3);
    if (sameBehavior.length === 3 && sameBehavior.every((c) => c.behavior === sameBehavior[0].behavior && c.action === sameBehavior[0].action)) out.push({ level: "medium", type: "rolled_over", agent_id: agentId, text: `${name(agentId)}: same commitment three weeks running. Change the action, the tool or the root cause.` });
  });
  const comp = weeklyCompliance(sessions, commitments, week, now);
  comp.flags.filter((f) => ["missed", "unmarked", "kudos_without_monitor"].includes(f.type)).forEach((f) => out.push({ level: f.type === "unmarked" ? "low" : "medium", type: f.type, agent_id: f.agent_id, text: `${name(f.agent_id)}: ${f.text}` }));
  (summaries || []).filter((s) => s.quartile === "outlier" && !commitments.some((c) => c.agent_id === s.id && c.week_start === week)).forEach((s) => out.push({ level: "high", type: "uncoached_outlier", agent_id: s.id, text: `${s.name} is in the Outlier group with no commitment this week.` }));
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------- Effectiveness: before vs. after the first coaching session ----------
export function effectiveness(agent, rows, sessions, commitments) {
  const done = sessions.filter((s) => s.agent_id === agent.id && s.status === "completed").sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!done.length) return null;
  const start = weekStart(done[0].date);
  const before = rows.filter((r) => r.week_start < start).slice(-4);
  const after = rows.filter((r) => r.week_start >= start);
  const kpi = done[done.length - 1].kpi_focus || BEHAVIOR_BY_ID[done[0].behavior]?.kpis[0] || "nps";
  const b = avg(before.map((r) => r[kpi])), a = avg(after.map((r) => r[kpi]));
  const dir = KPI_BY_ID[kpi].dir;
  const cs = commitments.filter((c) => c.agent_id === agent.id && c.status !== "open");
  return {
    agent_id: agent.id, kpi, behavior: done[done.length - 1].behavior, since: start,
    before: round(b), after: round(a), delta: a != null && b != null ? round(a - b) : null,
    improved: a != null && b != null ? (dir === "higher" ? a > b : a < b) : null,
    commitmentsMet: cs.filter((c) => c.status === "met").length, commitmentsReviewed: cs.length, weeksAfter: after.length,
  };
}

export function behaviorDistribution(commitments) {
  return BEHAVIORS.map((b) => ({ id: b.id, name: b.name, count: commitments.filter((c) => c.behavior === b.id).length, met: commitments.filter((c) => c.behavior === b.id && c.status === "met").length }));
}

// Offline diagnosis used when the AI is unavailable, and as evidence for the AI prompt.
export function scoreBehaviors(summary, verbatims) {
  const scores = Object.fromEntries(BEHAVIORS.map((b) => [b.id, { score: 0, evidence: [] }]));
  const neg = verbatims.filter((v) => v.score == null || v.score <= 6);
  neg.forEach((v) => {
    const t = v.text.toLowerCase();
    BEHAVIORS.forEach((b) => { const hits = b.keywords.filter((k) => t.includes(k)); if (hits.length) { scores[b.id].score += 2 + hits.length; scores[b.id].evidence.push(`Verbatim (${v.score ?? "?"}/10): “${v.text}”`); } });
  });
  if (summary) BEHAVIORS.forEach((b) => b.kpis.forEach((k, i) => { const g = summary.kpis[k]?.gap || 0; if (g > 0) { scores[b.id].score += g * (i === 0 ? 30 : 15); } }));
  return Object.entries(scores).map(([id, s]) => ({ id, ...s, score: round(s.score, 2) })).sort((a, b) => b.score - a.score);
}

// ---------- Supervisor behaviors, measured from their coaching data ----------
// Returns one entry per supervisor behavior: { value: 0-100 or null, num, den, text }.
// agents: the supervisor's agents · weekly: weekly_sessions · commitments: agent commitments · coaching: coaching_sessions.
export function supervisorMetrics({ weekly = [], commitments = [], coaching = [], week, now = today() }) {
  const pct = (num, den) => (den ? Math.round((num / den) * 100) : null);
  const inWeek = (d) => d && d >= week && d <= addDays(week, 6);
  const wc = commitments.filter((c) => c.week_start === week);
  const ws = weekly.filter((s) => s.week_start === week);
  const out = {};

  const due = ws.filter((s) => s.planned_date && s.planned_date < now);
  const heldDue = due.filter((s) => s.status === "held");
  out.rhythm = { num: heldDue.length, den: due.length, text: due.length ? `${heldDue.length} of ${due.length} sessions due were held` : "No sessions due yet this week" };

  const cs = coaching.filter((s) => s.status === "completed" && inWeek(s.date));
  const full = cs.filter((s) => DIRECT_STEPS.every((d) => String((s.notes || {})[d.id] || "").trim().length >= 5));
  out.direct = { num: full.length, den: cs.length, text: cs.length ? `${full.length} of ${cs.length} coaching sessions have all six steps written` : "No coaching sessions yet this week" };

  const smart = wc.filter((c) => smartCheck(c).ok && c.agent_ack);
  out.smart = { num: smart.length, den: wc.length, text: wc.length ? `${smart.length} of ${wc.length} commitments are SMART and acknowledged` : "No commitments yet this week" };

  // Agents whose last two reviewed weeks were "not met": did this week's plan change the root cause (or the behavior)?
  const byAgent = {};
  commitments.forEach((c) => (byAgent[c.agent_id] ||= []).push(c));
  let eligible = 0, rediagnosed = 0;
  for (const list of Object.values(byAgent)) {
    const cur = list.find((c) => c.week_start === week);
    const prev = list.filter((c) => c.week_start < week && c.status !== "open").sort((a, b) => (a.week_start < b.week_start ? 1 : -1)).slice(0, 2);
    if (!cur || prev.length < 2 || !prev.every((c) => c.status === "not_met")) continue;
    eligible++;
    if (cur.root_cause !== prev[0].root_cause || cur.behavior !== prev[0].behavior) rediagnosed++;
  }
  out.root_cause = { num: eligible ? rediagnosed : 0, den: eligible, text: eligible ? `${rediagnosed} of ${eligible} agents who missed twice were re-diagnosed` : "No agent missed twice in a row" };

  const rcOf = Object.fromEntries(commitments.map((c) => [c.id, c.root_cause]));
  const withTool = ws.filter((s) => s.tool && rcOf[s.commitment_id]);
  const fits = withTool.filter((s) => { const rc = rcOf[s.commitment_id]; return TOOL_PLAN[rc]?.[s.type] === s.tool || (ROOT_CAUSE_BY_ID[rc]?.tools || []).includes(s.tool); });
  out.tool = { num: fits.length, den: withTool.length, text: withTool.length ? `${fits.length} of ${withTool.length} sessions use a tool that fits the root cause` : "No sessions planned yet" };

  const fridayPassed = wc.filter((c) => c.follow_up_date && c.follow_up_date < now);
  const monitorHeld = (c) => ws.some((s) => s.commitment_id === c.id && s.type === "monitor" && s.status === "held");
  const reviewed = fridayPassed.filter((c) => c.status !== "open" && monitorHeld(c));
  out.followup = { num: reviewed.length, den: fridayPassed.length, text: fridayPassed.length ? `${reviewed.length} of ${fridayPassed.length} commitments reviewed with Monitor evidence` : "Friday reviews aren’t due yet" };

  for (const k of Object.keys(out)) out[k].value = k === "root_cause" && !out[k].den ? 100 : pct(out[k].num, out[k].den);
  return out;
}

// The behavior to focus on: the lowest measured one (ties go to the order of the list).
export const suggestSupBehavior = (m) => SUP_BEHAVIORS.filter((b) => m[b.id]?.value != null).sort((a, b) => m[a.id].value - m[b.id].value)[0]?.id || "rhythm";

// SMART check for a supervisor commitment. Percentages are fine here: the measure is the supervisor's coaching, not a KPI result.
export function leaderSmartCheck(c = {}) {
  const action = (c.action || "").trim();
  const checks = [
    { id: "S", name: "Specific", ok: action.length >= 20 && !VAGUE.test(action) && !!SUP_BEHAVIOR_BY_ID[c.behavior], tip: !SUP_BEHAVIOR_BY_ID[c.behavior] ? "Pick one of the six supervisor behaviors." : "Write one thing the supervisor will do this week, in their words." },
    { id: "M", name: "Measurable", ok: Number(c.measure_target) > 0 && Number(c.measure_target) <= 100 && !!(c.check_method || "").trim(), tip: "Set the target (for example 100% of sessions due) and how it’s checked." },
    { id: "A", name: "Achievable", ok: !!ROOT_CAUSE_BY_ID[c.root_cause], tip: "Mark the root cause so the plan fits the supervisor." },
    { id: "R", name: "Relevant", ok: !!c.behavior && !!(c.evidence || c.session_id), tip: "Tie it to what PULSE measured this week." },
    { id: "T", name: "Time-bound", ok: !!c.follow_up_date && (!c.week_start || (c.follow_up_date >= c.week_start && c.follow_up_date <= addDays(c.week_start, 6))), tip: "Set the Friday review inside the week." },
  ];
  return { ok: checks.every((x) => x.ok), checks };
}
