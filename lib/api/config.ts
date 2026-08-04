/**********************************************************************
 * config.ts — พอร์ตจาก Config.gs
 *   ค่าตั้งค่าระบบ (key-value) + ข้อมูลตั้งต้นหน้า Admin
 **********************************************************************/
import { T, readObjects, findOne, updateByKey, appendObject } from '../db';
import { normalizeBranch, normalizeLeaveType, normalizeHoliday } from '../helpers';
import { weeklyOffArr } from './holidays';
import { activePolicy } from './overtime';

export async function getConfig(): Promise<Record<string, any>> {
  const cfg: Record<string, any> = {};
  const rows = await readObjects(T.CONFIG);
  rows.forEach((r: any) => {
    cfg[r.key] = r.value;
  });
  return cfg;
}

export async function setConfig(key: string, value: any) {
  const found = await findOne(T.CONFIG, 'key', key);
  const v = value == null ? '' : String(value);
  if (found) await updateByKey(T.CONFIG, 'key', key, { value: v });
  else await appendObject(T.CONFIG, { key, value: v });
  return true;
}

/** ข้อมูลที่หน้า Admin ต้องใช้ตั้งแต่เปิดหน้า */
export async function adminBootstrap() {
  const [config, branches, positions, leaveTypes, holidays, weeklyOff, otPolicy] =
    await Promise.all([
      getConfig(),
      readObjects(T.BRANCHES),
      readObjects(T.POSITIONS),
      readObjects(T.LEAVETYPES),
      readObjects(T.HOLIDAYS),
      weeklyOffArr(),
      activePolicy(),
    ]);

  return {
    config,
    branches: branches.map(normalizeBranch),
    positions,
    leaveTypes: leaveTypes.map(normalizeLeaveType),
    holidays: holidays.map(normalizeHoliday),
    weeklyOff,
    otPolicy,
  };
}
