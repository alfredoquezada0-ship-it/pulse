// Fictional demo data. No real agents, members or calls.
import { BEHAVIORS, KPIS, LOBS, TOOL_PLAN, SESSION_TYPES } from "./constants.js";
import { rng, uid, weekStart, addDays, today, toISODate } from "./util.js";
import { buildPractices } from "./sample-practice.js";
import { buildDiagnoses } from "./sample-diagnosis.js";

const VERBATIMS = {
  lara: ["I had to repeat my issue three times and still didn't understand the answer.", "She used codes I didn't understand.", "He kept talking over me and didn't answer my question."],
  ownership: ["They transferred me to another department that sent me right back.", "She said she'd call me back and never called.", "Nobody helped, I just got passed around."],
  expectations: ["Third time I'm calling about the same claim. Nobody told me what happens next.", "I had no idea when my card would arrive.", "Still waiting, nobody told me how long it takes."],
  needs: ["Before I could ask about my other bill, he was saying goodbye.", "I felt rushed and had to call again for another issue."],
  warm: ["The agent was cold and sounded like a robot.", "Rude tone, very short with me."],
  appreciation: ["I was on hold forever with no explanation.", "Long silence and dead air, I felt like a ticket number."],
  empathy: ["My claim was denied after my surgery and she didn't care at all.", "I was upset about the bill and got no sympathy."],
};
const POSITIVE = ["She took care of everything and explained it clearly.", "Very friendly and patient, thank you!", "He told me exactly what happens next. Great service.", "Fast, kind and helpful."];

const SUPERVISORS = [
  { name: "Carla Peña", lob: "NPG" }, { name: "Marco Díaz", lob: "IFM" },
  { name: "Sofía Reyes", lob: "MedSupp" }, { name: "Andrés Mejía", lob: "BVA" },
];
const AGENT_NAMES = [
  "Daniela Cruz", "Kevin Rosario", "Marisol Vega", "Luis Ortega", "Andrea Polanco",
  "Jorge Ramírez", "Valeria Núñez", "Pedro Santana", "Camila Batista", "Rafael Tavárez",
  "Lucía Herrera", "Miguel Abreu", "Paola Guzmán", "Héctor Fermín", "Natalia Castillo",
  "Diego Familia", "Gabriela Soto", "Samuel Peralta", "Isabel Reynoso", "Tomás Liriano",
];
const email = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, ".") + "@pulse.demo";

export function buildSeed(seedNum = 7) {
  const r = rng(seedNum);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const between = (a, b) => a + r() * (b - a);
  const now = today();
  const thisWeek = weekStart(now);
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (8 - i))); // 8 past weeks
  const out = { users: [], kpi_goals: [], kpi_weekly: [], verbatims: [], coaching_sessions: [], commitments: [], weekly_sessions: [], quizzes: [], roleplays: [], training_completions: [] };

  LOBS.forEach((lob) => KPIS.forEach((k) => out.kpi_goals.push({ id: uid(), lob, kpi: k.id, goal: k.goal, dir: k.dir })));

  const manager = { id: uid(), name: "Morgan Ellis", email: "morgan.ellis@pulse.demo", role: "manager", lob: "All", supervisor_id: null, manager_id: null };
  out.users.push(manager);

  let ai = 0;
  SUPERVISORS.forEach((s, si) => {
    const sup = { id: uid(), name: s.name, email: email(s.name), role: "supervisor", lob: s.lob, supervisor_id: null, manager_id: manager.id };
    out.users.push(sup);
    if (si < 2) out.training_completions.push({ id: uid(), user_id: sup.id, guide_id: "direct", completed_at: addDays(now, -10) });
    if (si === 0) out.training_completions.push({ id: uid(), user_id: sup.id, guide_id: "weekly", completed_at: addDays(now, -3) });

    for (let j = 0; j < 5; j++) {
      const name = AGENT_NAMES[ai++];
      const weak = BEHAVIORS[(si * 2 + j * 3) % BEHAVIORS.length];
      const agent = { id: uid(), name, email: email(name), role: "agent", lob: s.lob, supervisor_id: sup.id, manager_id: manager.id, hire_date: addDays(now, -Math.round(between(90, 900))) };
      out.users.push(agent);
      const strength = between(-1, 1); // overall performance level
      const coached = j < 3; // first three agents per team are in the coaching cycle
      const improving = coached && j !== 2;
      weeks.forEach((w, wi) => {
        const lift = improving && wi >= 5 ? (wi - 4) * 2.2 : 0;
        const hit = (k) => (weak.kpis.includes(k) ? 1 : 0);
        out.kpi_weekly.push({
          id: uid(), agent_id: agent.id, week_start: w,
          nps: Math.round(32 + strength * 16 - hit("nps") * 12 + lift * 1.6 + between(-6, 6)),
          csat: +(89 + strength * 5 - hit("csat") * 5 + lift * 0.6 + between(-2, 2)).toFixed(1),
          fcr: +(90 + strength * 4 - hit("fcr") * 5 + lift * 0.5 + between(-1.5, 1.5)).toFixed(1),
          aht: Math.round(600 - strength * 60 + (weak.id === "appreciation" ? 70 : 0) - lift * 4 + between(-30, 30)),
          qa: +(90 + strength * 5 - between(0, 4)).toFixed(1),
          surveys: Math.round(between(6, 16)),
        });
      });
      // Verbatims from the last 3 weeks.
      const neg = VERBATIMS[weak.id];
      const nNeg = strength > 0.5 ? 1 : 3;
      for (let v = 0; v < nNeg; v++) out.verbatims.push({ id: uid(), agent_id: agent.id, date: addDays(now, -Math.round(between(2, 20))), score: Math.round(between(0, 6)), text: neg[v % neg.length] });
      for (let v = 0; v < 2; v++) out.verbatims.push({ id: uid(), agent_id: agent.id, date: addDays(now, -Math.round(between(2, 20))), score: 9 + (v % 2), text: pick(POSITIVE) });

      if (!coached) continue;
      const rc = ["skill", "knowledge", "will", "skill", "tool_process"][(si + j) % 5];
      // Last week's cycle, already reviewed.
      const lastWeek = addDays(thisWeek, -7);
      const s1 = { id: uid(), agent_id: agent.id, supervisor_id: sup.id, date: addDays(lastWeek, 0), status: "completed", behavior: weak.id, root_cause: rc,
        evidence: `${3 + (j % 2)} of 5 reviewed calls missed the action. Verbatim: “${neg[0]}”`,
        kpi_focus: weak.kpis[0], notes: { D: "Quick check-in about the new schedule.", I: "Focus on " + weak.name + ". Shared a survey verbatim.", R: "Recognized clean verification and a warm greeting.", E: "Agent spotted the gap when we replayed the close.", C: "Root cause: " + rc + ".", T: "Agreed on a SMART commitment with a Friday follow-up." } };
      out.coaching_sessions.push(s1);
      const c1 = { id: uid(), session_id: s1.id, agent_id: agent.id, supervisor_id: sup.id, behavior: weak.id, root_cause: rc, week_start: lastWeek,
        action: weak.actions[0], measure_target: 5, measure_total: 5, check_method: "Remote Call Listening, 5 calls", follow_up_date: addDays(lastWeek, 4),
        status: improving ? "met" : "partial", monitor_hits: improving ? 5 : 3, monitor_total: 5, self_hits: improving ? 6 : 4, agent_ack: true, agent_ack_at: addDays(lastWeek, 0) + "T15:00:00", review_notes: improving ? "5 of 5. Kudos given, keep one more week." : "3 of 5. Rushes the close on busy afternoons." };
      out.commitments.push(c1);
      SESSION_TYPES.forEach((t) => out.weekly_sessions.push({ id: uid(), supervisor_id: sup.id, agent_id: agent.id, commitment_id: c1.id, week_start: lastWeek, type: t.id, planned_date: addDays(lastWeek, t.days[0] - 1), planned_time: "10:00", tool: TOOL_PLAN[rc][t.id], status: "held", reason: "" }));

      // This week's cycle.
      const s2 = { ...s1, id: uid(), date: thisWeek, notes: { ...s1.notes, I: "Recalled last week’s commitment: " + (improving ? "met 5 of 5." : "3 of 5.") } };
      out.coaching_sessions.push(s2);
      const c2 = { ...c1, id: uid(), session_id: s2.id, week_start: thisWeek, follow_up_date: addDays(thisWeek, 4), status: "open", monitor_hits: null, monitor_total: null, self_hits: Math.round(between(1, 5)), agent_ack: j !== 1, agent_ack_at: j !== 1 ? thisWeek + "T16:00:00" : null, review_notes: "",
        action: improving ? weak.actions[1] || weak.actions[0] : weak.actions[0] };
      if (addDays(thisWeek, 4) < now) Object.assign(c2, { status: improving ? "met" : "partial", monitor_hits: improving ? 5 : 3, monitor_total: 5, agent_ack: true, agent_ack_at: thisWeek + "T16:00:00", review_notes: improving ? "5 of 5 again. Raise the bar next week." : "3 of 5. Keep the behavior, add SBS on busy afternoons." });
      out.commitments.push(c2);
      SESSION_TYPES.forEach((t, ti) => {
        const d = addDays(thisWeek, t.days[0] - 1);
        let status = "planned", reason = "";
        if (d < now) { status = "held"; if (si === 2 && ti === 2) { status = "missed"; reason = "Short-staffed on Wednesday"; } }
        out.weekly_sessions.push({ id: uid(), supervisor_id: sup.id, agent_id: agent.id, commitment_id: c2.id, week_start: thisWeek, type: t.id, planned_date: d, planned_time: ["10:00", "14:00", "11:00", "15:00"][ti], tool: TOOL_PLAN[rc][t.id], status, reason });
      });
    }
  });

  const agentOne = out.users.find((u) => u.role === "agent");
  out.quizzes.push({ id: uid(), agent_id: agentOne.id, supervisor_id: agentOne.supervisor_id, behavior: "expectations", title: "Set Clear Expectations: quick check", source: "seed", status: "assigned", created_at: toISODate(new Date()),
    questions: [
      { q: "A member asks when the new ID card will arrive. What sets a clear expectation?", o: ["“It’ll come soon.”", "“It ships today and arrives in 7–10 business days. Meanwhile, you can use the digital card in the app.”", "“Call back next week to check.”", "“I can’t see that.”"], a: 1, why: "Timeline plus what to do in the meantime." },
      { q: "What should you say before closing a claim-status call?", o: ["“Anything else?” and hang up", "The next step and when it will happen", "Nothing, the member will get a letter", "Transfer to claims"], a: 1, why: "The member leaves knowing what happens next and when." },
      { q: "Which line prevents a repeat call?", o: ["“It’s in process.”", "“If you don’t see the payment by Thursday, call us and mention reference 4471.”", "“Should be fine.”", "“We’ll let you know.”"], a: 1, why: "A date, a reference and a fallback." },
    ], answers: null, score: null });
  // Practice log: scripted practice calls for the demo agents.
  const sups = Object.fromEntries(out.users.filter((u) => u.role === "supervisor").map((u) => [u.id, u]));
  const focus = Object.fromEntries(out.commitments.filter((c) => c.week_start === thisWeek).map((c) => [c.agent_id, c.behavior]));
  out.roleplays = buildPractices({ agents: out.users.filter((u) => u.role === "agent"), focus, sups, seed: `demo-${seedNum}` });
  out.diagnoses = buildDiagnoses({ sessions: out.coaching_sessions.filter((x) => x.status === "completed"), commitments: out.commitments, seed: `demo-${seedNum}` });
  return out;
}
