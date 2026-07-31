/**********************************************************************
 * reports.ts — พอร์ตจาก Reports.gs
 *   - รายงานประจำเดือน (ตารางพนักงาน x วัน)
 *   - รายงานรายวัน
 *   - export .xlsx (แทน SpreadsheetApp เดิม ด้วย SheetJS)
 *
 * สถานะแต่ละช่อง:
 *   present  = ปกติ / late = สาย / absent = ขาด
 *   leave    = ลา (มีใบลาอนุมัติครอบวันนั้น)
 *   holiday  = วันหยุด / future = ยังไม่ถึง
 **********************************************************************/
import { T, readObjects, readByDateRange } from '../db';
import {
  today, asDateStr, asHHMM, dateRange, endOfMonth, thisMonth,
} from '../helpers';
import { holidayMap, weeklyOffArr, dayTypeOf } from './holidays';

/* ---------- กรองพนักงานที่ยัง active ---------- */
export function isActiveEmp(e: any) {
  const s = String(e.status || 'active').toLowerCase();
  return (
    s !== 'inactive' && s !== 'resigned' && s !== 'ลาออก' && s !== 'พ้นสภาพ'
  );
}

/* ==================== รายงานประจำเดือน ==================== */

export async function monthlyReportData(params: any) {
  params = params || {};
  let start = params.start;
  let end = params.end;
  if (!start || !end) {
    const ym = thisMonth();
    start = ym + '-01';
    end = endOfMonth(ym);
  }
  const nameQ = String(params.name || '').toLowerCase();
  const todayStr = today();

  const days = dateRange(start, end);

  const [hmap, woff, attRows, leaveRows, empRows] = await Promise.all([
    holidayMap(),
    weeklyOffArr(),
    readByDateRange(T.ATTENDANCE, 'date', start, end),
    readObjects(T.LEAVES, { status: 'approved' }),
    readObjects(T.PROFILES),
  ]);

  // index การลงเวลา: empId|date -> record
  const attIdx: Record<string, any> = {};
  attRows.forEach((a: any) => {
    attIdx[a.empId + '|' + asDateStr(a.date)] = a;
  });

  const leaves = leaveRows.map((l: any) => ({
    ...l,
    startDate: asDateStr(l.startDate),
    endDate: asDateStr(l.endDate),
  }));
  const leaveOn = (empId: string, date: string) => {
    const f = leaves.filter(
      (l: any) => l.empId === empId && l.startDate <= date && date <= l.endDate
    )[0];
    return f ? f.leaveType : null;
  };

  const emps = empRows
    .filter(
      (e: any) => !nameQ || String(e.name).toLowerCase().indexOf(nameQ) !== -1
    )
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'th'));

  const rows = emps.map((e: any) => {
    const cells: any[] = [];
    const sum = { present: 0, late: 0, absent: 0, leave: 0 };
    days.forEach((date) => {
      const dt = dayTypeOf(date, hmap, woff);
      let cell: any;
      if (dt.type !== 'work') {
        cell = { status: 'holiday', label: 'หยุด' };
      } else if (date > todayStr) {
        cell = { status: 'future', label: '' };
      } else {
        const att = attIdx[e.empId + '|' + date];
        if (att && att.status === 'late') {
          cell = { status: 'late', label: 'สาย' };
          sum.late++;
        } else if (att && att.checkInTime) {
          cell = { status: 'present', label: 'ปกติ' };
          sum.present++;
        } else {
          const lv = leaveOn(e.empId, date);
          if (lv) {
            cell = { status: 'leave', label: lv };
            sum.leave++;
          } else {
            cell = { status: 'absent', label: 'ขาด' };
            sum.absent++;
          }
        }
      }
      cells.push(cell);
    });
    return { empId: e.empId, name: e.name, cells, sum };
  });

  return { start, end, days, rows };
}

export async function monthlyReport(params: any) {
  return monthlyReportData(params);
}

/* ==================== รายงานรายวัน ==================== */

export async function dailyReport(params: any) {
  params = params || {};
  const date = params.date || today();
  const nameQ = String(params.name || '').toLowerCase();
  const todayStr = today();

  const [hmap, woff, attRows, leaveRows, empRows] = await Promise.all([
    holidayMap(),
    weeklyOffArr(),
    readObjects(T.ATTENDANCE, { date }),
    readObjects(T.LEAVES, { status: 'approved' }),
    readObjects(T.PROFILES),
  ]);

  const dt = dayTypeOf(date, hmap, woff);
  const isHoliday = dt.type !== 'work';

  const attIdx: Record<string, any> = {};
  attRows.forEach((a: any) => {
    attIdx[a.empId] = a;
  });

  const leaves = leaveRows.map((l: any) => ({
    ...l,
    startDate: asDateStr(l.startDate),
    endDate: asDateStr(l.endDate),
  }));
  const leaveOn = (empId: string) => {
    const f = leaves.filter(
      (l: any) => l.empId === empId && l.startDate <= date && date <= l.endDate
    )[0];
    return f ? f.leaveType : null;
  };

  const order: Record<string, number> = {
    late: 0, absent: 1, leave: 2, present: 3, holiday: 4, future: 5,
  };

  const rows = empRows
    .filter(
      (e: any) =>
        isActiveEmp(e) &&
        (!nameQ || String(e.name).toLowerCase().indexOf(nameQ) !== -1)
    )
    .map((e: any) => {
      const att = attIdx[e.empId];
      let status: string;
      let label: string;
      let leaveType = '';
      const ci = att ? asHHMM(att.checkInTime) : '';
      const co = att ? asHHMM(att.checkOutTime) : '';
      const wh =
        att && att.workHours !== '' && att.workHours != null ? att.workHours : '';
      const late = att && att.lateMinutes ? Number(att.lateMinutes) : 0;

      if (att && att.checkInTime) {
        if (att.status === 'late') {
          status = 'late';
          label = 'มาสาย';
        } else {
          status = 'present';
          label = 'ปกติ';
        }
      } else if (isHoliday) {
        status = 'holiday';
        label = 'หยุด';
      } else if (date > todayStr) {
        status = 'future';
        label = '-';
      } else {
        const lv = leaveOn(e.empId);
        if (lv) {
          status = 'leave';
          label = 'ลา';
          leaveType = lv;
        } else {
          status = 'absent';
          label = 'ขาด';
        }
      }

      return {
        empId: e.empId,
        name: e.name,
        position: e.position || '',
        date,
        status,
        label,
        leaveType,
        checkIn: ci,
        checkOut: co,
        workHours: wh,
        lateMinutes: late,
      };
    });

  rows.sort((a: any, b: any) => {
    const d = order[a.status] - order[b.status];
    return d !== 0 ? d : String(a.name).localeCompare(String(b.name), 'th');
  });

  const sum: Record<string, number> = {
    present: 0, late: 0, leave: 0, absent: 0, holiday: 0,
  };
  rows.forEach((r: any) => {
    if (sum[r.status] != null) sum[r.status]++;
  });

  return { date, isHoliday, holidayName: dt.name || '', rows, sum };
}

/* ==================== Export .xlsx ==================== */
/**
 * เดิมใช้ SpreadsheetApp.create() + Drive export
 * ตอนนี้สร้างไฟล์ด้วย SheetJS ในหน่วยความจำ แล้วคืน base64 ให้ client
 * โครงสร้าง/หัวตาราง เหมือนเดิมทุกประการ
 */
export async function exportMonthlyReportXlsx(params: any) {
  const XLSX = await import('xlsx');
  const d = await monthlyReportData(params);

  const wd = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const head: any[] = ['ชื่อพนักงาน'];
  d.days.forEach((ds) => {
    const p = ds.split('-');
    const dow = new Date(ds + 'T00:00:00Z').getUTCDay();
    head.push(+p[2] + ' ' + wd[dow]);
  });
  head.push('ปกติ', 'สาย', 'ลา', 'ขาด');

  const aoa: any[][] = [head];
  d.rows.forEach((r: any) => {
    const line: any[] = [r.name];
    r.cells.forEach((c: any) => line.push(c.label || ''));
    line.push(r.sum.present, r.sum.late, r.sum.leave, r.sum.absent);
    aoa.push(line);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // ตรึงแถวหัว + คอลัมน์ชื่อ (เหมือน setFrozenRows/Columns เดิม)
  (ws as any)['!freeze'] = { xSplit: 1, ySplit: 1 };
  (ws as any)['!cols'] = head.map((_, i) => ({ wch: i === 0 ? 22 : 7 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รายงาน');

  const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });

  return {
    filename: 'TapTime-Report-' + d.start + '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    b64,
  };
}
