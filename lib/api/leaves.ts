/**********************************************************************
 * leaves.ts — พอร์ตจาก Leaves.gs
 *   ฝั่ง Admin: ดู + อนุมัติ/ปฏิเสธใบลา
 **********************************************************************/
import { T, readObjects, findOne, updateByKey } from '../db';
import { normalizeLeave, nowStamp, asDateStr } from '../helpers';
import { notify } from './notifications';

export async function listLeaves(status?: string) {
  let rows = (await readObjects(T.LEAVES)).map(normalizeLeave);
  if (status) rows = rows.filter((l: any) => l.status === status);
  rows.sort((a: any, b: any) =>
    String(b.requestedAt).localeCompare(String(a.requestedAt))
  );
  return rows;
}

/** decision = 'approved' | 'rejected' */
export async function decideLeave(reqId: string, decision: string) {
  const found: any = await findOne(T.LEAVES, 'reqId', reqId);
  if (!found) throw new Error('ไม่พบคำขอลา');
  await updateByKey(T.LEAVES, 'reqId', reqId, {
    status: decision,
    decidedAt: nowStamp(),
  });

  // แจ้งกลับไปหาพนักงานเจ้าของใบลา
  const ok = decision === 'approved';
  const s = asDateStr(found.startDate);
  const e = asDateStr(found.endDate);
  const fmt = (d: string) => d.split('-').reverse().join('/');
  await notify(
    [found.empId],
    'leave_decided',
    ok ? 'คำขอลาได้รับอนุมัติ' : 'คำขอลาถูกปฏิเสธ',
    `${found.leaveType} ${s === e ? fmt(s) : `${fmt(s)} – ${fmt(e)}`}` +
      (ok ? ' ได้รับการอนุมัติแล้ว' : ' ไม่ได้รับการอนุมัติ'),
    { refId: reqId }
  );

  return true;
}
