/**********************************************************************
 * leaves.ts — พอร์ตจาก Leaves.gs
 *   ฝั่ง Admin: ดู + อนุมัติ/ปฏิเสธใบลา
 **********************************************************************/
import { T, readObjects, findOne, updateByKey } from '../db';
import { normalizeLeave, nowStamp } from '../helpers';

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
  const found = await findOne(T.LEAVES, 'reqId', reqId);
  if (!found) throw new Error('ไม่พบคำขอลา');
  await updateByKey(T.LEAVES, 'reqId', reqId, {
    status: decision,
    decidedAt: nowStamp(),
  });
  return true;
}
