// API client. Three modes:
//  - "server": talks to the PULSE Express API (demo login or Supabase Auth).
//  - "local":  no server reachable (for example a static preview). Runs the same API in the browser
//              with fictional data saved in this browser and offline AI suggestions.
import { handle } from "./core/router.js";
import { createMemStore } from "./core/memstore.js";
import { buildSeed } from "./core/seed.js";

const CFG = window.PULSE_CONFIG || {};
const base = (CFG.apiBase || "").replace(/\/$/, "");
const LS_DB = "pulse-local-db-v1", LS_USER = "pulse-local-user", LS_TOKEN = "pulse-token";
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

export const state = { mode: null, config: null, token: null, user: null, local: null, supabase: null };

export async function init() {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${base}/api/config`, { signal: ctrl.signal }); clearTimeout(t);
    const type = r.headers.get("content-type") || "";
    if (r.ok && type.includes("json")) { state.mode = "server"; state.config = await r.json(); }
  } catch {}
  if (!state.mode) {
    state.mode = "local";
    let initial = null; try { initial = JSON.parse(ls.get(LS_DB) || "null"); } catch {}
    state.local = createMemStore(initial || buildSeed(), (data) => ls.set(LS_DB, JSON.stringify(data)));
    if (!initial) ls.set(LS_DB, JSON.stringify(state.local.dump()));
    state.config = { authMode: "demo", store: "browser", ai: { provider: "offline" } };
  }
  if (state.config.authMode === "supabase") await initSupabase();
  else state.token = ls.get(LS_TOKEN);
  if (state.mode === "local") { const id = ls.get(LS_USER); if (id) state.user = await state.local.get("users", id); }
  else if (state.token) { try { state.user = await api("GET", "/api/me"); } catch { state.user = null; ls.set(LS_TOKEN, null); } }
  return state;
}

async function initSupabase() {
  if (!window.supabase) {
    await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  state.supabase = window.supabase.createClient(state.config.supabaseUrl, state.config.supabaseAnonKey);
  const { data } = await state.supabase.auth.getSession();
  state.token = data?.session?.access_token || null;
  state.supabase.auth.onAuthStateChange((_e, session) => { state.token = session?.access_token || null; });
}

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// The current access token. With Supabase it's read from the session each time, which refreshes it when it has expired,
// so a tab left open for hours doesn't keep sending an old token.
async function currentToken() {
  if (state.supabase) {
    try { const { data } = await state.supabase.auth.getSession(); state.token = data?.session?.access_token || null; } catch {}
  }
  return state.token;
}
export const LS_LOGIN_AT = "pulse-login-at", LS_LAST_ACTIVE = "pulse-last-active";
const markSignedIn = () => { const now = String(Date.now()); ls.set(LS_LOGIN_AT, now); ls.set(LS_LAST_ACTIVE, now); };

export async function api(method, path, body) {
  if (state.mode === "local") {
    const url = new URL("http://local" + path);
    try {
      const out = await handle({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, user: state.user }, { store: state.local, ai: null, demo: true });
      return JSON.parse(JSON.stringify(out ?? null));
    } catch (e) { throw new ApiError(e.status || 500, e.message || "Something went wrong."); }
  }
  const send = async () => { const token = await currentToken(); return fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); };
  let res = await send();
  if (res.status === 401 && state.supabase && state.user) { try { await state.supabase.auth.refreshSession(); } catch {} res = await send(); } // one retry with a refreshed token
  let data = null; try { data = await res.json(); } catch {}
  if (res.status === 401 && state.user) window.dispatchEvent(new CustomEvent("pulse:signed-out", { detail: "Your session ended. Please sign in again." }));
  if (res.status === 428) window.dispatchEvent(new CustomEvent("pulse:set-password")); // temporary password: choose your own first
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status}).`);
  return data;
}

export async function demoUsers() {
  if (state.mode === "local") return (await state.local.list("users")).filter((u) => u.active !== false).map(({ id, name, role, lob, supervisor_id, manager_id, source }) => ({ id, name, role, lob, supervisor_id, manager_id, real: source === "roster" }));
  return api("GET", "/api/demo-users");
}

export async function signInDemo(userId) {
  if (state.mode === "local") { state.user = await state.local.get("users", userId); ls.set(LS_USER, userId); return state.user; }
  const r = await fetch(base + "/api/auth/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
  const d = await r.json(); if (!r.ok) throw new ApiError(r.status, d.error);
  state.token = d.token; ls.set(LS_TOKEN, d.token); state.user = d.user; markSignedIn(); return d.user;
}

export async function signInEmail(email, password) {
  const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
  if (error) throw new ApiError(401, error.message);
  state.token = data.session.access_token;
  state.user = await api("GET", "/api/me");
  markSignedIn();
  if (!state.user) { await state.supabase.auth.signOut(); throw new ApiError(403, "Your login works, but there’s no PULSE profile for this email. Ask your manager to add you."); }
  return state.user;
}

// Always ends the session on this browser, even if Supabase can't be reached or the session already expired.
export async function signOut() {
  try { sessionStorage.removeItem("pulse-route"); } catch {}
  state.user = null; state.token = null;
  if (state.supabase) { try { await state.supabase.auth.signOut({ scope: "local" }); } catch {} }
  ls.set(LS_TOKEN, null); ls.set(LS_USER, null); ls.set(LS_LOGIN_AT, null); ls.set(LS_LAST_ACTIVE, null);
  state.token = null; state.user = null;
}

export function resetLocalDemo() { ls.set(LS_DB, null); ls.set(LS_USER, null); }
