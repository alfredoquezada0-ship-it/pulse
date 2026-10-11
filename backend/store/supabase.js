// Supabase (PostgreSQL) store. Uses the service role key on the server only.
// Access control is enforced by the API router, so the browser never talks to these tables directly.
import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createSupabaseStore({ url, serviceKey, client = null }) {
  const db = client || createClient(url, serviceKey, { auth: { persistSession: false } });
  const apply = (q, where = {}) => {
    for (const [k, v] of Object.entries(where)) q = Array.isArray(v) ? q.in(k, v.length ? v : ["00000000-0000-0000-0000-000000000000"]) : v == null ? q.is(k, null) : q.eq(k, v);
    return q;
  };
  const check = ({ data, error }) => { if (error) throw new Error(`Database: ${error.message}`); return data; };
  return {
    kind: "supabase", client: db,
    // Supabase returns at most 1,000 rows per request, so page through; long "in" lists are split so the URL stays short.
    async list(table, where = {}) {
      const big = Object.entries(where).find(([, v]) => Array.isArray(v) && v.length > 150);
      if (big) {
        const [k, vals] = big, out = [];
        for (let i = 0; i < vals.length; i += 150) out.push(...(await this.list(table, { ...where, [k]: vals.slice(i, i + 150) })));
        return out;
      }
      const out = [];
      for (let from = 0; ; from += 1000) {
        const page = check(await apply(db.from(table).select("*"), where).order("id").range(from, from + 999));
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async get(table, id) {
      if (!id || !UUID.test(String(id))) return null; // an id from a demo or a bad link: not found, instead of a database error
      const r = check(await db.from(table).select("*").eq("id", id).limit(1)); return r[0] || null;
    },
    async insert(table, row) { return check(await db.from(table).insert(row).select().single()); },
    async insertMany(table, rows) { return rows.length ? check(await db.from(table).insert(rows).select()) : []; },
    async update(table, id, patch) { return check(await db.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single()); },
    async remove(table, id) { check(await db.from(table).delete().eq("id", id)); return true; },
    // Delete every row matching `where` (long "in" lists are split so the URL stays short).
    async removeWhere(table, where = {}) {
      const big = Object.entries(where).find(([, v]) => Array.isArray(v) && v.length > 150);
      if (big) { const [k, vals] = big; for (let i = 0; i < vals.length; i += 150) await this.removeWhere(table, { ...where, [k]: vals.slice(i, i + 150) }); return true; }
      if (Object.values(where).some((v) => Array.isArray(v) && !v.length)) return true;
      check(await apply(db.from(table).delete(), where));
      return true;
    },
  };
}
