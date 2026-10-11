// OpenAI-compatible chat API: Groq and NVIDIA (build.nvidia.com) both speak it.
// Server only, so keys never reach the browser. Returns null when no key is set.
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stripThinking = (t) => String(t || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

// Catalogs change: a model can be retired (410) or removed (404). Retired models are skipped from then on, and when
// none of the configured models is left, `discover` (a list of name patterns, best first) picks a live one from /models.
const NOT_CHAT = /embed|rerank|guard|safety|reward|vision|-vl\b|vlm|pii|clip|retriever|parse|ocr|tts|asr|whisper|detect|translate|-base\b|coder|math|audio|image|video/i;
export function pickModels(ids, patterns = []) {
  const chat = ids.filter((id) => !NOT_CHAT.test(id));
  const out = [];
  for (const re of patterns) for (const id of chat) if (re.test(id) && !out.includes(id)) out.push(id);
  return out;
}

export function createOpenAICompat({ name, baseUrl, apiKey, model, fastModel = null, fallbacks = [], discover = null, timeoutMs = 45000, retries = 0, log = console, fetchImpl = fetch } = {}) {
  if (!apiKey || !model) return null;
  const auto = model === "auto";
  const models = auto ? [] : [model, ...fallbacks.filter((m) => m && m !== model)];
  const stats = { calls: 0, errors: 0, lastError: null, lastModel: null, lastMs: null, retired: [], discovered: null };
  const retired = new Set();
  let jsonMode = true; // turned off if this provider rejects response_format
  let looked = false;
  const found = new Set();
  const base = () => baseUrl.replace(/\/$/, "");

  async function lookUp() {
    looked = true;
    try {
      const res = await fetchImpl(`${base()}/models`, { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
      if (!res.ok) return [];
      const ids = ((await res.json())?.data || []).map((m) => m.id).filter(Boolean);
      const live = pickModels(ids, discover).filter((m) => !retired.has(m) && !models.includes(m));
      live.forEach((m) => found.add(m));
      if (live.length) log.info?.(`[ai] ${name}: looking for a live model among ${live.slice(0, 5).join(", ")}`);
      return live;
    } catch { return []; }
  }

  async function callOnce(m, payload) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base()}/chat/completions`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ ...payload, model: m }),
      });
      if (!res.ok) {
        let msg = ""; try { const j = await res.json(); msg = j?.error?.message || j?.detail || j?.message || ""; } catch {}
        const err = new Error(`${name} ${m} error ${res.status}: ${String(msg).slice(0, 200)}`); err.status = res.status; throw err;
      }
      const data = await res.json();
      return stripThinking(data?.choices?.[0]?.message?.content) || null;
    } catch (e) {
      if (e.name !== "AbortError" && !e.status && /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(`${e.message} ${e.cause?.code || ""}`)) { const err = new Error(`${name} couldn’t be reached (network or firewall)`); err.status = 503; throw err; }
      throw e;
    } finally { clearTimeout(t); }
  }

  const provider = {
    name, model, models, stats,
    async generate({ system, messages, json = true, temperature = 0.4, fast = false, effort = null }) {
      stats.calls++;
      const started = Date.now();
      if (discover && !looked && models.every((m) => retired.has(m))) models.push(...(await lookUp()));
      let order = (fast && fastModel ? [fastModel, ...models.filter((m) => m !== fastModel)] : models).filter((m) => !retired.has(m));
      if (stats.discovered && order.includes(stats.discovered)) order = [stats.discovered, ...order.filter((m) => m !== stats.discovered)];
      order = order.slice(0, 5); // don't make anyone wait through a long list
      const chat = [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text }))];
      let lastErr = null;
      for (const m of order) {
        for (let attempt = 0; attempt <= retries; attempt++) {
          const payload = { messages: chat, temperature, max_tokens: fast ? 400 : 4000 }; // reasoning counts toward the limit: too low cuts the JSON off
          if (json && jsonMode) payload.response_format = { type: "json_object" };
          if (/gpt-oss/i.test(m)) payload.reasoning_effort = fast ? "low" : effort || "medium"; // OpenAI open models reason first; keep it short
          try {
            const out = await callOnce(m, payload);
            stats.lastModel = m; stats.lastMs = Date.now() - started;
            if (found.has(m)) stats.discovered = m; // a model picked from the catalog: use it first from now on
            log.info?.(`[ai] ${name} ${m} answered in ${(stats.lastMs / 1000).toFixed(1)}s`);
            return out;
          } catch (e) {
            lastErr = e;
            if (e.status === 400 && jsonMode && /response_format|json/i.test(e.message)) { jsonMode = false; log.warn?.(`[ai] ${name} doesn't take JSON mode; continuing without it`); attempt--; continue; }
            if (e.name === "AbortError") { lastErr = new Error(`${name} ${m} timed out`); break; }
            if (e.status === 404 || e.status === 410) { retired.add(m); stats.retired = [...retired]; log.warn?.(`[ai] ${name} ${m} is no longer available; skipping it from now on`); break; }
            if (!RETRYABLE.has(e.status)) break;
            if (attempt < retries) await sleep(600 * 2 ** attempt);
          }
        }
        if (lastErr?.status === 401 || lastErr?.status === 403 || lastErr?.status === 429) break; // key problem or limit: the whole provider is out for now
      }
      // Everything configured is retired: look up the catalog once and try again with live models.
      if (discover && !looked && models.length && models.every((m) => retired.has(m))) { models.push(...(await lookUp())); if (models.some((m) => !retired.has(m))) return provider.generate({ system, messages, json, temperature, fast, effort }); }
      if (!lastErr && !order.length) lastErr = Object.assign(new Error(`${name}: none of its models are available (set ${name.toUpperCase()}_MODEL in .env)`), { status: 404 });
      throw lastErr || new Error(`${name} unavailable`);
    },
  };
  return provider;
}

// Ollama on your own computer (free, no limits, nothing leaves the machine). Uses Ollama's own API so thinking can be turned off.
export function createOllama({ url = "http://localhost:11434", model, timeoutMs = 120000, log = console, fetchImpl = fetch } = {}) {
  if (!model) return null;
  const stats = { calls: 0, errors: 0, lastError: null, lastModel: null, lastMs: null };
  let thinkOff = true; // turned off for models that don't know the setting
  return {
    name: "ollama", model, models: [model], stats,
    async generate({ system, messages, json = true, temperature = 0.4, fast = false }) {
      stats.calls++;
      const started = Date.now();
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = {
          model, stream: false, keep_alive: "30m",
          messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text }))],
          options: { temperature, num_predict: fast ? 300 : 2000 },
          ...(json ? { format: "json" } : {}), ...(thinkOff ? { think: false } : {}),
        };
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const res = await fetchImpl(`${url.replace(/\/$/, "")}/api/chat`, { method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          if (!res.ok) {
            let msg = ""; try { msg = (await res.json())?.error || ""; } catch {}
            const err = new Error(`ollama ${model} error ${res.status}: ${String(msg).slice(0, 200)}`); err.status = res.status;
            if (res.status === 400 && thinkOff && /think/i.test(msg)) { thinkOff = false; continue; }
            if (/alloc|out of memory|memory/i.test(msg)) { const oom = new Error(`ollama ran out of memory loading ${model}: free up memory (or turn on the Windows page file) or use a smaller model such as qwen3:4b`); oom.status = 507; throw oom; }
            throw err;
          }
          const data = await res.json();
          stats.lastModel = model; stats.lastMs = Date.now() - started;
          log.info?.(`[ai] ollama ${model} answered in ${(stats.lastMs / 1000).toFixed(1)}s`);
          return stripThinking(data?.message?.content) || null;
        } catch (e) {
          if (e.name === "AbortError") throw new Error(`ollama ${model} timed out`);
          if (e.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(e.message)) { const err = new Error(`ollama isn’t running at ${url}`); err.status = 503; throw err; }
          throw e;
        } finally { clearTimeout(t); }
      }
      throw new Error("ollama unavailable");
    },
  };
}
