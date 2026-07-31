/**********************************************************************
 * dashboard.ts — พอร์ตจาก Dashboard.gs
 *   สรุปการเข้างานประจำวัน
 **********************************************************************/
import { T, readObjects } from '../db';
import { today } from '../helpers';

export async function adminDashboard(date?: string, branchId?: string) {
  const d = date || today();

  const empFilter: any = {};
  if (branchId) empFilter.branchId = branchId;
  const attFilter: any = { date: d };
  if (branchId) attFilter.branchId = branchId;

  const [emps, att, leaves] = await Promise.all([
    readObjects(T.PROFILES, empFilter),
    readObjects(T.ATTENDANCE, attFilter),
    readObjects(T.LEAVES, { status: 'pending' }),
  ]);

  const checked: Record<string, boolean> = {};
  let ontime = 0;
  let late = 0;
  att.forEach((a: any) => {
    checked[a.empId] = true;
    if (a.status === 'late') late++;
    else if (a.checkInTime) ontime++;
  });

  const notYet = emps.filter((e: any) => !checked[e.empId]).length;

  return {
    totalEmployees: emps.length,
    ontime,
    late,
    notYet,
    leavesPending: leaves.length,
  };
}
