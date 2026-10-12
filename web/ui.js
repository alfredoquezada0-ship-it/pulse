// UI helpers: escaping, formatting, small components.
import { KPI_BY_ID, ROOT_CAUSE_BY_ID, SESSION_TYPE_BY_ID, QUARTILES } from "./core/constants.js";
import { DEFAULT_BEHAVIORS, DEFAULT_BY_ID, forLob, byKey } from "./core/bank.js";
import { parseDate } from "./core/util.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// The signed-in person's behavior bank (their manager's), loaded at sign-in. Falls back to the 7 core behaviors.
let BANK = DEFAULT_BEHAVIORS, BANK_BY = DEFAULT_BY_ID, BANK_INFO = { editable: false, manager: null };
export function setBank(info) {
  if (!info?.behaviors?.length) return;
  BANK = info.behaviors; BANK_BY = { ...DEFAULT_BY_ID, ...byKey(BANK) }; BANK_INFO = info;
}
export const bankInfo = () => BANK_INFO;
export const allBehaviors = () => BANK;
// Active behaviors for a LOB (all active ones when no LOB), plus `keep` if it's a retired one still in use.
export const behaviorList = (lob, keep) => { const l = forLob(BANK, lob); return keep && !l.some((b) => b.id === keep) && BANK_BY[keep] ? [...l, BANK_BY[keep]] : l; };
export const behaviorOf = (id) => BANK_BY[id] || null;
export const bName = (id) => BANK_BY[id]?.name || (id ? String(id) : "—");
export const rcName = (id) => ROOT_CAUSE_BY_ID[id]?.name || "—";
export const sName = (id) => SESSION_TYPE_BY_ID[id]?.name || id;
export const qName = (id) => QUARTILES.find((q) => q.id === id)?.name || "—";

export function fmtKpi(id, v) {
  if (v == null || isNaN(v)) return "—";
  if (id === "aht") { const s = Math.round(v); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  if (id === "nps") return String(Math.round(v));
  return `${Number(v).toFixed(1)}%`;
}
export function fmtDelta(id, d, dir) {
  if (d == null) return "";
  const good = dir === "lower" ? d < 0 : d > 0;
  const n = id === "aht" ? `${Math.abs(Math.round(d))}s` : id === "nps" ? Math.abs(Math.round(d)) : `${Math.abs(d).toFixed(1)} pts`;
  if (Math.abs(d) < 0.05) return `<span class="delta">flat</span>`;
  return `<span class="delta ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${n}</span>`;
}
export const dateLabel = (s) => { if (!s) return "—"; const d = parseDate(s); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); };
export const weekLabel = (s) => { const d = parseDate(s); return "Week of " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };

export function statusChip(st) {
  const m = { open: ["Open", "teal"], met: ["Met", "ok"], partial: ["Partially met", "warn"], not_met: ["Not met", "bad"], held: ["Held", "ok"], planned: ["Planned", "plain"], rescheduled: ["Rescheduled", "warn"], missed: ["Missed", "bad"], assigned: ["Assigned", "teal"], started: ["Started", "warn"], done: ["Done", "ok"], completed: ["Completed", "ok"], draft: ["Draft", "plain"] }[st] || [st, "plain"];
  return `<span class="chip ${m[1]}">${esc(m[0])}</span>`;
}
export const goalChip = (onGoal) => (onGoal ? `<span class="chip ok">On goal</span>` : `<span class="chip bad">Below goal</span>`);
export const quartileChip = (q) => (q ? `<span class="chip plain q-${q}">${esc(qName(q))}</span>` : "");

export function spark(series, goal, kpiId) {
  const vals = (series || []).filter((v) => v != null);
  if (vals.length < 2) return "";
  const all = goal != null ? [...vals, goal] : vals;
  let lo = Math.min(...all), hi = Math.max(...all); if (hi - lo < 1) { hi += 1; lo -= 1; }
  const W = 120, H = 34, P = 4;
  const x = (i) => P + (i * (W - 2 * P)) / (vals.length - 1);
  const y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const gy = goal != null ? y(goal).toFixed(1) : null;
  const name = KPI_BY_ID[kpiId]?.name || "";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(name)} trend over ${vals.length} weeks, latest ${esc(fmtKpi(kpiId, vals[vals.length - 1]))}">
    ${gy ? `<line class="goal" x1="0" x2="${W}" y1="${gy}" y2="${gy}"><title>Goal ${esc(fmtKpi(kpiId, goal))}</title></line>` : ""}
    <polyline class="ln" points="${pts}" vector-effect="non-scaling-stroke"/>
    ${vals.map((v, i) => `<circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="6"><title>Week ${i + 1}: ${esc(fmtKpi(kpiId, v))}</title></circle>`).join("")}
    <circle class="end" cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="3.5"/>
  </svg>`;
}

export function kpiTile(id, d, { withSpark = true } = {}) {
  const k = KPI_BY_ID[id];
  return `<div class="kpi"><span class="k">${esc(k.name)}</span><span class="v">${fmtKpi(id, d.value)}</span>
    <span class="meta"><span>Goal ${fmtKpi(id, d.goal)}</span>${fmtDelta(id, d.delta, d.dir)}</span>
    ${withSpark && d.series ? spark(d.series, d.goal, id) : ""}${d.value == null ? `<span class="chip plain">No data yet</span>` : goalChip(d.onGoal)}</div>`;
}

export function toast(msg, kind = "") {
  let host = $(".toasts"); if (!host) { host = document.createElement("div"); host.className = "toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg; host.appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 6000 : 3200);
}

export function modal(html) {
  const o = document.createElement("div"); o.className = "overlay";
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { o.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(o);
  const first = o.querySelector("input,select,textarea,button"); if (first) first.focus();
  return { el: o, close };
}

export const options = (list, value, placeholder) =>
  (placeholder ? `<option value="">${esc(placeholder)}</option>` : "") + list.map((o) => `<option value="${esc(o.id ?? o)}"${(o.id ?? o) === value ? " selected" : ""}>${esc(o.name ?? o)}</option>`).join("");

// Pass the AI result (or just its source). Shows which provider and model made it, and how long it took.
export const sourceTag = (r) => {
  const o = r && typeof r === "object" ? r : { source: r };
  if (o.source !== "ai") return `<span class="src">Offline suggestion (AI not available)</span>`;
  const secs = Number.isFinite(o.ai_ms) ? ` · ${(o.ai_ms / 1000).toFixed(o.ai_ms < 10000 ? 1 : 0)}s` : "";
  return `<span class="src" title="Made by AI. Review it before using it.">Generated by ${esc(o.ai_by || "AI")}${secs}</span>`;
};

export const icon = (n) => {
  const p = {
    home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", users: "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0", spark: "M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z",
    clip: "M9 4h6v3H9zM6 6h12v15H6z", cal: "M4 6h16v15H4zM4 10h16M9 3v4M15 3v4", check: "M5 12l5 5L20 7", chat: "M4 5h16v11H8l-4 4z", quiz: "M9 9a3 3 0 1 1 4 2.8V14M12 18h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
    book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM19 19v2H6", up: "M12 19V5M5 12l7-7 7 7", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", chart: "M4 20V10M10 20V4M16 20v-7M22 20H2", target: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
    bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
    mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3", play: "M11 5L6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13", phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z", hang: "M3 15c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-3a10 10 0 0 0-6 0v3l-3.5 1.5z",
  }[n] || "";
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;
};
