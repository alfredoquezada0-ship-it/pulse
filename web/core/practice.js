// Roleplay practice: the scenario a supervisor can write or edit, and the facts shown in the practice log.
// Shared by the server and the browser's local mode.
import { DEFAULT_BEHAVIORS, byKey } from "./bank.js";
import { spoken, cueFor } from "./ai.js";
import { deliveryMetrics } from "./delivery.js";

export const MOODS = ["calm", "worried", "frustrated", "angry"];
export const DIFFICULTIES = ["easy", "medium", "hard"];
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Checks a scenario the supervisor wrote or edited. Returns { scenario } or { problem }.
// base: the generated scenario it started from (keeps source and ai_by so the log shows where it came from).
export function cleanScenario(input = {}, { base = {}, channel = "text", userId = null, behaviors = DEFAULT_BEHAVIORS } = {}) {
  const behavior = input.behavior || base.behavior;
  if (!byKey(behaviors)[behavior]) return { problem: "Pick the core behavior the agent is practicing." };
  const member_name = str(input.member_name, 60);
  if (member_name.length < 2) return { problem: "Give the member a (fictional) name." };
  const age = Math.round(Number(input.member_age));
  if (!Number.isFinite(age) || age < 25 || age > 95) return { problem: "The member’s age must be between 25 and 95." };
  const situation = str(input.situation, 600);
  if (situation.length < 10) return { problem: "Describe the situation the agent sees before the call." };
  const opening = str(input.opening, 400);
  if (opening.length < 3) return { problem: "Write the member’s first line." };
  const criteria = (Array.isArray(input.success_criteria) ? input.success_criteria : []).map((x) => str(x, 200)).filter(Boolean);
  if (!criteria.length) return { problem: "Add at least one thing the agent should do (what they’re scored on)." };
  if (criteria.length > 5) return { problem: "Keep it to 5 things to do at most." };
  const ch = channel === "voice" ? "voice" : "text";
  return {
    scenario: {
      member_name, member_gender: input.member_gender === "male" ? "male" : "female", member_age: age,
      mood: MOODS.includes(input.mood) ? input.mood : "frustrated",
      call_type: str(input.call_type, 60) || base.call_type || "Claim status",
      difficulty: DIFFICULTIES.includes(input.difficulty) ? input.difficulty : base.difficulty || "medium",
      situation, opening: spoken(opening, ch), hidden_need: str(input.hidden_need, 300),
      member_notes: str(input.member_notes, 400),
      success_criteria: criteria, behavior, channel: ch,
      source: base.source || "manual", ...(base.ai_by ? { ai_by: base.ai_by } : {}),
      edited: true, edited_by: userId, edited_at: new Date().toISOString(),
    },
  };
}

const ms = (a, b) => (a && b ? new Date(b) - new Date(a) : null);
const ok = (x) => x != null && Number.isFinite(x) && x >= 0 && x < 3 * 3600000;

// Everything the log shows about one practice, computed from what was saved.
export function practiceFacts(rp, behaviors = DEFAULT_BEHAVIORS) {
  const t = rp.transcript || [], sc = rp.scenario || {};
  const start = rp.created_at;
  const lastAt = [...t].reverse().find((m) => m.at)?.at;
  let duration = ms(start, rp.ended_at || lastAt || (rp.status !== "active" ? rp.updated_at : null));
  if (!ok(duration)) duration = null;
  const agentText = t.filter((m) => m.who === "agent").map((m) => m.text).join(" ");
  const moods = [sc.mood, ...t.filter((m) => m.who === "member" && m.mood).map((m) => m.mood)].filter(Boolean);
  const ev = rp.evaluation || null;
  const shown = behaviors.filter((b) => cueFor(b).test(agentText));
  return {
    turns: t.filter((m) => m.who === "agent").length,
    duration_s: duration == null ? null : Math.round(duration / 1000),
    mood_start: moods[0] || null, mood_end: moods.at(-1) || null, moods,
    asked_other_needs: cueFor({ id: "needs" }).test(agentText),
    behaviors_heard: shown.map((b) => b.name),
    delivery: ev?.delivery || deliveryMetrics(t),
    timeline: t.map((m) => ({ ...m, offset_ms: m.at && start && ok(ms(start, m.at)) ? ms(start, m.at) : null })),
    score: ev?.score ?? null,
  };
}

// One line of the log (no transcript), for lists and CSV export.
export function practiceRow(rp, names = {}, behaviors = DEFAULT_BEHAVIORS) {
  const f = practiceFacts(rp, behaviors), sc = rp.scenario || {};
  const BY = { ...byKey(DEFAULT_BEHAVIORS), ...byKey(behaviors) };
  return {
    id: rp.id, created_at: rp.created_at, status: rp.status, sample: !!rp.sample,
    user_id: rp.user_id, agent_id: rp.agent_id, taken_by: names[rp.user_id] || "", agent_name: rp.agent_id ? names[rp.agent_id] || "" : "",
    behavior: rp.behavior, behavior_name: BY[rp.behavior]?.name || rp.behavior,
    scenario: { call_type: sc.call_type || "", channel: sc.channel || "text", difficulty: sc.difficulty || "", member_name: sc.member_name || "", edited: !!sc.edited, assignment_id: sc.assignment_id || null },
    evaluation: rp.evaluation ? { score: rp.evaluation.score, summary: rp.evaluation.summary, ai_by: rp.evaluation.ai_by || null, source: rp.evaluation.source } : null,
    turns: f.turns, duration_s: f.duration_s, mood_start: f.mood_start, mood_end: f.mood_end,
    wpm: f.delivery?.wpm ?? null, dead_air: f.delivery?.dead_air ?? null, interruptions: f.delivery?.interruptions ?? null,
    has_note: !!rp.coach_note,
  };
}

