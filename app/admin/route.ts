/**********************************************************************
 * GET /admin — หน้าแอดมิน (SPA เดิม ไม่แก้ไข UI)
 *
 * ต้องเข้าสู่ระบบและ profiles.role = 'admin'
 * ถ้าเปิดบนมือถือ -> เด้งไป /employee (ตามที่ตกลงไว้)
 *   แต่ยังเข้าได้ด้วย /admin?force=1 เผื่อต้องอนุมัติใบลาด่วนจากมือถือ
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { readGenerated, htmlResponse } from '@/lib/page';
import { getSession } from '@/lib/session';
import { isHandheld } from '@/lib/device';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession();
  if (!session || session.role !== 'admin') {
    const url = new URL('/login', req.url);
    url.searchParams.set('next', '/admin');
    return NextResponse.redirect(url);
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  if (!force && isHandheld(req.headers.get('user-agent') || '')) {
    return NextResponse.redirect(new URL('/employee', req.url));
  }

  return htmlResponse(readGenerated('admin.html'));
}
