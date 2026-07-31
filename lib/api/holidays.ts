/**********************************************************************
 * holidays.ts — พอร์ตจาก Holidays.gs
 *   วันหยุดราชการ + วันหยุดประจำสัปดาห์ + การจัดประเภทวัน
 **********************************************************************/
import { T, readObjects, findOne, updateByKey, appendObject, deleteByKey } from '../db';
import { uid, asDateStr, dayOfWeek, normalizeHoliday } from '../helpers';
import { getConfig, setConfig } from './config';

export type DayType = { type: 'holiday' | 'weekend' | 'work'; name: string };

/** รายการวันหยุดราชการทั้งหมด (เรียงตามวันที่) */
export async function listHolidays() {
  const rows = (await readObjects(T.HOLIDAYS)).map(normalizeHoliday);
  rows.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
  return rows;
}

/** เพิ่ม/แก้ไขวันหยุดราชการ */
export async function saveHoliday(h: any) {
  h = { ...h };
  if (h.holidayId) {
    const found = await findOne(T.HOLIDAYS, 'holidayId', h.holidayId);
    if (found) {
      await updateByKey(T.HOLIDAYS, 'holidayId', h.holidayId, h);
      return h.holidayId;
    }
  }
  h.holidayId = uid('HD-');
  await appendObject(T.HOLIDAYS, h);
  return h.holidayId;
}

export async function deleteHoliday(holidayId: string) {
  return deleteByKey(T.HOLIDAYS, 'holidayId', holidayId);
}

/** ตั้งค่าวันหยุดประจำสัปดาห์ (CSV เช่น "0,6") */
export async function saveWeeklyOff(csv: string) {
  await setConfig('weeklyOff', csv || '');
  return true;
}

/* ---------- ตัวช่วย (ภายใน) ---------- */

/** map { 'yyyy-MM-dd': ชื่อวันหยุด } */
export async function holidayMap(): Promise<Record<string, string>> {
  const m: Record<string, string> = {};
  const rows = await readObjects(T.HOLIDAYS);
  rows.forEach((h: any) => {
    m[asDateStr(h.date)] = h.name;
  });
  return m;
}

/** array เลขวันในสัปดาห์ที่หยุด (0=อาทิตย์ .. 6=เสาร์) */
export async function weeklyOffArr(): Promise<number[]> {
  const cfg = await getConfig();
  let v = cfg.weeklyOff;
  v = v === undefined || v === null ? '' : String(v);
  return v
    .split(',')
    .filter((x: string) => x !== '')
    .map((x: string) => parseInt(x, 10))
    .filter((n: number) => Number.isFinite(n));
}

/** ประเภทของวัน — ต้องส่ง hmap/woff เข้ามาเพื่อไม่ query ซ้ำ */
export function dayTypeOf(
  dateStr: string,
  hmap: Record<string, string>,
  woff: number[]
): DayType {
  if (hmap[dateStr]) return { type: 'holiday', name: hmap[dateStr] };
  const wd = dayOfWeek(dateStr);
  if (woff.indexOf(wd) !== -1)
    return { type: 'weekend', name: 'วันหยุดประจำสัปดาห์' };
  return { type: 'work', name: '' };
}
