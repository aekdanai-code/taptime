/**********************************************************************
 * overtime.ts — แกนคำนวณ OT
 *
 * `computeOt()` เป็นฟังก์ชัน **บริสุทธิ์ (pure)** ไม่แตะฐานข้อมูล
 * ทดสอบได้ตรง ๆ และหน้าเว็บฝั่งแอดมินใช้สูตรเดียวกันทำกล่องพรีวิวสด
 *
 * ข้อจำกัดที่ตั้งใจ: **ไม่รองรับ OT ข้ามเที่ยงคืน**
 *   ระบบยึด "1 คน 1 แถวต่อวัน" และเก็บเวลาเป็น 'HH:mm' ภายในวันเดียว
 *   ถ้าเวลาออก <= เวลาเข้า = ข้อมูลผิด -> คืน 0 พร้อม note
 *   ห้ามเดา +1440 นาที เพราะจะทำให้ข้อมูลผิดโดยไม่มีใครรู้
 **********************************************************************/
import { T, readObjects, findOne, appendObject, updateByKey } from '../db';
import { toMinutes, dayOfWeek, uid, nowStamp } from '../helpers';

export type OtMode =
  | 'off' | 'auto' | 'request_after' | 'request_before' | 'admin_only';

export type OtDayType = 'workday' | 'weekend' | 'holiday';

export type OtPolicy = {
  policyId: string;
  name?: string;
  isActive?: boolean;
  mode: OtMode;

  countAfterShift: boolean;
  countBeforeShift: boolean;
  graceMinutes: number;
  beforeShiftGraceMinutes: number;
  minMinutes: number;
  roundMinutes: number;
  roundMode: 'down' | 'nearest' | 'up';
  otBreakMinutes: number;
  otBreakAfterMinutes: number;

  maxPerDayMinutes: number;
  maxPerWeekMinutes: number;
  maxPerMonthMinutes: number;

  allowHolidayWork: boolean;
  holidayNeedsRequest: boolean;
  holidayCountsAllHours: boolean;
};

export type OtResult = {
  raw: number;        // นาทีดิบ (ก่อนหักพัก/ปัดเศษ/เพดาน)
  before: number;     // ส่วนก่อนเข้างาน
  after: number;      // ส่วนหลังเลิกงาน
  countable: number;  // นาทีที่นับได้จริง
  status: 'none' | 'pending' | 'approved';
  note?: string;      // เหตุผลกรณีไม่นับ
};

/** ค่าเริ่มต้น — ใช้เมื่อยังไม่มีแถวนโยบายในฐานข้อมูล */
export const DEFAULT_POLICY: OtPolicy = {
  policyId: 'OTP-default',
  name: 'นโยบาย OT เริ่มต้น',
  isActive: true,
  mode: 'request_after',
  countAfterShift: true,
  countBeforeShift: false,
  graceMinutes: 15,
  beforeShiftGraceMinutes: 15,
  minMinutes: 30,
  roundMinutes: 30,
  roundMode: 'down',
  otBreakMinutes: 0,
  otBreakAfterMinutes: 240,
  maxPerDayMinutes: 240,
  maxPerWeekMinutes: 0,
  maxPerMonthMinutes: 0,
  allowHolidayWork: true,
  holidayNeedsRequest: true,
  holidayCountsAllHours: true,
};

const MODES: OtMode[] =
  ['off', 'auto', 'request_after', 'request_before', 'admin_only'];

const int = (v: any, dflt = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : dflt;
};
const bool = (v: any, dflt = false) =>
  v === true || v === 'true' || v === 1 || v === '1'
    ? true
    : v === false || v === 'false' || v === 0 || v === '0'
      ? false
      : dflt;

/**
 * แปลงแถวจากฐานข้อมูล (หรือ payload จากฟอร์ม) ให้เป็น OtPolicy ที่ชนิดถูกต้อง
 * Supabase คืน numeric เป็น string ได้ และฟอร์มส่ง checkbox มาเป็น string
 */
export function normalizePolicy(row: any): OtPolicy {
  const r = row || {};
  const d = DEFAULT_POLICY;
  const mode = MODES.indexOf(r.mode) >= 0 ? (r.mode as OtMode) : d.mode;
  const roundMode =
    ['down', 'nearest', 'up'].indexOf(r.roundMode) >= 0
      ? (r.roundMode as OtPolicy['roundMode'])
      : d.roundMode;

  return {
    policyId: String(r.policyId || d.policyId),
    name: r.name || d.name,
    isActive: bool(r.isActive, false),
    mode,
    countAfterShift: bool(r.countAfterShift, d.countAfterShift),
    countBeforeShift: bool(r.countBeforeShift, d.countBeforeShift),
    graceMinutes: Math.max(0, int(r.graceMinutes, d.graceMinutes)),
    beforeShiftGraceMinutes:
      Math.max(0, int(r.beforeShiftGraceMinutes, d.beforeShiftGraceMinutes)),
    minMinutes: Math.max(0, int(r.minMinutes, d.minMinutes)),
    roundMinutes: Math.max(0, int(r.roundMinutes, d.roundMinutes)),
    roundMode,
    otBreakMinutes: Math.max(0, int(r.otBreakMinutes, d.otBreakMinutes)),
    otBreakAfterMinutes:
      Math.max(0, int(r.otBreakAfterMinutes, d.otBreakAfterMinutes)),
    maxPerDayMinutes: Math.max(0, int(r.maxPerDayMinutes, d.maxPerDayMinutes)),
    maxPerWeekMinutes: Math.max(0, int(r.maxPerWeekMinutes, d.maxPerWeekMinutes)),
    maxPerMonthMinutes:
      Math.max(0, int(r.maxPerMonthMinutes, d.maxPerMonthMinutes)),
    allowHolidayWork: bool(r.allowHolidayWork, d.allowHolidayWork),
    holidayNeedsRequest: bool(r.holidayNeedsRequest, d.holidayNeedsRequest),
    holidayCountsAllHours:
      bool(r.holidayCountsAllHours, d.holidayCountsAllHours),
  };
}

/**
 * คำนวณ OT — ลำดับขั้นห้ามสลับ
 *
 *   0    ปิดระบบ
 *   0.5  กันข้ามเที่ยงคืน
 *   1    เวลาดิบ (แยกวันทำงาน / วันหยุด)
 *   2    หักพักระหว่าง OT
 *   3    ปัดเศษ
 *   4    ขั้นต่ำ (ตัดทั้งก้อน ไม่ใช่ตัดเศษ)
 *   5    เพดาน วัน -> สัปดาห์ -> เดือน
 *   6    แยกตามโหมด
 */
export function computeOt(input: {
  checkInMin: number;
  checkOutMin: number;
  workStartMin: number;
  workEndMin: number;
  dayType: OtDayType;
  policy: OtPolicy;
  approvedMinutes?: number;
  usedThisWeek?: number;
  usedThisMonth?: number;
}): OtResult {
  const { policy, dayType } = input;
  const zero: OtResult = {
    raw: 0, before: 0, after: 0, countable: 0, status: 'none',
  };

  /* ---- 0. ปิดระบบ ---- */
  if (policy.mode === 'off') return zero;

  /* ---- 0.5 กันข้ามเที่ยงคืน ----
   * เวลาออกต้องอยู่หลังเวลาเข้าภายในวันเดียวกัน ไม่งั้นถือว่าข้อมูลผิด
   */
  if (
    !Number.isFinite(input.checkInMin) ||
    !Number.isFinite(input.checkOutMin) ||
    input.checkOutMin <= input.checkInMin
  ) {
    return { ...zero, note: 'cross_midnight_unsupported' };
  }

  /* ---- 1. เวลาดิบ ---- */
  let before = 0;
  let after = 0;

  if (dayType !== 'workday' && policy.holidayCountsAllHours) {
    // วันหยุด + นับทั้งวัน -> ทุกนาทีที่อยู่คือ OT
    after = input.checkOutMin - input.checkInMin;
  } else {
    if (policy.countAfterShift) {
      const d = input.checkOutMin - input.workEndMin;
      // ต้อง "เกิน" grace ไม่ใช่ "เท่ากับ"
      if (d > policy.graceMinutes) after = d;
    }
    if (policy.countBeforeShift) {
      const d = input.workStartMin - input.checkInMin;
      if (d > policy.beforeShiftGraceMinutes) before = d;
    }
  }

  const raw = Math.max(0, before + after);

  /* ---- 2. หักพักระหว่าง OT ---- */
  let m = raw;
  if (policy.otBreakMinutes > 0 && m >= policy.otBreakAfterMinutes) {
    m = Math.max(0, m - policy.otBreakMinutes);
  }

  /* ---- 3. ปัดเศษ ---- */
  const r = policy.roundMinutes;
  if (r > 0) {
    m = policy.roundMode === 'up'
      ? Math.ceil(m / r) * r
      : policy.roundMode === 'nearest'
        ? Math.round(m / r) * r
        : Math.floor(m / r) * r;
  }

  /* ---- 4. ขั้นต่ำ — ไม่ถึงเกณฑ์ตัดทั้งก้อน ---- */
  if (m < policy.minMinutes) m = 0;

  /* ---- 5. เพดาน (0 = ไม่จำกัด) ---- */
  if (policy.maxPerDayMinutes > 0) m = Math.min(m, policy.maxPerDayMinutes);
  if (policy.maxPerWeekMinutes > 0) {
    m = Math.min(
      m,
      Math.max(0, policy.maxPerWeekMinutes - Math.max(0, input.usedThisWeek || 0))
    );
  }
  if (policy.maxPerMonthMinutes > 0) {
    m = Math.min(
      m,
      Math.max(0, policy.maxPerMonthMinutes - Math.max(0, input.usedThisMonth || 0))
    );
  }

  /* ---- 6. แยกตามโหมด ---- */
  switch (policy.mode) {
    case 'auto':
      return {
        raw, before, after, countable: m,
        status: m > 0 ? 'approved' : 'none',
      };

    case 'request_after':
      return {
        raw, before, after, countable: m,
        status: m > 0 ? 'pending' : 'none',
      };

    case 'request_before': {
      // ทำเกินใบที่ขอไว้ -> นับได้แค่เท่าที่อนุมัติ
      const allowed = Math.min(m, Math.max(0, input.approvedMinutes || 0));
      return {
        raw, before, after, countable: allowed,
        status: allowed > 0 ? 'approved' : 'none',
        note: m > 0 && allowed < m ? 'capped_by_request' : undefined,
      };
    }

    case 'admin_only':
    default:
      // พนักงานยื่นไม่ได้ ระบบไม่นับให้เอง — แอดมินคีย์ผ่าน adminCreateOt
      return {
        raw, before, after, countable: 0, status: 'none',
        note: raw > 0 ? 'admin_only' : undefined,
      };
  }
}

/* ==================== ตัวช่วยฝั่งฐานข้อมูล ==================== */

/** นโยบายที่ใช้งานอยู่ (คืนค่าเริ่มต้นถ้ายังไม่ได้รันไมเกรชัน/ยังไม่มีแถว) */
export async function activePolicy(): Promise<OtPolicy> {
  try {
    const rows = await readObjects(T.OTPOLICIES, { isActive: true });
    if (rows && rows.length) return normalizePolicy(rows[0]);
    const any = await findOne(T.OTPOLICIES, 'policyId', 'OTP-default');
    if (any) return normalizePolicy(any);
  } catch {
    /* ยังไม่ได้รัน migration-005 — ใช้ค่าเริ่มต้นไปก่อน ไม่ทำให้เช็คเอาท์พัง */
  }
  return { ...DEFAULT_POLICY };
}

/**
 * ขอบเขตสัปดาห์แบบ **จันทร์–อาทิตย์** (มาตรฐาน ISO ตรงกับกฎหมายแรงงานไทย)
 * @returns ['yyyy-MM-dd' วันจันทร์, 'yyyy-MM-dd' วันอาทิตย์]
 */
export function weekRange(dateStr: string): [string, string] {
  const dow = dayOfWeek(dateStr);          // 0 = อาทิตย์ .. 6 = เสาร์
  const backToMon = dow === 0 ? 6 : dow - 1;
  const t = Date.parse(dateStr + 'T00:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return [iso(t - backToMon * 86400000), iso(t + (6 - backToMon) * 86400000)];
}

/**
 * นาที OT ที่ใช้ไปแล้วในสัปดาห์/เดือนของวันนั้น (ไม่รวมแถวของวันนั้นเอง)
 *
 * นับทั้ง `approved` และ `pending` — ถ้านับแค่ approved พนักงานจะทำทะลุเพดาน
 * ไปได้เรื่อย ๆ ระหว่างที่ใบยังค้างรออนุมัติ
 *
 * ถ้าไม่ได้ตั้งเพดานทั้งสัปดาห์และเดือน จะ **ไม่ยิงฐานข้อมูลเลย**
 */
export async function usedMinutes(
  empId: string,
  dateStr: string,
  policy: OtPolicy,
  excludeRecId?: string
): Promise<{ week: number; month: number }> {
  const needWeek = policy.maxPerWeekMinutes > 0;
  const needMonth = policy.maxPerMonthMinutes > 0;
  if (!needWeek && !needMonth) return { week: 0, month: 0 };

  const rows = await readObjects(T.ATTENDANCE, { empId });
  const [wStart, wEnd] = weekRange(dateStr);
  const ym = String(dateStr).slice(0, 7);

  let week = 0;
  let month = 0;
  for (const a of rows as any[]) {
    if (excludeRecId && a.recId === excludeRecId) continue;
    const d = String(a.date || '').slice(0, 10);
    if (!d || d === dateStr) continue;
    const st = String(a.otStatus || 'none');
    if (st !== 'approved' && st !== 'pending') continue;
    const min = Math.max(0, Number(a.otMinutes) || 0);
    if (needWeek && d >= wStart && d <= wEnd) week += min;
    if (needMonth && d.slice(0, 7) === ym) month += min;
  }
  return { week, month };
}

/* ==================== RPC ฝั่งแอดมิน ==================== */

/** อ่านนโยบายที่ใช้งานอยู่ */
export async function getOtPolicy() {
  return activePolicy();
}

/**
 * บันทึกนโยบาย — **สร้างแถวใหม่เสมอ ไม่ทับของเก่า**
 *
 * ข้อมูลย้อนหลังอ้าง `otPolicyId` ของตัวเองอยู่ ถ้าทับแถวเดิมกฎที่เคยใช้จะหาย
 * ทำให้ตรวจสอบย้อนหลังไม่ได้ว่าตอนนั้นคิดด้วยกฎอะไร
 */
export async function saveOtPolicy(payload: any) {
  const p = normalizePolicy({ ...(payload || {}), policyId: 'x' });

  // ปิดแถวที่ active อยู่ก่อน (unique index อนุญาต isActive = true ได้แถวเดียว)
  await updateByKey(T.OTPOLICIES, 'isActive', true, { isActive: false });

  const row = {
    ...p,
    policyId: uid('OTP-'),
    name: (payload && payload.name) || 'นโยบาย OT',
    isActive: true,
    updatedAt: new Date().toISOString(),
    updatedBy: (payload && payload.updatedBy) || null,
  };
  await appendObject(T.OTPOLICIES, row);
  return normalizePolicy(row);
}

/**
 * ข้อมูลที่หน้าพนักงานต้องรู้เกี่ยวกับ OT
 * **ห้ามส่งฟิลด์เกี่ยวกับเงินไปฝั่งพนักงานเด็ดขาด**
 */
export function employeeOtView(p: OtPolicy) {
  return {
    mode: p.mode,
    allowHolidayWork: p.allowHolidayWork,
    holidayNeedsRequest: p.holidayNeedsRequest,
    holidayCountsAllHours: p.holidayCountsAllHours,
    canRequest: p.mode === 'request_before' || p.mode === 'request_after',
    enabled: p.mode !== 'off',
  };
}

/** 'HH:mm' -> นาที (คืน null ถ้าแปลงไม่ได้) — ห่อไว้ให้ import ที่เดียว */
export { toMinutes, nowStamp };
