// Web security for the PULSE server: security headers (with a Content Security Policy), HTTPS only,
// request limits, and cleaning every request body before any route sees it.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ---------- security headers ----------
// The guides are static pages with one inline script each: they're allowed by hash, nothing else inline runs.
function inlineScriptHashes(dir) {
  const out = [];
  try {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".html"))) {
      const html = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) out.push(`'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`);
    }
  } catch {}
  return out;
}

export function securityHeaders({ supabaseUrl = "", webDir, https = false, captcha = false } = {}) {
  const supa = supabaseUrl ? [supabaseUrl, supabaseUrl.replace(/^https:/, "wss:")] : [];
  const captchaSrc = captcha ? ["https://challenges.cloudflare.com"] : [];
  const base = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "https://cdn.jsdelivr.net", ...captchaSrc],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // style="" attributes are used for bar widths
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "img-src": ["'self'", "data:", "blob:"],
    "media-src": ["'self'", "blob:"],
    "connect-src": ["'self'", ...supa],
    "frame-src": captchaSrc.length ? captchaSrc : ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const guideHashes = webDir ? inlineScriptHashes(path.join(webDir, "guides")) : [];
  const csp = (extraScripts = []) => Object.entries({ ...base, "script-src": [...base["script-src"], ...extraScripts] }).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ") + (https ? "; upgrade-insecure-requests" : "");
  const appCsp = csp(), guideCsp = csp(guideHashes);
  return (req, res, next) => {
    res.setHeader("Content-Security-Policy", req.path.startsWith("/guides/") ? guideCsp : appCsp);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // The microphone is used for voice roleplays on this site only; nothing else.
    res.setHeader("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (https) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store"); // never cache people's data
    next();
  };
}

// ---------- HTTPS only ----------
// Render (and most hosts) end TLS in front of the app and pass the original scheme in X-Forwarded-Proto.
export function forceHttps({ enabled }) {
  return (req, res, next) => {
    if (!enabled || req.headers["x-forwarded-proto"] !== "http") return next();
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(403).json({ error: "Use https." });
    res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  };
}

// ---------- rate limits ----------
// In memory, per key (IP or user). Fine for one Render instance; a second instance would keep its own counts.
export function rateLimiter({ windowMs, max, message = "Too many requests. Wait a moment and try again." }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k); }, windowMs).unref?.();
  const check = (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start > windowMs) { h = { start: now, n: 0 }; hits.set(key, h); }
    h.n++;
    return h.n <= max ? null : Math.ceil((h.start + windowMs - now) / 1000);
  };
  const mw = (keyOf) => (req, res, next) => {
    const wait = check(keyOf(req));
    if (wait == null) return next();
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({ error: message });
  };
  return { check, mw };
}
export const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

// ---------- request bodies ----------
// Drops keys that could tamper with objects (__proto__, constructor, prototype), strips control characters,
// and caps depth, string length and array size. Routes still validate their own fields on top of this.
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
export function cleanValue(v, { depth = 0, maxDepth = 10, maxString = 20000, maxArray = 60000 } = {}, budget = { keys: 0 }) {
  if (depth > maxDepth) throw Object.assign(new Error("The request is nested too deeply."), { status: 400 });
  if (typeof v === "string") return v.replace(CONTROL, "").normalize("NFC").slice(0, maxString);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    if (v.length > maxArray) throw Object.assign(new Error(`Too many rows in one request (${maxArray.toLocaleString("en-US")} max). Split the file.`), { status: 413 });
    return v.map((x) => cleanValue(x, { depth: depth + 1, maxDepth, maxString, maxArray }, budget));
  }
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (BAD_KEYS.has(k)) continue;
      if (++budget.keys > 500000) throw Object.assign(new Error("The request is too large."), { status: 413 });
      out[k.slice(0, 200)] = cleanValue(x, { depth: depth + 1, maxDepth, maxString, maxArray }, budget);
    }
    return out;
  }
  return null;
}
export const cleanBody = () => (req, res, next) => {
  try { if (req.body && typeof req.body === "object") req.body = cleanValue(req.body); next(); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};
