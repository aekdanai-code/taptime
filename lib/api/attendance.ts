/**********************************************************************
 * attendance.ts — พอร์ตจาก Attendance.gs
 *   - รายการลงเวลาแต่ละวัน
 *   - Admin ลงเวลาแทน / แก้เวลาออก
 *   - แกนคำนวณมาสาย / OT / ชั่วโมงงาน (ใช้ร่วมกับฝั่งพนักงาน)
 **********************************************************************/
import {
  T, readObjects, findOne, appendObject, updateByKey,
} from '../db';
import {
  uid, today, nowHHMM, toMinutes, normalizeAtt, normalizeBranch, asDateStr,
} from '../helpers';

/** ดึงข้อมูลสาขาตาม id (normalize เวลาเป็น string แล้ว) */
export async function getBranch(branchId: string): Promise<any> {
  const b = await findOne(T.BRANCHES, 'branchId', branchId);
  return normalizeBranch(b || {});
}

/** หา record การลงเวลาของพนักงานในวันที่กำหนด */
export async function attendanceOf(empId: string, date: string) {
  const rows = await readObjects(T.ATTENDANCE, { empId, date });
  return rows[0] || null;
}

/** รายการลงเวลาของวัน */
export async function listAttendance(date?: string, branchId?: string) {
  const d = date || today();
  const filter: any = { date: d };
  if (branchId) filter.branchId = branchId;
  const rows = await readObjects(T.ATTENDANCE, filter);
  return rows.map(normalizeAtt);
}

/** Admin ลงเวลาเข้าแทนพนักงาน */
export async function manualCheckIn(
  empId: string, date?: string, time?: string, dayType?: string
) {
  const emp = await findOne(T.PROFILES, 'empId', empId);
  if (!emp) throw new Error('ไม่พบพนักงาน');
  return writeCheckIn(
    emp, date || today(), time || nowHHMM(), dayType || 'วันปกติ', null, null
  );
}

/** Admin ลงเวลาออกแทนพนักงาน */
export async function manualCheckOut(empId: string, date?: string, time?: string) {
  const att = await attendanceOf(empId, date || today());
  if (!att) throw new Error('ยังไม่มีการเช็คอินของวันนี้');
  return writeCheckOut(att, time || nowHHMM());
}

/** แก้ไขเวลาออกงานของ record */
export async function editCheckOut(recId: string, time: string) {
  const att = await findOne(T.ATTENDANCE, 'recId', recId);
  if (!att) throw new Error('ไม่พบรายการ');
  return writeCheckOut(att, time);
}

/* ================= แกนคำนวณเวลา ================= */

/**
 * เขียน/อัปเดตการเช็คอิน + คำนวณมาสาย
 *   startMin    = toMinutes(branch.workStart || '08:00')
 *   lateMinutes = max(0, inMin - startMin)
 *   status      = lateMinutes > lateThreshold ? 'late' : 'ontime'
 */
export async function writeCheckIn(
  emp: any, date: string, time: string, dayType: string,
  lat: any, lng: any
) {
  const branch = await getBranch(emp.branchId);
  const startMin = toMinutes(branch.workStart || '08:00') ?? 480;
  const inMin = toMinutes(time) ?? 0;
  const threshold = Number(branch.lateThreshold || 0);
  const lateMinutes = Math.max(0, inMin - startMin);
  const status = lateMinutes > threshold ? 'late' : 'ontime';

  const existing = await attendanceOf(emp.empId, date);

  const patch: any = {
    recId: existing ? existing.recId : uid('AT-'),
    empId: emp.empId,
    empName: emp.name,
    branchId: emp.branchId,
    date,
    checkInTime: time,
    lateMinutes,
    dayType,
    status,
    checkInLat: lat === '' || lat == null ? null : Number(lat),
    checkInLng: lng === '' || lng == null ? null : Number(lng),
  };

  if (existing) await updateByKey(T.ATTENDANCE, 'recId', existing.recId, patch);
  else await appendObject(T.ATTENDANCE, patch);
  return patch;
}

/**
 * เขียนเวลาออก + คำนวณ OT และชั่วโมงงาน
 *   otMinutes = max(0, outMin - endMin)
 *   workHours = max(0, (outMin - inMin)/60 - breakHours)   ปัด 2 ตำแหน่ง
 */
export async function writeCheckOut(att: any, time: string) {
  const branch = await getBranch(att.branchId);
  const endMin = toMinutes(branch.workEnd || '17:00') ?? 1020;
  const outMin = toMinutes(time) ?? 0;
  const inMin = toMinutes(att.checkInTime);
  const breakH = Number(branch.breakHours || 0);

  const otMinutes = Math.max(0, outMin - endMin);
  const workHoursRaw =
    inMin != null ? Math.max(0, (outMin - inMin) / 60 - breakH) : null;
  const workHours =
    workHoursRaw == null ? null : Math.round(workHoursRaw * 100) / 100;

  await updateByKey(T.ATTENDANCE, 'recId', att.recId, {
    checkOutTime: time,
    otMinutes,
    workHours,
  });

  return {
    recId: att.recId,
    checkOutTime: time,
    otMinutes,
    workHours: workHours == null ? '' : workHours,
  };
}

export { asDateStr };
