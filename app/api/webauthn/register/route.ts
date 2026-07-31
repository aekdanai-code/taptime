/**********************************************************************
 * /api/webauthn/register
 *   GET  -> ขอ options สำหรับผูกอุปกรณ์ (พร้อมตั้ง challenge cookie)
 *   POST -> ส่งผลลัพธ์จาก navigator.credentials.create() มาตรวจและบันทึก
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { T, findOne } from '@/lib/db';
import {
  registrationOptions, verifyRegistration, deviceNameFromUA,
  packChallenge, unpackChallenge, CHALLENGE_COOKIE, challengeCookieOptions,
} from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getSession();
  if (!session)
    return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

  const emp: any = await findOne(T.PROFILES, 'empId', session.empId);
  if (!emp)
    return NextResponse.json({ error: 'ไม่พบข้อมูลพนักงาน' }, { status: 404 });

  const origin = req.nextUrl.origin;
  const options = await registrationOptions(emp, origin);

  const res = NextResponse.json(options);
  res.cookies.set(
    CHALLENGE_COOKIE,
    packChallenge(options.challenge, emp.empId, 'register'),
    challengeCookieOptions
  );
  return res;
}

export async function POST(req: NextRequest) {
  try {
    const session = getSession();
    if (!session)
      return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });

    const packed = unpackChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value);
    if (!packed || packed.p !== 'register' || packed.e !== session.empId)
      return NextResponse.json(
        { error: 'คำขอหมดอายุ กรุณาลองใหม่' },
        { status: 400 }
      );

    const emp: any = await findOne(T.PROFILES, 'empId', session.empId);
    if (!emp)
      return NextResponse.json({ error: 'ไม่พบข้อมูลพนักงาน' }, { status: 404 });

    const body = await req.json();
    const name =
      body?.deviceName || deviceNameFromUA(req.headers.get('user-agent') || '');

    const out = await verifyRegistration(
      emp, body.response ?? body, packed.c, name, req.nextUrl.origin
    );

    const res = NextResponse.json({ ok: true, ...out, deviceName: name });
    res.cookies.set(CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'ผูกอุปกรณ์ไม่สำเร็จ' },
      { status: 400 }
    );
  }
}
