// PULSE API server (Express). Deploy on Render; the web app can be served from here or from Vercel.
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../web/core/router.js";
import { HttpError } from "../web/core/util.js";
import { createFileStore } from "./store/file.js";
import { createSupabaseStore } from "./store/supabase.js";
import { createGemini } from "./ai/gemini.js";
import { createOpenAICompat, createOllama } from "./ai/openai-compat.js";
import { createAIChain } from "./ai/chain.js";
import { createAuth, issueDemoToken } from "./auth.js";
import { createClient } from "@supabase/supabase-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
// Supabase renamed its keys: accept the new names (secret / publishable) and the legacy ones (service_role / anon).
env.SUPABASE_SERVICE_ROLE_KEY ||= env.SUPABASE_SECRET_KEY || "";
env.SUPABASE_ANON_KEY ||= env.SUPABASE_PUBLISHABLE_KEY || "";

export function createApp(opts = {}) {
  const useSupabase = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) && !opts.forceMemory;
  const store = opts.store || (useSupabase
    ? createSupabaseStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY })
    : createFileStore(opts.dataFile === undefined ? path.join(here, "..", "data", "local-db.json") : opts.dataFile));
  const authMode = opts.authMode || env.AUTH_MODE || (useSupabase ? "supabase" : "demo");
  const secret = env.APP_SECRET || "pulse-dev-secret-change-me";
  const ai = opts.ai !== undefined ? opts.ai : createAIFromEnv(env);
  // Sessions: signed out after SESSION_IDLE_MINUTES without activity (in the browser) and after SESSION_MAX_HOURS since sign-in (enforced here too).
  const session = { idleMinutes: Math.max(1, Number(env.SESSION_IDLE_MINUTES || 30)), maxHours: Math.max(1, Number(env.SESSION_MAX_HOURS || 12)) };
  const userFromRequest = createAuth({ mode: authMode, secret, store, maxHours: session.maxHours });
  const demo = authMode === "demo";
  const passwords = opts.passwords !== undefined ? opts.passwords : authMode === "supabase" && store.client ? createPasswords(store.client) : null;

  const app = express();
  app.disable("x-powered-by");
  const origins = (env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : true }));
  app.use(express.json({ limit: "8mb" })); // roster files are sent as sheet rows

  // Simple per-user limiter for AI routes, to stay inside the free tier.
  const hits = new Map();
  const AI_PER_MIN = Number(env.AI_REQUESTS_PER_MINUTE || 12);
  const limitAI = (userId) => {
    const now = Date.now(), list = (hits.get(userId) || []).filter((t) => now - t < 60000);
    if (list.length >= AI_PER_MIN) throw new HttpError(429, "Too many AI requests this minute. Wait a few seconds and try again.");
    list.push(now); hits.set(userId, list);
  };

  app.get("/api/config", (_req, res) => res.json({
    authMode, session, store: store.kind, ai: ai ? { provider: ai.name, model: ai.model, providers: ai.providers || [ai.name], fast: ai.fastProviders || [ai.name], lastProvider: ai.stats.lastProvider || null, lastError: ai.stats.lastError } : { provider: "offline" },
    supabaseUrl: authMode === "supabase" ? env.SUPABASE_URL : null, supabaseAnonKey: authMode === "supabase" ? env.SUPABASE_ANON_KEY : null,
  }));

  // Demo sign-in (pick a person, no password) is for fictional data. Real people imported from the roster
  // can only be picked on your own computer, unless DEMO_REAL_PEOPLE=true. Deployed, use AUTH_MODE=supabase.
  const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket?.remoteAddress) && !req.headers["x-forwarded-for"];
  const demoRoster = (req) => env.DEMO_REAL_PEOPLE === "true" || isLocal(req);

  app.post("/api/auth/demo", async (req, res) => {
    if (!demo) return res.status(404).json({ error: "Not found." });
    const user = await store.get("users", req.body?.user_id);
    if (!user || user.active === false) return res.status(404).json({ error: "User not found." });
    if (user.source === "roster" && !demoRoster(req)) return res.status(403).json({ error: "Real people sign in with their own login. Set AUTH_MODE=supabase on the server." });
    res.json({ token: issueDemoToken(user.id, secret, session.maxHours), user });
  });

  app.all("/api/*", async (req, res) => {
    try {
      let user = await userFromRequest(req);
      if (demo && user?.source === "roster" && !demoRoster(req)) user = null;
      if (user && req.path.startsWith("/api/ai/") && req.method === "POST") limitAI(user.id);
      const data = await handle({ method: req.method, path: req.path, query: req.query, body: req.body, user }, { store, ai, demo, demoRoster: demoRoster(req), passwords });
      res.json(data ?? null);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(`[error] ${req.method} ${req.path}:`, e);
      // On your own computer (or with SHOW_ERRORS=true) the page shows the real reason, which makes setup problems easy to spot.
      const detail = env.SHOW_ERRORS === "true" || isLocal(req);
      res.status(status).json({ error: status >= 500 ? `Something went wrong on the server${detail ? `: ${e.message}` : "."}` : e.message });
    }
  });

  // Serve the web app too, so one Render service is enough.
  if (env.SERVE_WEB !== "false") {
    app.use(express.static(path.join(here, "..", "web")));
    app.get("*", (_req, res) => res.sendFile(path.join(here, "..", "web", "index.html")));
  }
  return { app, store, ai, authMode };
}

// AI providers from .env. Each one is used only if its key (or OLLAMA_MODEL) is set.
//   AI_ORDER       order for analysis  (default gemini,groq,nvidia,ollama)
//   AI_FAST_ORDER  order for roleplay replies (default gemini,groq,nvidia,ollama): Gemini answers them with
//                  GEMINI_FAST_MODEL (Flash-Lite, a much larger free quota) so Flash is kept for analysis.
// NVIDIA's catalog changes often: with NVIDIA_MODEL unset (or retired), PULSE picks a live chat model from its list.
const NVIDIA_PICKS = [/kimi-k2.*instruct/i, /deepseek-v3/i, /nemotron.*super/i, /glm-?5/i, /qwen3.*instruct/i, /qwen3/i, /gpt-oss-120b/i, /llama-?4/i, /llama.*70b/i, /mistral-(large|medium)/i, /gemma-?4/i];
const GROQ_PICKS = [/gpt-oss-120b/i, /llama-3\.3-70b/i, /llama-?4/i, /qwen3/i, /kimi/i, /gpt-oss/i];
const csv = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
export function createProvidersFromEnv(e = env, { fetchImpl = fetch, log = console } = {}) {
  const list = csv;
  return [
    createGemini({ apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL || "gemini-3.8-flash", fastModel: e.GEMINI_FAST_MODEL || "gemini-3.5-flash-lite", fallbacks: list(e.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-3.1-flash-lite"), thinking: e.GEMINI_THINKING || "low", timeoutMs: 35000, retries: 0, fetchImpl, log }),
    createOpenAICompat({ name: "groq", baseUrl: "https://api.groq.com/openai/v1", apiKey: e.GROQ_API_KEY, model: e.GROQ_MODEL || "openai/gpt-oss-120b", fastModel: e.GROQ_FAST_MODEL || "llama-3.3-70b-versatile", fallbacks: list(e.GROQ_FALLBACK_MODELS || "llama-3.3-70b-versatile,openai/gpt-oss-20b"), discover: GROQ_PICKS, timeoutMs: 30000, fetchImpl, log }),
    createOpenAICompat({ name: "nvidia", baseUrl: e.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1", apiKey: e.NVIDIA_API_KEY, model: e.NVIDIA_MODEL || "auto", fallbacks: list(e.NVIDIA_FALLBACK_MODELS), discover: NVIDIA_PICKS, timeoutMs: 40000, fetchImpl, log }),
    createOllama({ url: e.OLLAMA_URL || "http://localhost:11434", model: e.OLLAMA_MODEL, fetchImpl, log }),
  ].filter(Boolean);
}
export function createAIFromEnv(e = env, { fetchImpl = fetch, log = console } = {}) {
  const providers = createProvidersFromEnv(e, { fetchImpl, log });
  if (!providers.length) return null;
  return createAIChain(providers, { order: csv(e.AI_ORDER || "gemini,groq,nvidia,ollama"), fastOrder: csv(e.AI_FAST_ORDER || "gemini,groq,nvidia,ollama"), log });
}

// Password changes go through the Supabase admin API (secret key, server only).
// check() signs in with a throwaway client to confirm a password, limited to 8 tries per person per 10 minutes.
function createPasswords(admin) {
  const tries = new Map();
  const friendly = (m) => (/weak|short|at least/i.test(m) ? `Supabase rejected the password: ${m}` : m);
  return {
    async set(user, password) {
      const { error } = await admin.auth.admin.updateUserById(user.auth_user_id, { password });
      if (error) throw new HttpError(400, friendly(error.message));
    },
    async check(user, password) {
      const now = Date.now(), list = (tries.get(user.id) || []).filter((t) => now - t < 600000);
      if (list.length >= 8) throw new HttpError(429, "Too many password attempts. Wait 10 minutes and try again.");
      list.push(now); tries.set(user.id, list);
      const { data } = await admin.auth.admin.getUserById(user.auth_user_id);
      const email = data?.user?.email; if (!email) return false;
      const probe = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await probe.auth.signInWithPassword({ email, password });
      if (!error) await probe.auth.signOut({ scope: "local" }); // ends only this probe session, not the person's own
      return !error;
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { app, store, ai, authMode } = createApp();
  const port = Number(env.PORT || 3000);
  app.listen(port, () => console.log(`PULSE running on http://localhost:${port} · store: ${store.kind} · auth: ${authMode} · AI: ${ai ? ai.name : "offline fallback"}${ai?.fastProviders ? ` (roleplays: ${ai.fastProviders.join(" → ")})` : ""}`));
}
