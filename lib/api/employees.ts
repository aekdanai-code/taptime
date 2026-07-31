/**********************************************************************
 * employees.ts — พอร์ตจาก Employees.gs
 *   ตาราง Employees เดิม -> ตาราง profiles (ผูก Supabase Auth ผ่าน authUserId)
 **********************************************************************/
import { T, readObjects, findOne, appendObject, updateByKey, deleteByKey, supabaseAdmin } from '../db';
import { uid, normalizeEmp } from '../helpers';

/** รายชื่อพนักงาน (แนบชื่อสาขา + normalize วันที่) */
export async function listEmployees() {
  const [emps, branchRows] = await Promise.all([
    readObjects(T.PROFILES),
    readObjects(T.BRANCHES),
  ]);
  const branches: Record<string, string> = {};
  branchRows.forEach((b: any) => (branches[b.branchId] = b.name));

  return emps
    .map((e: any) => {
      normalizeEmp(e);
      e.branchName = branches[e.branchId] || '';
      return e;
    })
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'th'));
}

/**
 * เพิ่ม/แก้ไขพนักงาน (มี empId = แก้ไข, ไม่มี = เพิ่มใหม่)
 *
 * ** ใหม่: ถ้าเป็นการเพิ่มพนักงานและมีอีเมล -> ส่งอีเมลเชิญตั้งรหัสผ่านทันที **
 * ถ้าเป็นการแก้ไขแล้วเพิ่งใส่อีเมลเข้าไปครั้งแรก ก็ส่งเชิญให้เช่นกัน
 * (ถ้าส่งอีเมลไม่สำเร็จ จะไม่ทำให้การบันทึกพนักงานล้มเหลว — คืน inviteError มาแทน)
 */
export async function saveEmployee(emp: any) {
  emp = { ...emp };
  delete emp.branchName; // คอลัมน์เสริมจาก listEmployees
  delete emp.authUserId; // ห้ามแก้จากฟอร์ม
  delete emp.token;      // เลิกใช้ token แล้ว

  if (emp.email) emp.email = String(emp.email).trim().toLowerCase();

  let isNew = true;
  let hadEmailBefore = false;

  if (emp.empId) {
    const found: any = await findOne(T.PROFILES, 'empId', emp.empId);
    if (found) {
      isNew = false;
      hadEmailBefore = !!found.email;
      await updateByKey(T.PROFILES, 'empId', emp.empId, emp);
    }
  }

  if (isNew) {
    emp.empId = uid('EMP-');
    if (!emp.status) emp.status = 'active';
    if (!emp.role) emp.role = 'employee';
    await appendObject(T.PROFILES, emp);
  }

  /* ---- ส่งอีเมลเชิญตั้งรหัสผ่าน ---- */
  const shouldInvite = !!emp.email && (isNew || !hadEmailBefore);
  if (shouldInvite) {
    try {
      const { inviteEmployee } = await import('./invite');
      const r = await inviteEmployee(emp.empId);
      return { empId: emp.empId, invited: true, email: r.email, mode: r.mode };
    } catch (e: any) {
      return { empId: emp.empId, invited: false, inviteError: e?.message || String(e) };
    }
  }

  return { empId: emp.empId, invited: false };
}

export async function deleteEmployee(empId: string) {
  // ลบ auth user ที่ผูกอยู่ด้วย (ถ้ามี)
  const emp: any = await findOne(T.PROFILES, 'empId', empId);
  if (emp?.authUserId) {
    try {
      await supabaseAdmin().auth.admin.deleteUser(emp.authUserId);
    } catch {
      /* ไม่เป็นไรถ้าไม่มี user แล้ว */
    }
  }
  return deleteByKey(T.PROFILES, 'empId', empId);
}

/* ================= จัดการอุปกรณ์ (passkey) — ฝั่งแอดมิน ================= */

/** รายการอุปกรณ์ที่พนักงานผูกไว้ */
export async function listEmployeeDevices(empId: string) {
  const rows = await readObjects(T.WEBAUTHN, { empId });
  return rows
    .map((c: any) => ({
      credentialId: c.credentialId,
      deviceName: c.deviceName,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
      backedUp: c.backedUp,
    }))
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * ปลดอุปกรณ์ (เช่น พนักงานเปลี่ยนมือถือ / ทำเครื่องหาย)
 * ปลดแล้วพนักงานต้องผูกอุปกรณ์ใหม่ตอนเช็คอินครั้งถัดไป
 */
export async function revokeEmployeeDevice(credentialId: string) {
  return deleteByKey(T.WEBAUTHN, 'credentialId', credentialId);
}

/** ยกเว้นไม่ต้องใช้ passkey (สำหรับเครื่องที่ไม่รองรับ biometric) */
export async function setWebauthnExempt(empId: string, exempt: boolean) {
  const emp = await findOne(T.PROFILES, 'empId', empId);
  if (!emp) throw new Error('ไม่พบพนักงาน');
  await updateByKey(T.PROFILES, 'empId', empId, { webauthnExempt: !!exempt });
  return true;
}

/** ประวัติการเช็คอิน/เอาท์ พร้อมหลักฐาน (ล่าสุด 200 รายการ) */
export async function listCheckinAudit(params: any) {
  params = params || {};
  const filter: any = {};
  if (params.empId) filter.empId = params.empId;
  const rows = await readObjects(T.AUDIT, filter);
  return rows
    .sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 200);
}

/**
 * (ใหม่) สร้าง/ตั้งรหัสผ่านให้พนักงานเข้าสู่ระบบด้วย Supabase Auth
 * - ถ้ายังไม่มี auth user -> สร้างใหม่แล้วผูก authUserId
 * - ถ้ามีแล้ว -> เปลี่ยนรหัสผ่าน
 */
export async function setEmployeePassword(empId: string, password: string) {
  const emp: any = await findOne(T.PROFILES, 'empId', empId);
  if (!emp) throw new Error('ไม่พบพนักงาน');
  if (!emp.email) throw new Error('พนักงานคนนี้ยังไม่มีอีเมล — กรุณากรอกอีเมลก่อน');
  if (!password || password.length < 6)
    throw new Error('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');

  const admin = supabaseAdmin();

  if (emp.authUserId) {
    const { error } = await admin.auth.admin.updateUserById(emp.authUserId, {
      password,
      email: emp.email,
    });
    if (error) throw new Error(error.message);
    return { ok: true, created: false, email: emp.email };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: emp.email,
    password,
    email_confirm: true,
    user_metadata: { empId: emp.empId, name: emp.name },
  });
  if (error) throw new Error(error.message);

  await updateByKey(T.PROFILES, 'empId', empId, { authUserId: data.user.id });
  return { ok: true, created: true, email: emp.email };
}
