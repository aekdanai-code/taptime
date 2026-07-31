/**********************************************************************
 * device.ts — แยกชนิดอุปกรณ์จาก user-agent
 *
 * ใช้ตัดสินว่าหลัง login จะพาไปหน้าไหน:
 *   admin + desktop -> /admin
 *   ทุกกรณีบนมือถือ  -> /employee
 **********************************************************************/

const MOBILE_RE =
  /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Silk/i;
const TABLET_RE = /iPad|Tablet|PlayBook|Nexus 7|Nexus 10|SM-T/i;

export type DeviceKind = 'mobile' | 'tablet' | 'desktop';

export function deviceKind(ua = ''): DeviceKind {
  // iPadOS 13+ ปลอม UA เป็น Macintosh — แยกด้วยการมี touch ไม่ได้ฝั่งเซิร์ฟเวอร์
  // จึงอาศัย hint จาก client (ดูหมายเหตุใน login) ร่วมด้วย
  if (TABLET_RE.test(ua)) return 'tablet';
  if (MOBILE_RE.test(ua)) return 'mobile';
  return 'desktop';
}

/** มือถือและแท็บเล็ตถือเป็น "จอเล็ก" -> ไปหน้าพนักงาน */
export function isHandheld(ua = '', clientHint?: string | null) {
  if (clientHint === 'mobile') return true;
  if (clientHint === 'desktop') return false;
  return deviceKind(ua) !== 'desktop';
}

/** หน้าปลายทางหลัง login */
export function landingFor(role: string, handheld: boolean) {
  if (role === 'admin' && !handheld) return '/admin';
  return '/employee';
}
