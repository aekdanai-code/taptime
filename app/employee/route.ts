/**********************************************************************
 * GET /employee — หน้าพนักงาน (SPA มือถือเดิม ไม่แก้ไข UI)
 *
 * ** เปลี่ยนจากเดิม: ยกเลิกการเข้าผ่าน ?token=xxxx แล้ว **
 * ต้องเข้าสู่ระบบเท่านั้น — ตัวตนมาจาก session cookie ที่เซ็น HMAC
 *
 * ตัวแปร TOKEN ในหน้าเว็บเดิมยังอยู่ (เพื่อไม่ต้องแก้ HTML) แต่ถูกแทนด้วย empId
 * และเซิร์ฟเวอร์ **ไม่เชื่อค่านี้** — /api/rpc เขียนทับด้วย empId จาก session เสมอ
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { readGenerated, htmlResponse } from '@/lib/page';
import { getSession } from '@/lib/session';
import { T, findOne } from '@/lib/db';
import { hasCredential } from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession();
  if (!session) {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', '/employee');
    return NextResponse.redirect(url);
  }

  const emp: any = await findOne(T.PROFILES, 'empId', session.empId);
  if (!emp) {
    const url = new URL('/login', req.url);
    return NextResponse.redirect(url);
  }

  // ต้องผูก passkey ไหม (บังคับ เว้นแต่แอดมินตั้งยกเว้นให้)
  const exempt = !!emp.webauthnExempt;
  const enrolled = exempt ? true : await hasCredential(emp.empId);

  const html = readGenerated('employee.html')
    .replace(/__TAPTIME_TOKEN__/g, String(emp.empId))
    .replace(/__TAPTIME_WEBAUTHN__/g, JSON.stringify({
      required: !exempt,
      enrolled,
      name: emp.name,
    }))
    .replace(/__TAPTIME_IS_ADMIN__/g, session.role === 'admin' ? 'true' : 'false');

  return htmlResponse(html);
}
