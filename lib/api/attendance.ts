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
  computeWorkHours,
} from '../helpers';
import { holidayMap, weeklyOffArr, dayTypeOf } from './holidays';
import {
  activePolicy, computeOt, usedMinutes, OtDayType,
} from './overtime';

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
 * ประเภทวันสำหรับการคิด OT
 *
 * คำนวณสด ๆ จากวันที่ของแถวเสมอ ไม่เชื่อค่าที่บันทึกไว้ตอนเช็คอิน
 * เพราะแอดมินคีย์ย้อนหลัง / อนุมัติคำขอแก้เวลา ก็ต้องได้ประเภทวันที่ถูกต้อง
 */
export async function otDayTypeOf(dateStr: string): Promise<OtDayType> {
  const [hmap, woff] = await Promise.all([holidayMap(), weeklyOffArr()]);
  const t = dayTypeOf(asDateStr(dateStr), hmap, woff).type;
  return t === 'work' ? 'workday' : (t as OtDayType);
}

/** นาที OT ที่ได้รับอนุมัติล่วงหน้าของวันนั้น (ใช้กับโหมด request_before) */
async function approvedOtMinutes(empId: string, dateStr: string): Promise<number> {
  try {
    const rows = await readObjects(T.OTREQUESTS, { empId, date: dateStr });
    return (rows as any[])
      .filter((r) => String(r.status) === 'approved')
      .reduce((s, r) => {
        const v = r.minutesApproved == null ? r.minutesRequested : r.minutesApproved;
        return s + Math.max(0, Number(v) || 0);
      }, 0);
  } catch {
    // ยังไม่ได้รัน migration-005 — ถือว่ายังไม่มีใบอนุมัติ
    return 0;
  }
}

/**
 * เขียนเวลาออก + คำนวณ OT และชั่วโมงงาน
 *
 * **ชั่วโมงงานกับ OT ต้องไม่นับซ้ำกัน** — ยึดสมการนี้เสมอ
 *
 *     workHours + otMinutes/60  =  (เวลาออก − เวลาเข้า) − เวลาพัก
 *
 * จึงหัก "นาที OT ที่นับได้" ออกจาก workHours (ไม่ใช่ตัดที่ workEnd ตรง ๆ
 * เพราะถ้าตัดตรง ๆ แล้วทำเกิน 20 นาทีแต่ขั้นต่ำ OT คือ 30 นาที
 * เวลา 20 นาทีนั้นจะหายไปจากทั้งสองช่องโดยไม่มีใครรู้)
 *
 * หมายเหตุ: หักเวลาพักเมื่อทำงานถึงเกณฑ์ `breakAfterHours` เท่านั้น
 */
export async function writeCheckOut(att: any, time: string) {
  const branch = await getBranch(att.branchId);
  const startMin = toMinutes(branch.workStart || '08:00') ?? 480;
  const endMin = toMinutes(branch.workEnd || '17:00') ?? 1020;
  const outMin = toMinutes(time) ?? 0;
  const inMin = toMinutes(att.checkInTime);
  const dateStr = asDateStr(att.date);

  const [policy, dayType] = await Promise.all([
    activePolicy(),
    otDayTypeOf(dateStr),
  ]);

  const approvedMinutes =
    policy.mode === 'request_before'
      ? await approvedOtMinutes(att.empId, dateStr)
      : 0;

  // ไม่ได้ตั้งเพดานสัปดาห์/เดือน -> ฟังก์ชันนี้จะไม่ยิงฐานข้อมูลเลย
  const used = await usedMinutes(att.empId, dateStr, policy, att.recId);

  const ot = computeOt({
    checkInMin: inMin == null ? NaN : inMin,
    checkOutMin: outMin,
    workStartMin: startMin,
    workEndMin: endMin,
    dayType,
    policy,
    approvedMinutes,
    usedThisWeek: used.week,
    usedThisMonth: used.month,
  });

  let workHours: number | null = null;
  if (inMin != null) {
    const net = computeWorkHours(
      outMin - inMin,
      Number(branch.breakHours || 0),
      branch.breakAfterHours
    ).net;
    workHours = Math.round(Math.max(0, net - ot.countable / 60) * 100) / 100;
  }

  /* โหมด request_after — ต้องมีใบให้แอดมินกดอนุมัติ
   *
   * เรียกทุกครั้งแม้ OT จะเป็น 0 เพราะถ้าแอดมินอนุมัติคำขอแก้เวลาให้ย้อนกลับ
   * จนไม่มี OT แล้ว ใบที่ระบบเคยสร้างต้องถูกยกเลิกตามไปด้วย
   * ไม่งั้นจะมีใบค้างรออนุมัติทั้งที่ไม่มี OT จริง
   *
   * import แบบ dynamic เพื่อตัดวงจร import (otRequests เรียก attendanceOf กลับมา)
   */
  let otRequestId: string | null = null;
  if (policy.mode === 'request_after' && inMin != null) {
    try {
      const { syncSystemOtRequest } = await import('./otRequests');
      otRequestId = await syncSystemOtRequest({
        emp: { empId: att.empId, name: att.empName, branchId: att.branchId },
        date: dateStr,
        kind: ot.before > 0 && ot.after === 0 ? 'before_shift' : 'after_shift',
        dayType,
        minutes: ot.countable,
        actualStart: att.checkInTime || '',
        actualEnd: time,
        policyId: policy.policyId,
      });
    } catch (e) {
      // สร้างใบไม่สำเร็จต้องไม่ทำให้เช็คเอาท์ล้มเหลว — แถวลงเวลายังขึ้น pending อยู่ดี
      console.error('[syncSystemOtRequest]', (e as any)?.message || e);
    }
  }

  const patch: any = {
    checkOutTime: time,
    otMinutes: ot.countable,
    otMinutesRaw: ot.raw,
    otBeforeMinutes: ot.before,
    otAfterMinutes: ot.after,
    otDayType: dayType,
    otStatus: ot.status,
    otPolicyId: policy.policyId,
    otRequestId,
    otNote: ot.note || null,
    workHours,
  };

  await updateByKey(T.ATTENDANCE, 'recId', att.recId, patch);

  return {
    recId: att.recId,
    checkOutTime: time,
    otMinutes: ot.countable,
    otMinutesRaw: ot.raw,
    otStatus: ot.status,
    otDayType: dayType,
    otRequestId,
    otNote: ot.note || '',
    workHours: workHours == null ? '' : workHours,
  };
}

export { asDateStr };
