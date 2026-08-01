/**********************************************************************
 * invite.ts — อีเมลเชิญพนักงานตั้งรหัสผ่าน (ผ่าน Supabase Auth)
 *
 * ใช้ `auth.admin.inviteUserByEmail()` ของ Supabase:
 *   - สร้าง user ใน auth.users ให้อัตโนมัติ (ถ้ายังไม่มี)
 *   - ส่งอีเมลตามเทมเพลต "Invite user" ใน Supabase Dashboard
 *   - ลิงก์ในอีเมลพากลับมาที่ /set-password เพื่อตั้งรหัสผ่าน
 *
 * ⚠️ ข้อจำกัดของ SMTP ที่ Supabase ให้มาในตัว (ไม่ได้ตั้ง Custom SMTP)
 *   1. ส่งได้ **เฉพาะอีเมลที่เป็นสมาชิกทีมของ organization** เท่านั้น
 *      อีเมลอื่นจะถูกปฏิเสธด้วย "Email address not authorized"
 *      -> เชิญพนักงานจริงไม่ได้เลย ต้องตั้ง Custom SMTP เท่านั้น
 *   2. จำกัด 2 ฉบับ/ชั่วโมง
 *   3. ไม่มี SLA — Supabase ระบุว่าไม่เหมาะกับการใช้งานจริง
 *
 * ตั้ง Custom SMTP ที่ Authentication -> Emails -> SMTP Settings
 * แล้วปรับเพดานที่ Authentication -> Rate Limits (ค่าเริ่มต้นหลังตั้ง = 30/ชม.)
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
  if (env) return toOrigin(env);
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

/**
 * ตัด path ออกให้เหลือแค่ origin
 * กันกรณีตั้งค่าเป็น `https://xxx.vercel.app/admin` แล้วลิงก์ในอีเมล
 * กลายเป็น `/admin/set-password` ซึ่งเป็นหน้า 404
 */
export function toOrigin(raw: string): string {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  try {
    return new URL(s).origin;
  } catch {
    return s;
  }
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
  // อาการที่พบบ่อยที่สุดตอนยังไม่ได้ตั้ง Custom SMTP
  if (/not authorized|not_authorized/i.test(msg))
    return 'ส่งไม่ได้: SMTP ที่ Supabase ให้มาในตัว ส่งได้เฉพาะอีเมลของสมาชิกทีมใน organization ' +
           'เท่านั้น — ต้องตั้ง Custom SMTP (Authentication → Emails → SMTP Settings) ' +
           'ถึงจะส่งหาพนักงานได้';
  if (/rate limit|too many|429/i.test(msg))
    return 'ส่งอีเมลบ่อยเกินไป — SMTP ในตัวจำกัด 2 ฉบับ/ชม. ' +
           '(ตั้ง Custom SMTP แล้วจะเป็น 30 ฉบับ/ชม. และปรับเพิ่มได้ที่ Authentication → Rate Limits)';
  if (/smtp|mail/i.test(msg))
    return 'ส่งอีเมลไม่สำเร็จ: ' + msg + ' — ตรวจการตั้งค่า Email ใน Supabase Dashboard';
  return msg;
}
