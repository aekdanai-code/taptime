/**********************************************************************
 * employeeApi.ts — พอร์ตจาก EmployeeApi.gs
 *
 * ** เปลี่ยนจากเดิม: ยกเลิกการยืนยันตัวด้วย "token ในลิงก์" ทั้งหมด **
 * ทุกฟังก์ชันรับ `empId` เป็น argument แรก และ /api/rpc จะ **เขียนทับ**
 * argument นั้นด้วย empId จาก session เสมอ — ค่าที่ client ส่งมาไม่มีผล
 * จึงปลอมเป็นคนอื่นไม่ได้แม้จะแก้ JavaScript ในหน้าเว็บ
 **********************************************************************/
import { T, readObjects, findOne, appendObject } from '../db';
import {
  uid, today, nowHHMM, nowStamp, thisMonth, thisYear,
  distanceMeters, normalizeAtt, normalizeLeave, normalizeTimeEdit,
  normalizeHoliday, asDateStr,
} from '../helpers';
import { attendanceOf, writeCheckIn, writeCheckOut, getBranch } from './attendance';
import { holidayMap, weeklyOffArr, dayTypeOf } from './holidays';
import { entitlementsFor } from './leaveAssign';
import { notifyAdmins } from './notifications';

/** 'yyyy-MM-dd' -> 'DD/MM/YYYY' สำหรับข้อความแจ้งเตือน */
function thaiDate(ds: string) {
  const p = String(ds || '').split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(ds || '');
}

/**
 * หาพนักงานจาก empId (ที่มาจาก session เท่านั้น)
 * ชื่อเดิม empByToken ถูกเปลี่ยนเป็น empByIdentity เพื่อไม่ให้เข้าใจผิดว่ายังใช้ token
 */
export async function empByIdentity(empId: string): Promise<any> {
  if (!empId) return null;
  const emp: any = await findOne(T.PROFILES, 'empId', String(empId));
  if (!emp) return null;
  if (String(emp.status || 'active').toLowerCase() === 'inactive') return null;
  return emp;
}

/** ข้อมูลตั้งต้นหน้าพนักงาน */
export async function employeeContext(empId: string) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  const [branch, myAtt, myLeavesRaw, myTimeEditsRaw, allLeaveTypes, myAssigns,
         holidayRows, hmap, woff] =
    await Promise.all([
      getBranch(emp.branchId),
      readObjects(T.ATTENDANCE, { empId: emp.empId }),
      readObjects(T.LEAVES, { empId: emp.empId }),
      readObjects(T.TIMEEDITS, { empId: emp.empId }),
      readObjects(T.LEAVETYPES),
      readObjects(T.LEAVEASSIGN, { empId: emp.empId }),
      readObjects(T.HOLIDAYS),
      holidayMap(),
      weeklyOffArr(),
    ]);

  // สิทธิ์การลาของพนักงานคนนี้ (ตาม assignment + โควตาเฉพาะราย)
  const entitlements = entitlementsFor(allLeaveTypes, myAssigns);
  // ประเภทลาที่ยื่นได้ — ส่งให้ฟอร์มยื่นลาใช้ (โครงเดิมของหน้าเว็บ)
  const leaveTypes = entitlements.map((e) => ({
    typeId: e.typeId,
    name: e.name,
    daysPerYear: e.quota,
    advanceDays: e.advanceDays,
    expireDate: e.expireDate,
  }));

  const td = today();
  const ym = thisMonth();
  const curYear = thisYear();

  const attAll = myAtt.map(normalizeAtt);
  const attToday = attAll.filter((a: any) => a.date === td)[0] || null;

  /* ---- สถิติเดือนนี้ ---- */
  let lateCount = 0, lateMin = 0, otMin = 0, workDays = 0;
  attAll
    .filter((a: any) => String(a.date).indexOf(ym) === 0)
    .forEach((a: any) => {
      if (a.checkInTime) workDays++;
      if (a.status === 'late') lateCount++;
      lateMin += Number(a.lateMinutes || 0);
      otMin += Number(a.otMinutes || 0);
    });

  const myLeaves = myLeavesRaw
    .map(normalizeLeave)
    .sort((a: any, b: any) =>
      String(b.requestedAt).localeCompare(String(a.requestedAt))
    );

  /* ---- การลาในเดือนนี้ (อนุมัติแล้ว) ---- */
  const leaveCount = myLeaves.filter(
    (l: any) =>
      l.status === 'approved' &&
      (String(l.startDate).indexOf(ym) === 0 || String(l.endDate).indexOf(ym) === 0)
  ).length;

  /* ---- โควตาวันลาคงเหลือ แยกตามประเภท (ปีปัจจุบัน) ----
   * ใช้สิทธิ์จาก entitlements (assign รายคน + โควตาเฉพาะราย)
   * showQuota = false -> ยังยื่นลาได้ แต่หน้าพนักงานจะไม่โชว์จำนวนวัน
   */
  const leaveBalances = entitlements.map((t) => {
    const used = myLeaves
      .filter(
        (l: any) =>
          l.status === 'approved' &&
          l.leaveType === t.name &&
          String(l.startDate).indexOf(curYear) === 0
      )
      .reduce((s: number, l: any) => s + Number(l.days || 0), 0);
    return {
      name: t.name,
      quota: t.quota,
      used,
      remaining: t.quota - used,
      showQuota: t.showQuota,
    };
  });

  const myTimeEdits = myTimeEditsRaw
    .map(normalizeTimeEdit)
    .sort((a: any, b: any) =>
      String(b.requestedAt).localeCompare(String(a.requestedAt))
    );

  /* ---- ประเภทของวันนี้ (กันเช็คอินวันหยุด) ---- */
  const todayType = dayTypeOf(td, hmap, woff);

  return {
    emp: {
      empId: emp.empId,
      name: emp.name,
      position: emp.position,
      branchId: emp.branchId,
      photo: emp.photo || '',
    },
    branch: {
      name: branch.name,
      lat: branch.lat,
      lng: branch.lng,
      radius: branch.radius,
      workStart: branch.workStart,
      workEnd: branch.workEnd,
      breakHours: branch.breakHours,
      breakAfterHours: branch.breakAfterHours,
      lateThreshold: branch.lateThreshold,
      earlyCheckinMin: branch.earlyCheckinMin,
    },
    today: td,
    todayHoliday: todayType.type !== 'work',
    todayHolidayName: todayType.name || '',
    attendance: attToday,
    leaveTypes,
    holidays: holidayRows.map(normalizeHoliday),
    weeklyOff: woff,
    stats: {
      leaveRemaining: leaveBalances
        .filter((b: any) => b.showQuota)
        .reduce((s: number, b: any) => s + b.remaining, 0),
      workDays,
      lateCount,
      leaveCount,
      lateMinutes: lateMin,
      otMinutes: otMin,
    },
    leaveBalances,
    myLeaves,
    myTimeEdits,
  };
}

/**
 * ตรวจ geofence แบบ "fail-closed"
 *
 * ของเดิม (Apps Script) เขียนว่า `if (dist > radius) return out_of_zone`
 * ถ้า client ไม่ส่ง lat/lng มา (หรือส่งค่าที่ไม่ใช่ตัวเลข) -> Number() ได้ NaN
 * -> dist = NaN -> `NaN > radius` = **false** -> หลุดผ่านการตรวจ GPS ทั้งหมด
 * ยิง `{"fn":"empCheckIn","args":["<token>"]}` เปล่า ๆ ก็เช็คอินได้จากทุกที่
 *
 * เวอร์ชันนี้จึงบังคับให้ต้องผ่านทุกเงื่อนไขก่อน ไม่ใช่แค่ "ไม่เข้าเงื่อนไขปฏิเสธ"
 */
function checkGeofence(lat: any, lng: any, branch: any) {
  const la = Number(lat);
  const ln = Number(lng);

  // พิกัดต้องเป็นตัวเลขจริง อยู่ในช่วงที่เป็นไปได้ และไม่ใช่ (0,0) ที่มักมาจากค่าว่าง
  if (
    !Number.isFinite(la) || !Number.isFinite(ln) ||
    Math.abs(la) > 90 || Math.abs(ln) > 180 ||
    (la === 0 && ln === 0)
  ) {
    return { ok: false as const, reason: 'no_location' };
  }

  const bLat = Number(branch?.lat);
  const bLng = Number(branch?.lng);
  const radius = Number(branch?.radius);
  if (!Number.isFinite(bLat) || !Number.isFinite(bLng) || !Number.isFinite(radius) || radius <= 0) {
    return { ok: false as const, reason: 'branch_no_location' };
  }

  const dist = distanceMeters(la, ln, bLat, bLng);
  if (!Number.isFinite(dist)) return { ok: false as const, reason: 'no_location' };

  if (dist > radius) {
    return {
      ok: false as const,
      reason: 'out_of_zone',
      distance: Math.round(dist),
      radius,
    };
  }
  return { ok: true as const, distance: Math.round(dist) };
}

/** ความคลาดเคลื่อนสูงสุดของพิกัดที่ยอมรับ (เมตร) — กันค่าที่มาจากตำแหน่ง IP/Wi-Fi หยาบ ๆ */
const MAX_ACCURACY_M = 200;

/** meta ที่ /api/rpc เติมให้ฝั่งเซิร์ฟเวอร์ (client แก้ไม่ได้) */
export type CheckCtx = {
  accuracy?: number;
  credentialId?: string | null;
  ip?: string;
  userAgent?: string;
};

/** บันทึกหลักฐานทุกครั้งที่มีความพยายามเช็คอิน/เอาท์ (ไม่ throw ถ้าเขียนไม่สำเร็จ) */
async function audit(
  empId: string,
  action: 'checkin' | 'checkout',
  result: string,
  lat: any, lng: any,
  distance: number | null,
  ctx?: CheckCtx
) {
  try {
    await appendObject(T.AUDIT, {
      empId,
      action,
      result,
      lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
      lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
      accuracy: Number.isFinite(Number(ctx?.accuracy)) ? Number(ctx?.accuracy) : null,
      distance,
      credentialId: ctx?.credentialId || null,
      ip: ctx?.ip || null,
      userAgent: ctx?.userAgent || null,
    });
  } catch {
    /* audit ต้องไม่ทำให้การเช็คอินล้มเหลว */
  }
}

/** ตรวจความแม่นยำของพิกัด */
function checkAccuracy(ctx?: CheckCtx) {
  const acc = Number(ctx?.accuracy);
  if (Number.isFinite(acc) && acc > MAX_ACCURACY_M) {
    return { ok: false as const, reason: 'low_accuracy', accuracy: Math.round(acc) };
  }
  return { ok: true as const };
}

/** พนักงานเช็คอิน (ตรวจรัศมี GPS + ความแม่นยำ + บันทึก audit) */
export async function empCheckIn(empId: string, lat: any, lng: any, ctx?: CheckCtx) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const branch = await getBranch(emp.branchId);
  if (!branch.branchId) throw new Error('ไม่พบข้อมูลสาขา');

  const acc = checkAccuracy(ctx);
  if (!acc.ok) {
    await audit(emp.empId, 'checkin', acc.reason, lat, lng, null, ctx);
    return acc;
  }

  const geo = checkGeofence(lat, lng, branch);
  if (!geo.ok) {
    await audit(emp.empId, 'checkin', geo.reason, lat, lng,
      (geo as any).distance ?? null, ctx);
    return geo;
  }

  // กันเช็คอินในวันหยุด (ราชการ/ประจำสัปดาห์)
  const [hmap, woff] = await Promise.all([holidayMap(), weeklyOffArr()]);
  const dt = dayTypeOf(today(), hmap, woff);
  if (dt.type !== 'work') {
    await audit(emp.empId, 'checkin', 'holiday', lat, lng, geo.distance, ctx);
    return { ok: false, reason: 'holiday', holidayName: dt.name };
  }

  const existing = await attendanceOf(emp.empId, today());
  if (existing && existing.checkInTime) {
    await audit(emp.empId, 'checkin', 'already_in', lat, lng, geo.distance, ctx);
    return { ok: false, reason: 'already_in' };
  }

  const rec = await writeCheckIn(emp, today(), nowHHMM(), 'วันปกติ', lat, lng);
  await audit(emp.empId, 'checkin', 'ok', lat, lng, geo.distance, ctx);

  return {
    ok: true,
    late: rec.status === 'late',
    lateMinutes: rec.lateMinutes,
    record: rec,
  };
}

/** พนักงานเช็คเอาท์ (ตรวจรัศมี GPS + ความแม่นยำ + บันทึก audit) */
export async function empCheckOut(empId: string, lat: any, lng: any, ctx?: CheckCtx) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const branch = await getBranch(emp.branchId);
  if (!branch.branchId) throw new Error('ไม่พบข้อมูลสาขา');

  const acc = checkAccuracy(ctx);
  if (!acc.ok) {
    await audit(emp.empId, 'checkout', acc.reason, lat, lng, null, ctx);
    return acc;
  }

  const geo = checkGeofence(lat, lng, branch);
  if (!geo.ok) {
    await audit(emp.empId, 'checkout', geo.reason, lat, lng,
      (geo as any).distance ?? null, ctx);
    return geo;
  }

  const att = await attendanceOf(emp.empId, today());
  if (!att) {
    await audit(emp.empId, 'checkout', 'no_checkin', lat, lng, geo.distance, ctx);
    return { ok: false, reason: 'no_checkin' };
  }
  if (att.checkOutTime) {
    await audit(emp.empId, 'checkout', 'already_out', lat, lng, geo.distance, ctx);
    return { ok: false, reason: 'already_out' };
  }

  const record = await writeCheckOut(att, nowHHMM());
  // เก็บพิกัดตอนเช็คเอาท์ไว้เป็นหลักฐานด้วย (ของเดิมตรวจแล้วทิ้ง)
  await audit(emp.empId, 'checkout', 'ok', lat, lng, geo.distance, ctx);

  return { ok: true, record };
}

/** พนักงานยื่นลา (ตรวจเงื่อนไขลาล่วงหน้า) */
export async function empSubmitLeave(empId: string, payload: any) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  // เงื่อนไข: ต้องลาล่วงหน้าอย่างน้อย advanceDays วัน
  const lt: any = await findOne(T.LEAVETYPES, 'name', payload.leaveType);
  const adv = lt ? Number(lt.advanceDays || 0) : 0;
  if (adv > 0) {
    const diffDays = Math.floor(
      (new Date(payload.startDate + 'T00:00:00Z').getTime() -
        new Date(today() + 'T00:00:00Z').getTime()) /
        86400000
    );
    if (diffDays < adv)
      throw new Error(
        `ประเภท "${payload.leaveType}" ต้องยื่นล่วงหน้าอย่างน้อย ${adv} วัน`
      );
  }

  /* ---- กันยื่นลาซ้ำ / ทับกับใบที่มีอยู่แล้ว ----
   * ทับกันเมื่อ  start1 <= end2  และ  start2 <= end1
   * นับเฉพาะใบที่ยัง pending หรือ approved (ใบที่ถูกปฏิเสธไม่กันสิทธิ์)
   */
  const s = asDateStr(payload.startDate);
  const e = asDateStr(payload.endDate);
  if (!s || !e) throw new Error('กรุณาเลือกวันที่เริ่มและวันสิ้นสุด');
  if (s > e) throw new Error('วันสิ้นสุดต้องไม่ก่อนวันเริ่มลา');

  const mine = await readObjects(T.LEAVES, { empId: emp.empId });
  const clash = mine
    .map(normalizeLeave)
    .filter((l: any) => l.status === 'pending' || l.status === 'approved')
    .filter((l: any) => String(l.startDate) <= e && s <= String(l.endDate))[0];

  if (clash) {
    const range =
      clash.startDate === clash.endDate
        ? thaiDate(clash.startDate)
        : `${thaiDate(clash.startDate)} – ${thaiDate(clash.endDate)}`;
    const st = clash.status === 'approved' ? 'อนุมัติแล้ว' : 'รออนุมัติ';
    throw new Error(
      `ช่วงวันที่นี้ทับกับใบลาที่มีอยู่แล้ว: ${clash.leaveType} ${range} (${st})`
    );
  }

  let days = payload.days;
  if (!days) {
    const d1 = new Date(payload.startDate + 'T00:00:00Z').getTime();
    const d2 = new Date(payload.endDate + 'T00:00:00Z').getTime();
    days = Math.round((d2 - d1) / 86400000) + 1;
    if (payload.halfDay) days = 0.5;
  }

  const req = {
    reqId: uid('LV-'),
    empId: emp.empId,
    empName: emp.name,
    branchId: emp.branchId,
    leaveType: payload.leaveType,
    startDate: payload.startDate,
    endDate: payload.endDate,
    days,
    reason: payload.reason,
    status: 'pending',
    requestedAt: nowStamp(),
    decidedAt: '',
  };
  await appendObject(T.LEAVES, req);

  await notifyAdmins(
    'leave_submitted',
    'คำขอลาใหม่',
    `${emp.name} ขอ${payload.leaveType} ${
      s === e ? thaiDate(s) : `${thaiDate(s)} – ${thaiDate(e)}`
    } (${days} วัน)`,
    { refId: req.reqId, actorId: emp.empId }
  );

  return req;
}

export { asDateStr };
