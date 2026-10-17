// Sample (fictional) supervisor diagnoses for past DIRECT sessions, so the prep page history and the manager's
// calibration view can be explored. Each one lines up with the behavior that was actually coached.
import { BEHAVIORS } from "./constants.js";
import { rng, uid } from "./util.js";
import { tallyCalls } from "./diagnosis.js";

const hashStr = (s) => [...String(s)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
const CALL_LABELS = ["Mon · claim status", "Mon · benefits", "Tue · billing", "Tue · ID card", "Wed · eligibility", "Thu · claim denial"];
const NOTES = ["Member asked twice when it would be done.", "Long hold, no check-back.", "Good greeting, rushed close.", "Solved it but never said what happens next.", "", ""];
const REASONS = {
  lara: "On most calls the member had to repeat the question; she answers before confirming what they asked.",
  ownership: "He sends members to other departments instead of owning it; two calls ended in a transfer.",
  expectations: "Fixes the issue but never gives a date or next step; members call back asking when.",
  needs: "Closes fast with 'anything else?' and hangs up; misses the refill/appointment questions.",
  warm: "Sounds flat in the first 10 seconds, no name, straight to the ID.",
  appreciation: "Long silences while searching and no thanks after holds.",
  empathy: "Members were upset about bills and he went straight to the process.",
};

// sessions: completed coaching_sessions; commitments: their commitments (session_id → behavior coached).
export function buildDiagnoses({ sessions, commitments, seed = "dx" }) {
  const r = rng(hashStr(seed)); r(); r();
  const out = [];
  for (const s of sessions) {
    const c = commitments.find((x) => x.session_id === s.id);
    if (!c || (r() < 0.2 && out.length)) continue; // not every past session went through the new prep flow (but at least one did)
    const coached = c.behavior;
    const switched = r() < 0.15; // the supervisor changed their pick after the AI's second opinion
    const others = BEHAVIORS.filter((b) => b.id !== coached).map((b) => b.id);
    const supPick = switched ? others[Math.floor(r() * others.length)] : coached;
    const n = 3 + Math.floor(r() * 3);
    const calls = Array.from({ length: n }, (_, i) => {
      const marks = {};
      for (const b of BEHAVIORS) {
        const target = b.id === supPick ? 0.75 : b.id === coached ? 0.5 : 0.15;
        const x = r();
        if (x < target) marks[b.id] = "missed"; else if (x < target + 0.35) marks[b.id] = "shown";
      }
      return { label: CALL_LABELS[i % CALL_LABELS.length], marks, note: NOTES[Math.floor(r() * NOTES.length)] };
    });
    const tally = tallyCalls(calls);
    const aiPick = switched ? coached : r() < 0.75 ? supPick : others[Math.floor(r() * others.length)];
    out.push({
      id: uid(), supervisor_id: s.supervisor_id, agent_id: s.agent_id, week_start: c.week_start, calls, evidence_top: tally.top,
      sup_pick: supPick, sup_reason: REASONS[supPick], ai_pick: aiPick, agrees: aiPick === supPick,
      ai: { behavior_id: aiPick, confidence: "medium", source: "offline", comparison: aiPick === supPick ? "The KPIs and verbatims point the same way." : "The data points somewhere else; check it on the next calls.", agrees_with_supervisor: aiPick === supPick },
      final_pick: coached, final_reason: switched ? "The verbatims about call-backs matched the AI’s read; switching." : REASONS[coached],
      status: "final", session_id: s.id, created_at: `${s.date}T09:30:00`,
    });
  }
  return out;
}
