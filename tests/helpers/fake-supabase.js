// A strict, in-memory stand-in for the Supabase REST API, built from supabase/schema.sql.
// It behaves like PostgREST where PULSE could trip: unknown columns, uuid/int/date types, check and
// unique constraints, foreign keys (cascade / set null / block), 1,000 rows per response, long URLs.
import fs from "node:fs";
import crypto from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSchema(sql) {
  const tables = {};
  const body = sql.replace(/--[^\n]*/g, "");
  for (const m of body.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
    const t = { cols: {}, uniques: [] };
    for (let line of m[2].split(/,\s*\n/)) {
      line = line.trim().replace(/,$/, "");
      if (!line) continue;
      const u = line.match(/^unique \(([^)]+)\)/);
      if (u) { t.uniques.push(u[1].split(",").map((s) => s.trim())); continue; }
      // "nps numeric, csat numeric, ..." lines declare several columns
      for (const part of line.split(/,\s*(?=[a-z_]+ (?:numeric|int|text|uuid|date|boolean|jsonb|timestamptz))/)) addCol(t, part.trim());
    }
    tables[m[1]] = t;
  }
  for (const m of body.matchAll(/alter table (\w+) add column if not exists (.+?);/g)) if (tables[m[1]]) addCol(tables[m[1]], m[2]);
  return tables;
}
function addCol(t, def) {
  const m = def.match(/^([a-z_]+) (uuid|text|int|numeric|date|boolean|jsonb|timestamptz)(.*)$/);
  if (!m) return;
  const [, name, type, rest] = m;
  if (t.cols[name]) return;
  const c = { type, notNull: /not null|primary key/.test(rest), unique: /\bunique\b|primary key/.test(rest) };
  const d = rest.match(/default ([^ ]+(?: [^ ]+)?)/);
  if (d) c.default = d[1].startsWith("gen_random_uuid") ? "uuid" : /^now\(\)|^current_date/.test(d[1]) ? "now" : d[1] === "false" ? false : d[1] === "true" ? true : /^'(.*)'::jsonb/.test(d[1]) ? JSON.parse(d[1].match(/^'(.*)'::jsonb/)[1]) : /^'(.*)'/.test(d[1]) ? d[1].match(/^'(.*)'/)[1] : /^\d+$/.test(d[1]) ? +d[1] : undefined;
  const chk = rest.match(/check \(\w+ in \(([^)]+)\)\)/);
  if (chk) c.check = chk[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  const fk = rest.match(/references (\w+)\.?(\w+)?\((\w+)\)(?: on delete (cascade|set null))?/);
  if (fk && !rest.includes("auth.users")) c.fk = { table: fk[1], onDelete: fk[4] || "block" };
  t.cols[name] = c;
}

export function createFakeSupabase(schemaSql, { maxRows = 1000, maxUrl = 8000 } = {}) {
  const schema = parseSchema(schemaSql);
  const data = Object.fromEntries(Object.keys(schema).map((t) => [t, []]));
  const calls = { requests: 0 };
  const err = (message) => ({ data: null, error: { message } });

  function cast(table, col, v) {
    const c = schema[table].cols[col];
    if (!c) throw new Error(`Could not find the '${col}' column of '${table}' in the schema cache`);
    if (v === null || v === undefined) return null;
    if (c.type === "uuid" && !UUID.test(String(v))) throw new Error(`invalid input syntax for type uuid: "${v}"`);
    if (c.type === "int") { if (!Number.isInteger(Number(v))) throw new Error(`invalid input syntax for type integer: "${v}"`); return Number(v); }
    if (c.type === "numeric") { if (!Number.isFinite(Number(v))) throw new Error(`invalid input syntax for type numeric: "${v}"`); return Number(v); }
    if (c.type === "date") { const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`invalid input syntax for type date: "${v}"`); return s; }
    if (c.type === "boolean") return v === true || v === "true";
    if (c.type === "jsonb") return JSON.parse(JSON.stringify(v));
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  function validate(table, row, selfId) {
    const t = schema[table];
    for (const [k, c] of Object.entries(t.cols)) {
      if (c.notNull && row[k] == null) throw new Error(`null value in column "${k}" of relation "${table}" violates not-null constraint`);
      if (c.check && row[k] != null && !c.check.includes(row[k])) throw new Error(`new row for relation "${table}" violates check constraint "${table}_${k}_check"`);
      if (c.fk && row[k] != null && !data[c.fk.table].some((r) => r.id === row[k])) throw new Error(`insert or update on table "${table}" violates foreign key constraint "${table}_${k}_fkey"`);
      if (c.unique && row[k] != null && data[table].some((r) => r.id !== selfId && r[k] === row[k])) throw new Error(`duplicate key value violates unique constraint "${table}_${k}_key"`);
    }
    for (const u of t.uniques) if (u.every((k) => row[k] != null) && data[table].some((r) => r.id !== selfId && u.every((k) => r[k] === row[k]))) throw new Error(`duplicate key value violates unique constraint "${table}_${u.join("_")}_key"`);
  }
  function deleteRows(table, rows) {
    for (const row of rows) {
      for (const [t2, s2] of Object.entries(schema)) for (const [col, c] of Object.entries(s2.cols)) {
        if (c.fk?.table !== table) continue;
        const refs = data[t2].filter((r) => r[col] === row.id);
        if (!refs.length) continue;
        if (c.fk.onDelete === "block") throw new Error(`update or delete on table "${table}" violates foreign key constraint "${t2}_${col}_fkey" on table "${t2}"`);
        if (c.fk.onDelete === "set null") refs.forEach((r) => (r[col] = null));
        else deleteRows(t2, refs);
      }
      data[table] = data[table].filter((r) => r !== row);
    }
  }

  function builder(table) {
    const st = { table, op: "select", filters: [], urlLen: 0, order: null, range: null, limit: null, single: false, returning: false, payload: null };
    const filt = (col, test, shown) => {
      if (!schema[table].cols[col]) st.error ||= `column ${table}.${col} does not exist`;
      st.urlLen += col.length + String(shown).length + 5;
      st.filters.push(test);
      return b;
    };
    const b = {
      select() { if (st.op === "select") st.op = "select"; else st.returning = true; return b; },
      insert(rows) { st.op = "insert"; st.payload = Array.isArray(rows) ? rows : [rows]; return b; },
      update(patch) { st.op = "update"; st.payload = patch; return b; },
      delete() { st.op = "delete"; return b; },
      eq(col, v) { try { v = cast(table, col, v); } catch (e) { st.error ||= e.message; } return filt(col, (r) => r[col] === v, v); },
      is(col, v) { return filt(col, (r) => r[col] == null, "null"); },
      in(col, vals) { try { vals = vals.map((v) => cast(table, col, v)); } catch (e) { st.error ||= e.message; } return filt(col, (r) => vals.includes(r[col]), vals.join(",")); },
      order(col) { st.order = col; return b; },
      range(a, z) { st.range = [a, z]; return b; },
      limit(n) { st.limit = n; return b; },
      single() { st.single = true; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      calls.requests++;
      if (!schema[table]) return err(`relation "public.${table}" does not exist`);
      if (st.error) return err(st.error);
      if (st.urlLen > maxUrl) return err("414 Request-URI Too Large");
      const match = (r) => st.filters.every((f) => f(r));
      try {
        let rows;
        if (st.op === "insert") {
          rows = st.payload.map((p) => {
            const row = {};
            for (const [k, v] of Object.entries(p)) row[k] = cast(table, k, v);
            for (const [k, c] of Object.entries(schema[table].cols)) if (row[k] === undefined) row[k] = c.default === "uuid" ? crypto.randomUUID() : c.default === "now" ? new Date().toISOString() : c.default !== undefined ? structuredClone(c.default) : null;
            return row;
          });
          for (const r of rows) { validate(table, r); data[table].push(r); }
        } else if (st.op === "update") {
          rows = data[table].filter(match);
          const patch = Object.fromEntries(Object.entries(st.payload).map(([k, v]) => [k, cast(table, k, v)]));
          for (const r of rows) { validate(table, { ...r, ...patch }, r.id); Object.assign(r, patch); }
        } else if (st.op === "delete") {
          rows = data[table].filter(match);
          deleteRows(table, rows);
        } else {
          rows = data[table].filter(match);
          if (st.order) rows = [...rows].sort((a, z) => (String(a[st.order]) < String(z[st.order]) ? -1 : 1));
          const [a, z] = st.range || [0, Infinity];
          rows = rows.slice(a, Math.min(z + 1, a + maxRows));
          if (st.limit != null) rows = rows.slice(0, st.limit);
        }
        const out = JSON.parse(JSON.stringify(rows));
        if (st.single) return out.length === 1 ? { data: out[0], error: null } : err("JSON object requested, multiple (or no) rows returned");
        return { data: st.op === "select" || st.returning ? out : null, error: null };
      } catch (e) { return err(e.message); }
    }
    return b;
  }
  return { from: builder, data, calls, schema, auth: { admin: {} } };
}

export const loadSchema = () => fs.readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");
