// Authentication.
// - AUTH_MODE=supabase: the browser signs in with Supabase Auth and sends its access token;
//   the server verifies it and looks up the PULSE user by email.
// - AUTH_MODE=demo: pick a seeded user; the server signs a short-lived token (HMAC-SHA256).
import crypto from "node:crypto";

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (data, secret) => crypto.createHmac("sha256", secret).update(data).digest("base64url");

export function issueDemoToken(userId, secret, hours = 12) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + hours * 3600 }));
  return `${head}.${body}.${sign(`${head}.${body}`, secret)}`;
}

export function verifyDemoToken(token, secret) {
  const [h, b, s] = String(token).split(".");
  if (!h || !b || !s) return null;
  const expected = sign(`${h}.${b}`, secret);
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(b, "base64url").toString());
  if (payload.exp < Date.now() / 1000) return null;
  return payload.sub;
}

// When the person signed in: the oldest "amr" timestamp in a Supabase access token (it survives token refreshes).
function signedInAt(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
    const amr = (p.amr || []).map((a) => Number(a.timestamp)).filter(Boolean);
    return amr.length ? Math.min(...amr) : Number(p.iat) || null;
  } catch { return null; }
}

export function createAuth({ mode, secret, store, maxHours = 12 }) {
  return async function userFromRequest(req) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return null;
    if (mode === "supabase") {
      const { data, error } = await store.client.auth.getUser(token);
      if (error || !data?.user?.id) return null;
      const at = signedInAt(token);
      if (maxHours && at && Date.now() / 1000 - at > maxHours * 3600) return null; // signed in too long ago: sign in again
      // Link by Supabase Auth UID. The email is only used once, to connect a login that isn't linked yet.
      const linked = await store.list("users", { auth_user_id: data.user.id });
      if (linked[0]) return linked[0].active === false ? null : linked[0]; // people who left the roster can't sign in
      if (!data.user.email) return null;
      const byEmail = (await store.list("users", { email: data.user.email.toLowerCase() }))[0];
      if (!byEmail || byEmail.auth_user_id || byEmail.active === false) return null; // already linked to a different login, or left
      return store.update("users", byEmail.id, { auth_user_id: data.user.id });
    }
    const id = verifyDemoToken(token, secret);
    const u = id ? await store.get("users", id) : null;
    return u && u.active !== false ? u : null;
  };
}
