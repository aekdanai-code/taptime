/**********************************************************************
 * GET /login — หน้าเข้าสู่ระบบ (Supabase Auth)
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { readGenerated, htmlResponse } from '@/lib/page';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession();
  if (session) {
    const next =
      req.nextUrl.searchParams.get('next') ||
      (session.role === 'admin' ? '/admin' : '/employee');
    return NextResponse.redirect(new URL(next, req.url));
  }
  return htmlResponse(readGenerated('login.html'));
}
