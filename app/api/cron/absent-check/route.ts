/**********************************************************************
 * GET /api/cron/absent-check
 *   ตรวจว่าวันนี้มีใครขาดงานบ้าง แล้วแจ้งเตือนแอดมิน
 *
 * ถูกเรียกโดย Vercel Cron ตามตาราง (ดู vercel.json)
 * ป้องกันด้วย CRON_SECRET — Vercel จะแนบ Authorization: Bearer <CRON_SECRET>
 * ให้เอง ถ้าตั้ง env ตัวนี้ไว้
 *
 * "ขาดงาน" = วันทำงาน + ไม่มีเช็คอิน + ไม่มีใบลาที่อนุมัติครอบวันนั้น
 * (ใช้เกณฑ์เดียวกับรายงานรายวัน)
 **********************************************************************/
import { NextRequest, NextResponse } from 'next/server';
import { dailyReport } from '@/lib/api/reports';
import { notifyAdmins } from '@/lib/api/notifications';
import { today } from '@/lib/helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const date = req.nextUrl.searchParams.get('date') || today();
    const rep: any = await dailyReport({ date });

    if (rep.isHoliday) {
      return NextResponse.json({ ok: true, date, skipped: 'holiday' });
    }

    const absent = (rep.rows || []).filter((r: any) => r.status === 'absent');
    if (!absent.length) {
      return NextResponse.json({ ok: true, date, absent: 0 });
    }

    const names = absent.map((r: any) => r.name);
    const preview = names.slice(0, 5).join(', ');
    const more = names.length > 5 ? ` และอีก ${names.length - 5} คน` : '';

    const sent = await notifyAdmins(
      'absent',
      `มีพนักงานขาดงาน ${absent.length} คน`,
      `วันที่ ${date.split('-').reverse().join('/')} — ${preview}${more}`,
      { refId: date }
    );

    return NextResponse.json({ ok: true, date, absent: absent.length, sent });
  } catch (e: any) {
    console.error('[cron:absent-check]', e?.message || e);
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
