// Voice for roleplays, using the browser's built-in speech engines (free, no extra API key).
// - The member speaks with speechSynthesis (every modern browser; Edge and Chrome have the most natural voices).
// - The agent answers with SpeechRecognition (Chrome, Edge, Safari). Firefox can play the member but can't listen.
// Audio from the microphone is transcribed by the browser's speech service (Google in Chrome, Microsoft in Edge).

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
const SR = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export const support = () => ({ speak: !!synth && typeof SpeechSynthesisUtterance !== "undefined", listen: !!SR, secure: typeof window === "undefined" || window.isSecureContext });

// ---------------------------------------------------------------- Voices
let voicesP = null;
export function loadVoices() {
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  voicesP ||= new Promise((res) => {
    const done = () => res(synth.getVoices());
    synth.addEventListener?.("voiceschanged", done, { once: true });
    setTimeout(done, 1500); // some browsers never fire voiceschanged
  });
  return voicesP;
}

const FEMALE = /\b(aria|jenny|michelle|ana|emma|ava|sara|nancy|jane|libby|sonia|zira|samantha|susan|victoria|karen|moira|tessa|fiona|allison|joanna|salli|kendra|kimberly|ivy|catherine|hazel|heather|linda|serena|nicky|kathy|shelley|sandy|female|woman|elizabeth|amber|ashley|cora|monica|natasha|clara|aurora|jessa|emily|olivia|nova|shimmer)\b/i;
const MALE = /\b(guy|davis|andrew|brian|christopher|eric|roger|steffan|tony|jason|david|mark|alex|daniel|fred|tom|aaron|arthur|evan|nathan|ryan|thomas|male|man|ralph|albert|reed|rocko|eddy|george|james|brandon|jacob|kai|liam|william|ethan|connor|matthew|noah|oliver|richard|ronald|derek)\b/i;
const GIMMICK = /(grandma|grandpa|bad news|good news|bells|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|boing|bahh|junior|ralph|fred|kathy|princess)/i;

export const englishVoices = (voices) => voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !GIMMICK.test(v.name));
export const voiceGender = (v) => (FEMALE.test(v.name) ? "female" : MALE.test(v.name) ? "male" : v.name === "Google US English" ? "female" : null);

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// Best natural-sounding en-US voice of the member's gender. The same member keeps the same voice.
export function pickVoice(voices, { gender, seed = "", preferred = "", exclude = "" } = {}) {
  const en = englishVoices(voices);
  if (preferred) { const p = en.find((v) => v.name === preferred); if (p) return p; }
  if (!en.length) return voices[0] || null;
  const score = (v) => (/natural|neural|online|premium|enhanced/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/^en[-_]US/i.test(v.lang) ? 2 : 0) + (gender && voiceGender(v) === gender ? 5 : gender && voiceGender(v) ? -5 : 0) + (v.name === exclude ? -3 : 0);
  const ranked = en.map((v) => ({ v, s: score(v) })).sort((a, b) => b.s - a.s);
  const top = ranked.filter((r) => r.s >= ranked[0].s - 1).map((r) => r.v);
  return top[hash(seed) % top.length];
}

// ---------------------------------------------------------------- Speaking (the member)
const MOOD = { calm: { rate: 1, pitch: 1 }, worried: { rate: 0.97, pitch: 1.06 }, frustrated: { rate: 1.04, pitch: 0.97 }, angry: { rate: 1.09, pitch: 0.93 } };

// Chrome stops long utterances after ~15 s, so speak sentence by sentence.
export function chunks(text, max = 180) {
  const parts = String(text || "").replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) || [];
  const out = [];
  for (const p of parts) { const t = p.trim(); if (!t) continue; if (out.length && (out.at(-1) + " " + t).length <= max) out[out.length - 1] += " " + t; else out.push(t); }
  return out;
}

let speakToken = 0;
const keep = new Set(); // keeps utterances alive so Chrome doesn't drop their onend events

export function stopSpeaking() { speakToken++; try { synth?.cancel(); } catch {} keep.clear(); }
export const isSpeaking = () => !!synth?.speaking;

// Resolves when the line has been spoken (or cancelled). onBoundary(charIndex) reports progress if the voice supports it.
export function speak(text, { voice = null, mood = "calm", age = 45, speed = 1, onStart } = {}) {
  if (!synth) return Promise.resolve({ ok: false, reason: "unsupported" });
  stopSpeaking();
  const token = speakToken;
  const m = MOOD[mood] || MOOD.calm;
  const rate = Math.max(0.6, Math.min(1.6, m.rate * (age >= 65 ? 0.94 : 1) * speed));
  const pieces = chunks(text);
  let started = false;
  const one = (piece) => new Promise((res) => {
    const u = new SpeechSynthesisUtterance(piece);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "en-US";
    u.rate = rate; u.pitch = m.pitch; u.volume = 1;
    keep.add(u);
    const est = 2500 + (piece.length / (14 * rate)) * 1000; // watchdog in case onend never fires
    const timer = setTimeout(() => finish("timeout"), est * 1.8);
    function finish(why) { clearTimeout(timer); keep.delete(u); res(why); }
    u.onstart = () => { if (!started) { started = true; onStart?.(); } };
    u.onend = () => finish("end");
    u.onerror = (e) => finish(e.error || "error");
    synth.speak(u);
  });
  return (async () => {
    for (const p of pieces) {
      if (token !== speakToken) return { ok: false, reason: "cancelled" };
      const why = await one(p);
      if (why === "interrupted" || why === "canceled" || token !== speakToken) return { ok: false, reason: "cancelled" };
      if (why === "not-allowed") return { ok: false, reason: "not-allowed" };
    }
    return { ok: true };
  })();
}

// ---------------------------------------------------------------- Listening (the agent)
// Hands-free: after the agent stops talking for `pauseMs`, the turn is sent automatically.
// Timings for delivery feedback: delay_ms = from opening the mic to the first words heard,
// speak_ms = from the first to the last words heard. Both are approximate.
export function createListener({ lang = "en-US", pauseMs = 1600, autoSend = true, onText, onDone, onState, onError } = {}) {
  if (!SR) return null;
  let rec = null, want = false, finishing = false, committed = "", session = "", timer = null;
  let openedAt = 0, firstAt = null, lastAt = null;

  const text = () => (committed + " " + session).replace(/\s+/g, " ").trim();
  const clear = () => { clearTimeout(timer); timer = null; };
  const arm = () => { clear(); if (autoSend) timer = setTimeout(finish, pauseMs); };

  function boot() {
    rec = new SR();
    rec.lang = lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript + " ";
      session = s;
      const now = performance.now();
      if (firstAt == null && s.trim()) firstAt = now;
      lastAt = now;
      onText?.(text());
      arm();
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // onend restarts it
      want = false; finishing = false; clear();
      onError?.(e.error === "not-allowed" || e.error === "service-not-allowed" ? "mic-blocked" : e.error === "audio-capture" ? "no-mic" : e.error === "network" ? "network" : e.error || "error");
    };
    rec.onend = () => {
      committed = text(); session = "";
      if (finishing) { finishing = false; deliver(); return; }
      if (want) { try { boot(); } catch { want = false; onState?.("idle"); } } // Chrome ends sessions on its own; keep listening
      else onState?.("idle");
    };
    rec.start();
  }

  function deliver() {
    const t = text();
    const timing = { delay_ms: firstAt == null || openedAt == null ? null : Math.max(0, Math.round(firstAt - openedAt - 300)), speak_ms: firstAt == null ? 0 : Math.round(lastAt - firstAt + 400) };
    onState?.("idle");
    if (t) onDone?.(t, timing); else onError?.("nothing-heard");
  }

  function finish() {
    clear();
    if (!want) return;
    want = false;
    if (!text()) { onState?.("idle"); try { rec?.abort(); } catch {} return onError?.("nothing-heard"); }
    finishing = true;
    try { rec.stop(); } catch { finishing = false; deliver(); }
  }

  return {
    // since: when the member stopped talking (null = don't time the answer). seed: words already heard by barge-in.
    start({ since = performance.now(), seed = "" } = {}) {
      if (want) return;
      committed = seed; session = ""; finishing = false;
      openedAt = since; firstAt = seed ? performance.now() : null; lastAt = firstAt;
      want = true; onState?.("listening");
      try { boot(); } catch { want = false; onState?.("idle"); onError?.("error"); return; }
      if (seed) { onText?.(text()); arm(); } // barge-in already heard words: send them if the agent stops there
    },
    // Hands-free off: the agent clicks to finish. Hands-free on: sends now instead of waiting for the pause.
    finish,
    cancel() { want = false; finishing = false; clear(); try { rec?.abort(); } catch {} committed = ""; session = ""; onState?.("idle"); },
    set(opts) { if ("pauseMs" in opts) pauseMs = opts.pauseMs; if ("autoSend" in opts) autoSend = opts.autoSend; },
    get active() { return want || finishing; },
    get heard() { return text(); },
  };
}

// Barge-in (headset only): listens while the member is speaking and calls onSpeech when the agent starts talking.
// Without a headset the microphone hears the member's own voice, so this is off by default.
export function createBargeIn({ lang = "en-US", onSpeech } = {}) {
  if (!SR) return null;
  let rec = null, on = false;
  return {
    start() {
      if (on) return; on = true;
      rec = new SR(); rec.lang = lang; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => { const t = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim(); if (on && t.split(/\s+/).length >= 2) { on = false; try { rec.abort(); } catch {} onSpeech?.(t); } };
      rec.onerror = () => {}; rec.onend = () => { if (on) try { rec.start(); } catch { on = false; } };
      try { rec.start(); } catch { on = false; }
    },
    stop() { on = false; try { rec?.abort(); } catch {} },
  };
}
