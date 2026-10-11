import test from "node:test";
import assert from "node:assert/strict";
import { createAIFromEnv } from "../backend/server.js";
import { parseJSON } from "../web/core/ai.js";

const quiet = { info() {}, warn() {} };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const req = { system: "s", messages: [{ role: "user", text: "Return JSON" }], json: true };

test("falls back Gemini → Groq → NVIDIA (explicit order), and rests a provider that hit its limit", async () => {
  const calls = [];
  let geminiDown = true;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body || "{}");
    if (url.includes("generativelanguage")) { calls.push("gemini"); return geminiDown ? reply(429, { error: { message: "quota" } }) : reply(200, { candidates: [{ content: { parts: [{ text: '{"by":"gemini"}' }] } }] }); }
    if (url.includes("groq")) { calls.push(`groq:${body.model}`); return reply(200, { choices: [{ message: { content: '{"by":"groq"}' } }] }); }
    if (url.includes("nvidia")) { calls.push("nvidia"); return reply(200, { choices: [{ message: { content: '{"by":"nvidia"}' } }] }); }
    throw new Error("unexpected " + url);
  };
  const ai = createAIFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", NVIDIA_API_KEY: "n", AI_ORDER: "gemini,groq,nvidia" }, { fetchImpl, log: quiet });
  assert.deepEqual(ai.providers, ["gemini", "groq", "nvidia"]);
  assert.equal(parseJSON(await ai.generate(req)).by, "groq");
  assert.equal(ai.stats.lastProvider, "groq");
  calls.length = 0;
  await ai.generate(req); // Gemini is resting after its 429: not called again right away
  assert.deepEqual(calls, ["groq:openai/gpt-oss-120b"]);
  // Roleplay turns go to Groq's fast model first
  calls.length = 0;
  await ai.generate({ ...req, fast: true });
  assert.deepEqual(calls, ["groq:llama-3.3-70b-versatile"]);
});

test("a provider without JSON mode is retried without it; reasoning text is stripped", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(!!body.response_format);
    if (body.response_format) return reply(400, { error: { message: "response_format json_object is not supported" } });
    return reply(200, { choices: [{ message: { content: '<think>hmm</think>Here you go: {"ok":true}' } }] });
  };
  const ai = createAIFromEnv({ NVIDIA_API_KEY: "n", NVIDIA_MODEL: "some/model" }, { fetchImpl, log: quiet });
  assert.deepEqual(parseJSON(await ai.generate(req)), { ok: true });
  assert.deepEqual(seen, [true, false]);
  await ai.generate(req);
  assert.deepEqual(seen, [true, false, false]); // remembers
});

test("Ollama: thinking turned off, retried without it for models that don't know the setting; down → next provider", async () => {
  const bodies = [];
  let running = true;
  const fetchImpl = async (url, opts) => {
    if (url.includes("11434")) {
      if (!running) { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; }
      const body = JSON.parse(opts.body); bodies.push(body);
      if ("think" in body) return reply(400, { error: '"qwen" does not support thinking' });
      return reply(200, { message: { content: '{"by":"ollama"}' } });
    }
    return reply(200, { choices: [{ message: { content: '{"by":"groq"}' } }] });
  };
  const ai = createAIFromEnv({ OLLAMA_MODEL: "qwen3:8b", GROQ_API_KEY: "q", AI_FAST_ORDER: "ollama,groq" }, { fetchImpl, log: quiet });
  assert.equal(parseJSON(await ai.generate({ ...req, fast: true })).by, "ollama");
  assert.equal(bodies[0].think, false); assert.equal(bodies[0].format, "json");
  running = false;
  assert.equal(parseJSON(await ai.generate({ ...req, fast: true })).by, "groq");
});

test("no keys means offline suggestions", () => {
  assert.equal(createAIFromEnv({}, { log: quiet }), null);
});

test("a retired model (410) is skipped and a live one is picked from the provider's list", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    if (url.endsWith("/models")) { calls.push("list"); return reply(200, { data: [{ id: "nvidia/llama-3.2-nv-embedqa-1b" }, { id: "meta/llama-3.1-70b-instruct" }, { id: "moonshotai/kimi-k2-instruct" }, { id: "qwen/qwen3-235b-a22b" }] }); }
    const m = JSON.parse(opts.body).model; calls.push(m);
    if (/llama-3\.[13]-70b/.test(m)) return reply(410, { detail: `The model '${m}' has reached its end of life` });
    return reply(200, { choices: [{ message: { content: `{"by":"${m}"}` } }] });
  };
  const ai = createAIFromEnv({ NVIDIA_API_KEY: "n", NVIDIA_MODEL: "meta/llama-3.3-70b-instruct" }, { fetchImpl, log: quiet });
  assert.equal(parseJSON(await ai.generate(req)).by, "moonshotai/kimi-k2-instruct");
  assert.deepEqual(calls, ["meta/llama-3.3-70b-instruct", "list", "moonshotai/kimi-k2-instruct"]); // embeddings and retired models never tried
  calls.length = 0;
  await ai.generate(req);
  assert.deepEqual(calls, ["moonshotai/kimi-k2-instruct"]); // remembered
  // With no model set at all, it picks from the list straight away
  calls.length = 0;
  const auto = createAIFromEnv({ NVIDIA_API_KEY: "n" }, { fetchImpl, log: quiet });
  assert.equal(parseJSON(await auto.generate(req)).by, "moonshotai/kimi-k2-instruct");
  assert.deepEqual(calls, ["list", "moonshotai/kimi-k2-instruct"]);
});

test("Ollama out of memory: clear message, rests, next provider answers", async () => {
  let ollamaCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes("11434")) { ollamaCalls++; return reply(500, { error: "llama-server process has terminated: ggml_backend_cpu_buffer_type_alloc_buffer: failed to allocate buffer of size 3312451584" }); }
    return reply(200, { choices: [{ message: { content: '{"by":"groq"}' } }] });
  };
  const ai = createAIFromEnv({ OLLAMA_MODEL: "qwen3:8b", GROQ_API_KEY: "q", AI_ORDER: "ollama,groq" }, { fetchImpl, log: quiet });
  assert.equal(parseJSON(await ai.generate(req)).by, "groq");
  await ai.generate(req);
  assert.equal(ollamaCalls, 1); // resting, not retried on every request
});

test("AI results say which provider and model made them", async () => {
  const { quiz } = await import("../web/core/ai.js");
  const { sourceTag } = await import("../web/ui.js").catch(() => ({}));
  const sent = [];
  const fetchImpl = async (url, opts) => {
    if (url.includes("generativelanguage")) return reply(429, { error: { message: "quota" } });
    const body = JSON.parse(opts.body); sent.push(body);
    return reply(200, { choices: [{ message: { content: JSON.stringify({ title: "T", questions: [{ q: "Q", o: ["a", "b", "c", "d"], a: 1, why: "w" }] }) } }] });
  };
  const ai = createAIFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q", AI_ORDER: "gemini,groq" }, { fetchImpl, log: quiet });
  const q = await quiz(ai, { behaviorId: "ownership", agent: { name: "Ana P", lob: "BVA" } });
  assert.equal(q.source, "ai");
  assert.equal(q.ai_by, "Groq · gpt-oss-120b"); // Gemini was out of quota, so Groq made it
  assert.ok(Number.isFinite(q.ai_ms));
  assert.equal(sent[0].reasoning_effort, "medium"); // quizzes get full reasoning: quality over a few seconds
  if (sourceTag) assert.match(sourceTag(q), /Generated by Groq · gpt-oss-120b · \d/);
});

test("Gemini: a model out of daily quota is skipped, Flash-Lite covers, and roleplay replies use Flash-Lite first", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    if (url.includes("generativelanguage")) {
      const m = decodeURIComponent(url.split("/models/")[1].split(":")[0]); calls.push(m);
      if (m === "gemini-3.8-flash") return reply(429, { error: { message: "You exceeded your current quota", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });
      return reply(200, { candidates: [{ content: { parts: [{ text: `{"by":"${m}"}` }] } }] });
    }
    return reply(200, { choices: [{ message: { content: '{"by":"groq"}' } }] });
  };
  const ai = createAIFromEnv({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" }, { fetchImpl, log: quiet });
  assert.deepEqual(ai.providers.slice(0, 2), ["gemini", "groq"]); // Gemini first by default
  assert.equal(parseJSON(await ai.generate(req)).by, "gemini-3.5-flash-lite");
  calls.length = 0;
  await ai.generate(req);
  assert.deepEqual(calls, ["gemini-3.5-flash-lite"], "Flash isn't asked again today");
  calls.length = 0;
  await ai.generate({ ...req, fast: true });
  assert.deepEqual(calls, ["gemini-3.5-flash-lite"]);
});
