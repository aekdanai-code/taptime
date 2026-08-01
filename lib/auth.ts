/**********************************************************************
 * auth.ts — ตรวจสิทธิ์จาก "ฐานข้อมูลจริง" ไม่ใช่จาก cookie
 *
 * ทำไมไม่เชื่อ role ใน cookie:
 *   role ถูกใส่ลง cookie ตอน login แล้วอยู่ยาว 30 วัน
 *   ถ้าแอดมินเพิ่งเลื่อนใครเป็น admin คนนั้นต้อง logout/login ใหม่ถึงจะเข้าได้
 *   และถ้าถอดสิทธิ์ใคร คนนั้นยังเข้าหน้าแอดมินได้จนกว่า cookie จะหมดอายุ
 *
 * จึงอ่าน role สด ๆ จากตาราง profiles ทุกครั้งที่ตรวจสิทธิ์
 * (เป็น query เล็ก ๆ และเกิดเฉพาะงานฝั่งแอดมิน ซึ่งปริมาณน้อย)
 **********************************************************************/
import { T, findOne } from './db';
import { getSession, Session } from './session';

export type Viewer = {
  empId: string;
  name: string;
  role: string;        // role ปัจจุบันจากฐานข้อมูล
  isAdmin: boolean;
  active: boolean;
};

/** อ่านผู้ใช้ปัจจุบันพร้อม role ล่าสุด — คืน null ถ้าไม่มี session หรือถูกลบ/ระงับ */
export async function currentViewer(
  session?: Session | null
): Promise<Viewer | null> {
  const s = session === undefined ? getSession() : session;
  if (!s?.empId) return null;

  const emp: any = await findOne(T.PROFILES, 'empId', s.empId);
  if (!emp) return null;

  const active = String(emp.status || 'active').toLowerCase() !== 'inactive';
  const role = emp.role === 'admin' ? 'admin' : emp.role || 'employee';

  return {
    empId: emp.empId,
    name: emp.name,
    role,
    isAdmin: role === 'admin' && active,
    active,
  };
}

/** true = เป็นแอดมินที่ยัง active อยู่ ณ ตอนนี้ */
export async function isAdminNow(session?: Session | null): Promise<boolean> {
  const v = await currentViewer(session);
  return !!v?.isAdmin;
}
