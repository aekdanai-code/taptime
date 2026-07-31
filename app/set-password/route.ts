/**********************************************************************
 * GET /set-password — หน้าตั้งรหัสผ่านจากลิงก์ในอีเมลเชิญ
 *
 * Supabase ส่ง access_token มาใน URL hash (#access_token=...) ซึ่งเซิร์ฟเวอร์
 * มองไม่เห็น จึงต้องให้ supabase-js ฝั่ง browser จัดการเอง
 * ที่นี่แค่ฉีดค่า URL / anon key ลงไปในหน้า
 **********************************************************************/
import { readGenerated, htmlResponse } from '@/lib/page';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const html = readGenerated('set-password.html')
    .replace(/__SUPABASE_URL__/g, process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    .replace(/__SUPABASE_ANON__/g, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
  return htmlResponse(html);
}
