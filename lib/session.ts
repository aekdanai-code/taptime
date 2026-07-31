/**********************************************************************
 * session.ts — session cookie แบบเซ็นด้วย HMAC
 *
 * หลังจากตรวจ email/password กับ Supabase Auth สำเร็จแล้ว เราออก cookie
 * ของเราเองที่บรรจุ { empId, role, name, token } และเซ็นด้วย SESSION_SECRET
 * -> ไม่ต้องยุ่งกับ refresh token ของ Supabase ในทุก request
 **********************************************************************/
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

export const COOKIE = 'tt_session';

/** "จดจำฉันไว้" = 30 วัน | ไม่ติ๊ก = อยู่จนกว่าจะปิดเบราว์เซอร์ (session cookie) */
export const REMEMBER_AGE = 60 * 60 * 24 * 30;
const SESSION_AGE = 60 * 60 * 12; // อายุสูงสุดของ session ที่ไม่ได้ติ๊กจดจำ

export type Session = {
  empId: string;
  role: string;
  name: string;
  remember: boolean;
  exp: number;
};

function secret() {
  const s = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('ยังไม่ได้ตั้งค่า SESSION_SECRET');
  return s;
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function encodeSession(s: Omit<Session, 'exp'>): string {
  const ttl = s.remember ? REMEMBER_AGE : SESSION_AGE;
  const full: Session = { ...s, exp: Math.floor(Date.now() / 1000) + ttl };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeSession(raw?: string | null): Session | null {
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const body = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expect = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const s: Session = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!s.exp || s.exp < Math.floor(Date.now() / 1000)) return null;
    return s;
  } catch {
    return null;
  }
}

/** อ่าน session จาก cookie ของ request ปัจจุบัน */
export function getSession(): Session | null {
  try {
    return decodeSession(cookies().get(COOKIE)?.value);
  } catch {
    return null;
  }
}

/**
 * remember = true  -> ตั้ง maxAge 30 วัน (cookie อยู่ข้ามการปิดเบราว์เซอร์)
 * remember = false -> ไม่ตั้ง maxAge เลย = session cookie หายเมื่อปิดเบราว์เซอร์
 */
export function cookieOptions(remember: boolean) {
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  return remember ? { ...base, maxAge: REMEMBER_AGE } : base;
}
