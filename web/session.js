// Session limits in the browser:
//  - idle: signed out after `idleMinutes` with no activity (a warning shows 2 minutes before). Activity in any PULSE tab counts.
//  - max:  signed out `maxHours` after signing in, whatever happens (the server enforces this too).
// Times live in localStorage so every tab shares them, and a browser closed overnight comes back signed out.
const LAST = "pulse-last-active", LOGIN = "pulse-login-at";
const get = (k) => { try { return Number(localStorage.getItem(k)) || null; } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };

export function expiredReason(cfg = {}) {
  const idle = (cfg.idleMinutes || 30) * 60000, max = (cfg.maxHours || 12) * 3600000, now = Date.now();
  const last = get(LAST), login = get(LOGIN);
  if (login && now - login > max) return `For security you’re signed out ${cfg.maxHours || 12} hours after signing in. Please sign in again.`;
  if (last && now - last > idle) return `You were signed out after ${cfg.idleMinutes || 30} minutes without activity.`;
  return null;
}

export function startSessionWatch(cfg = {}, { onWarn, onExpire }) {
  const idle = (cfg.idleMinutes || 30) * 60000;
  const warnAt = Math.max(idle - 120000, idle * 0.8);
  let lastWrite = 0, warned = false, stopped = false;
  if (!get(LAST)) set(LAST, Date.now());
  if (!get(LOGIN)) set(LOGIN, Date.now()); // sessions started before this version
  const activity = () => {
    const now = Date.now();
    if (now - lastWrite > 5000) { set(LAST, now); lastWrite = now; }
    if (warned) { warned = false; onWarn?.(false); }
  };
  const events = ["pointerdown", "keydown", "wheel", "touchstart", "pulse:activity"];
  events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
  let moveT = 0; const move = () => { const now = Date.now(); if (now - moveT > 15000) { moveT = now; activity(); } };
  window.addEventListener("pointermove", move, { passive: true });
  const tick = () => {
    if (stopped) return;
    const reason = expiredReason(cfg);
    if (reason) { stop(); onExpire?.(reason); return; }
    const quiet = Date.now() - (get(LAST) || Date.now());
    if (quiet >= warnAt && !warned) { warned = true; onWarn?.(true, Math.max(0, Math.round((idle - quiet) / 1000))); }
    else if (quiet < warnAt && warned) { warned = false; onWarn?.(false); } // another tab was used
  };
  const timer = setInterval(tick, 10000);
  document.addEventListener("visibilitychange", tick);
  function stop() {
    stopped = true; clearInterval(timer);
    events.forEach((e) => window.removeEventListener(e, activity));
    window.removeEventListener("pointermove", move);
    document.removeEventListener("visibilitychange", tick);
  }
  return { stop, stayActive: () => { set(LAST, Date.now()); warned = false; onWarn?.(false); } };
}
