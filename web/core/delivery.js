// Delivery metrics for voice roleplays. Shared by the server (evaluation) and the browser (live call).
// The timings come from the browser's speech recognizer, so they are approximate (about ±0.5 s per turn).

const FILLERS = /\b(u+m+|u+h+|e+r+m+|h+m+|you know|i mean|basically|kinda|sort of)\b/gi;
export const PACE = { min: 120, max: 165 }; // a steady phone pace, in words per minute
export const DEAD_AIR_MS = 4000;            // silence before answering that the member would notice

export const countWords = (t) => (String(t || "").match(/[A-Za-z0-9’']+/g) || []).length;
export const countFillers = (t) => (String(t || "").match(FILLERS) || []).length;

// Keep only the two timings the browser measures; everything else is computed from the text.
export function cleanVoice(v) {
  if (!v || typeof v !== "object") return null;
  const n = (x) => (x == null || x === "" || !Number.isFinite(+x) ? null : Math.max(0, Math.min(600000, Math.round(+x))));
  const out = { speak_ms: n(v.speak_ms), delay_ms: n(v.delay_ms) };
  if (v.interrupted) out.interrupted = true;
  return out.speak_ms == null && out.delay_ms == null ? null : out;
}

// Speech can't really go past ~260 wpm; a higher number means the recognizer sent the words in one burst.
const plausible = (wpm) => (wpm != null && wpm >= 60 && wpm <= 260 ? wpm : null);

export function deliveryMetrics(transcript = []) {
  const turns = transcript.filter((m) => m.who === "agent" && m.voice);
  if (!turns.length) return null;
  const agentWords = transcript.filter((m) => m.who === "agent").reduce((s, m) => s + countWords(m.text), 0);
  const memberWords = transcript.filter((m) => m.who === "member").reduce((s, m) => s + countWords(m.text), 0);
  const timed = turns.filter((m) => (m.voice.speak_ms || 0) >= 1500);
  const timedWords = timed.reduce((s, m) => s + countWords(m.text), 0);
  const timedMs = timed.reduce((s, m) => s + m.voice.speak_ms, 0);
  const delays = turns.map((m) => m.voice.delay_ms).filter((d) => d != null && !Number.isNaN(d));
  const fillers = turns.reduce((s, m) => s + countFillers(m.text), 0);
  const words = turns.reduce((s, m) => s + countWords(m.text), 0);
  const m = {
    turns: turns.length,
    wpm: plausible(timedMs ? Math.round(timedWords / (timedMs / 60000)) : null),
    avg_response_s: delays.length ? +(delays.reduce((a, b) => a + b, 0) / delays.length / 1000).toFixed(1) : null,
    dead_air: delays.filter((d) => d > DEAD_AIR_MS).length,
    interruptions: turns.filter((t) => t.voice.interrupted).length,
    fillers,
    fillers_per_100: words ? +((fillers / words) * 100).toFixed(1) : 0,
    longest_turn_s: Math.round(Math.max(0, ...turns.map((t) => t.voice.speak_ms || 0)) / 1000),
    talk_share: agentWords + memberWords ? Math.round((agentWords / (agentWords + memberWords)) * 100) : null,
  };
  const notes = [];
  if (m.wpm != null && m.wpm > PACE.max) notes.push(`You spoke at about ${m.wpm} words a minute. Slow down to ${PACE.min}–${PACE.max}, especially when you give dates, amounts or next steps.`);
  else if (m.wpm != null && m.wpm < PACE.min - 20) notes.push(`You spoke at about ${m.wpm} words a minute. A little more energy keeps the call moving and sounds more confident.`);
  else if (m.wpm != null) notes.push(`Good pace: about ${m.wpm} words a minute.`);
  if (m.dead_air) notes.push(`${m.dead_air} long silence${m.dead_air > 1 ? "s" : ""} before you answered. Fill the gap out loud: “Let me pull that up for you, one moment.”`);
  if (m.interruptions) notes.push(`You cut the member off ${m.interruptions} time${m.interruptions > 1 ? "s" : ""}. Let them finish, then acknowledge (LARA).`);
  if (m.fillers_per_100 > 4) notes.push(`About ${m.fillers} filler words (“um”, “you know”). Pause instead; a short pause sounds more confident.`);
  if (m.longest_turn_s > 45) notes.push(`Your longest answer ran ${m.longest_turn_s} seconds. Break long explanations up and check understanding.`);
  if (m.talk_share != null && m.talk_share > 70) notes.push(`You did ${m.talk_share}% of the talking. Ask more questions to discover the member’s needs.`);
  return { ...m, notes };
}

export const deliveryLine = (d) => !d ? "" : `Delivery (approximate, from speech timing): pace ${d.wpm ?? "n/a"} wpm (target ${PACE.min}-${PACE.max}); average time to answer ${d.avg_response_s ?? "n/a"} s; long silences before answering: ${d.dead_air}; times the agent cut the member off: ${d.interruptions}; filler words: ${d.fillers}; agent share of talk: ${d.talk_share ?? "n/a"}%.`;
