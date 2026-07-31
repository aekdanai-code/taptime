/**********************************************************************
 * POST /api/auth/login — เข้าสู่ระบบด้วย Supabase Auth (email/password)
 *
 * ทุกคนใช้หน้านี้หน้าเดียว (ทั้ง admin และพนักงาน) แล้วแยกด้วย profiles.role
 *   admin + เปิดบนเดสก์ท็อป -> /admin
 *   นอกนั้น (รวม admin บนมือถือ) -> /employee
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAnon, T, findOne, updateByKey } from '@/lib/db';
import { encodeSession, COOKIE, cookieOptions } from '@/lib/session';
import { isHandheld, landingFor } from '@/lib/device';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, password, remember, device } = await req.json();
    if (!email || !password)
      return NextResponse.json(
        { error: 'กรุณากรอกอีเมลและรหัสผ่าน' },
        { status: 400 }
      );

    const { data, error } = await supabaseAnon().auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password: String(password),
    });
    if (error || !data?.user)
      return NextResponse.json(
        { error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' },
        { status: 401 }
      );

    // หา profile — ลองจาก authUserId ก่อน แล้วค่อย fallback ที่ email
    let profile: any = await findOne(T.PROFILES, 'authUserId', data.user.id);
    if (!profile) {
      profile = await findOne(T.PROFILES, 'email', data.user.email);
      if (profile) {
        await updateByKey(T.PROFILES, 'empId', profile.empId, {
          authUserId: data.user.id,
        });
      }
    }

    if (!profile)
      return NextResponse.json(
        { error: 'ไม่พบข้อมูลพนักงานที่ผูกกับบัญชีนี้ กรุณาติดต่อผู้ดูแลระบบ' },
        { status: 403 }
      );

    if (String(profile.status || 'active').toLowerCase() === 'inactive')
      return NextResponse.json(
        { error: 'บัญชีนี้ถูกระงับการใช้งาน' },
        { status: 403 }
      );

    const role = profile.role === 'admin' ? 'admin' : 'employee';
    const remembered = !!remember;
    const handheld = isHandheld(req.headers.get('user-agent') || '', device);

    await updateByKey(T.PROFILES, 'empId', profile.empId, {
      lastLoginAt: new Date().toISOString(),
    });

    const res = NextResponse.json({
      ok: true,
      role,
      name: profile.name,
      handheld,
      redirect: landingFor(role, handheld),
    });

    res.cookies.set(
      COOKIE,
      encodeSession({
        empId: profile.empId,
        role,
        name: profile.name,
        remember: remembered,
      }),
      cookieOptions(remembered)
    );
    return res;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'เข้าสู่ระบบไม่สำเร็จ' },
      { status: 500 }
    );
  }
}
