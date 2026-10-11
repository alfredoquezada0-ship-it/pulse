// Google Gemini provider (free tier from Google AI Studio). Called only from the server,
// so the API key never reaches the browser.
// Retries briefly when Google is busy (503/500) or rate-limits (429), then tries the fallback
// models in GEMINI_FALLBACK_MODELS, then gives up so PULSE uses its offline suggestions.
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The free tier gives each model its own daily quota (Flash: a few dozen requests a day, Flash-Lite: hundreds).
// A model that runs out for the day is skipped for an hour instead of being asked again on every request,
// and quick tasks (roleplay replies) go to fastModel first so the bigger model's quota is kept for analysis.
const DAILY = /per ?day|perday|daily/i;
export function createGemini({ apiKey, model = "gemini-3.8-flash", fastModel = null, fallbacks = [], thinking = "low", timeoutMs = 45000, retries = 1, log = console, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!apiKey) return null;
  const models = [model, ...fallbacks.filter((m) => m && m !== model)];
  if (fastModel && !models.includes(fastModel)) models.push(fastModel);
  const stats = { calls: 0, errors: 0, lastError: null, lastModel: null, lastMs: null, outFor: {} };
  const outUntil = new Map(); // model -> time it can be tried again
  const gone = new Set();     // retired or unknown models
  // Gemini 3 models "think" before answering. A low level keeps answers fast; turned off if a model rejects it.
  const thinkingOn = !!thinking && thinking !== "off";
  const noThinking = new Set(); // models that rejected the thinking setting

  async function callOnce(m, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${BASE}/${encodeURIComponent(m)}:generateContent`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey.trim() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = "", raw = ""; try { const j = await res.json(); msg = j?.error?.message || ""; raw = JSON.stringify(j?.error?.details || ""); } catch {}
        const err = new Error(`Gemini ${m} error ${res.status}: ${msg.slice(0, 200)}`); err.status = res.status;
        if (res.status === 429 && DAILY.test(`${msg} ${raw}`)) err.daily = true;
        throw err;
      }
      const data = await res.json();
      return data?.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || "").join("") || null;
    } finally { clearTimeout(t); }
  }

  return {
    name: "gemini", model, models, stats,
    onError(e) { stats.errors++; stats.lastError = String(e.message || e); log.warn?.(`[ai] ${stats.lastError} · using the offline suggestion`); },
    async generate({ system, messages, json = true, temperature = 0.4, fast = false }) {
      stats.calls++;
      const order = (fast && fastModel ? [fastModel, ...models.filter((m) => m !== fastModel)] : models).filter((m) => !gone.has(m) && (outUntil.get(m) || 0) <= now());
      if (!order.length) {
        const until = Math.min(...[...outUntil.values()].filter((t) => t > now()), now() + 3600000);
        throw Object.assign(new Error("Gemini: today’s free quota is used up for every model"), { status: 429, restMs: Math.max(60000, until - now()) });
      }
      const started = Date.now();
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text }] })),
        generationConfig: { temperature, ...(json ? { responseMimeType: "application/json" } : {}) },
      };
      const withThinking = (m) => { if (thinkingOn && !noThinking.has(m)) body.generationConfig.thinkingConfig = { thinkingLevel: fast ? "minimal" : thinking }; else delete body.generationConfig.thinkingConfig; };
      let lastErr = null;
      for (const m of order) {
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            withThinking(m);
            const out = await callOnce(m, body);
            stats.lastModel = m; stats.lastMs = Date.now() - started;
            log.info?.(`[ai] ${m} answered in ${(stats.lastMs / 1000).toFixed(1)}s`);
            return out;
          } catch (e) {
            lastErr = e;
            if (e.status === 400 && thinkingOn && !noThinking.has(m) && /thinking/i.test(e.message)) { noThinking.add(m); log.warn?.(`[ai] ${m} rejected the thinking setting; continuing without it`); attempt--; continue; }
            if (e.name === "AbortError") { lastErr = new Error(`Gemini ${m} timed out`); break; }
            if (e.status === 429 && e.daily) { outUntil.set(m, now() + 3600000); stats.outFor[m] = new Date(now() + 3600000).toISOString(); log.warn?.(`[ai] ${m}: free quota used up for today; skipping it for an hour`); break; }
            if (e.status === 404) { gone.add(m); log.warn?.(`[ai] ${m} isn’t available; skipping it from now on`); break; }
            if (e.status === 401 || e.status === 403) throw e; // bad key: no other model will work either
            if (!RETRYABLE.has(e.status)) break; // 400: try the next model
            if (attempt < retries) { log.warn?.(`[ai] ${m} busy (${e.status}), retrying…`); await sleep(800 * 2 ** attempt); }
          }
        }
      }
      if (lastErr?.daily && order.every((m) => (outUntil.get(m) || 0) > now() || gone.has(m))) lastErr.restMs = 3600000;
      throw lastErr || new Error("Gemini unavailable");
    },
  };
}
