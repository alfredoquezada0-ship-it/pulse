import test from "node:test";
import assert from "node:assert/strict";
import { createAuth, issueDemoToken } from "../backend/auth.js";
import { createMemStore } from "../web/core/memstore.js";
import { buildSeed } from "../web/core/seed.js";

const jwt = (payload) => ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

test("Supabase sign-in expires SESSION_MAX_HOURS after the person signed in, even if the token was refreshed", async () => {
  const store = createMemStore(buildSeed());
  const [u] = await store.list("users", { role: "supervisor" });
  await store.update("users", u.id, { auth_user_id: "auth-1" });
  store.client = { auth: { getUser: async () => ({ data: { user: { id: "auth-1", email: u.email } }, error: null }) } };
  const auth = createAuth({ mode: "supabase", store, maxHours: 12 });
  const now = Math.floor(Date.now() / 1000);
  const fresh = jwt({ iat: now, amr: [{ method: "password", timestamp: now - 3600 }] });
  const old = jwt({ iat: now, amr: [{ method: "password", timestamp: now - 13 * 3600 }] }); // refreshed just now, signed in 13 h ago
  assert.equal((await auth({ headers: { authorization: `Bearer ${fresh}` } }))?.id, u.id);
  assert.equal(await auth({ headers: { authorization: `Bearer ${old}` } }), null);
});

test("demo tokens expire and people who left can't sign in", async () => {
  const store = createMemStore(buildSeed());
  const [u] = await store.list("users", { role: "agent" });
  const auth = createAuth({ mode: "demo", secret: "s", store });
  assert.equal((await auth({ headers: { authorization: `Bearer ${issueDemoToken(u.id, "s", 1)}` } }))?.id, u.id);
  assert.equal(await auth({ headers: { authorization: `Bearer ${issueDemoToken(u.id, "s", -1)}` } }), null);
  await store.update("users", u.id, { active: false });
  assert.equal(await auth({ headers: { authorization: `Bearer ${issueDemoToken(u.id, "s", 1)}` } }), null);
});

test("idle and maximum session limits in the browser", async () => {
  const mem = {};
  globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)), removeItem: (k) => delete mem[k] };
  const { expiredReason } = await import("../web/session.js");
  const cfg = { idleMinutes: 30, maxHours: 12 };
  mem["pulse-login-at"] = Date.now() - 3600000; mem["pulse-last-active"] = Date.now() - 60000;
  assert.equal(expiredReason(cfg), null);
  mem["pulse-last-active"] = Date.now() - 31 * 60000;
  assert.match(expiredReason(cfg), /30 minutes without activity/);
  mem["pulse-login-at"] = Date.now() - 13 * 3600000; mem["pulse-last-active"] = Date.now();
  assert.match(expiredReason(cfg), /12 hours/);
  delete globalThis.localStorage;
});
