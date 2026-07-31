/**********************************************************************
 * POST /api/rpc — จุดเดียวที่ frontend คุยกับ backend
 *
 * body: { fn: string, args: any[], webauthn?: assertion, meta?: {accuracy} }
 * ok   -> 200 { ...ผลลัพธ์ }
 * fail -> 4xx/5xx { error: 'ข้อความ' }
 *
 * ชั้นความปลอดภัย
 *  1. ADMIN_FNS      -> ต้องมี session role = 'admin'
 *  2. EMPLOYEE_FNS   -> ต้องมี session, และ **เขียนทับ args[0] ด้วย empId จาก
 *                       session เสมอ** -> ปลอมเป็นคนอื่นไม่ได้
 *  3. BIOMETRIC_FNS  -> ต้องแนบ WebAuthn assertion ที่ผ่านการตรวจ (เว้นคนที่
 *                       แอดมินตั้ง webauthnExempt ไว้)
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import {
  REGISTRY, ADMIN_FNS, EMPLOYEE_FNS, BIOMETRIC_FNS, applyIdentity,
} from '@/lib/rpc';
import { getSession } from '@/lib/session';
import { T, findOne } from '@/lib/db';
import {
  verifyAuthentication, unpackChallenge, CHALLENGE_COOKIE,
} from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    ''
  );
}

export async function POST(req: NextRequest) {
  let fn = '';
  try {
    const body = await req.json();
    fn = String(body?.fn || '');
    let args: any[] = Array.isArray(body?.args) ? [...body.args] : [];

    const handler = REGISTRY[fn];
    if (!handler) {
      return NextResponse.json(
        { error: `ไม่รู้จักฟังก์ชัน "${fn}"` },
        { status: 404 }
      );
    }

    const session = getSession();

    /* ---------- 1. ฟังก์ชันฝั่งแอดมิน ---------- */
    if (ADMIN_FNS.has(fn)) {
      if (!session || session.role !== 'admin') {
        return NextResponse.json(
          { error: 'ต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ', code: 'unauthorized' },
          { status: 401 }
        );
      }
    }

    /* ---------- 2. ฟังก์ชันฝั่งพนักงาน ---------- */
    if (EMPLOYEE_FNS.has(fn)) {
      if (!session) {
        return NextResponse.json(
          { error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', code: 'unauthorized' },
          { status: 401 }
        );
      }
      // เขียนทับตัวตนเสมอ — ค่าที่ client ส่งมาไม่มีผลใด ๆ
      args = applyIdentity(fn, args, session);
    }

    /* ---------- 3. ฟังก์ชันที่ต้องยืนยัน biometric ---------- */
    if (BIOMETRIC_FNS.has(fn)) {
      const emp: any = await findOne(T.PROFILES, 'empId', session!.empId);
      const exempt = !!emp?.webauthnExempt;
      let credentialId: string | null = null;

      if (!exempt) {
        const assertion = body?.webauthn;
        if (!assertion) {
          return NextResponse.json(
            {
              error: 'ต้องยืนยันตัวตนด้วย Face ID / ลายนิ้วมือ ก่อนลงเวลา',
              code: 'webauthn_required',
            },
            { status: 401 }
          );
        }

        const packed = unpackChallenge(req.cookies.get(CHALLENGE_COOKIE)?.value);
        if (!packed || packed.p !== 'auth' || packed.e !== session!.empId) {
          return NextResponse.json(
            { error: 'คำขอยืนยันตัวตนหมดอายุ กรุณาลองใหม่', code: 'webauthn_expired' },
            { status: 401 }
          );
        }

        credentialId = await verifyAuthentication(
          session!.empId, assertion, packed.c, req.nextUrl.origin
        );
      }

      // meta ฝั่งเซิร์ฟเวอร์ (client ปลอมไม่ได้) — ส่งเป็น argument ที่ 4
      args[3] = {
        accuracy: Number(body?.meta?.accuracy),
        credentialId,
        ip: clientIp(req),
        userAgent: req.headers.get('user-agent') || '',
      };
    }

    const result = await handler(...args);

    const res = NextResponse.json(result === undefined ? null : result);
    // challenge ใช้ได้ครั้งเดียว
    if (BIOMETRIC_FNS.has(fn)) {
      res.cookies.set(CHALLENGE_COOKIE, '', { path: '/', maxAge: 0 });
    }
    return res;
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error(`[rpc:${fn}]`, msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
