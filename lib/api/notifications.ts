/**********************************************************************
 * notifications.ts — ระบบแจ้งเตือนในแอป (badge + รายการ)
 *
 * 1 เหตุการณ์ -> อาจสร้างหลายแถว (แถวละ 1 ผู้รับ) เพื่อให้แต่ละคน
 * มีสถานะอ่าน/ยังไม่อ่านของตัวเอง
 *
 * เหตุการณ์ที่แจ้ง
 *   พนักงานยื่นลา / ยื่นคำขอแก้เวลา  -> แจ้งแอดมินทุกคน
 *   แอดมินอนุมัติ / ปฏิเสธ           -> แจ้งกลับไปหาพนักงานคนนั้น
 *   มีคนขาดงาน (cron รายวัน)         -> แจ้งแอดมินทุกคน
 **********************************************************************/
import { T, readObjects, supabaseAdmin } from '../db';

export type NotiType =
  | 'leave_submitted'
  | 'leave_decided'
  | 'timeedit_submitted'
  | 'timeedit_decided'
  | 'ot_submitted'
  | 'ot_decided'
  | 'absent';

/** แท็บปลายทางเมื่อกดจากรายการแจ้งเตือน */
const TAB_OF: Record<NotiType, string> = {
  leave_submitted: 'leaves',
  leave_decided: 'leave',
  timeedit_submitted: 'timeedits',
  timeedit_decided: 'history',
  ot_submitted: 'otapprove',
  ot_decided: 'history',
  absent: 'daily',
};

/** รายชื่อ empId ของแอดมินที่ยัง active */
async function adminIds(): Promise<string[]> {
  const rows = await readObjects(T.PROFILES, { role: 'admin' });
  return rows
    .filter((e: any) => String(e.status || 'active').toLowerCase() !== 'inactive')
    .map((e: any) => e.empId);
}

/**
 * สร้างแจ้งเตือน (ไม่ throw — แจ้งเตือนล้มเหลวต้องไม่ทำให้งานหลักพัง)
 * @param to รายชื่อผู้รับ (empId)
 */
export async function notify(
  to: string[],
  type: NotiType,
  title: string,
  body: string,
  opts: { refId?: string; actorId?: string } = {}
) {
  const ids = (to || []).filter(Boolean);
  if (!ids.length) return 0;

  const rows = ids.map((empId) => ({
    empId,
    type,
    title,
    body,
    tab: TAB_OF[type] || null,
    refId: opts.refId || null,
    actorId: opts.actorId || null,
    isRead: false,
  }));

  try {
    const { error } = await supabaseAdmin().from(T.NOTIFICATIONS).insert(rows);
    if (error) throw new Error(error.message);
    return rows.length;
  } catch (e) {
    console.error('[notify]', (e as any)?.message || e);
    return 0;
  }
}

/** แจ้งแอดมินทุกคน */
export async function notifyAdmins(
  type: NotiType,
  title: string,
  body: string,
  opts: { refId?: string; actorId?: string } = {}
) {
  const ids = await adminIds();
  // ไม่ต้องแจ้งตัวเอง (กรณีแอดมินยื่นลาเอง)
  const targets = opts.actorId ? ids.filter((id) => id !== opts.actorId) : ids;
  return notify(targets, type, title, body, opts);
}

/* ==================== ฝั่ง client ==================== */

/** รายการแจ้งเตือนของฉัน (ล่าสุด 50 รายการ) + จำนวนที่ยังไม่อ่าน */
export async function listNotifications(empId: string) {
  const rows = await readObjects(T.NOTIFICATIONS, { empId });
  const sorted = rows
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 50);
  return {
    unread: rows.filter((n: any) => !n.isRead).length,
    items: sorted,
  };
}

/** จำนวนที่ยังไม่อ่าน (ใช้กับ badge — เบากว่าโหลดทั้งรายการ) */
export async function unreadCount(empId: string) {
  const { count, error } = await supabaseAdmin()
    .from(T.NOTIFICATIONS)
    .select('notiId', { count: 'exact', head: true })
    .eq('empId', empId)
    .eq('isRead', false);
  if (error) throw new Error(error.message);
  return { unread: count || 0 };
}

/**
 * ทำเครื่องหมายว่าอ่านแล้ว
 * @param ids ระบุ = อ่านเฉพาะรายการนั้น | ไม่ระบุ = อ่านทั้งหมดของคนนี้
 */
export async function markNotificationsRead(empId: string, ids?: any[]) {
  let q = supabaseAdmin()
    .from(T.NOTIFICATIONS)
    .update({ isRead: true })
    .eq('empId', empId)
    .eq('isRead', false);

  if (Array.isArray(ids) && ids.length) {
    q = q.in('notiId', ids.map((n) => Number(n)).filter(Number.isFinite));
  }

  const { error } = await q;
  if (error) throw new Error(error.message);
  return true;
}
