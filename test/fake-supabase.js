/**
 * fake-supabase.js — ฐานข้อมูลจำลองในหน่วยความจำ (สำหรับ test เท่านั้น)
 * เลียนแบบ API ของ @supabase/supabase-js เท่าที่ lib/db.ts ใช้จริง
 */
'use strict';

function makeDb(seed) {
  const data = JSON.parse(JSON.stringify(seed));

  function builder(table) {
    let rows = () => data[table] || (data[table] = []);
    let mode = 'select';
    let filters = [];
    let payload = null;
    let limitN = null;
    let returning = false;

    const match = (r) =>
      filters.every((f) => {
        const v = r[f.k];
        if (f.op === 'eq') return String(v) === String(f.v);
        if (f.op === 'gte') return String(v) >= String(f.v);
        if (f.op === 'lte') return String(v) <= String(f.v);
        return true;
      });

    const exec = () => {
      try {
        if (mode === 'select') {
          let out = rows().filter(match);
          if (limitN != null) out = out.slice(0, limitN);
          return { data: out.map((r) => ({ ...r })), error: null };
        }
        if (mode === 'insert') {
          const arr = Array.isArray(payload) ? payload : [payload];
          arr.forEach((r) => rows().push({ ...r }));
          return { data: arr, error: null };
        }
        if (mode === 'update') {
          const hit = rows().filter(match);
          hit.forEach((r) => Object.assign(r, payload));
          return { data: hit, error: null };
        }
        if (mode === 'delete') {
          const keep = [];
          const gone = [];
          rows().forEach((r) => (match(r) ? gone : keep).push(r));
          data[table] = keep;
          return { data: gone, error: null };
        }
        if (mode === 'upsert') {
          const arr = Array.isArray(payload) ? payload : [payload];
          arr.forEach((r) => {
            const pk = Object.keys(r)[0];
            const cur = rows().find((x) => x[pk] === r[pk]);
            if (cur) Object.assign(cur, r);
            else rows().push({ ...r });
          });
          return { data: arr, error: null };
        }
        return { data: null, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    };

    const api = {
      select(_cols) { if (mode === 'select') mode = 'select'; else returning = true; return api; },
      eq(k, v) { filters.push({ op: 'eq', k, v }); return api; },
      gte(k, v) { filters.push({ op: 'gte', k, v }); return api; },
      lte(k, v) { filters.push({ op: 'lte', k, v }); return api; },
      limit(n) { limitN = n; return api; },
      maybeSingle() {
        const r = exec();
        return Promise.resolve({ data: r.data && r.data[0] ? r.data[0] : null, error: r.error });
      },
      single() { return api.maybeSingle(); },
      insert(p) { mode = 'insert'; payload = p; return api; },
      upsert(p) { mode = 'upsert'; payload = p; return api; },
      update(p) { mode = 'update'; payload = p; return api; },
      delete() { mode = 'delete'; return api; },
      then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
    };
    return api;
  }

  return {
    _data: data,
    from: (t) => builder(t),
    auth: {
      admin: {
        createUser: async () => ({ data: { user: { id: 'fake-uuid' } }, error: null }),
        updateUserById: async () => ({ data: {}, error: null }),
        deleteUser: async () => ({ error: null }),
      },
      signInWithPassword: async () => ({ data: null, error: { message: 'not implemented' } }),
    },
  };
}

module.exports = { makeDb };
