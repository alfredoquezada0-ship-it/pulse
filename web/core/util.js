// Small helpers shared by browser and server.

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const uid = () =>
  (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID()
    : "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

// Dates are handled as YYYY-MM-DD strings in local time.
export const pad = (n) => String(n).padStart(2, "0");
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toISODate(d); };
export const isoWeekday = (s) => { const w = parseDate(s).getDay(); return w === 0 ? 7 : w; };
export const weekStart = (s = toISODate(new Date())) => addDays(s, 1 - isoWeekday(s));
export const today = () => toISODate(new Date());
// Coaching done on a weekend sets up the coming week.
export const coachingWeek = (s = today()) => (isoWeekday(s) >= 6 ? addDays(weekStart(s), 7) : weekStart(s));

export const avg = (arr) => { const v = arr.filter((x) => typeof x === "number" && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// Remove things that look like identifiers before text leaves the platform.
export const redact = (text = "") =>
  String(text)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b\d{5,}\b/g, "[number]")
    .replace(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, "[phone]");

// Deterministic pseudo-random generator for seed data.
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function parseCSV(text) {
  text = String(text || "").replace(/^\ufeff/, ""); // Excel's UTF-8 marker
  // Excel in Spanish saves "CSV" with semicolons (and decimal commas); detect it from the header line.
  const first = text.split(/\r?\n/, 1)[0];
  const sep = first.split(";").length > first.split(",").length ? ";" : ",";
  const rows = []; let row = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
