// Sample practice calls (fictional) for the practice log: scripted roleplays scored by the rule-based evaluator,
// so the log, the transcript view and the delivery stats can be explored before anyone practices.
import { BEHAVIORS, BEHAVIOR_BY_ID } from "./constants.js";
import { SCRIPTS, evaluateOffline } from "./ai.js";
import { rng, uid, addDays } from "./util.js";

const AGENT = {
  open: ["Good morning, thank you for calling. My name is {me}, and I’m happy to help. May I have your name and member ID?", "Thank you for calling, this is {me}. Can I get the member ID?"],
  care: ["I’m sorry you’ve had to call about this again. That sounds frustrating. Let me take care of this for you right now.", "Okay, let me look. Hold on."],
  explain: ["So just to confirm, you need a clear answer and a date. Here’s the next step: you’ll get an update in 5 to 7 business days, and I’ll give you a reference number today.", "It’s in process. It depends on the department."],
  needs: ["Before we hang up, is there anything else coming up, like an appointment or a refill?", "Okay. Is that all?"],
  need: ["I’m glad you mentioned that. I’ll take care of it now and note it on your file.", "You’d have to call back for that one."],
  close: ["Thank you for your patience today, I appreciate it. You’ll receive the letter by Friday, and the reference number is on your file.", "Okay, bye."],
};
const MEMBER_END = { good: "Okay. Thank you, that really helps.", bad: "Fine. I guess I’ll call back if nothing happens." };
const CALLS = Object.keys(SCRIPTS);
const words = (t) => (String(t).match(/[A-Za-z0-9’']+/g) || []).length;
const hashStr = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);

// One scripted call. q (0–1) is how well the agent does: each moment goes well with probability q.
export function scriptedPractice({ agent, takenBy = agent, behavior, callType, channel, difficulty = "medium", startedAt, q, r, assignmentId = null }) {
  const s = SCRIPTS[callType] || SCRIPTS["Claim status"];
  const b = BEHAVIOR_BY_ID[behavior];
  const mood0 = difficulty === "hard" ? "angry" : difficulty === "easy" ? "worried" : "frustrated";
  const scenario = { member_name: s.name, member_gender: s.gender, member_age: s.age, situation: s.situation, mood: mood0, opening: s.opening, hidden_need: s.need, success_criteria: [b.actions[0], b.actions[1] || "Confirm the member understood before closing.", "Close with the next step and the timeline."], behavior, call_type: callType, difficulty, channel, source: "offline", ...(assignmentId ? { assignment_id: assignmentId } : {}) };
  const me = String(takenBy.name || "Alex").split(" ")[0];
  // The practiced behavior's moment goes a bit better than the rest: that's what the agent was working on.
  const good = (moment) => r() < Math.min(0.97, q + (moment === focusMoment(behavior) ? 0.2 : 0));
  const t = []; let clock = new Date(startedAt).getTime(); let mood = mood0;
  const say = (who, text, extra = {}) => {
    const speak = Math.round(words(text) * (60000 / (who === "agent" ? 130 + r() * 50 : 150)));
    if (who === "agent") {
      const delay = r() < (1 - q) * 0.45 ? 4200 + r() * 3500 : 700 + r() * 2300;
      clock += delay;
      const voice = channel === "voice" ? { speak_ms: speak, delay_ms: Math.round(delay), ...(r() < (1 - q) * 0.15 ? { interrupted: true } : {}) } : null;
      t.push({ who, text, ...(voice ? { voice } : {}), at: new Date(clock).toISOString() });
      clock += channel === "voice" ? speak : 4000 + words(text) * 900;
    } else {
      clock += 1800 + r() * 1500;
      t.push({ who, text, mood, at: new Date(clock).toISOString(), ...extra });
      clock += channel === "voice" ? speak : 2500;
    }
  };
  const calmer = (ok) => { const order = ["calm", "worried", "frustrated", "angry"]; const i = order.indexOf(mood); mood = order[Math.max(0, Math.min(3, i + (ok ? -1 : 1)))]; };
  t.push({ who: "member", text: s.opening, mood, at: new Date(clock).toISOString() }); clock += 4000;
  let ok = good("open"); say("agent", AGENT.open[ok ? 0 : 1].replace("{me}", me)); say("member", s.lines[0]);
  ok = good("care"); say("agent", AGENT.care[ok ? 0 : 1]); calmer(ok); say("member", s.lines[1]);
  ok = good("explain"); say("agent", AGENT.explain[ok ? 0 : 1]); calmer(ok); say("member", s.lines[2]);
  const asked = good("needs"); say("agent", AGENT.needs[asked ? 0 : 1]);
  if (asked) { say("member", `Actually, yes. ${s.need}`); ok = good("need"); say("agent", AGENT.need[ok ? 0 : 1]); calmer(ok); }
  ok = good("close"); say("agent", AGENT.close[ok ? 0 : 1]); calmer(ok);
  say("member", mood === "calm" || mood === "worried" ? MEMBER_END.good : MEMBER_END.bad);
  const endedAt = new Date(clock + 1500).toISOString();
  return { id: uid(), user_id: takenBy.id, agent_id: agent.id, behavior, scenario, transcript: t, evaluation: evaluateOffline(scenario, t), status: "evaluated", mood, ended_at: endedAt, created_at: new Date(startedAt).toISOString(), updated_at: endedAt };
}
const focusMoment = (behavior) => ({ warm: "open", empathy: "care", ownership: "care", lara: "explain", expectations: "explain", needs: "needs", appreciation: "close" })[behavior];

// A few practices per coached agent over the last three weeks, plus one for each finished assignment.
// agents: [{ id, name, supervisor_id }], focus: { agentId: behavior }, done: finished roleplay_assignments (updated in place).
export function buildPractices({ agents, focus = {}, done = [], sups = {}, now = new Date(), seed = "practice" }) {
  const r = rng(hashStr(seed)); r(); r();
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  const at = (daysAgo) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(9 + Math.floor(r() * 8), Math.floor(r() * 60), 0, 0); return d; };
  for (const a of agents) {
    const skill = 0.1 + r() * 0.7;
    const n = Math.floor(r() * 4) || (a === agents[0] && !done.length ? 1 : 0); // 0–3, and at least one practice per team
    for (let k = 0; k < n; k++) {
      const behavior = r() < 0.75 && focus[a.id] ? focus[a.id] : pick(BEHAVIORS).id;
      const rp = scriptedPractice({ agent: a, behavior, callType: pick(CALLS), channel: r() < 0.65 ? "voice" : "text", difficulty: pick(["easy", "medium", "medium", "hard"]), startedAt: at(1 + Math.floor(r() * 20)), q: Math.min(0.9, skill + k * 0.1), r });
      if (r() < 0.12) { rp.evaluation = null; rp.status = "ended"; } // left without asking for feedback
      else if (a.supervisor_id && r() < 0.3) Object.assign(rp, coachNote(rp, a, sups[a.supervisor_id], r));
      out.push(rp);
    }
  }
  for (const ra of done) {
    const a = agents.find((x) => x.id === ra.agent_id); if (!a) continue;
    const end = new Date(ra.completed_at || now);
    const rp = scriptedPractice({ agent: a, behavior: ra.behavior, callType: CALLS.includes(ra.call_type) ? ra.call_type : CALLS[0], channel: ra.channel === "text" ? "text" : "voice", difficulty: ra.difficulty || "medium", startedAt: new Date(end.getTime() - 6 * 60000), q: 0.25 + r() * 0.6, r, assignmentId: ra.id });
    if (r() < 0.5) Object.assign(rp, coachNote(rp, a, sups[a.supervisor_id], r));
    ra.roleplay_id = rp.id; ra.score = rp.evaluation.score;
    out.push(rp);
  }
  return out;
}

function coachNote(rp, agent, sup, r) {
  if (!sup) return {};
  const first = String(agent.name).split(" ")[0], s = rp.evaluation?.score ?? 3;
  const notes = s >= 4
    ? [`Great work, ${first}. The close was clear and the member calmed down. Do the same on Wednesday’s calls.`, `Strong call. Keep giving the date and the reference number like this.`]
    : [`${first}, the fix was right but the member never heard a timeline. Practice the close once more before Monitor.`, `Let’s replay this one together in our next session. Focus on acknowledging the member before solving.`];
  return { coach_note: notes[Math.floor(r() * notes.length)], coach_note_by: sup.id, coach_note_at: rp.ended_at };
}
