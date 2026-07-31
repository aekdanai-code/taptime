/**
 * run-tests.js — ตรวจสอบว่าตรรกะที่พอร์ตมาให้ผลตรงกับสเปกเดิม (TapTime V1.1)
 *
 *   node test/run-tests.js
 *
 * ใช้ฐานข้อมูลจำลองในหน่วยความจำที่โหลดจากข้อมูลจริงใน TapTime.xlsx
 * (ต้อง build เป็น JS ก่อน — ดู test/README ในไฟล์นี้ท้ายสุด)
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { makeDb } = require('./fake-supabase');

const FIXTURE = require(process.env.FIXTURE || path.join(__dirname, 'fixture.json'));
const LIB = process.env.LIB || path.join(__dirname, '..', '.testbuild');

/* ---- แทนที่ @supabase/supabase-js ด้วยตัวปลอม ---- */
const fake = makeDb(FIXTURE);
const real = require.resolve('@supabase/supabase-js');
require.cache[real] = {
  id: real, filename: real, loaded: true, exports: { createClient: () => fake },
};
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.NEXT_PUBLIC_APP_URL = 'https://taptime.example.com';

const helpers = require(path.join(LIB, 'helpers'));
const holidays = require(path.join(LIB, 'api/holidays'));
const config = require(path.join(LIB, 'api/config'));
const dashboard = require(path.join(LIB, 'api/dashboard'));
const employees = require(path.join(LIB, 'api/employees'));
const attendance = require(path.join(LIB, 'api/attendance'));
const employeeApi = require(path.join(LIB, 'api/employeeApi'));
const leaves = require(path.join(LIB, 'api/leaves'));
const timeEdits = require(path.join(LIB, 'api/timeEdits'));
const reports = require(path.join(LIB, 'api/reports'));

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.message || e)); }
}

(async () => {
  console.log('\n── helpers ─────────────────────────────────');

  await t('toMinutes แปลง HH:mm ถูกต้อง', () => {
    assert.strictEqual(helpers.toMinutes('08:00'), 480);
    assert.strictEqual(helpers.toMinutes('08:37'), 517);
    assert.strictEqual(helpers.toMinutes('17:02'), 1022);
    assert.strictEqual(helpers.toMinutes(''), null);
  });

  await t('distanceMeters (Haversine) ตรงกับสูตรเดิม', () => {
    // จุดสาขา BR-e7625e91 vs พิกัดเช็คอินจริงในข้อมูลเดิม
    const d = helpers.distanceMeters(14.754073, 100.086218, 14.75477398074244, 100.08632229190546);
    assert.ok(d > 70 && d < 90, 'ระยะ = ' + d.toFixed(1) + ' m (คาดว่า ~78 m ซึ่งอยู่ใน radius 100)');
  });

  await t('dateRange ครอบคลุมทั้งเดือน', () => {
    const d = helpers.dateRange('2026-07-01', '2026-07-31');
    assert.strictEqual(d.length, 31);
    assert.strictEqual(d[0], '2026-07-01');
    assert.strictEqual(d[30], '2026-07-31');
  });

  await t('dayOfWeek: 2026-07-30 = วันพฤหัสบดี (4)', () => {
    assert.strictEqual(helpers.dayOfWeek('2026-07-30'), 4);
    assert.strictEqual(helpers.dayOfWeek('2026-07-26'), 0); // อาทิตย์
  });

  await t('endOfMonth', () => {
    assert.strictEqual(helpers.endOfMonth('2026-07'), '2026-07-31');
    assert.strictEqual(helpers.endOfMonth('2026-02'), '2026-02-28');
  });

  console.log('\n── config / holidays ───────────────────────');

  await t('getConfig อ่านค่าจากตาราง config', async () => {
    const c = await config.getConfig();
    assert.strictEqual(c.companyName, 'บริษัท ปลาบิน เทรดดิ้ง จำกัด');
    assert.strictEqual(c.appName, 'TapTime');
  });

  await t('weeklyOffArr แข็งแรงต่อค่า 0 (อาทิตย์)', async () => {
    const w = await holidays.weeklyOffArr();
    assert.deepStrictEqual(w, [0]);
  });

  await t('dayTypeOf จำแนกวันได้ครบ 3 แบบ', async () => {
    const hmap = await holidays.holidayMap();
    const woff = await holidays.weeklyOffArr();
    assert.deepStrictEqual(holidays.dayTypeOf('2026-07-28', hmap, woff),
      { type: 'holiday', name: 'วันเฉลิมพรชนมพรรษา ร.10' });
    assert.strictEqual(holidays.dayTypeOf('2026-07-26', hmap, woff).type, 'weekend');
    assert.strictEqual(holidays.dayTypeOf('2026-07-30', hmap, woff).type, 'work');
  });

  await t('adminBootstrap คืนครบ 6 ก้อน', async () => {
    const b = await config.adminBootstrap();
    ['config', 'branches', 'positions', 'leaveTypes', 'holidays', 'weeklyOff']
      .forEach((k) => assert.ok(k in b, 'ขาด key: ' + k));
    assert.strictEqual(b.branches[0].workStart, '08:00');
    assert.strictEqual(b.branches[0].workEnd, '17:00');
  });

  console.log('\n── พนักงาน (profiles) ──────────────────────');

  await t('listEmployees แนบ branchName', async () => {
    const list = await employees.listEmployees();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'เอกดนัย อมตธรรม');
    assert.strictEqual(list[0].branchName, 'สำนักงานใหญ่');
  });

  await t('employeeLink ถูกถอดออกแล้ว (ปุ่มลิงก์/QR ถูกเอาออกจากหน้าจัดการพนักงาน)', () => {
    assert.strictEqual(employees.employeeLink, undefined, 'ยังมีฟังก์ชันค้างอยู่');
    const rpc2 = require(path.join(LIB, 'rpc'));
    assert.ok(!rpc2.REGISTRY.employeeLink, 'ยังลงทะเบียนใน REGISTRY อยู่');
    assert.ok(!rpc2.ADMIN_FNS.has('employeeLink'), 'ยังอยู่ใน ADMIN_FNS');
  });

  console.log('\n── การคำนวณเวลา (สเปกข้อ 4.2 / 4.3) ────────');

  await t('writeCheckIn: 08:37 กับ workStart 08:00, threshold 15 -> late 37 นาที', async () => {
    const emp = { empId: 'TEST-1', name: 'ทดสอบ', branchId: 'BR-e7625e91' };
    const r = await attendance.writeCheckIn(emp, '2026-07-31', '08:37', 'วันปกติ', null, null);
    assert.strictEqual(r.lateMinutes, 37);
    assert.strictEqual(r.status, 'late');
  });

  await t('writeCheckIn: 08:10 -> lateMinutes 10 แต่ยังนับ ontime (<= threshold 15)', async () => {
    const emp = { empId: 'TEST-2', name: 'ทดสอบ2', branchId: 'BR-e7625e91' };
    const r = await attendance.writeCheckIn(emp, '2026-07-31', '08:10', 'วันปกติ', null, null);
    assert.strictEqual(r.lateMinutes, 10);
    assert.strictEqual(r.status, 'ontime');
  });

  await t('writeCheckOut: 17:02 -> OT 2 นาที, workHours 7.42 (ตรงกับข้อมูลเดิม)', async () => {
    const att = await attendance.attendanceOf('TEST-1', '2026-07-31'); // เข้า 08:37
    const r = await attendance.writeCheckOut(att, '17:02');
    assert.strictEqual(r.otMinutes, 2);
    assert.strictEqual(r.workHours, 7.42); // (1022-517)/60 - 1 = 7.4166 -> 7.42
  });

  await t('writeCheckOut: ออกก่อนเลิกงาน -> OT = 0', async () => {
    const att = await attendance.attendanceOf('TEST-2', '2026-07-31'); // เข้า 08:10
    const r = await attendance.writeCheckOut(att, '13:37');
    assert.strictEqual(r.otMinutes, 0);
    assert.strictEqual(r.workHours, 4.45); // (817-490)/60 - 1
  });

  await t('เทียบกับแถวจริงในฐานข้อมูลเดิม (AT-154005fb)', () => {
    const row = FIXTURE.attendance.find((a) => a.recId === 'AT-154005fb');
    assert.strictEqual(row.checkInTime, '08:37');
    assert.strictEqual(row.lateMinutes, 37);
    assert.strictEqual(row.otMinutes, 2);
    assert.strictEqual(row.workHours, 7.42);
    assert.strictEqual(row.status, 'late');
  });

  console.log('\n── ฝั่งพนักงาน ─────────────────────────────');

  await t('employeeContext คืนโครงตามสเปกข้อ 6.1', async () => {
    const c = await employeeApi.employeeContext('EMP-f3795df3');
    ['emp', 'branch', 'today', 'todayHoliday', 'todayHolidayName', 'attendance',
      'leaveTypes', 'holidays', 'weeklyOff', 'stats', 'leaveBalances',
      'myLeaves', 'myTimeEdits'].forEach((k) => assert.ok(k in c, 'ขาด key: ' + k));
    ['leaveRemaining', 'workDays', 'lateCount', 'leaveCount', 'lateMinutes', 'otMinutes']
      .forEach((k) => assert.ok(k in c.stats, 'ขาด stats.' + k));
    assert.strictEqual(c.emp.name, 'เอกดนัย อมตธรรม');
    assert.strictEqual(c.branch.radius, 100);
  });

  await t('โควตาลา: ลาพักร้อน 6 วัน ใช้ไป 1 -> เหลือ 5 (สเปกข้อ 4.6)', async () => {
    const c = await employeeApi.employeeContext('EMP-f3795df3');
    const v = c.leaveBalances.find((b) => b.name === 'ลาพักร้อน');
    assert.strictEqual(v.quota, 6);
    assert.strictEqual(v.used, 1);
    assert.strictEqual(v.remaining, 5);
    const sick = c.leaveBalances.find((b) => b.name === 'ลาป่วย');
    assert.strictEqual(sick.remaining, 30);
    assert.strictEqual(c.stats.leaveRemaining, 5 + 30 + 3);
  });

  await t('empCheckIn นอกรัศมี -> out_of_zone', async () => {
    const r = await employeeApi.empCheckIn('EMP-f3795df3', 13.75, 100.5); // กรุงเทพฯ
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'out_of_zone');
    assert.strictEqual(r.radius, 100);
    assert.ok(r.distance > 100);
  });

  await t('empCheckIn token ผิด -> throw', async () => {
    await assert.rejects(() => employeeApi.empCheckIn('EMP-ไม่มีจริง', 14.754, 100.086));
  });

  await t('ปิดช่องโหว่: ไม่ส่งพิกัดมาเลย -> no_location (ห้ามหลุดผ่าน)', async () => {
    // ของเดิม: NaN > radius = false -> ข้ามการตรวจ GPS ทั้งหมด
    for (const args of [[], [undefined, undefined], ['abc', 'xyz'], [null, null],
                        [0, 0], ['', ''], [999, 999]]) {
      const r = await employeeApi.empCheckIn('EMP-f3795df3', ...args);
      assert.strictEqual(r.ok, false, 'หลุดผ่านด้วย args=' + JSON.stringify(args));
      assert.ok(['no_location', 'out_of_zone'].includes(r.reason),
        'reason ผิด: ' + r.reason + ' (args=' + JSON.stringify(args) + ')');
    }
  });

  await t('ปิดช่องโหว่: empCheckOut ก็ต้อง fail-closed เหมือนกัน', async () => {
    for (const args of [[], ['abc', 'xyz'], [0, 0]]) {
      const r = await employeeApi.empCheckOut('EMP-f3795df3', ...args);
      assert.strictEqual(r.ok, false);
      assert.ok(['no_location', 'out_of_zone'].includes(r.reason), 'reason ผิด: ' + r.reason);
    }
  });

  await t('ปฏิเสธพิกัดที่ความแม่นยำต่ำ (accuracy > 200 ม.)', async () => {
    const r = await employeeApi.empCheckIn(
      'EMP-f3795df3', 14.754073, 100.086218, { accuracy: 3000 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'low_accuracy');
    assert.strictEqual(r.accuracy, 3000);
  });

  await t('พนักงานที่ถูกระงับ (inactive) ใช้งานไม่ได้', async () => {
    const emps = fake._data.profiles;
    const me = emps.find((e) => e.empId === 'EMP-f3795df3');
    const before = me.status;
    me.status = 'inactive';
    await assert.rejects(() => employeeApi.employeeContext('EMP-f3795df3'),
      /เซสชันหมดอายุ/);
    await assert.rejects(() => employeeApi.empCheckIn('EMP-f3795df3', 14.754073, 100.086218));
    me.status = before;
  });

  await t('บันทึก audit ทุกครั้งที่พยายามลงเวลา (ผ่านและไม่ผ่าน)', async () => {
    const before = (fake._data.checkin_audit || []).length;
    await employeeApi.empCheckIn('EMP-f3795df3', 13.75, 100.5, {
      accuracy: 12, ip: '1.2.3.4', userAgent: 'test-ua', credentialId: 'cred-1',
    });
    const rows = fake._data.checkin_audit || [];
    assert.strictEqual(rows.length, before + 1);
    const last = rows[rows.length - 1];
    assert.strictEqual(last.result, 'out_of_zone');
    assert.strictEqual(last.action, 'checkin');
    assert.strictEqual(last.ip, '1.2.3.4');
    assert.strictEqual(last.credentialId, 'cred-1');
    assert.strictEqual(last.accuracy, 12);
    assert.ok(last.distance > 100, 'ต้องเก็บระยะห่างไว้เป็นหลักฐาน');
  });

  await t('empSubmitLeave: ลากิจต้องยื่นล่วงหน้า 2 วัน -> ปฏิเสธถ้ายื่นวันนี้', async () => {
    await assert.rejects(
      () => employeeApi.empSubmitLeave('EMP-f3795df3', {
        leaveType: 'ลากิจ', startDate: helpers.today(), endDate: helpers.today(), reason: 'x',
      }),
      /ล่วงหน้าอย่างน้อย 2 วัน/
    );
  });

  await t('empSubmitLeave: ลาป่วย (advanceDays ว่าง) ยื่นย้อนหลังได้', async () => {
    const r = await employeeApi.empSubmitLeave('EMP-f3795df3', {
      leaveType: 'ลาป่วย', startDate: '2026-07-20', endDate: '2026-07-21', reason: 'ไข้',
    });
    assert.strictEqual(r.days, 2);
    assert.strictEqual(r.status, 'pending');
    assert.ok(/^LV-/.test(r.reqId));
  });

  console.log('\n── คำขอแก้เวลา ─────────────────────────────');

  await t('empSubmitTimeEdit ต้องกรอกอย่างน้อย 1 ช่อง', async () => {
    await assert.rejects(
      () => timeEdits.empSubmitTimeEdit('EMP-f3795df3', { date: '2026-07-27' }),
      /อย่างน้อย 1 ช่อง/
    );
  });

  await t('decideTimeEdit(approved) เขียนทับเวลาและคำนวณใหม่', async () => {
    await timeEdits.empSubmitTimeEdit('EMP-f3795df3', {
      date: '2026-07-27', newCheckOut: '17:30', reason: 'ลืมเช็คเอาท์',
    });
    const list = await timeEdits.listTimeEdits('pending');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].oldCheckOut, '13:37');

    await timeEdits.decideTimeEdit(list[0].editId, 'approved');
    const att = await attendance.attendanceOf('EMP-f3795df3', '2026-07-27');
    assert.strictEqual(att.checkOutTime, '17:30');
    assert.strictEqual(att.otMinutes, 30);   // 17:30 - 17:00
    assert.strictEqual(att.workHours, 8.5);  // (1050-480)/60 - 1
    assert.strictEqual((await timeEdits.listTimeEdits('pending')).length, 0);
  });

  console.log('\n── รายงาน ──────────────────────────────────');

  await t('dailyReport 2026-07-30 (วันทำงาน) จัดสถานะถูก', async () => {
    const r = await reports.dailyReport({ date: '2026-07-30' });
    assert.strictEqual(r.isHoliday, false);
    const me = r.rows.find((x) => x.empId === 'EMP-f3795df3');
    assert.strictEqual(me.status, 'late');
    assert.strictEqual(me.checkIn, '08:37');
    assert.strictEqual(me.checkOut, '17:02');
    assert.strictEqual(me.lateMinutes, 37);
    assert.strictEqual(r.sum.late, 1);
  });

  await t('dailyReport 2026-07-28 (วันหยุดราชการ) -> holiday', async () => {
    const r = await reports.dailyReport({ date: '2026-07-28' });
    assert.strictEqual(r.isHoliday, true);
    assert.strictEqual(r.holidayName, 'วันเฉลิมพรชนมพรรษา ร.10');
    assert.strictEqual(r.rows[0].status, 'holiday');
  });

  await t('dailyReport วันอนาคต -> future (ไม่นับเป็นขาด/ลา)', async () => {
    const r = await reports.dailyReport({ date: '2026-08-20' });
    const me = r.rows.find((x) => x.empId === 'EMP-f3795df3');
    assert.strictEqual(me.status, 'future');
    assert.strictEqual(me.label, '-');
  });

  await t('dailyReport: ใบลาอนุมัติย้อนหลัง เปลี่ยน "ขาด" -> "ลา" อัตโนมัติ', async () => {
    // 2026-07-23 = วันพฤหัสบดี วันทำงาน ไม่มีเช็คอิน -> เดิมต้องเป็น "ขาด"
    const before = await reports.dailyReport({ date: '2026-07-23' });
    assert.strictEqual(
      before.rows.find((x) => x.empId === 'EMP-f3795df3').status, 'absent');

    // ยื่นลาป่วยย้อนหลังแล้วอนุมัติ (สเปกข้อ 4.5)
    const req = await employeeApi.empSubmitLeave('EMP-f3795df3', {
      leaveType: 'ลาป่วย', startDate: '2026-07-23', endDate: '2026-07-23', reason: 'ไข้',
    });
    await leaves.decideLeave(req.reqId, 'approved');

    const after = await reports.dailyReport({ date: '2026-07-23' });
    const me = after.rows.find((x) => x.empId === 'EMP-f3795df3');
    assert.strictEqual(me.status, 'leave');
    assert.strictEqual(me.leaveType, 'ลาป่วย');
  });

  await t('monthlyReport ก.ค. 2026: 31 วัน + สถานะครบทุกแบบ', async () => {
    const r = await reports.monthlyReport({ start: '2026-07-01', end: '2026-07-31' });
    assert.strictEqual(r.days.length, 31);
    const row = r.rows.find((x) => x.empId === 'EMP-f3795df3');
    const c = (d) => row.cells[r.days.indexOf(d)];
    // ใช้เฉพาะวันที่ผ่านมาแล้วแน่ ๆ (ข้อมูลใน fixture อยู่ช่วง 26-30 ก.ค.)
    assert.strictEqual(c('2026-07-26').status, 'holiday'); // อาทิตย์ (weeklyOff)
    assert.strictEqual(c('2026-07-28').status, 'holiday'); // วันหยุดราชการ
    assert.strictEqual(c('2026-07-27').status, 'present');
    assert.strictEqual(c('2026-07-30').status, 'late');
    assert.strictEqual(c('2026-07-23').status, 'leave');   // จากใบลาที่เพิ่งอนุมัติ
    assert.strictEqual(c('2026-07-23').label, 'ลาป่วย');
    assert.ok(row.sum.absent > 0, 'ต้องมีวันขาดบ้าง');
    assert.strictEqual(row.sum.late, 1);
    assert.ok(row.sum.leave >= 1, 'ต้องมีวันลาอย่างน้อย 1');
  });

  await t('monthlyReport: วันที่ยังไม่ถึง = future (ไม่นับเป็นขาด)', async () => {
    // ใช้เดือนถัดไปเสมอ เพื่อให้ผลไม่ขึ้นกับวันที่รันทดสอบ
    const [y, m] = helpers.today().split('-').map(Number);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const ym = `${nextY}-${String(nextM).padStart(2, '0')}`;

    const r = await reports.monthlyReport({ start: `${ym}-01`, end: `${ym}-10` });
    const row = r.rows.find((x) => x.empId === 'EMP-f3795df3');
    row.cells.forEach((cell, i) => {
      assert.ok(['future', 'holiday'].includes(cell.status),
        `${r.days[i]} ควรเป็น future/holiday แต่ได้ ${cell.status}`);
    });
    assert.strictEqual(row.sum.absent, 0, 'วันอนาคตต้องไม่นับเป็นขาด');
  });

  await t('exportMonthlyReportXlsx คืน base64 ที่เป็นไฟล์ xlsx จริง', async () => {
    const r = await reports.exportMonthlyReportXlsx({ start: '2026-07-01', end: '2026-07-31' });
    assert.ok(/^TapTime-Report-2026-07-01\.xlsx$/.test(r.filename));
    const buf = Buffer.from(r.b64, 'base64');
    assert.strictEqual(buf.slice(0, 2).toString(), 'PK'); // ZIP magic
    assert.ok(buf.length > 2000);
  });

  console.log('\n── แดชบอร์ด / ใบลา ─────────────────────────');

  await t('adminDashboard นับยอดถูก', async () => {
    const d = await dashboard.adminDashboard('2026-07-30');
    assert.strictEqual(d.late, 1);
    assert.strictEqual(d.ontime, 0);
    assert.ok(d.totalEmployees >= 1);
  });

  await t('decideLeave เปลี่ยนสถานะ + บันทึก decidedAt', async () => {
    const pending = await leaves.listLeaves('pending');
    assert.ok(pending.length >= 1);
    await leaves.decideLeave(pending[0].reqId, 'approved');
    const after = (await leaves.listLeaves()).find((l) => l.reqId === pending[0].reqId);
    assert.strictEqual(after.status, 'approved');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(after.decidedAt));
  });

  console.log('\n── สิทธิ์การลารายคน (leave assignment) ─────');

  const leaveAssign = require(path.join(LIB, 'api/leaveAssign'));

  const TYPES = [
    { typeId: 'LT-sick', name: 'ลาป่วย',    daysPerYear: 30, assignAll: true,  showQuota: true },
    { typeId: 'LT-vac',  name: 'ลาพักร้อน', daysPerYear: 6,  assignAll: true,  showQuota: true },
    { typeId: 'LT-sp',   name: 'ลาพิเศษ',   daysPerYear: 3,  assignAll: false, showQuota: false },
  ];

  await t('assignAll = true และไม่มี assignment -> ได้โควตากลาง', () => {
    const r = leaveAssign.entitlementsFor(TYPES, []);
    const vac = r.find((x) => x.typeId === 'LT-vac');
    assert.strictEqual(vac.quota, 6);
    assert.strictEqual(vac.custom, false);
  });

  await t('assignAll = false และไม่ถูก assign -> ไม่ได้สิทธิ์เลย', () => {
    const r = leaveAssign.entitlementsFor(TYPES, []);
    assert.ok(!r.some((x) => x.typeId === 'LT-sp'), 'ไม่ควรมีลาพิเศษ');
    assert.strictEqual(r.length, 2);
  });

  await t('assignAll = false แต่ถูก assign -> ได้สิทธิ์', () => {
    const r = leaveAssign.entitlementsFor(TYPES, [{ typeId: 'LT-sp', daysOverride: null }]);
    const sp = r.find((x) => x.typeId === 'LT-sp');
    assert.ok(sp, 'ต้องได้สิทธิ์ลาพิเศษ');
    assert.strictEqual(sp.quota, 3, 'daysOverride = null -> ใช้โควตากลาง');
  });

  await t('โควตาเฉพาะราย: อายุงานเกิน 1 ปี ได้ลาพักร้อน 10 วัน', () => {
    const r = leaveAssign.entitlementsFor(TYPES, [{ typeId: 'LT-vac', daysOverride: 10 }]);
    const vac = r.find((x) => x.typeId === 'LT-vac');
    assert.strictEqual(vac.quota, 10);
    assert.strictEqual(vac.custom, true);
    // คนอื่นยังได้ 6 เท่าเดิม
    assert.strictEqual(leaveAssign.entitlementsFor(TYPES, [])
      .find((x) => x.typeId === 'LT-vac').quota, 6);
  });

  await t('daysOverride = 0 ใช้ได้จริง (ไม่ถูกมองว่าเป็นค่าว่าง)', () => {
    const r = leaveAssign.entitlementsFor(TYPES, [{ typeId: 'LT-vac', daysOverride: 0 }]);
    assert.strictEqual(r.find((x) => x.typeId === 'LT-vac').quota, 0);
  });

  await t('showQuota ถูกส่งต่อไปให้หน้าพนักงาน', () => {
    const r = leaveAssign.entitlementsFor(TYPES, [{ typeId: 'LT-sp', daysOverride: null }]);
    assert.strictEqual(r.find((x) => x.typeId === 'LT-sp').showQuota, false);
    assert.strictEqual(r.find((x) => x.typeId === 'LT-vac').showQuota, true);
  });

  await t('ข้อมูลเก่าที่ยังไม่มี assignAll/showQuota ถือว่าเปิดไว้', () => {
    const legacy = [{ typeId: 'LT-old', name: 'ลาเก่า', daysPerYear: 5 }];
    const r = leaveAssign.entitlementsFor(legacy, []);
    assert.strictEqual(r.length, 1, 'ต้องยังได้สิทธิ์');
    assert.strictEqual(r[0].showQuota, true);
    assert.strictEqual(r[0].quota, 5);
  });

  await t('employeeContext ใช้โควตาเฉพาะรายจริง (end-to-end)', async () => {
    const types = fake._data.leave_types;
    const vac = types.find((x) => x.name === 'ลาพักร้อน');
    fake._data.leave_assignments.push({
      typeId: vac.typeId, empId: 'EMP-f3795df3', daysOverride: 12,
    });
    const c = await employeeApi.employeeContext('EMP-f3795df3');
    const b = c.leaveBalances.find((x) => x.name === 'ลาพักร้อน');
    assert.strictEqual(b.quota, 12, 'ต้องใช้โควตาเฉพาะราย');
    assert.strictEqual(b.remaining, 12 - b.used);
    // ฟอร์มยื่นลาต้องเห็นประเภทนี้ด้วย
    assert.ok(c.leaveTypes.some((x) => x.name === 'ลาพักร้อน'));
    fake._data.leave_assignments.length = 0;
  });

  await t('ประเภทที่ไม่ได้ assign จะไม่โผล่ในหน้าพนักงาน (end-to-end)', async () => {
    const types = fake._data.leave_types;
    const vac = types.find((x) => x.name === 'ลาพักร้อน');
    const before = vac.assignAll;
    vac.assignAll = false;                       // จำกัดเฉพาะคนที่ถูกเลือก
    const c = await employeeApi.employeeContext('EMP-f3795df3');
    assert.ok(!c.leaveBalances.some((x) => x.name === 'ลาพักร้อน'),
      'ไม่ควรเห็นลาพักร้อน');
    assert.ok(!c.leaveTypes.some((x) => x.name === 'ลาพักร้อน'),
      'ฟอร์มยื่นลาก็ไม่ควรมีตัวเลือกนี้');
    vac.assignAll = before;
  });

  await t('saveLeaveAssignments เขียนทับชุดเดิมทั้งหมด', async () => {
    const vac = fake._data.leave_types.find((x) => x.name === 'ลาพักร้อน');
    await leaveAssign.saveLeaveAssignments({
      typeId: vac.typeId, assignAll: false,
      items: [{ empId: 'EMP-f3795df3', daysOverride: 10 }],
    });
    assert.strictEqual(fake._data.leave_assignments.length, 1);
    assert.strictEqual(vac.assignAll, false);

    // บันทึกใหม่แบบไม่มีใครเลย -> ต้องล้างของเดิม
    await leaveAssign.saveLeaveAssignments({
      typeId: vac.typeId, assignAll: true, items: [],
    });
    assert.strictEqual(fake._data.leave_assignments.length, 0);
    assert.strictEqual(vac.assignAll, true);
  });

  console.log('\n── ฟิลด์พนักงานใหม่ ────────────────────────');

  await t('บันทึก/อ่าน ชื่อเล่น สัญชาติ เพศ วันเกิด ที่อยู่ ได้ครบ', async () => {
    const r = await employees.saveEmployee({
      name: 'ทดสอบ ฟิลด์ใหม่', nickname: 'เทส', nationality: 'ไทย',
      gender: 'หญิง', birthDate: '1998-03-15', address: '1 ถ.ทดสอบ',
      nationalId: '1234567890123', phone: '0800000000',
      branchId: 'BR-e7625e91', position: 'พนักงานขาย', status: 'active',
    });
    const list = await employees.listEmployees();
    const e = list.find((x) => x.empId === r.empId);
    assert.strictEqual(e.nickname, 'เทส');
    assert.strictEqual(e.nationality, 'ไทย');
    assert.strictEqual(e.gender, 'หญิง');
    assert.strictEqual(e.birthDate, '1998-03-15');
    assert.strictEqual(e.address, '1 ถ.ทดสอบ');
    assert.strictEqual(e.branchName, 'สำนักงานใหญ่', 'ต้องแนบชื่อสาขา');
    await employees.deleteEmployee(r.empId);
  });

  await t('saveEmployee ไม่สร้าง token อีกแล้ว (ยกเลิกระบบลิงก์)', async () => {
    const r = await employees.saveEmployee({ name: 'ไม่มีโทเคน', status: 'active' });
    const row = fake._data.profiles.find((x) => x.empId === r.empId);
    assert.ok(!row.token, 'ต้องไม่มี token');
    await employees.deleteEmployee(r.empId);
  });

  console.log('\n── การเชื่อมต่อ frontend <-> backend ────────');

  const fs = require('fs');
  const SRC = path.join(__dirname, '..', 'src');
  const htmlFiles = []
    .concat(fs.readdirSync(path.join(SRC, 'frontend-admin')).map((f) => path.join(SRC, 'frontend-admin', f)))
    .concat(fs.readdirSync(path.join(SRC, 'frontend-employee')).map((f) => path.join(SRC, 'frontend-employee', f)));

  const called = new Set();
  htmlFiles.forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    const re = /\brun\(\s*['"]([A-Za-z_$][\w$]*)['"]/g;
    let m;
    while ((m = re.exec(s))) called.add(m[1]);
    // กรณีเรียกผ่านตัวแปร: run(fn,TOKEN,...) ใน EmployeeCore (empCheckIn/empCheckOut)
  });
  called.add('empCheckIn');
  called.add('empCheckOut');

  const rpc = require(path.join(LIB, 'rpc'));

  await t(`ทุกฟังก์ชันที่หน้าเว็บเรียก (${called.size} ตัว) มีอยู่ใน REGISTRY`, () => {
    const missing = [...called].filter((fn) => !rpc.REGISTRY[fn]);
    assert.deepStrictEqual(missing, [], 'ขาด: ' + missing.join(', '));
  });

  await t('ทุกฟังก์ชันที่หน้าเว็บเรียก ถูกกำหนดสิทธิ์ไว้ (admin หรือ employee)', () => {
    const un = [...called].filter(
      (fn) => !rpc.ADMIN_FNS.has(fn) && !rpc.EMPLOYEE_FNS.has(fn)
    );
    assert.deepStrictEqual(un, [], 'ไม่ได้กำหนดสิทธิ์: ' + un.join(', '));
  });

  await t('ฟังก์ชันฝั่งพนักงานไม่หลุดไปอยู่ในกลุ่ม admin', () => {
    [...rpc.EMPLOYEE_FNS].forEach((fn) =>
      assert.ok(!rpc.ADMIN_FNS.has(fn), fn + ' อยู่ทั้งสองกลุ่ม')
    );
  });

  await t('ทุกชื่อใน ADMIN_FNS/EMPLOYEE_FNS มีตัวจริงใน REGISTRY', () => {
    [...rpc.ADMIN_FNS, ...rpc.EMPLOYEE_FNS].forEach((fn) =>
      assert.ok(typeof rpc.REGISTRY[fn] === 'function', 'ไม่มี handler: ' + fn)
    );
  });

  console.log('\n── HTML ที่ประกอบแล้ว ──────────────────────');

  const GEN = path.join(__dirname, '..', 'generated');
  await t('generated/admin.html ไม่เหลือ include() ค้าง และมี shim', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(!/<\?!?=/.test(h), 'ยังเหลือ template tag ของ Apps Script');
    assert.ok(h.includes('window.google.script.run'), 'ไม่พบ shim');
    assert.ok(h.indexOf('window.google.script.run') < h.indexOf('function run('),
      'shim ต้องมาก่อนสคริปต์ของหน้า');
    ['AdminEmployees', 'renderDashboard', 'renderReport', 'renderHolidays']
      .forEach((k) => assert.ok(h.includes(k) || h.includes(k.replace('Admin', '')), 'ขาดส่วน ' + k));
  });

  await t('generated/employee.html มี placeholder ครบ และ tab bar ครบ 4', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(!/include\(/.test(h), 'ยังเหลือ include() ค้าง');
    ['__TAPTIME_TOKEN__', '__TAPTIME_WEBAUTHN__', '__TAPTIME_IS_ADMIN__']
      .forEach((k) => assert.ok(h.includes(k), 'ไม่พบ placeholder ' + k));
    ['data-p="home"', 'data-p="history"', 'data-p="leave"', 'data-p="holiday"']
      .forEach((k) => assert.ok(h.includes(k), 'ขาดแท็บ ' + k));
    assert.ok(h.includes('initSlider') || h.includes('bindSlider'), 'ขาดสไลด์เช็คอิน');
  });

  await t('ลำดับสคริปต์ถูกต้อง: WEBAUTHN -> shim -> TOKEN -> โค้ดหน้าเว็บ', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    const iWa = h.indexOf('var WEBAUTHN =');
    const iShim = h.indexOf('window.google.script.run');
    const iTok = h.indexOf('var TOKEN =');
    const iRun = h.indexOf('function run(');
    assert.ok(iWa >= 0 && iShim > iWa, 'WEBAUTHN ต้องประกาศก่อน shim');
    assert.ok(iTok > iShim, 'TOKEN ต้องมาหลัง shim');
    assert.ok(iRun > iShim, 'shim ต้องมาก่อน run() ของหน้าเว็บ');
  });

  await t('ไม่มีร่องรอยระบบ token link เดิมหลงเหลือใน generated', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(!/employee\?token=/.test(h), 'ยังมีลิงก์แบบ ?token= อยู่');
    assert.ok(!/page=employee/.test(h), 'ยังมีลิงก์แบบ page=employee อยู่');
  });

  await t('หน้าจัดการพนักงาน: ไม่มีปุ่มลิงก์/QR แล้ว', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['ลิงก์/QR', 'showLink(', 'employeeLink', 'qrserver.com']
      .forEach((k) => assert.ok(!h.includes(k), 'ยังเหลือ ' + k));
  });

  await t('หน้าจัดการพนักงาน: มีค้นหา / ตัวกรอง 4 แบบ / แบ่งหน้า', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['emp_q', 'emp_branch', 'emp_pos', 'emp_status', 'emp_role',
     'empFilter(', 'empClearFilter(', 'empPer(', 'empPage(']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    // ตัวเลือกจำนวนรายการต่อหน้า
    assert.ok(/\[10,\s*20,\s*50,\s*100\]/.test(h), 'ตัวเลือกต่อหน้าไม่ครบ 10/20/50/100');
    assert.ok(/per\s*:\s*20/.test(h), 'ค่าเริ่มต้นต้องเป็น 20 รายการ');
  });

  await t('หน้าจัดการพนักงาน: ครอปรูปกึ่งกลางเป็น 150x150', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(/var SIZE\s*=\s*150/.test(h), 'ไม่ได้กำหนดขนาด 150');
    assert.ok(h.includes('Math.min(img.width,img.height)'), 'ไม่ได้ครอปเป็นจัตุรัส');
    assert.ok(h.includes('(img.width-side)/2'), 'ไม่ได้ครอปกึ่งกลาง');
    assert.ok(!/var max\s*=\s*160/.test(h), 'ยังใช้โค้ดย่อรูปแบบเดิม');
  });

  await t('ฟอร์มพนักงาน: มีฟิลด์ใหม่ครบ (ชื่อเล่น เพศ วันเกิด สัญชาติ ที่อยู่ สถานะ)', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['e_nick', 'e_gender', 'e_birth', 'e_nation', 'e_natid', 'e_addr', 'e_status']
      .forEach((k) => assert.ok(h.includes(k), 'ขาดฟิลด์ ' + k));
    // จัดกลุ่มเป็นหมวด
    ['ข้อมูลส่วนตัว', 'ข้อมูลติดต่อ', 'ข้อมูลการจ้างงาน', 'การเข้าใช้ระบบ']
      .forEach((k) => assert.ok(h.includes(k), 'ขาดหมวด ' + k));
  });

  await t('หน้าจัดการพนักงาน: มีปุ่มส่งอีเมลเชิญใหม่ + สถานะบัญชี', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['resendInvite(', 'doResendInvite(', 'accountState(', "run('inviteEmployee'"]
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    // สถานะบัญชีครบ 4 แบบ
    ['ไม่มีอีเมล', 'ยังไม่ได้เชิญ', 'รอตั้งรหัสผ่าน', 'พร้อมใช้งาน']
      .forEach((k) => assert.ok(h.includes(k), 'ขาดสถานะ ' + k));
    assert.ok(h.includes('<th>บัญชีผู้ใช้</th>'), 'ขาดคอลัมน์บัญชีผู้ใช้');
    // ปุ่มต้องเตือนถ้าลิงก์ยังชี้ localhost
    assert.ok(h.includes('ตรวจ Site URL ใน Supabase'), 'ขาดคำเตือน localhost');
    assert.ok(h.includes("mail:'<rect"), 'ขาดไอคอน mail');
  });

  await t('หน้าจัดการพนักงาน: มี UI ยกเว้น passkey + จัดการอุปกรณ์', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['e_waex', 'webauthnExempt', 'loadDevices(', 'revokeDevice(',
     "run('listEmployeeDevices'", "run('revokeEmployeeDevice'"]
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    assert.ok(h.includes('ยกเว้นไม่ต้องยืนยันตัวตนด้วยอุปกรณ์'), 'ขาด label ของ checkbox');
    assert.ok(h.includes('ความปลอดภัยจะลดลง'), 'ควรเตือนผลกระทบด้านความปลอดภัย');
    assert.ok(h.includes('ยกเว้น passkey'), 'ตารางควรแสดงป้ายว่าถูกยกเว้น');
  });

  await t('ข้อความแนะนำบอกว่า PIN/ล็อกหน้าจอก็ใช้ได้ (ไม่ใช่แค่ชีวมิติ)', () => {
    const emp = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(/PIN/.test(emp), 'ควรบอกว่าใช้ PIN ได้');
    assert.ok(/ล็อกหน้าจอ/.test(emp), 'ควรแนะนำให้ตั้งล็อกหน้าจอ');
    assert.ok(/LINE|Facebook/.test(emp), 'ควรเตือนเรื่องเบราว์เซอร์ในแอป');
  });

  await t('setWebauthnExempt / จัดการอุปกรณ์ เป็นสิทธิ์แอดมินเท่านั้น', () => {
    const rpc2 = require(path.join(LIB, 'rpc'));
    ['setWebauthnExempt', 'listEmployeeDevices', 'revokeEmployeeDevice'].forEach((fn) => {
      assert.ok(typeof rpc2.REGISTRY[fn] === 'function', 'ไม่มีใน REGISTRY: ' + fn);
      assert.ok(rpc2.ADMIN_FNS.has(fn), fn + ' ต้องเป็นสิทธิ์แอดมิน');
      assert.ok(!rpc2.EMPLOYEE_FNS.has(fn), fn + ' พนักงานต้องเรียกไม่ได้');
    });
  });

  await t('บันทึก webauthnExempt ผ่าน saveEmployee ได้', async () => {
    const r = await employees.saveEmployee({
      name: 'ทดสอบยกเว้น', status: 'active', webauthnExempt: true,
    });
    const row = fake._data.profiles.find((x) => x.empId === r.empId);
    assert.strictEqual(row.webauthnExempt, true);
    await employees.saveEmployee({ empId: r.empId, name: 'ทดสอบยกเว้น', webauthnExempt: false });
    assert.strictEqual(
      fake._data.profiles.find((x) => x.empId === r.empId).webauthnExempt, false);
    await employees.deleteEmployee(r.empId);
  });

  await t('inviteEmployee เรียกได้และเป็นสิทธิ์แอดมินเท่านั้น', () => {
    const rpc2 = require(path.join(LIB, 'rpc'));
    assert.ok(typeof rpc2.REGISTRY.inviteEmployee === 'function', 'ไม่มีใน REGISTRY');
    assert.ok(rpc2.ADMIN_FNS.has('inviteEmployee'), 'ต้องเป็นสิทธิ์แอดมิน');
    assert.ok(!rpc2.EMPLOYEE_FNS.has('inviteEmployee'), 'พนักงานต้องเรียกไม่ได้');
  });

  await t('appUrl(): ใช้โดเมนจาก env เมื่ออยู่นอก request context', () => {
    const invite = require(path.join(LIB, 'api/invite'));
    const before = process.env.NEXT_PUBLIC_APP_URL;

    process.env.NEXT_PUBLIC_APP_URL = 'https://taptime-three.vercel.app/';
    assert.strictEqual(invite.appUrl(), 'https://taptime-three.vercel.app',
      'ต้องตัด / ท้ายออก');

    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = 'taptime-three.vercel.app';
    assert.strictEqual(invite.appUrl(), 'https://taptime-three.vercel.app',
      'ต้อง fallback ไป VERCEL_URL');

    delete process.env.VERCEL_URL;
    assert.strictEqual(invite.appUrl(), 'http://localhost:3000');
    process.env.NEXT_PUBLIC_APP_URL = before;
  });

  await t('เมนูวันหยุด: ไม่มีตารางวันหยุดแล้ว แต่คลิกปฏิทินได้', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(!h.includes('วันหยุดราชการ / วันหยุดพิเศษ</h3>'),
      'ยังมีการ์ดตารางวันหยุดอยู่');
    assert.ok(!h.includes('+ เพิ่มวันหยุด</button>'), 'ยังมีปุ่มเพิ่มวันหยุดแบบเดิม');
    assert.ok(h.includes('calClick('), 'ปฏิทินคลิกไม่ได้');
    assert.ok(h.includes('cal-day'), 'ขาด class ของช่องวันในปฏิทิน');
    // ยังต้องมีทั้ง เพิ่ม / แก้ไข / ลบ
    ['editHoliday(', 'saveHolidayM(', 'delHoliday(']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    assert.ok(h.includes('ลบวันหยุดนี้'), 'ไม่มีปุ่มลบในกล่องแก้ไข');
  });

  await t('ตั้งค่าวันลา: มี UI กำหนดสิทธิ์ + ตัวเลือกแสดงจำนวนวัน', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['openAssign(', 'saveAssign(', 'assignAllToggle(', 'assignDays(',
     'listLeaveAssignments', 'saveLeaveAssignments', 'lt_show']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    assert.ok(h.includes('ให้สิทธิ์พนักงานทุกคน'), 'ขาดตัวเลือก assign ทุกคน');
    assert.ok(h.includes('แสดงจำนวนวันลา/ปี ในหน้าพนักงาน'), 'ขาด checkbox showQuota');
  });

  await t('หน้าพนักงาน: ซ่อนโควตาของประเภทที่ตั้งค่าไม่ให้แสดง', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(h.includes('x.showQuota!==false'), 'ไม่ได้กรองตาม showQuota');
  });

  await t('generated/login.html มีช่อง "จดจำฉันไว้"', () => {
    const h = fs.readFileSync(path.join(GEN, 'login.html'), 'utf8');
    assert.ok(h.includes('id="remember"'), 'ไม่พบ checkbox remember');
    assert.ok(h.includes('remember:'), 'ไม่ได้ส่งค่า remember ไป API');
    assert.ok(h.includes('deviceHint'), 'ไม่ได้ส่ง device hint');
  });

  await t('ทุกหน้ามี meta viewport (กันหน้าจอมือถือย่อ/ไม่เต็มจอ)', () => {
    // ของเดิม Apps Script ใส่แท็กนี้จาก doGet() ไม่ได้อยู่ในไฟล์ HTML
    // ถ้าหายไปอีก มือถือจะเดาความกว้างเป็น ~980px แล้วย่อทั้งหน้า
    for (const page of ['admin.html', 'employee.html', 'login.html', 'set-password.html']) {
      const h = fs.readFileSync(path.join(GEN, page), 'utf8');
      const m = h.match(/<meta name="viewport" content="([^"]+)">/);
      assert.ok(m, page + ' ไม่มี meta viewport');
      assert.ok(/width=device-width/.test(m[1]),
        page + ' viewport ต้องมี width=device-width — ได้ ' + m[1]);
      assert.ok(/initial-scale=1/.test(m[1]),
        page + ' viewport ต้องมี initial-scale=1');
      assert.ok(h.indexOf('<meta name="viewport"') < h.indexOf('</head>'),
        page + ': viewport ต้องอยู่ใน <head>');
      // ต้องมีอันเดียว ไม่ซ้อนกัน
      assert.strictEqual((h.match(/<meta name="viewport"/g) || []).length, 1,
        page + ': มี viewport ซ้ำ');
    }
  });

  await t('หน้าพนักงานล็อกไม่ให้ซูม (ตรงกับสเปกเดิม)', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    const m = h.match(/<meta name="viewport" content="([^"]+)">/);
    assert.ok(/maximum-scale=1/.test(m[1]),
      'หน้าพนักงานต้องมี maximum-scale=1 — ได้ ' + m[1]);
  });

  await t('ทุกหน้ามี favicon / apple-touch-icon / manifest ครบ', () => {
    for (const page of ['admin.html', 'employee.html', 'login.html', 'set-password.html']) {
      const h = fs.readFileSync(path.join(GEN, page), 'utf8');
      ['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/manifest.webmanifest']
        .forEach((k) => assert.ok(h.includes(k), `${page} ขาด ${k}`));
      assert.ok(h.includes('theme-color'), page + ' ขาด theme-color');
      // ต้องอยู่ใน <head>
      assert.ok(h.indexOf('/favicon.ico') < h.indexOf('</head>'),
        page + ': แท็กไอคอนต้องอยู่ใน <head>');
    }
  });

  await t('ไฟล์ไอคอนถูกสร้างครบและขนาดถูกต้อง', () => {
    const PUB = path.join(__dirname, '..', 'public');
    const expect = {
      'logo.png': 512, 'logo-192.png': 192,
      'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512,
      'apple-touch-icon.png': 180,
      'favicon-16.png': 16, 'favicon-32.png': 32, 'favicon-48.png': 48,
    };
    for (const [name, size] of Object.entries(expect)) {
      const p = path.join(PUB, name);
      assert.ok(fs.existsSync(p), 'ไม่พบ public/' + name);
      // อ่านขนาดจาก PNG header (byte 16-23 = width,height แบบ big-endian)
      const buf = fs.readFileSync(p);
      assert.strictEqual(buf.toString('hex', 1, 4), '504e47', name + ' ไม่ใช่ PNG');
      assert.strictEqual(buf.readUInt32BE(16), size, name + ' กว้างไม่ตรง');
      assert.strictEqual(buf.readUInt32BE(20), size, name + ' สูงไม่ตรง');
    }
    assert.ok(fs.existsSync(path.join(PUB, 'favicon.ico')), 'ไม่พบ favicon.ico');
  });

  await t('manifest.webmanifest ถูกต้องตามสเปก PWA', () => {
    const m = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'));
    assert.strictEqual(m.short_name, 'TapTime');
    assert.strictEqual(m.display, 'standalone');
    assert.strictEqual(m.start_url, '/employee');
    assert.ok(m.icons.some((i) => i.sizes === '192x192'), 'ขาดไอคอน 192');
    assert.ok(m.icons.some((i) => i.sizes === '512x512'), 'ขาดไอคอน 512');
    assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'ขาดไอคอน maskable');
    // ทุกไฟล์ที่อ้างใน manifest ต้องมีจริง
    m.icons.forEach((i) =>
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', i.src)),
        'manifest อ้างไฟล์ที่ไม่มี: ' + i.src));
  });

  await t('โลโก้ถูกใช้แทนตัวอักษร "T" ในหน้า login และ sidebar', () => {
    const login = fs.readFileSync(path.join(GEN, 'login.html'), 'utf8');
    assert.ok(login.includes('src="/logo.png"'), 'หน้า login ไม่ได้ใช้โลโก้');
    assert.ok(!/<span class="logo">T<\/span>/.test(login), 'ยังเหลือตัวอักษร T');

    const admin = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(admin.includes("url('/logo.png')"), 'sidebar ไม่ได้ใช้โลโก้');
    // ต้องมาหลัง AdminStyles เพื่อให้ override ได้
    assert.ok(admin.lastIndexOf("url('/logo.png')") > admin.indexOf('.brand .logo{width:26px'),
      'CSS โลโก้ต้องมาหลัง AdminStyles');
  });

  await t('generated/set-password.html มี placeholder ของ Supabase', () => {
    const h = fs.readFileSync(path.join(GEN, 'set-password.html'), 'utf8');
    assert.ok(h.includes('__SUPABASE_URL__'));
    assert.ok(h.includes('__SUPABASE_ANON__'));
    assert.ok(h.includes('updateUser'), 'ไม่พบการเรียกตั้งรหัสผ่าน');
  });

  await t('CSS/สคริปต์ของหน้าเดิมถูกฝังครบ (เทียบขนาดกับไฟล์ต้นฉบับ)', () => {
    const gen = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8').length;
    const parts = fs.readdirSync(path.join(SRC, 'frontend-admin'))
      .reduce((s, f) => s + fs.readFileSync(path.join(SRC, 'frontend-admin', f), 'utf8').length, 0);
    assert.ok(gen > parts * 0.9, `ขนาดหาย: generated ${gen} vs ต้นฉบับ ${parts}`);
  });

  console.log('\n── session cookie + remember me ────────────');

  process.env.SESSION_SECRET = 'test-secret-0123456789';
  const session = require(path.join(LIB, 'session'));

  await t('encode -> decode ได้ค่าเดิม', () => {
    const raw = session.encodeSession({ empId: 'EMP-1', role: 'admin', name: 'ก', remember: true });
    const s = session.decodeSession(raw);
    assert.strictEqual(s.empId, 'EMP-1');
    assert.strictEqual(s.role, 'admin');
    assert.ok(s.exp > Math.floor(Date.now() / 1000));
  });

  await t('remember me: ติ๊ก = 30 วัน, ไม่ติ๊ก = 12 ชม.', () => {
    const now = Math.floor(Date.now() / 1000);
    const r = session.decodeSession(
      session.encodeSession({ empId: 'E', role: 'employee', name: 'ก', remember: true }));
    const n = session.decodeSession(
      session.encodeSession({ empId: 'E', role: 'employee', name: 'ก', remember: false }));
    assert.ok(r.exp - now > 29 * 86400, 'จดจำไว้ต้องอยู่ ~30 วัน');
    assert.ok(n.exp - now < 13 * 3600, 'ไม่จดจำต้องสั้นกว่ามาก');
  });

  await t('cookie options: ติ๊กจดจำ -> มี maxAge, ไม่ติ๊ก -> เป็น session cookie', () => {
    assert.strictEqual(session.cookieOptions(true).maxAge, session.REMEMBER_AGE);
    assert.strictEqual(session.cookieOptions(false).maxAge, undefined);
    assert.strictEqual(session.cookieOptions(false).httpOnly, true);
  });

  await t('cookie ที่ถูกแก้ไข (ยกระดับเป็น admin) ถูกปฏิเสธ', () => {
    const raw = session.encodeSession({ empId: 'EMP-1', role: 'employee', name: 'ก', remember: false });
    const [body, sig] = [raw.slice(0, raw.lastIndexOf('.')), raw.slice(raw.lastIndexOf('.') + 1)];
    const hacked = JSON.parse(Buffer.from(body, 'base64url').toString());
    hacked.role = 'admin';
    const forged = Buffer.from(JSON.stringify(hacked)).toString('base64url') + '.' + sig;
    assert.strictEqual(session.decodeSession(forged), null);
  });

  await t('cookie หมดอายุ / ว่าง ถูกปฏิเสธ', () => {
    assert.strictEqual(session.decodeSession(''), null);
    assert.strictEqual(session.decodeSession('abc'), null);
    assert.strictEqual(session.decodeSession('abc.def'), null);
  });

  console.log('\n── แยกอุปกรณ์ (desktop / mobile) ───────────');

  const device = require(path.join(LIB, 'device'));
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1',
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  };

  await t('แยกชนิดอุปกรณ์จาก user-agent ถูกต้อง', () => {
    assert.strictEqual(device.deviceKind(UA.iphone), 'mobile');
    assert.strictEqual(device.deviceKind(UA.android), 'mobile');
    assert.strictEqual(device.deviceKind(UA.ipad), 'tablet');
    assert.strictEqual(device.deviceKind(UA.mac), 'desktop');
    assert.strictEqual(device.deviceKind(UA.win), 'desktop');
  });

  await t('admin + desktop -> /admin, admin + มือถือ -> /employee', () => {
    assert.strictEqual(device.landingFor('admin', false), '/admin');
    assert.strictEqual(device.landingFor('admin', true), '/employee');
    assert.strictEqual(device.landingFor('employee', false), '/employee');
    assert.strictEqual(device.landingFor('employee', true), '/employee');
  });

  await t('client hint ทับ user-agent ได้ (iPad ปลอม UA เป็น Mac)', () => {
    assert.strictEqual(device.isHandheld(UA.mac, 'mobile'), true);
    assert.strictEqual(device.isHandheld(UA.iphone, 'desktop'), false);
    assert.strictEqual(device.isHandheld(UA.mac, null), false);
  });

  console.log('\n── WebAuthn ────────────────────────────────');

  const webauthn = require(path.join(LIB, 'webauthn'));

  await t('rpID ถอดจากโดเมนถูกต้อง', () => {
    assert.strictEqual(webauthn.rpConfig('https://taptime.vercel.app').rpID, 'taptime.vercel.app');
    assert.strictEqual(webauthn.rpConfig('http://localhost:3000').rpID, 'localhost');
    assert.strictEqual(webauthn.rpConfig('http://localhost:3000').origin, 'http://localhost:3000');
  });

  await t('challenge: pack -> unpack ได้ค่าเดิม', () => {
    const packed = webauthn.packChallenge('abc123', 'EMP-1', 'auth');
    const o = webauthn.unpackChallenge(packed);
    assert.strictEqual(o.c, 'abc123');
    assert.strictEqual(o.e, 'EMP-1');
    assert.strictEqual(o.p, 'auth');
  });

  await t('challenge ที่ถูกแก้ไข (สลับเป็นพนักงานคนอื่น) ถูกปฏิเสธ', () => {
    const packed = webauthn.packChallenge('abc123', 'EMP-1', 'auth');
    const body = packed.slice(0, packed.lastIndexOf('.'));
    const sig = packed.slice(packed.lastIndexOf('.') + 1);
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    o.e = 'EMP-เหยื่อ';
    const forged = Buffer.from(JSON.stringify(o)).toString('base64url') + '.' + sig;
    assert.strictEqual(webauthn.unpackChallenge(forged), null);
  });

  await t('challenge หมดอายุถูกปฏิเสธ', () => {
    const body = Buffer.from(JSON.stringify({
      c: 'x', e: 'EMP-1', p: 'auth', x: Date.now() / 1000 - 10,
    })).toString('base64url');
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET)
      .update(body).digest('base64url');
    assert.strictEqual(webauthn.unpackChallenge(body + '.' + sig), null);
  });

  await t('deviceNameFromUA ตั้งชื่ออุปกรณ์อ่านง่าย', () => {
    assert.strictEqual(webauthn.deviceNameFromUA(UA.iphone), 'iPhone');
    assert.strictEqual(webauthn.deviceNameFromUA(UA.android), 'Android');
    assert.strictEqual(webauthn.deviceNameFromUA(UA.ipad), 'iPad');
  });

  await t('empCheckIn/empCheckOut ถูกกำหนดให้ต้องผ่าน biometric', () => {
    const rpc2 = require(path.join(LIB, 'rpc'));
    assert.ok(rpc2.BIOMETRIC_FNS.has('empCheckIn'));
    assert.ok(rpc2.BIOMETRIC_FNS.has('empCheckOut'));
    // ทุกตัวใน BIOMETRIC ต้องเป็น employee fn ด้วย (จะได้ถูกเขียนทับ empId)
    [...rpc2.BIOMETRIC_FNS].forEach((fn) =>
      assert.ok(rpc2.EMPLOYEE_FNS.has(fn), fn + ' ต้องอยู่ใน EMPLOYEE_FNS'));
  });

  console.log('\n── การเขียนทับตัวตน (กันเช็คอินแทนกัน) ─────');

  const rpcMod = require(path.join(LIB, 'rpc'));
  const ME = { empId: 'EMP-ฉัน' };

  await t('args[0] ถูกเขียนทับด้วย empId จาก session เสมอ', () => {
    for (const fn of rpcMod.EMPLOYEE_FNS) {
      // จำลอง attacker ที่แก้ JS แล้วส่ง empId ของเพื่อนมา
      const out = rpcMod.applyIdentity(fn, ['EMP-เหยื่อ', 1, 2], ME);
      assert.strictEqual(out[0], 'EMP-ฉัน', fn + ' ไม่ได้เขียนทับตัวตน');
      assert.deepStrictEqual(out.slice(1), [1, 2], fn + ' argument อื่นต้องไม่ถูกแตะ');
    }
  });

  await t('ไม่มี session -> ตัวตนเป็น null (ฟังก์ชันจะ throw ต่อ)', () => {
    const out = rpcMod.applyIdentity('empCheckIn', ['EMP-เหยื่อ'], null);
    assert.strictEqual(out[0], null);
  });

  await t('ฟังก์ชันแอดมินไม่ถูกเขียนทับ argument', () => {
    const out = rpcMod.applyIdentity('decideLeave', ['LV-1', 'approved'], ME);
    assert.deepStrictEqual(out, ['LV-1', 'approved']);
  });

  await t('ส่ง args เปล่า/ผิดชนิด ก็ยังได้ตัวตนที่ถูกต้อง', () => {
    assert.strictEqual(rpcMod.applyIdentity('empCheckIn', [], ME)[0], 'EMP-ฉัน');
    assert.strictEqual(rpcMod.applyIdentity('empCheckIn', null, ME)[0], 'EMP-ฉัน');
  });

  console.log('\n════════════════════════════════════════════');
  console.log(`ผ่าน ${pass} / ล้มเหลว ${fail}`);
  console.log('════════════════════════════════════════════\n');
  process.exit(fail ? 1 : 0);
})();
