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
import { headers } from 'next/headers';
import { T, findOne, updateByKey, supabaseAdmin } from '../db';

/**
 * หา URL ของเว็บสำหรับใส่ในลิงก์อีเมล
 *
 * ลำดับความน่าเชื่อถือ:
 *   1. โดเมนที่แอดมิน "กำลังเปิดอยู่จริง" (จาก header ของ request)
 *      — แม่นที่สุด และไม่พังแม้ลืมตั้ง/ลืม redeploy env
 *   2. NEXT_PUBLIC_APP_URL ที่ตั้งไว้
 *   3. VERCEL_URL ที่ Vercel ใส่ให้อัตโนมัติ
 *   4. localhost (ตอน dev)
 *
 * เดิมใช้แค่ข้อ 2 อย่างเดียว ซึ่งมีปัญหาเพราะ Next.js ฝังค่า NEXT_PUBLIC_*
 * ตั้งแต่ตอน build — แก้ค่าใน Vercel แล้วไม่ redeploy ค่าเก่าจะยังติดอยู่
 */
export function appUrl(): string {
  try {
    const h = headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    if (host && !/^localhost|^127\.0\.0\.1/.test(host)) {
      const proto = h.get('x-forwarded-proto') || 'https';
      return `${proto}://${host}`;
    }
    if (host) return `http://${host}`;
  } catch {
    /* เรียกนอก request context — ข้ามไปใช้ env แทน */
  }

  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
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
    return { ok: true, mode: 'reset', email, redirectTo };
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

  return { ok: true, mode: 'invite', email, redirectTo };
}

/** ข้อความ error ของ Supabase -> ภาษาไทยที่เข้าใจง่าย */
function mapMailError(msg: string) {
  if (/rate limit|too many/i.test(msg))
    return 'ส่งอีเมลบ่อยเกินไป (SMTP ในตัวของ Supabase จำกัด ~4 ฉบับ/ชั่วโมง) — ตั้ง Custom SMTP เพื่อส่งได้ไม่จำกัด';
  if (/smtp|mail/i.test(msg))
    return 'ส่งอีเมลไม่สำเร็จ: ' + msg + ' — ตรวจการตั้งค่า Email ใน Supabase Dashboard';
  return msg;
}
