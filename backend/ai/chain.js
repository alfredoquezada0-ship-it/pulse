// Tries AI providers in order until one answers. A provider that hits its free limit (429) rests for a minute;
// one with a bad key (401/403), no live model (404/410) or not enough memory (Ollama) rests for 10 minutes. If all fail, PULSE uses its offline suggestions.
// order:     for analysis (diagnosis, coaching plans, quizzes, reviews)
// fastOrder: for quick replies (each turn of a roleplay call)
export function createAIChain(providers, { order = [], fastOrder = [], log = console, now = () => Date.now() } = {}) {
  const byName = Object.fromEntries(providers.filter(Boolean).map((p) => [p.name, p]));
  const pick = (names) => {
    const list = names.map((n) => byName[n]).filter(Boolean);
    for (const p of Object.values(byName)) if (!list.includes(p)) list.push(p); // anything configured but not named goes last
    return list;
  };
  const main = pick(order), fast = pick(fastOrder.length ? fastOrder : order);
  if (!main.length) return null;
  const restUntil = new Map();
  const stats = { calls: 0, errors: 0, lastError: null, lastModel: null, lastProvider: null, lastMs: null, byProvider: {} };

  return {
    name: main.map((p) => p.name).join(" → "), model: main[0].model,
    models: main.map((p) => `${p.name}:${p.model}`), providers: main.map((p) => p.name), fastProviders: fast.map((p) => p.name), stats,
    onError(e) { stats.errors++; stats.lastError = String(e.message || e); log.warn?.(`[ai] ${stats.lastError} · using the offline suggestion`); },
    async generate(req) {
      stats.calls++;
      const list = req.fast ? fast : main;
      const ready = list.filter((p) => (restUntil.get(p.name) || 0) <= now());
      const tryList = ready.length ? ready : list; // everyone is resting: try anyway rather than fail outright
      let lastErr = null;
      for (const p of tryList) {
        try {
          const out = await p.generate(req);
          if (out) {
            req.answeredBy = { provider: p.name, model: p.stats?.lastModel || p.model, ms: p.stats?.lastMs ?? null };
            stats.lastProvider = p.name; stats.lastModel = p.stats?.lastModel || p.model; stats.lastMs = p.stats?.lastMs ?? null;
            (stats.byProvider[p.name] ||= { ok: 0, failed: 0 }).ok++;
            return out;
          }
          lastErr = new Error(`${p.name} returned an empty answer`);
        } catch (e) {
          lastErr = e;
          (stats.byProvider[p.name] ||= { ok: 0, failed: 0 }).failed++;
          const rest = e.restMs ? e.restMs : e.status === 401 || e.status === 403 || e.status === 507 || e.status === 404 || e.status === 410 ? 600000 : e.status === 429 ? 60000 : e.status === 503 && /isn’t running/.test(e.message) ? 120000 : 0;
          if (rest) restUntil.set(p.name, now() + rest);
          log.warn?.(`[ai] ${p.name} failed (${e.status || e.message}); trying the next provider`);
        }
      }
      throw lastErr || new Error("No AI provider answered");
    },
  };
}
