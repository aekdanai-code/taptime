/**********************************************************************
 * timeEdits.ts — พอร์ตจาก TimeEdits.gs
 *   คำขอแก้เวลาเข้า-ออกงาน (เช่น ลืมเช็คเอาท์)
 *   flow: พนักงานยื่น -> แอดมินอนุมัติ/ปฏิเสธ
 *   อนุมัติแล้วอัปเดต attendance + คำนวณสาย/OT/ชั่วโมงงานใหม่
 **********************************************************************/
import { T, readObjects, findOne, appendObject, updateByKey } from '../db';
import { uid, nowStamp, normalizeTimeEdit, asDateStr, asHHMM } from '../helpers';
import { attendanceOf, writeCheckIn, writeCheckOut } from './attendance';
import { empByIdentity } from './employeeApi';

/** พนักงานยื่นคำขอแก้เวลา — payload {date, newCheckIn, newCheckOut, reason} */
export async function empSubmitTimeEdit(empId: string, payload: any) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  payload = payload || {};
  if (!payload.date) throw new Error('กรุณาเลือกวันที่');
  if (!payload.newCheckIn && !payload.newCheckOut)
    throw new Error('กรุณากรอกเวลาเข้าหรือเวลาออกอย่างน้อย 1 ช่อง');

  const existing = await attendanceOf(emp.empId, payload.date);

  await appendObject(T.TIMEEDITS, {
    editId: uid('TE-'),
    empId: emp.empId,
    empName: emp.name,
    branchId: emp.branchId,
    date: payload.date,
    oldCheckIn: existing ? existing.checkInTime || '' : '',
    oldCheckOut: existing ? existing.checkOutTime || '' : '',
    newCheckIn: payload.newCheckIn || '',
    newCheckOut: payload.newCheckOut || '',
    reason: payload.reason || '',
    status: 'pending',
    requestedAt: nowStamp(),
    decidedAt: '',
  });
  return true;
}

/** รายการคำขอแก้เวลา (ฝั่งแอดมิน) */
export async function listTimeEdits(status?: string) {
  let rows = (await readObjects(T.TIMEEDITS)).map(normalizeTimeEdit);
  if (status) rows = rows.filter((t: any) => t.status === status);
  rows.sort((a: any, b: any) =>
    String(b.requestedAt).localeCompare(String(a.requestedAt))
  );
  return rows;
}

/** อนุมัติ/ปฏิเสธคำขอ — decision = 'approved' | 'rejected' */
export async function decideTimeEdit(editId: string, decision: string) {
  const found: any = await findOne(T.TIMEEDITS, 'editId', editId);
  if (!found) throw new Error('ไม่พบคำขอ');

  if (decision === 'approved') {
    const emp: any = await findOne(T.PROFILES, 'empId', found.empId);
    if (!emp) throw new Error('ไม่พบพนักงาน');

    const date = asDateStr(found.date);
    let att: any = await attendanceOf(found.empId, date);
    const dayType = att ? att.dayType || 'วันปกติ' : 'วันปกติ';
    const lat = att ? att.checkInLat : '';
    const lng = att ? att.checkInLng : '';

    const ci = found.newCheckIn || (att ? att.checkInTime : '');
    const co = found.newCheckOut || (att ? att.checkOutTime : '');

    if (ci) await writeCheckIn(emp, date, asHHMM(ci), dayType, lat, lng);
    att = await attendanceOf(found.empId, date); // อ่านซ้ำหลังเขียนเข้า
    if (co && att) await writeCheckOut(att, asHHMM(co));
  }

  await updateByKey(T.TIMEEDITS, 'editId', editId, {
    status: decision,
    decidedAt: nowStamp(),
  });
  return true;
}
