// Checks every AI provider in .env: npm run check-ai
// Each one gets a tiny request; you see which answer, how fast, and the order PULSE uses them in.
try { process.loadEnvFile(".env"); console.log("✓ .env found"); } catch { console.log("✗ No .env file in this folder"); }
const { createProvidersFromEnv, createAIFromEnv } = await import("./backend/server.js");
const env = process.env;
const silent = { info() {}, warn() {} };
const where = {
  gemini: "GEMINI_API_KEY · free key at https://aistudio.google.com/apikey",
  groq: "GROQ_API_KEY · free key at https://console.groq.com/keys",
  nvidia: "NVIDIA_API_KEY · free key (nvapi-…) at https://build.nvidia.com/settings/api-keys",
  ollama: "OLLAMA_MODEL (for example qwen3:8b) · install Ollama from https://ollama.com and run: ollama pull qwen3:8b",
};
const providers = createProvidersFromEnv(env, { log: silent });
console.log(`Node ${process.version}\n`);
for (const name of Object.keys(where)) {
  const p = providers.find((x) => x.name === name);
  if (!p) { console.log(`· ${name.padEnd(7)} not set up  → ${where[name]}`); continue; }
  const t0 = Date.now();
  try {
    const out = await p.generate({ system: "You are a connection test.", messages: [{ role: "user", text: 'Return JSON exactly like {"ok":true}' }], json: true, temperature: 0 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`✓ ${name.padEnd(7)} ${p.stats.lastModel || p.model} answered in ${secs}s: ${String(out).trim().slice(0, 60)}`);
    if (Object.keys(p.stats.outFor || {}).length) console.log(`           Out of today’s free quota: ${Object.keys(p.stats.outFor).join(", ")} (so ${p.stats.lastModel} answered)`);
    if (p.stats.retired?.length) console.log(`           Retired and skipped: ${p.stats.retired.join(", ")}`);
    if (p.stats.discovered) console.log(`           Picked automatically. To pin it, put ${name.toUpperCase()}_MODEL=${p.stats.discovered} in .env (or leave it unset).`);
  } catch (e) {
    console.log(`✗ ${name.padEnd(7)} ${e.message}`);
    if (e.status === 401 || e.status === 403) console.log("           The key was rejected. Copy it again without spaces.");
    if (e.status === 404 || e.status === 410) console.log(`           That model is retired or not available to this key. Remove ${name.toUpperCase()}_MODEL from .env so PULSE picks a live one.`);
    if (e.status === 429) console.log(name === "gemini" ? "           Free quota used up for every Gemini model. PULSE skips Gemini for an hour and uses the next provider." : "           Free limit reached (per minute or per day). PULSE skips it for now and uses the next provider.");
    if (e.status === 507) console.log("           Check Task Manager › Memory › Committed: the second number should be well above your RAM after turning on the page file.");
  }
}
const ai = createAIFromEnv(env, { log: silent });
console.log(ai ? `\nOrder for analysis:  ${ai.providers.join(" → ")}\nOrder for roleplays: ${ai.fastProviders.join(" → ")}\nIf all of them fail, PULSE uses its offline suggestions.` : "\nNo AI provider is set up: PULSE uses its offline suggestions.");
