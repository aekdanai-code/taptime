/**********************************************************************
 * otRequests.ts — ใบขอ/ใบอนุมัติ OT  (flow เดียวกับ leave_requests)
 *
 * ชนิดของใบ (`kind`)
 *   after_shift   ทำต่อหลังเลิกงาน
 *   before_shift  มาทำก่อนเข้างาน
 *   holiday_work  ขอทำงานในวันหยุด — ยื่นได้ทุกโหมด ยกเว้นโหมด off
 *                 (ไม่งั้นโหมด auto/admin_only + holidayNeedsRequest จะเป็นทางตัน
 *                  เพราะพนักงานหาทางสร้างใบอนุมัติไม่ได้เลย)
 *
 * ที่มาของใบ (`source`)
 *   employee  พนักงานยื่นเอง
 *   system    ระบบสร้างให้ตอนเช็คเอาท์ (โหมด request_after)
 *   admin     แอดมินคีย์ให้ (โหมด admin_only หรือกรณีตกหล่น)
 **********************************************************************/
import { T, readObjects, findOne, appendObject, updateByKey } from '../db';
import { uid, today, nowStamp, asDateStr, asHHMM, toMinutes } from '../helpers';
import { attendanceOf, otDayTypeOf } from './attendance';
import { empByIdentity } from './employeeApi';
import { activePolicy, OtPolicy } from './overtime';
import { notify, notifyAdmins } from './notifications';

export type OtKind = 'after_shift' | 'before_shift' | 'holiday_work';

const KINDS: OtKind[] = ['after_shift', 'before_shift', 'holiday_work'];
const fmtD = (d: string) => String(d || '').split('-').reverse().join('/');
const fmtM = (m: number) => {
  const n = Math.max(0, Math.round(Number(m) || 0));
  return Math.floor(n / 60) + ' ชม. ' + (n % 60) + ' นาที';
};

/** ใบที่ยัง "มีผล" อยู่ (ตรงกับ partial unique index ในฐานข้อมูล) */
const isLive = (r: any) =>
  String(r.status) === 'pending' || String(r.status) === 'approved';

const TH_STATUS: Record<string, string> = {
  pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว',
  rejected: 'ปฏิเสธ', cancelled: 'ยกเลิกแล้ว',
};

/** ใบที่ยังมีผลของ (พนักงาน, วัน, ชนิด) — ใช้กันยื่นซ้ำและกันระบบสร้างซ้ำ */
export async function liveRequest(empId: string, date: string, kind: OtKind) {
  const rows = await readObjects(T.OTREQUESTS, { empId, date });
  return (rows as any[]).filter((r) => r.kind === kind && isLive(r))[0] || null;
}

/** ใบที่อนุมัติแล้วของวันนั้น (ทุกชนิด) */
export async function approvedRequests(empId: string, date: string) {
  const rows = await readObjects(T.OTREQUESTS, { empId, date });
  return (rows as any[]).filter((r) => String(r.status) === 'approved');
}

/* ==================== ระบบสร้างใบให้เอง ==================== */

/**
 * โหมด `request_after` — ตอนเช็คเอาท์ระบบนับ OT ให้แล้วขึ้น "รออนุมัติ"
 * จึงต้องมีใบให้แอดมินกด
 *
 * ใช้ **upsert ตามใบเดิม** ไม่ใช่ insert เสมอ เพราะการอนุมัติคำขอแก้เวลา
 * จะเรียก writeCheckOut ซ้ำ ถ้า insert ใหม่จะชน unique index (empId, date, kind)
 */
export async function syncSystemOtRequest(opts: {
  emp: any;
  date: string;
  kind: OtKind;
  dayType: string;
  minutes: number;
  actualStart?: string;
  actualEnd?: string;
  policyId: string;
}): Promise<string | null> {
  const { emp, date, kind, minutes } = opts;
  const existing = await liveRequest(emp.empId, date, kind);

  // ไม่มี OT แล้ว (เช่นแก้เวลาย้อนกลับ) -> ยกเลิกใบที่ระบบเคยสร้าง
  if (minutes <= 0) {
    if (existing && String(existing.source) === 'system' &&
        String(existing.status) === 'pending') {
      await updateByKey(T.OTREQUESTS, 'otId', existing.otId, {
        status: 'cancelled', decidedAt: nowStamp(), adminNote: 'ไม่มี OT หลังแก้เวลา',
      });
    }
    return null;
  }

  if (existing) {
    // ใบที่คนกดอนุมัติไปแล้ว หรือใบที่พนักงานยื่นเอง ห้ามระบบไปแก้
    if (String(existing.status) !== 'pending' ||
        String(existing.source) !== 'system') {
      return existing.otId;
    }
    await updateByKey(T.OTREQUESTS, 'otId', existing.otId, {
      minutesRequested: minutes,
      actualStart: opts.actualStart || null,
      actualEnd: opts.actualEnd || null,
      dayType: opts.dayType,
      policyId: opts.policyId,
    });
    return existing.otId;
  }

  const otId = uid('OT-');
  await appendObject(T.OTREQUESTS, {
    otId,
    empId: emp.empId,
    empName: emp.name || emp.empName || '',
    branchId: emp.branchId || null,
    date,
    dayType: opts.dayType,
    source: 'system',
    kind,
    actualStart: opts.actualStart || null,
    actualEnd: opts.actualEnd || null,
    minutesRequested: minutes,
    status: 'pending',
    requestedAt: nowStamp(),
    policyId: opts.policyId,
  });

  await notifyAdmins(
    'ot_submitted',
    'มี OT รออนุมัติ',
    `${emp.name || ''} ทำ OT วันที่ ${fmtD(date)} ${fmtM(minutes)}`,
    { refId: otId, actorId: emp.empId }
  );

  return otId;
}

/* ==================== ฝั่งพนักงาน ==================== */

/** ชนิดใบที่พนักงานยื่นได้ ณ นโยบายปัจจุบัน */
function canEmployeeSubmit(policy: OtPolicy, kind: OtKind) {
  if (policy.mode === 'off') return 'ระบบ OT ปิดอยู่';
  // ใบขอทำงานวันหยุดยื่นได้ทุกโหมด ไม่งั้นเช็คอินวันหยุดจะเป็นทางตัน
  if (kind === 'holiday_work') {
    if (!policy.allowHolidayWork) return 'ระบบไม่อนุญาตให้ทำงานในวันหยุด';
    return null;
  }
  if (policy.mode === 'admin_only') return 'ผู้ดูแลระบบเป็นผู้บันทึก OT ให้';
  if (policy.mode === 'auto')
    return 'โหมดปัจจุบันระบบนับ OT ให้อัตโนมัติ ไม่ต้องยื่นคำขอ';
  return null;
}

/**
 * พนักงานยื่นขอ OT
 * payload = { date, kind?, plannedStart, plannedEnd, reason }
 */
export async function empSubmitOtRequest(empId: string, payload: any) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  const p = payload || {};
  const date = asDateStr(p.date);
  if (!date) throw new Error('กรุณาเลือกวันที่');

  const policy = await activePolicy();
  const dayType = await otDayTypeOf(date);

  const kind: OtKind =
    KINDS.indexOf(p.kind) >= 0
      ? p.kind
      : dayType === 'workday' ? 'after_shift' : 'holiday_work';

  const blocked = canEmployeeSubmit(policy, kind);
  if (blocked) throw new Error(blocked);

  if (kind === 'holiday_work' && dayType === 'workday')
    throw new Error('วันที่เลือกไม่ใช่วันหยุด');

  const s = p.plannedStart ? asHHMM(p.plannedStart) : '';
  const e = p.plannedEnd ? asHHMM(p.plannedEnd) : '';
  if (!s || !e) throw new Error('กรุณาระบุเวลาเริ่มและเวลาสิ้นสุด');

  const sm = toMinutes(s);
  const em = toMinutes(e);
  if (sm == null || em == null) throw new Error('รูปแบบเวลาไม่ถูกต้อง');
  if (em <= sm)
    throw new Error('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม (ระบบไม่รองรับกะข้ามคืน)');

  const clash = await liveRequest(emp.empId, date, kind);
  if (clash)
    throw new Error(
      `มีใบขอ OT ของวันที่ ${fmtD(date)} อยู่แล้ว (สถานะ: ${
        TH_STATUS[String(clash.status)] || clash.status})`
    );

  const minutes = em - sm;
  const otId = uid('OT-');
  const row = {
    otId,
    empId: emp.empId,
    empName: emp.name,
    branchId: emp.branchId,
    date,
    dayType,
    source: 'employee',
    kind,
    plannedStart: s,
    plannedEnd: e,
    minutesRequested: minutes,
    reason: p.reason || '',
    status: 'pending',
    requestedAt: nowStamp(),
    policyId: policy.policyId,
  };
  await appendObject(T.OTREQUESTS, row);

  await notifyAdmins(
    'ot_submitted',
    kind === 'holiday_work' ? 'คำขอทำงานวันหยุดใหม่' : 'คำขอทำ OT ใหม่',
    `${emp.name} ขอ${kind === 'holiday_work' ? 'ทำงานวันหยุด' : 'ทำ OT'} ` +
      `${fmtD(date)} ${s}–${e} (${fmtM(minutes)})`,
    { refId: otId, actorId: emp.empId }
  );

  return row;
}

/** พนักงานยกเลิกใบของตัวเอง — ได้เฉพาะใบที่ยัง pending */
export async function empCancelOtRequest(empId: string, otId: string) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  const found: any = await findOne(T.OTREQUESTS, 'otId', otId);
  if (!found) throw new Error('ไม่พบคำขอ');
  // ตัวตนมาจาก session เสมอ -> ยกเลิกใบของคนอื่นไม่ได้
  if (String(found.empId) !== String(emp.empId)) throw new Error('ไม่พบคำขอ');
  if (String(found.status) !== 'pending')
    throw new Error('ยกเลิกได้เฉพาะใบที่ยังรออนุมัติ');

  await updateByKey(T.OTREQUESTS, 'otId', otId, {
    status: 'cancelled',
    decidedAt: nowStamp(),
  });
  return true;
}

/** ประวัติ OT ของตัวเอง (ใหม่สุดขึ้นก่อน) */
export async function empOtHistory(empId: string) {
  const emp = await empByIdentity(empId);
  if (!emp) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const rows = await readObjects(T.OTREQUESTS, { empId: emp.empId });
  return (rows as any[])
    .map((r) => ({ ...r, date: asDateStr(r.date) }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/* ==================== ฝั่งแอดมิน ==================== */

/** รายการใบขอ OT — กรองตาม status / ช่วงวัน / empId / สาขา */
export async function listOtRequests(params?: any) {
  const p = params || {};
  let rows = (await readObjects(T.OTREQUESTS)).map((r: any) => ({
    ...r, date: asDateStr(r.date),
  }));

  if (p.status) rows = rows.filter((r: any) => String(r.status) === p.status);
  if (p.empId) rows = rows.filter((r: any) => String(r.empId) === String(p.empId));
  if (p.branchId)
    rows = rows.filter((r: any) => String(r.branchId) === String(p.branchId));
  if (p.start) rows = rows.filter((r: any) => r.date >= asDateStr(p.start));
  if (p.end) rows = rows.filter((r: any) => r.date <= asDateStr(p.end));
  if (p.name) {
    const q = String(p.name).toLowerCase();
    rows = rows.filter((r: any) =>
      String(r.empName || '').toLowerCase().indexOf(q) >= 0);
  }

  rows.sort((a: any, b: any) =>
    String(b.date).localeCompare(String(a.date)) ||
    String(b.requestedAt).localeCompare(String(a.requestedAt)));
  return rows;
}

/** เขียนผลการอนุมัติกลับไปที่แถวลงเวลาของวันนั้น */
async function syncAttendance(req: any, status: string, minutes: number) {
  const att = await attendanceOf(req.empId, asDateStr(req.date));
  if (!att) return;
  await updateByKey(T.ATTENDANCE, 'recId', att.recId, {
    otStatus: status,
    otMinutes: status === 'approved' ? minutes : 0,
    otRequestId: req.otId,
  });
}

/**
 * อนุมัติ / ปฏิเสธใบขอ OT
 * @param minutesApproved แก้จำนวนนาทีก่อนอนุมัติได้ (ห้ามเกินที่ยื่นขอ)
 */
export async function decideOtRequest(
  otId: string,
  decision: string,
  minutesApproved?: any,
  note?: string
) {
  const found: any = await findOne(T.OTREQUESTS, 'otId', otId);
  if (!found) throw new Error('ไม่พบคำขอ OT');
  if (decision !== 'approved' && decision !== 'rejected')
    throw new Error('คำสั่งไม่ถูกต้อง');
  if (String(found.status) !== 'pending')
    throw new Error('ใบนี้ถูกดำเนินการไปแล้ว');

  const asked = Math.max(0, Number(found.minutesRequested) || 0);
  let minutes = asked;
  if (minutesApproved !== undefined && minutesApproved !== null &&
      minutesApproved !== '') {
    minutes = Math.max(0, Math.round(Number(minutesApproved) || 0));
    if (minutes > asked)
      throw new Error('จำนวนนาทีที่อนุมัติต้องไม่เกินที่ยื่นขอ');
  }

  const ok = decision === 'approved';
  await updateByKey(T.OTREQUESTS, 'otId', otId, {
    status: decision,
    minutesApproved: ok ? minutes : 0,
    adminNote: note || '',
    decidedAt: nowStamp(),
  });

  // ใบขอทำงานวันหยุดเป็น "ใบผ่านทาง" ให้เช็คอินได้ ยังไม่ใช่จำนวน OT จริง
  // จำนวนจริงจะถูกคำนวณตอนเช็คเอาท์ จึงไม่ไปเขียนทับแถวลงเวลา
  if (String(found.kind) !== 'holiday_work') {
    await syncAttendance(found, decision, minutes);
  }

  await notify(
    [found.empId],
    'ot_decided',
    ok ? 'คำขอ OT ได้รับอนุมัติ' : 'คำขอ OT ถูกปฏิเสธ',
    `วันที่ ${fmtD(asDateStr(found.date))}` +
      (ok ? ` อนุมัติ ${fmtM(minutes)}` : ' ไม่ได้รับการอนุมัติ') +
      (note ? ` — ${note}` : ''),
    { refId: otId }
  );

  return true;
}

/** อนุมัติหลายใบพร้อมกัน — คืนจำนวนที่สำเร็จ/ล้มเหลว */
export async function decideOtRequests(
  otIds: any[], decision: string, note?: string
) {
  const ids = (Array.isArray(otIds) ? otIds : []).filter(Boolean);
  let ok = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try { await decideOtRequest(String(id), decision, undefined, note); ok++; }
    catch (e: any) { errors.push(String(id) + ': ' + (e?.message || e)); }
  }
  return { ok, failed: errors.length, errors };
}

/**
 * แอดมินคีย์ OT ให้พนักงาน (โหมด admin_only หรือกรณีตกหล่น)
 * payload = { empId, date, start, end, minutes?, reason?, kind? }
 */
export async function adminCreateOt(payload: any) {
  const p = payload || {};
  const emp: any = await findOne(T.PROFILES, 'empId', p.empId);
  if (!emp) throw new Error('ไม่พบพนักงาน');

  const date = asDateStr(p.date || today());
  if (!date) throw new Error('กรุณาเลือกวันที่');

  const policy = await activePolicy();
  const dayType = await otDayTypeOf(date);
  const kind: OtKind = KINDS.indexOf(p.kind) >= 0 ? p.kind : 'after_shift';

  let minutes = Math.max(0, Math.round(Number(p.minutes) || 0));
  const s = p.start ? asHHMM(p.start) : '';
  const e = p.end ? asHHMM(p.end) : '';
  if (!minutes) {
    const sm = toMinutes(s);
    const em = toMinutes(e);
    if (sm == null || em == null)
      throw new Error('กรุณาระบุเวลาเริ่ม-สิ้นสุด หรือจำนวนนาที');
    if (em <= sm) throw new Error('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    minutes = em - sm;
  }
  if (minutes <= 0) throw new Error('จำนวนนาทีต้องมากกว่า 0');

  const clash = await liveRequest(emp.empId, date, kind);
  if (clash)
    throw new Error(
      `มีใบ OT ของวันที่ ${fmtD(date)} อยู่แล้ว (สถานะ: ${
        TH_STATUS[String(clash.status)] || clash.status})`
    );

  const otId = uid('OT-');
  const row = {
    otId,
    empId: emp.empId,
    empName: emp.name,
    branchId: emp.branchId,
    date,
    dayType,
    source: 'admin',
    kind,
    actualStart: s || null,
    actualEnd: e || null,
    minutesRequested: minutes,
    minutesApproved: minutes,
    reason: p.reason || '',
    status: 'approved',
    requestedAt: nowStamp(),
    decidedAt: nowStamp(),
    policyId: policy.policyId,
  };
  await appendObject(T.OTREQUESTS, row);

  if (kind !== 'holiday_work') await syncAttendance(row, 'approved', minutes);

  await notify(
    [emp.empId],
    'ot_decided',
    'ผู้ดูแลระบบบันทึก OT ให้',
    `วันที่ ${fmtD(date)} จำนวน ${fmtM(minutes)}`,
    { refId: otId }
  );

  return row;
}

/**
 * สรุป OT รายคนในช่วงวัน — **นับเฉพาะที่อนุมัติแล้ว**
 * ส่วนที่ยังรออนุมัติแยกออกมาอีกคอลัมน์ ห้ามรวมกัน
 */
export async function otSummary(params?: any) {
  const p = params || {};
  const start = asDateStr(p.start || today());
  const end = asDateStr(p.end || today());

  const [attRows, empRows] = await Promise.all([
    readObjects(T.ATTENDANCE),
    readObjects(T.PROFILES),
  ]);

  const nameOf: Record<string, any> = {};
  (empRows as any[]).forEach((e) => { nameOf[e.empId] = e; });

  const acc: Record<string, any> = {};
  for (const a of attRows as any[]) {
    const d = asDateStr(a.date);
    if (!d || d < start || d > end) continue;
    if (p.branchId && String(a.branchId) !== String(p.branchId)) continue;

    const min = Math.max(0, Number(a.otMinutes) || 0);
    if (!min) continue;

    const k = a.empId;
    if (!acc[k]) {
      const e = nameOf[k] || {};
      acc[k] = {
        empId: k,
        empName: a.empName || e.name || k,
        branchId: a.branchId || e.branchId || '',
        workdayMinutes: 0, weekendMinutes: 0, holidayMinutes: 0,
        approvedMinutes: 0, pendingMinutes: 0, days: 0,
      };
    }
    const r = acc[k];
    const st = String(a.otStatus || 'none');
    if (st === 'approved') {
      r.approvedMinutes += min;
      r.days++;
      const dt = String(a.otDayType || 'workday');
      if (dt === 'holiday') r.holidayMinutes += min;
      else if (dt === 'weekend') r.weekendMinutes += min;
      else r.workdayMinutes += min;
    } else if (st === 'pending') {
      r.pendingMinutes += min;
    }
  }

  const rows = Object.keys(acc)
    .map((k) => acc[k])
    .filter((r) => r.approvedMinutes > 0 || r.pendingMinutes > 0)
    .sort((a, b) => b.approvedMinutes - a.approvedMinutes);

  return {
    start, end, rows,
    totalApproved: rows.reduce((s, r) => s + r.approvedMinutes, 0),
    totalPending: rows.reduce((s, r) => s + r.pendingMinutes, 0),
  };
}
