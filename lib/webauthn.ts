/**********************************************************************
 * webauthn.ts — passkey / biometric (WebAuthn) ฝั่งเซิร์ฟเวอร์
 *
 * ใช้เพื่อยืนยันว่า "คนที่กดเช็คอินคือเจ้าของบัญชีจริง และอยู่ที่อุปกรณ์ที่ผูกไว้"
 *   - credential ถูกผูกกับ empId ในตาราง webauthn_credentials
 *   - ต้องปลดล็อกด้วย Face ID / ลายนิ้วมือ / PIN ของเครื่อง (userVerification)
 *   - challenge เก็บใน cookie ที่เซ็น HMAC อายุ 2 นาที (stateless, กัน replay)
 **********************************************************************/
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { T, readObjects, findOne, appendObject, updateByKey, deleteByKey } from './db';

export const CHALLENGE_COOKIE = 'tt_wa';
const CHALLENGE_TTL = 120; // วินาที

/* ---------------------------------------------------------------- RP config */

/** ชื่อโดเมนที่ passkey ผูกอยู่ — ต้องตรงกับโดเมนที่เปิดเว็บจริง */
export function rpConfig(reqOrigin?: string) {
  const raw = reqOrigin || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = new URL(raw);
  return {
    rpID: url.hostname,           // localhost / taptime.vercel.app
    origin: url.origin,
    rpName: 'TapTime',
  };
}

/* ------------------------------------------------------- challenge (cookie) */

function secret() {
  const s = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('ยังไม่ได้ตั้งค่า SESSION_SECRET');
  return s;
}

export function packChallenge(challenge: string, empId: string, purpose: string) {
  const body = Buffer.from(
    JSON.stringify({ c: challenge, e: empId, p: purpose, x: Date.now() / 1000 + CHALLENGE_TTL })
  ).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function unpackChallenge(raw?: string | null) {
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const body = raw.slice(0, i);
  const expect = createHmac('sha256', secret()).update(body).digest('base64url');
  try {
    const a = Buffer.from(raw.slice(i + 1));
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!o.x || o.x < Date.now() / 1000) return null;
    return o as { c: string; e: string; p: string };
  } catch {
    return null;
  }
}

export const challengeCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: CHALLENGE_TTL,
};

/* ---------------------------------------------------------- credential CRUD */

export async function listCredentials(empId: string) {
  return readObjects(T.WEBAUTHN, { empId });
}

export async function hasCredential(empId: string) {
  return (await listCredentials(empId)).length > 0;
}

export async function deleteCredential(credentialId: string) {
  return deleteByKey(T.WEBAUTHN, 'credentialId', credentialId);
}

/* --------------------------------------------------------------- ลงทะเบียน */

export async function registrationOptions(emp: any, origin?: string) {
  const { rpID, rpName } = rpConfig(origin);
  const existing = await listCredentials(emp.empId);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: emp.email || emp.empId,
    userDisplayName: emp.name || emp.empId,
    userID: new TextEncoder().encode(emp.empId),
    attestationType: 'none',
    // กันผูกอุปกรณ์เดิมซ้ำ
    excludeCredentials: existing.map((c: any) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(',') : undefined,
    })),
    authenticatorSelection: {
      // ต้องเป็นตัวเครื่องเอง (Face ID / ลายนิ้วมือ) ไม่ใช่กุญแจ USB ที่ถอดไปให้คนอื่นได้
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  return options;
}

export async function verifyRegistration(
  emp: any,
  response: any,
  expectedChallenge: string,
  deviceName: string,
  reqOrigin?: string
) {
  const { rpID, origin } = rpConfig(reqOrigin);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('ลงทะเบียนอุปกรณ์ไม่สำเร็จ');
  }

  const { credential, credentialBackedUp } = verification.registrationInfo;

  await appendObject(T.WEBAUTHN, {
    credentialId: credential.id,
    empId: emp.empId,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter ?? 0,
    transports: (credential.transports || []).join(','),
    deviceName: deviceName || 'อุปกรณ์ของฉัน',
    backedUp: !!credentialBackedUp,
  });

  return { credentialId: credential.id };
}

/* -------------------------------------------------------------- ยืนยันตัวตน */

export async function authenticationOptions(empId: string, origin?: string) {
  const { rpID } = rpConfig(origin);
  const creds = await listCredentials(empId);

  return generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c: any) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(',') : undefined,
    })),
    userVerification: 'required', // บังคับ biometric / PIN ทุกครั้ง
  });
}

/**
 * ตรวจ assertion — คืน credentialId ถ้าผ่าน, throw ถ้าไม่ผ่าน
 * ตรวจด้วยว่า credential นั้น "เป็นของ empId คนนี้จริง"
 */
export async function verifyAuthentication(
  empId: string,
  response: any,
  expectedChallenge: string,
  reqOrigin?: string
): Promise<string> {
  const { rpID, origin } = rpConfig(reqOrigin);

  const cred: any = await findOne(T.WEBAUTHN, 'credentialId', response?.id);
  if (!cred) throw new Error('ไม่พบอุปกรณ์ที่ลงทะเบียนไว้ กรุณาผูกอุปกรณ์ใหม่');
  if (cred.empId !== empId)
    throw new Error('อุปกรณ์นี้ผูกอยู่กับพนักงานคนอื่น');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: cred.credentialId,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
      counter: Number(cred.counter || 0),
      transports: cred.transports ? cred.transports.split(',') : undefined,
    },
  });

  if (!verification.verified) throw new Error('ยืนยันตัวตนไม่สำเร็จ');

  const newCounter = verification.authenticationInfo.newCounter;
  // counter ที่ไม่เพิ่มขึ้น = สัญญาณว่า credential ถูกโคลน
  if (Number(cred.counter || 0) > 0 && newCounter > 0 && newCounter <= Number(cred.counter)) {
    throw new Error('ตรวจพบความผิดปกติของอุปกรณ์ กรุณาติดต่อผู้ดูแลระบบ');
  }

  await updateByKey(T.WEBAUTHN, 'credentialId', cred.credentialId, {
    counter: newCounter,
    lastUsedAt: new Date().toISOString(),
  });

  return cred.credentialId;
}

/** ตั้งชื่ออุปกรณ์แบบอ่านง่ายจาก user-agent */
export function deviceNameFromUA(ua = '') {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'อุปกรณ์ของฉัน';
}
