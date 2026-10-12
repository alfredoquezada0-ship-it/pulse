// In-memory store with the same interface as the Supabase adapter.
// `onChange` lets the caller persist the data (a JSON file on the server, localStorage in the browser).
import { uid } from "./util.js";

export const TABLES = [
  "users", "kpi_goals", "kpi_weekly", "verbatims", "coaching_sessions", "commitments",
  "weekly_sessions", "quizzes", "roleplays", "training_completions",
  "notifications", "roleplay_assignments", "leader_sessions", "leader_commitments", "diagnoses", "behaviors"];

const matches = (row, where) =>
  Object.entries(where || {}).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));

export function createMemStore(initial = {}, onChange = () => {}) {
  const data = {};
  TABLES.forEach((t) => (data[t] = (initial[t] || []).map((r) => ({ ...r }))));
  const clone = (r) => (r ? JSON.parse(JSON.stringify(r)) : r);
  const touch = () => onChange(data);
  return {
    kind: "memory",
    async list(table, where) { return data[table].filter((r) => matches(r, where)).map(clone); },
    async get(table, id) { return clone(data[table].find((r) => r.id === id) || null); },
    async insert(table, row) {
      const r = { id: uid(), created_at: new Date().toISOString(), ...row };
      data[table].push(r); touch(); return clone(r);
    },
    async insertMany(table, rows) {
      const out = rows.map((row) => ({ id: uid(), created_at: new Date().toISOString(), ...row }));
      data[table].push(...out); touch(); return clone(out);
    },
    async update(table, id, patch) {
      const r = data[table].find((x) => x.id === id); if (!r) return null;
      Object.assign(r, patch, { updated_at: new Date().toISOString() }); touch(); return clone(r);
    },
    async remove(table, id) {
      const i = data[table].findIndex((x) => x.id === id); if (i >= 0) { data[table].splice(i, 1); touch(); }
      return true;
    },
    async removeWhere(table, where) {
      const before = data[table].length;
      data[table] = data[table].filter((r) => !matches(r, where));
      if (data[table].length !== before) touch();
      return true;
    },
    dump() { return clone(data); },
  };
}
