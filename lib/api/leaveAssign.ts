/**********************************************************************
 * leaveAssign.ts — assign ประเภทการลาให้พนักงาน + โควตาเฉพาะราย
 *
 * กติกาการคิดสิทธิ์/โควตาของพนักงาน 1 คน ต่อประเภทลา 1 ประเภท
 *   1. มีแถวใน leave_assignments  -> ได้สิทธิ์ โควตา = daysOverride ?? daysPerYear
 *   2. ไม่มีแถว + assignAll = true -> ได้สิทธิ์ โควตา = daysPerYear
 *   3. ไม่มีแถว + assignAll = false-> ไม่ได้สิทธิ์ลาประเภทนี้
 *
 * ใช้ร่วมกันระหว่างฝั่งแอดมิน (ตั้งค่า) และฝั่งพนักงาน (คำนวณโควตาคงเหลือ)
 **********************************************************************/
import { T, readObjects, supabaseAdmin } from '../db';

export type LeaveEntitlement = {
  typeId: string;
  name: string;
  quota: number;
  showQuota: boolean;
  advanceDays: number;
  expireDate: string | null;
  /** true = ได้โควตาพิเศษเฉพาะราย (ไม่ใช่ค่ากลาง) */
  custom: boolean;
};

/**
 * คำนวณสิทธิ์การลาทั้งหมดของพนักงาน 1 คน
 * @param leaveTypes  ประเภทลาทั้งหมด (ส่งเข้ามาเพื่อไม่ query ซ้ำ)
 * @param assignments แถว assignment เฉพาะของพนักงานคนนี้
 */
export function entitlementsFor(
  leaveTypes: any[],
  assignments: any[]
): LeaveEntitlement[] {
  const byType: Record<string, any> = {};
  (assignments || []).forEach((a) => (byType[a.typeId] = a));

  const out: LeaveEntitlement[] = [];
  for (const t of leaveTypes || []) {
    const a = byType[t.typeId];
    // assignAll ที่เป็น null/undefined (ข้อมูลเก่า) ให้ถือว่า true
    const assignAll = t.assignAll === false ? false : true;

    if (!a && !assignAll) continue; // ไม่ได้สิทธิ์

    const override = a && a.daysOverride !== null && a.daysOverride !== undefined
      ? Number(a.daysOverride)
      : null;

    out.push({
      typeId: t.typeId,
      name: t.name,
      quota: override != null && Number.isFinite(override)
        ? override
        : Number(t.daysPerYear || 0),
      showQuota: t.showQuota === false ? false : true,
      advanceDays: Number(t.advanceDays || 0),
      expireDate: t.expireDate || null,
      custom: override != null && Number.isFinite(override),
    });
  }
  return out;
}

/* ==================== ฝั่งแอดมิน ==================== */

/** รายชื่อพนักงานที่ถูก assign ประเภทลานี้ (พร้อมโควตาเฉพาะราย) */
export async function listLeaveAssignments(typeId: string) {
  const [rows, emps] = await Promise.all([
    readObjects(T.LEAVEASSIGN, { typeId }),
    readObjects(T.PROFILES),
  ]);
  const nameOf: Record<string, string> = {};
  emps.forEach((e: any) => (nameOf[e.empId] = e.name));

  return rows
    .map((r: any) => ({
      empId: r.empId,
      name: nameOf[r.empId] || '(ถูกลบแล้ว)',
      daysOverride: r.daysOverride,
      note: r.note || '',
    }))
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'th'));
}

/**
 * บันทึกการ assign ทั้งชุดของประเภทลาหนึ่ง (แทนที่ของเดิมทั้งหมด)
 * @param payload { typeId, assignAll, items:[{empId, daysOverride, note}] }
 */
export async function saveLeaveAssignments(payload: any) {
  const typeId = String(payload?.typeId || '');
  if (!typeId) throw new Error('ไม่พบประเภทการลา');

  const db = supabaseAdmin();
  const items: any[] = Array.isArray(payload.items) ? payload.items : [];

  // อัปเดตธง assignAll ของประเภทลา
  {
    const { error } = await db
      .from(T.LEAVETYPES)
      .update({ assignAll: !!payload.assignAll })
      .eq('typeId', typeId);
    if (error) throw new Error(error.message);
  }

  // ล้างของเดิมแล้วใส่ชุดใหม่ (ง่ายและถูกต้องกว่าไล่ diff)
  {
    const { error } = await db.from(T.LEAVEASSIGN).delete().eq('typeId', typeId);
    if (error) throw new Error(error.message);
  }

  const rows = items
    .filter((i) => i && i.empId)
    .map((i) => {
      const d = i.daysOverride;
      const n = d === '' || d === null || d === undefined ? null : Number(d);
      return {
        typeId,
        empId: String(i.empId),
        daysOverride: n !== null && Number.isFinite(n) ? n : null,
        note: i.note || null,
      };
    });

  if (rows.length) {
    const { error } = await db.from(T.LEAVEASSIGN).insert(rows);
    if (error) throw new Error(error.message);
  }

  return { ok: true, count: rows.length, assignAll: !!payload.assignAll };
}

/** สรุปจำนวนคนที่ได้สิทธิ์แต่ละประเภท (ใช้แสดงในตารางตั้งค่าวันลา) */
export async function leaveAssignSummary() {
  const [types, assigns, emps] = await Promise.all([
    readObjects(T.LEAVETYPES),
    readObjects(T.LEAVEASSIGN),
    readObjects(T.PROFILES),
  ]);

  const total = emps.length;
  const count: Record<string, number> = {};
  const custom: Record<string, number> = {};
  assigns.forEach((a: any) => {
    count[a.typeId] = (count[a.typeId] || 0) + 1;
    if (a.daysOverride !== null && a.daysOverride !== undefined) {
      custom[a.typeId] = (custom[a.typeId] || 0) + 1;
    }
  });

  const out: Record<string, any> = {};
  types.forEach((t: any) => {
    const assignAll = t.assignAll === false ? false : true;
    out[t.typeId] = {
      assignAll,
      assigned: assignAll ? total : count[t.typeId] || 0,
      listed: count[t.typeId] || 0,
      customCount: custom[t.typeId] || 0,
    };
  });
  return { total, byType: out };
}
