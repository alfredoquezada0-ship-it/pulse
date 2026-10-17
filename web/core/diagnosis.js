// Supervisor-first diagnosis: the supervisor listens to 3–5 calls, marks which of the 7 behaviors showed up or
// were missing, picks the behavior to coach, and only then sees the AI's second opinion.
import { DEFAULT_BEHAVIORS as BEHAVIORS, byKey } from "./bank.js";
import { scrubPII } from "./sanitize.js";

export const MIN_CALLS = 3, MAX_CALLS = 5;
const MARKS = new Set(["shown", "missed"]);

// Keeps only real marks; drops empty calls. Returns { calls, problem }.
export function cleanCalls(input, behaviors = BEHAVIORS) {
  const BY = byKey(behaviors);
  const list = Array.isArray(input) ? input.slice(0, MAX_CALLS) : [];
  const calls = list.map((c, i) => ({
    label: scrubPII(String(c?.label || `Call ${i + 1}`).trim()).slice(0, 80) || `Call ${i + 1}`,
    marks: Object.fromEntries(Object.entries(c?.marks || {}).filter(([b, m]) => BY[b] && MARKS.has(m))),
    note: scrubPII(String(c?.note || "").trim()).slice(0, 500),
  })).filter((c) => Object.keys(c.marks).length);
  if (calls.length < MIN_CALLS) return { calls, problem: `Mark what you heard on at least ${MIN_CALLS} calls (listen to 3–5 before choosing).` };
  return { calls };
}

// Per behavior: how many calls it showed up in and how many it was missing from. top = the most-missed behavior.
export function tallyCalls(calls = [], behaviors = BEHAVIORS) {
  const rows = behaviors.map((b) => {
    const shown = calls.filter((c) => c.marks?.[b.id] === "shown").length, missed = calls.filter((c) => c.marks?.[b.id] === "missed").length;
    return { id: b.id, name: b.name, shown, missed };
  });
  const ranked = [...rows].sort((a, b) => b.missed - a.missed || a.shown - b.shown);
  const top = ranked[0]?.missed ? ranked[0].id : null;
  const tied = top ? ranked.filter((r) => r.missed === ranked[0].missed && r.shown === ranked[0].shown).map((r) => r.id) : [];
  return { rows, top, tied, calls: calls.length };
}

// One line per call for the AI and for the DIRECT session's I step.
export const callLines = (calls = [], behaviors = BEHAVIORS) => calls.map((c) => {
  const BY = byKey(behaviors), nm = (b) => BY[b]?.name || b;
  const missed = Object.entries(c.marks).filter(([, m]) => m === "missed").map(([b]) => nm(b));
  const shown = Object.entries(c.marks).filter(([, m]) => m === "shown").map(([b]) => nm(b));
  return `${c.label}: missing ${missed.join(", ") || "nothing marked"}; showed ${shown.join(", ") || "nothing marked"}${c.note ? `. Note: ${c.note}` : ""}`;
});

// How a supervisor diagnoses, for the manager: listening, consistency with their own evidence, agreement with the AI,
// and whether coaching on their pick got the agent's commitment met.
export function calibration(diagnoses = [], commitments = []) {
  const done = diagnoses.filter((d) => d.status === "final");
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
  const outcome = (d) => commitments.find((c) => d.session_id && c.session_id === d.session_id) || null;
  const scored = done.map((d) => ({ d, c: outcome(d) })).filter((x) => x.c && x.c.status !== "open");
  const own = scored.filter((x) => x.d.final_pick === x.d.sup_pick), switched = scored.filter((x) => x.d.final_pick !== x.d.sup_pick);
  const met = (xs) => xs.filter((x) => x.c.status === "met").length;
  return {
    diagnoses: done.length,
    calls_avg: done.length ? +(done.reduce((s, d) => s + (d.calls?.length || 0), 0) / done.length).toFixed(1) : null,
    followed_evidence: pct(done.filter((d) => d.evidence_top && d.sup_pick === d.evidence_top).length, done.filter((d) => d.evidence_top).length),
    ai_agreed: pct(done.filter((d) => d.agrees).length, done.filter((d) => d.agrees != null).length),
    switched_to_ai: pct(done.filter((d) => d.ai_pick && d.final_pick === d.ai_pick && d.final_pick !== d.sup_pick).length, done.length),
    own_pick: { reviewed: own.length, met: met(own), rate: pct(met(own), own.length) },
    changed_pick: { reviewed: switched.length, met: met(switched), rate: pct(met(switched), switched.length) },
    recent: done.slice(0, 6).map((d) => ({ id: d.id, agent_id: d.agent_id, week_start: d.week_start, calls: d.calls?.length || 0, evidence_top: d.evidence_top, sup_pick: d.sup_pick, ai_pick: d.ai_pick, final_pick: d.final_pick, agrees: d.agrees, outcome: outcome(d)?.status || null })),
  };
}
