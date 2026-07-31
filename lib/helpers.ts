/**********************************************************************
 * helpers.ts — พอร์ตจาก Helpers.gs
 *   - ตัวช่วยเวลา (โซน Asia/Bangkok)
 *   - normalize ค่าวันที่/เวลา
 *   - คำนวณระยะทาง GPS (Haversine)
 *   - uid()
 *
 * หมายเหตุ: Postgres คืนค่าคอลัมน์ date เป็น 'yyyy-MM-dd' และเวลาเราเก็บเป็น
 * text 'HH:mm' อยู่แล้ว จึงแทบไม่ต้องแก้ Date เหมือนตอนใช้ Google Sheets
 * แต่ยังคง asDateStr/asHHMM ไว้เพื่อความเข้ากันได้และกันค่าแปลกปลอม
 **********************************************************************/
import { randomUUID } from 'crypto';

export const TZ = 'Asia/Bangkok';

/* ---------- uid ---------- */
export function uid(prefix = '') {
  return prefix + randomUUID().substring(0, 8);
}

/* ---------- เวลาโซนไทย ---------- */
function bkk(d: Date = new Date()) {
  // en-CA -> 'YYYY-MM-DD', hourCycle h23 -> 00-23
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  if (p.hour === '24') p.hour = '00';
  return p;
}

/** 'yyyy-MM-dd' ของวันนี้ (โซนไทย) */
export function today(): string {
  const p = bkk();
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'HH:mm' ปัจจุบัน (โซนไทย) */
export function nowHHMM(): string {
  const p = bkk();
  return `${p.hour}:${p.minute}`;
}

/** 'yyyy-MM-dd HH:mm' ปัจจุบัน (โซนไทย) */
export function nowStamp(): string {
  return `${today()} ${nowHHMM()}`;
}

/** 'yyyy-MM' ของเดือนปัจจุบัน */
export function thisMonth(): string {
  return today().substring(0, 7);
}

/** 'yyyy' ของปีปัจจุบัน */
export function thisYear(): string {
  return today().substring(0, 4);
}

/* ---------- normalize ---------- */
/** แปลงค่าเป็น 'HH:mm' */
export function asHHMM(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const p = bkk(v);
    return `${p.hour}:${p.minute}`;
  }
  const s = String(v);
  // รองรับ 'HH:mm:ss' หรือ ISO string
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${('0' + m[1]).slice(-2)}:${m[2]}` : s;
}

/** แปลงค่าเป็น 'yyyy-MM-dd' */
export function asDateStr(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const p = bkk(v);
    return `${p.year}-${p.month}-${p.day}`;
  }
  return String(v).substring(0, 10);
}

/** number หรือ '' (ตามพฤติกรรมเดิมของชีต) */
export function num(v: any, dflt: number | '' = 0): number | '' {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/* ---------- normalizer ต่อชนิดข้อมูล (เหมือนสเปกเดิม) ---------- */
export function normalizeBranch(b: any) {
  if (!b) return b;
  b.workStart = asHHMM(b.workStart);
  b.workEnd = asHHMM(b.workEnd);
  return b;
}

export function normalizeEmp(e: any) {
  if (!e) return e;
  e.startDate = asDateStr(e.startDate);
  e.birthDate = asDateStr(e.birthDate);
  return e;
}

export function normalizeLeave(l: any) {
  if (!l) return l;
  l.startDate = asDateStr(l.startDate);
  l.endDate = asDateStr(l.endDate);
  return l;
}

export function normalizeAtt(a: any) {
  if (!a) return a;
  a.date = asDateStr(a.date);
  if (a.checkInTime !== '' && a.checkInTime != null)
    a.checkInTime = asHHMM(a.checkInTime);
  if (a.checkOutTime !== '' && a.checkOutTime != null)
    a.checkOutTime = asHHMM(a.checkOutTime);
  return a;
}

export function normalizeTimeEdit(t: any) {
  if (!t) return t;
  t.date = asDateStr(t.date);
  return t;
}

export function normalizeLeaveType(l: any) {
  if (!l) return l;
  l.expireDate = asDateStr(l.expireDate);
  return l;
}

export function normalizeHoliday(h: any) {
  if (!h) return h;
  h.date = asDateStr(h.date);
  return h;
}

/* ---------- ตัวช่วยเวลา ---------- */
/** 'HH:mm' -> นาทีนับจากเที่ยงคืน (null ถ้าว่าง) */
export function toMinutes(hhmm: any): number | null {
  if (hhmm == null || hhmm === '') return null;
  const s = asHHMM(hhmm);
  const p = s.split(':');
  const h = parseInt(p[0], 10);
  const m = parseInt(p[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * คำนวณชั่วโมงทำงานสุทธิ — สูตรกลางที่ใช้ร่วมกันทั้งเซิร์ฟเวอร์และตัวนับสด
 *
 * ปัญหาของสูตรเดิม: หักเวลาพักทุกกรณี
 *   ทำงาน 08:00-11:00 (3 ชม.) แต่ยังไม่ได้พักเลย -> ถูกหัก 1 ชม. เหลือ 2 ชม.
 *   ทำงาน 08:00-08:30 (0.5 ชม.) -> ติดลบ แล้วถูกตัดเป็น 0
 *
 * สูตรใหม่: หักเวลาพักเมื่อทำงาน "ถึงเกณฑ์" เท่านั้น
 *   breakAfterHours = 0 -> หักเสมอ (พฤติกรรมเดิม)
 *
 * @param grossMinutes นาทีดิบ (เวลาออก - เวลาเข้า)
 * @returns { gross, breakDeducted, net } หน่วยชั่วโมง (ปัดทศนิยม 2 ตำแหน่ง)
 */
export function computeWorkHours(
  grossMinutes: number,
  breakHours: number,
  breakAfterHours: number
) {
  const gross = Math.max(0, Number(grossMinutes) || 0) / 60;
  const brk = Math.max(0, Number(breakHours) || 0);
  // ไม่ได้ตั้งค่า (undefined/null) ให้ถือว่า 6 ชม. — ค่าเริ่มต้นของระบบ
  const after =
    breakAfterHours === null || breakAfterHours === undefined || breakAfterHours === ('' as any)
      ? 6
      : Math.max(0, Number(breakAfterHours) || 0);

  const shouldDeduct = brk > 0 && gross >= after;
  const net = shouldDeduct ? Math.max(0, gross - brk) : gross;

  return {
    gross: Math.round(gross * 100) / 100,
    breakDeducted: shouldDeduct ? brk : 0,
    net: Math.round(net * 100) / 100,
  };
}

/** ระยะทางระหว่างพิกัด 2 จุด (เมตร) — Haversine */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** สร้างรายการวันที่ 'yyyy-MM-dd' ตั้งแต่ start ถึง end (รวมปลายทั้งสอง) */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (d <= last) {
    out.push(d.toISOString().substring(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** วันในสัปดาห์ (0=อาทิตย์) ของ 'yyyy-MM-dd' */
export function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

/** วันสุดท้ายของเดือนจาก 'yyyy-MM' */
export function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().substring(0, 10);
}
