/**********************************************************************
 * GET / — router หลัก (แทน doGet ของ Apps Script)
 *
 * ลิงก์เดิม ?page=employee&token=xxx **ไม่รองรับแล้ว** (ยกเลิกระบบ token)
 * ทุกคนต้องผ่านหน้า /login
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isHandheld, landingFor } from '@/lib/device';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.redirect(new URL('/login', req.url));

  const handheld = isHandheld(req.headers.get('user-agent') || '');
  return NextResponse.redirect(
    new URL(landingFor(session.role, handheld), req.url)
  );
}
