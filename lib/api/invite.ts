/**********************************************************************
 * invite.ts — อีเมลเชิญพนักงานตั้งรหัสผ่าน (ผ่าน Supabase Auth)
 *
 * ใช้ `auth.admin.inviteUserByEmail()` ของ Supabase:
 *   - สร้าง user ใน auth.users ให้อัตโนมัติ (ถ้ายังไม่มี)
 *   - ส่งอีเมลตามเทมเพลต "Invite user" ใน Supabase Dashboard
 *   - ลิงก์ในอีเมลพากลับมาที่ /set-password เพื่อตั้งรหัสผ่าน
 *
 * หมายเหตุโควตา: SMTP ในตัวของ Supabase จำกัดประมาณ 4 ฉบับ/ชั่วโมง
 * ถ้าจะใช้งานจริงจัง ให้ตั้ง Custom SMTP ใน Supabase Dashboard
 * (Authentication -> Emails -> SMTP Settings)
 **********************************************************************/
import { T, findOne, updateByKey, supabaseAdmin } from '../db';

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** ค้นหา auth user จากอีเมล (Supabase ยังไม่มี getUserByEmail ตรง ๆ) */
async function findAuthUserByEmail(email: string) {
  const admin = supabaseAdmin();
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users: any[] = (data?.users as any[]) || [];
    const hit = users.find((u) => String(u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

/**
 * ส่งอีเมลเชิญตั้งรหัสผ่านให้พนักงาน
 * - ยังไม่มีบัญชี  -> inviteUserByEmail (ส่งอีเมล "คุณได้รับเชิญ")
 * - มีบัญชีแล้ว    -> ส่งลิงก์รีเซ็ตรหัสผ่านแทน
 */
export async function inviteEmployee(empId: string) {
  const emp: any = await findOne(T.PROFILES, 'empId', empId);
  if (!emp) throw new Error('ไม่พบพนักงาน');

  const email = String(emp.email || '').trim().toLowerCase();
  if (!email) throw new Error('พนักงานคนนี้ยังไม่มีอีเมล — กรุณากรอกอีเมลก่อน');

  const admin = supabaseAdmin();
  const redirectTo = `${appUrl()}/set-password`;

  const existing = await findAuthUserByEmail(email);

  if (existing) {
    // มีบัญชีแล้ว -> ส่งลิงก์ตั้งรหัสผ่านใหม่
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(mapMailError(error.message));

    if (emp.authUserId !== existing.id) {
      await updateByKey(T.PROFILES, 'empId', empId, { authUserId: existing.id });
    }
    await updateByKey(T.PROFILES, 'empId', empId, {
      invitedAt: new Date().toISOString(),
    });
    return { ok: true, mode: 'reset', email };
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { empId: emp.empId, name: emp.name },
  });
  if (error) throw new Error(mapMailError(error.message));

  await updateByKey(T.PROFILES, 'empId', empId, {
    authUserId: data?.user?.id || null,
    invitedAt: new Date().toISOString(),
  });

  return { ok: true, mode: 'invite', email };
}

/** ข้อความ error ของ Supabase -> ภาษาไทยที่เข้าใจง่าย */
function mapMailError(msg: string) {
  if (/rate limit|too many/i.test(msg))
    return 'ส่งอีเมลบ่อยเกินไป (SMTP ในตัวของ Supabase จำกัด ~4 ฉบับ/ชั่วโมง) — ตั้ง Custom SMTP เพื่อส่งได้ไม่จำกัด';
  if (/smtp|mail/i.test(msg))
    return 'ส่งอีเมลไม่สำเร็จ: ' + msg + ' — ตรวจการตั้งค่า Email ใน Supabase Dashboard';
  return msg;
}
