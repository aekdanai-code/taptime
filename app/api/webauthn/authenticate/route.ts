/**********************************************************************
 * GET /api/webauthn/authenticate
 *   ขอ options + challenge สำหรับยืนยันตัวตนก่อนเช็คอิน/เช็คเอาท์
 *   (ตัว assertion จะถูกส่งไปพร้อมกับ POST /api/rpc)
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  authenticationOptions, hasCredential,
  packChallenge, CHALLENGE_COOKIE, challengeCookieOptions,
} from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession();
  if (!session)
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

  if (!(await hasCredential(session.empId)))
    return NextResponse.json(
      { error: 'ยังไม่ได้ผูกอุปกรณ์', code: 'not_enrolled' },
      { status: 409 }
    );

  const options = await authenticationOptions(session.empId, req.nextUrl.origin);

  const res = NextResponse.json(options);
  res.cookies.set(
    CHALLENGE_COOKIE,
    packChallenge(options.challenge, session.empId, 'auth'),
    challengeCookieOptions
  );
  return res;
}
