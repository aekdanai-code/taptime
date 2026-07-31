/**********************************************************************
 * db.ts — ชั้นเข้าถึงฐานข้อมูล Supabase
 *
 * แทนที่ Helpers.gs เดิมในส่วน "เข้าถึงชีต":
 *   ss()/sheet()      -> supabaseAdmin
 *   readObjects(name) -> readObjects(table, filter?)
 *   appendObject      -> appendObject
 *   updateRow(row,..) -> updateByKey(table, key, value, patch)
 *   deleteByKey       -> deleteByKey
 *   findOne           -> findOne
 *
 * ทุก query วิ่งด้วย service_role key (ฝั่งเซิร์ฟเวอร์เท่านั้น) จึง bypass RLS
 **********************************************************************/
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/* ---------- ชื่อตาราง (แทน SHEETS เดิม) ---------- */
export const T = {
  CONFIG: 'config',
  BRANCHES: 'branches',
  POSITIONS: 'positions',
  LEAVETYPES: 'leave_types',
  PROFILES: 'profiles', // <- ชีต Employees เดิม
  ATTENDANCE: 'attendance',
  LEAVES: 'leave_requests',
  HOLIDAYS: 'holidays',
  TIMEEDITS: 'time_edit_requests',
  LEAVEASSIGN: 'leave_assignments',
  WEBAUTHN: 'webauthn_credentials',
  AUDIT: 'checkin_audit',
  NOTIFICATIONS: 'notifications',
} as const;

/* ---------- primary key ของแต่ละตาราง ---------- */
export const PK: Record<string, string> = {
  [T.CONFIG]: 'key',
  [T.BRANCHES]: 'branchId',
  [T.POSITIONS]: 'posId',
  [T.LEAVETYPES]: 'typeId',
  [T.PROFILES]: 'empId',
  [T.ATTENDANCE]: 'recId',
  [T.LEAVES]: 'reqId',
  [T.HOLIDAYS]: 'holidayId',
  [T.TIMEEDITS]: 'editId',
  [T.LEAVEASSIGN]: 'typeId',
  [T.WEBAUTHN]: 'credentialId',
  [T.AUDIT]: 'auditId',
  [T.NOTIFICATIONS]: 'notiId',
};

let _client: SupabaseClient | null = null;

/** client ฝั่งเซิร์ฟเวอร์ (service_role) */
export function supabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ในไฟล์ .env.local'
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/** client ฝั่งเซิร์ฟเวอร์ (anon) — ใช้ตอนตรวจ email/password ตอน login */
export function supabaseAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('ยังไม่ได้ตั้งค่า Supabase URL / ANON KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Filter = Record<string, any>;

function apply(q: any, filter?: Filter) {
  if (!filter) return q;
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    q = q.eq(k, v);
  }
  return q;
}

/** อ่านทั้งตารางเป็น array ของ object (เทียบเท่า readObjects ของ Apps Script) */
export async function readObjects<R = any>(
  table: string,
  filter?: Filter
): Promise<R[]> {
  const { data, error } = await apply(
    supabaseAdmin().from(table).select('*'),
    filter
  );
  if (error) throw new Error(error.message);
  return (data || []) as R[];
}

/** อ่านแบบระบุช่วงวันที่ (สำหรับรายงาน — เลี่ยงดึงทั้งตาราง) */
export async function readByDateRange<R = any>(
  table: string,
  column: string,
  start: string,
  end: string,
  filter?: Filter
): Promise<R[]> {
  const { data, error } = await apply(
    supabaseAdmin().from(table).select('*').gte(column, start).lte(column, end),
    filter
  );
  if (error) throw new Error(error.message);
  return (data || []) as R[];
}

/** เพิ่มแถวใหม่ */
export async function appendObject(table: string, obj: Record<string, any>) {
  const { error } = await supabaseAdmin().from(table).insert(clean(obj));
  if (error) throw new Error(error.message);
  return obj;
}

/** เพิ่มหรือทับตาม primary key */
export async function upsertObject(table: string, obj: Record<string, any>) {
  const { error } = await supabaseAdmin()
    .from(table)
    .upsert(clean(obj), { onConflict: PK[table] });
  if (error) throw new Error(error.message);
  return obj;
}

/** แก้ไขแถวตามคีย์ (แทน updateRow ที่เดิมอ้างเลขแถว) */
export async function updateByKey(
  table: string,
  key: string,
  value: any,
  patch: Record<string, any>
) {
  const { error } = await supabaseAdmin()
    .from(table)
    .update(clean(patch))
    .eq(key, value);
  if (error) throw new Error(error.message);
  return true;
}

/** ลบแถวตามคีย์ — คืน true ถ้าลบสำเร็จ */
export async function deleteByKey(table: string, key: string, value: any) {
  const { data, error } = await supabaseAdmin()
    .from(table)
    .delete()
    .eq(key, value)
    .select(key);
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

/** หาแถวเดียวตามคีย์ (คืน null ถ้าไม่พบ) */
export async function findOne<R = any>(
  table: string,
  key: string,
  value: any
): Promise<R | null> {
  const { data, error } = await supabaseAdmin()
    .from(table)
    .select('*')
    .eq(key, value)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as R) || null;
}

/**
 * ตัด key ที่เป็น undefined / '' ที่ไม่ควรเขียนทับ และแปลง '' ของคอลัมน์
 * ตัวเลข/วันที่ให้เป็น null (Postgres ไม่รับ '' สำหรับ numeric/date)
 */
const NUMERIC_COLS = new Set([
  'lat', 'lng', 'radius', 'breakHours', 'lateThreshold', 'earlyCheckinMin',
  'daysPerYear', 'advanceDays', 'salary', 'lateMinutes', 'otMinutes',
  'workHours', 'checkInLat', 'checkInLng', 'days', 'daysOverride',
  'breakAfterHours',
]);
const DATE_COLS = new Set([
  'date', 'startDate', 'endDate', 'birthDate', 'expireDate',
]);

function clean(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (k.startsWith('_')) continue; // _row เดิมจาก Apps Script
    if (v === '' && (NUMERIC_COLS.has(k) || DATE_COLS.has(k))) {
      out[k] = null;
    } else if (NUMERIC_COLS.has(k) && v !== null) {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : null;
    } else {
      out[k] = v;
    }
  }
  return out;
}
