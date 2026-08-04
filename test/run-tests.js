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
const overtime = require(path.join(LIB, 'api/overtime'));

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
    const me = list.find((e) => e.empId === 'EMP-f3795df3');
    assert.ok(me, 'ต้องมีพนักงานจากข้อมูลจริง');
    assert.strictEqual(me.name, 'เอกดนัย อมตธรรม');
    assert.strictEqual(me.branchName, 'สำนักงานใหญ่');
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

  await t('writeCheckOut: 17:02 -> ยังไม่เกินผ่อนผัน 15 นาที จึงไม่มี OT', async () => {
    const att = await attendance.attendanceOf('TEST-1', '2026-07-31'); // เข้า 08:37
    const r = await attendance.writeCheckOut(att, '17:02');
    // กฎเก่าให้ OT 2 นาที (max(0, ออก - workEnd)) โดยไม่มีผ่อนผัน/ขั้นต่ำ
    // นโยบายเริ่มต้นใหม่: grace 15 นาที -> อยู่ต่อ 2 นาทีไม่ถือเป็น OT
    assert.strictEqual(r.otMinutes, 0);
    assert.strictEqual(r.otMinutesRaw, 0);
    assert.strictEqual(r.workHours, 7.42); // (1022-517)/60 - 1 = 7.4166 -> 7.42
  });

  await t('writeCheckOut: ออกก่อนเลิกงาน -> OT = 0 และไม่หักเบรก (ยังไม่ถึงเกณฑ์)', async () => {
    const att = await attendance.attendanceOf('TEST-2', '2026-07-31'); // เข้า 08:10
    const r = await attendance.writeCheckOut(att, '13:37');
    assert.strictEqual(r.otMinutes, 0);
    // (817-490)/60 = 5.45 ชม. ยังไม่ถึงเกณฑ์ 6 ชม. -> ไม่หักเบรก
    // (กฎเดิมหักเสมอจะได้ 4.45 ซึ่งกินเวลาพนักงานไปฟรี ๆ 1 ชม.)
    assert.strictEqual(r.workHours, 5.45);
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
    assert.strictEqual(att.otMinutes, 30);   // 17:30 - 17:00 (เกินผ่อนผัน 15 นาที)
    assert.strictEqual(att.otStatus, 'pending'); // โหมด request_after -> รออนุมัติ
    // ชั่วโมงงานปกติต้อง "ไม่รวม" OT: (1050-480)/60 - พัก 1 - OT 0.5 = 8
    assert.strictEqual(att.workHours, 8);
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

  console.log('\n── ชั่วโมงทำงาน / การหักเบรก ───────────────');

  await t('หักเบรกเมื่อทำงานถึงเกณฑ์เท่านั้น', () => {
    const f = helpers.computeWorkHours;
    // ทำงาน 9 ชม. เกิน 6 -> หัก 1 ชม.
    assert.strictEqual(f(9 * 60, 1, 6).net, 8);
    assert.strictEqual(f(9 * 60, 1, 6).breakDeducted, 1);
    // ทำงาน 3 ชม. ไม่ถึง 6 -> ไม่หัก (ของเดิมจะได้ 2 ซึ่งผิด)
    assert.strictEqual(f(3 * 60, 1, 6).net, 3);
    assert.strictEqual(f(3 * 60, 1, 6).breakDeducted, 0);
    // พอดีเกณฑ์ -> หัก
    assert.strictEqual(f(6 * 60, 1, 6).net, 5);
  });

  await t('กะสั้นมากไม่ติดลบ และไม่ถูกปัดเป็น 0 อีกต่อไป', () => {
    const f = helpers.computeWorkHours;
    assert.strictEqual(f(30, 1, 6).net, 0.5, 'ทำงาน 30 นาที ต้องได้ 0.5 ชม.');
    assert.strictEqual(f(30, 1, 0).net, 0, 'ถ้าตั้งหักเสมอ ต้องไม่ติดลบ');
    assert.strictEqual(f(-120, 1, 6).net, 0, 'ค่าติดลบต้องกลายเป็น 0');
  });

  await t('breakAfterHours = 0 -> หักเสมอ (พฤติกรรมเดิม)', () => {
    assert.strictEqual(helpers.computeWorkHours(3 * 60, 1, 0).net, 2);
  });

  await t('ไม่ได้ตั้ง breakAfterHours -> ใช้ค่าเริ่มต้น 6 ชม.', () => {
    assert.strictEqual(helpers.computeWorkHours(3 * 60, 1, undefined).net, 3);
    assert.strictEqual(helpers.computeWorkHours(3 * 60, 1, null).net, 3);
    assert.strictEqual(helpers.computeWorkHours(9 * 60, 1, undefined).net, 8);
  });

  await t('เทียบกับข้อมูลจริง: 08:00-13:37 = 4.62 ชม. (ยังเท่าเดิม)', async () => {
    // 5.62 ชม. ไม่ถึงเกณฑ์ 6 -> ไม่หักเบรก ผลจึงเป็น 5.62 ไม่ใช่ 4.62
    // ตรวจว่าสูตรคำนวณตรงตามที่ตั้งใจ (ค่าเก่าในฐานข้อมูลคิดด้วยกฎเดิม)
    const gross = (13 * 60 + 37) - (8 * 60);
    assert.strictEqual(helpers.computeWorkHours(gross, 1, 0).net, 4.62, 'กฎเดิม');
    assert.strictEqual(helpers.computeWorkHours(gross, 1, 6).net, 5.62, 'กฎใหม่');
  });

  await t('writeCheckOut ใช้สูตรใหม่ (end-to-end)', async () => {
    const emp = { empId: 'TEST-BRK', name: 'ทดสอบเบรก', branchId: 'BR-e7625e91' };
    await attendance.writeCheckIn(emp, '2026-07-20', '08:00', 'วันปกติ', null, null);
    let att = await attendance.attendanceOf('TEST-BRK', '2026-07-20');
    // 08:00-11:00 = 3 ชม. ไม่ถึงเกณฑ์ 6 -> ต้องได้ 3 ไม่ใช่ 2
    let r = await attendance.writeCheckOut(att, '11:00');
    assert.strictEqual(r.workHours, 3);

    att = await attendance.attendanceOf('TEST-BRK', '2026-07-20');
    r = await attendance.writeCheckOut(att, '17:00');   // 9 ชม. -> หัก 1
    assert.strictEqual(r.workHours, 8);
  });

  console.log('\n── กันยื่นลาซ้ำ / ทับช่วงวัน ───────────────');

  await t('ยื่นลาทับกับใบที่อนุมัติแล้ว -> ถูกปฏิเสธ', async () => {
    // fixture มีใบลาพักร้อน 31/07/2026 (approved)
    await assert.rejects(
      () => employeeApi.empSubmitLeave('EMP-f3795df3', {
        leaveType: 'ลาป่วย', startDate: '2026-07-31', endDate: '2026-07-31', reason: 'x',
      }),
      /ทับกับใบลาที่มีอยู่แล้ว/
    );
  });

  await t('ทับแบบคาบเกี่ยว (ครอบ / คร่อมหัว / คร่อมท้าย) ถูกจับได้ทุกแบบ', async () => {
    const cases = [
      ['2026-07-30', '2026-08-02', 'ครอบทั้งใบเดิม'],
      ['2026-07-25', '2026-07-31', 'คร่อมหัว'],
      ['2026-07-31', '2026-08-05', 'คร่อมท้าย'],
    ];
    for (const [s, e, label] of cases) {
      await assert.rejects(
        () => employeeApi.empSubmitLeave('EMP-f3795df3', {
          leaveType: 'ลาป่วย', startDate: s, endDate: e, reason: 'x',
        }),
        /ทับกับใบลา/,
        label + ' ไม่ถูกจับ'
      );
    }
  });

  await t('ช่วงที่ไม่ทับกันยื่นได้ตามปกติ', async () => {
    const r = await employeeApi.empSubmitLeave('EMP-f3795df3', {
      leaveType: 'ลาป่วย', startDate: '2026-06-01', endDate: '2026-06-02', reason: 'ไข้',
    });
    assert.strictEqual(r.days, 2);
    // ลบทิ้งเพื่อไม่ให้กระทบเทสต์อื่น
    fake._data.leave_requests = fake._data.leave_requests.filter((l) => l.reqId !== r.reqId);
  });

  await t('วันสิ้นสุดก่อนวันเริ่ม -> ถูกปฏิเสธ', async () => {
    await assert.rejects(
      () => employeeApi.empSubmitLeave('EMP-f3795df3', {
        leaveType: 'ลาป่วย', startDate: '2026-06-10', endDate: '2026-06-01', reason: 'x',
      }),
      /วันสิ้นสุดต้องไม่ก่อนวันเริ่มลา/
    );
  });

  await t('ใบที่ถูกปฏิเสธไม่กันสิทธิ์การยื่นใหม่', async () => {
    fake._data.leave_requests.push({
      reqId: 'LV-rejected', empId: 'EMP-f3795df3', leaveType: 'ลาป่วย',
      startDate: '2026-06-15', endDate: '2026-06-16', status: 'rejected', days: 2,
    });
    const r = await employeeApi.empSubmitLeave('EMP-f3795df3', {
      leaveType: 'ลาป่วย', startDate: '2026-06-15', endDate: '2026-06-16', reason: 'ไข้',
    });
    assert.ok(r.reqId, 'ควรยื่นได้');
    fake._data.leave_requests = fake._data.leave_requests
      .filter((l) => l.reqId !== r.reqId && l.reqId !== 'LV-rejected');
  });

  console.log('\n── ระบบแจ้งเตือน ───────────────────────────');

  const noti = require(path.join(LIB, 'api/notifications'));

  await t('ยื่นลา -> แจ้งแอดมิน (ไม่แจ้งตัวผู้ยื่นเอง)', async () => {
    fake._data.notifications.length = 0;
    const r = await employeeApi.empSubmitLeave('EMP-f3795df3', {
      leaveType: 'ลาป่วย', startDate: '2026-05-04', endDate: '2026-05-04', reason: 'ไข้',
    });
    const rows = fake._data.notifications;
    assert.strictEqual(rows.length, 1, 'ต้องมี 1 แจ้งเตือน (แอดมิน 1 คน)');
    assert.strictEqual(rows[0].empId, 'EMP-admin1');
    assert.strictEqual(rows[0].type, 'leave_submitted');
    assert.strictEqual(rows[0].isRead, false);
    assert.ok(/เอกดนัย/.test(rows[0].body), 'ต้องมีชื่อผู้ยื่น');
    assert.ok(!rows.some((n) => n.empId === 'EMP-f3795df3'), 'ห้ามแจ้งตัวเอง');
    fake._data.leave_requests = fake._data.leave_requests.filter((l) => l.reqId !== r.reqId);
  });

  await t('อนุมัติลา -> แจ้งกลับไปหาพนักงาน', async () => {
    fake._data.notifications.length = 0;
    const lv = fake._data.leave_requests[0];
    await leaves.decideLeave(lv.reqId, 'approved');
    const rows = fake._data.notifications;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].empId, lv.empId);
    assert.strictEqual(rows[0].type, 'leave_decided');
    assert.ok(/อนุมัติ/.test(rows[0].title));
  });

  await t('ปฏิเสธลา -> ข้อความบอกว่าไม่ได้รับอนุมัติ', async () => {
    fake._data.notifications.length = 0;
    const lv = fake._data.leave_requests[0];
    await leaves.decideLeave(lv.reqId, 'rejected');
    assert.ok(/ถูกปฏิเสธ/.test(fake._data.notifications[0].title));
  });

  await t('ยื่นคำขอแก้เวลา -> แจ้งแอดมิน', async () => {
    fake._data.notifications.length = 0;
    await timeEdits.empSubmitTimeEdit('EMP-f3795df3', {
      date: '2026-07-27', newCheckOut: '18:00', reason: 'ลืมเช็คเอาท์',
    });
    const rows = fake._data.notifications;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].type, 'timeedit_submitted');
    assert.strictEqual(rows[0].empId, 'EMP-admin1');
  });

  await t('นับ/อ่าน/ล้างแจ้งเตือน ทำงานถูกต้อง', async () => {
    fake._data.notifications.length = 0;
    await noti.notify(['EMP-f3795df3'], 'absent', 'ทดสอบ 1', 'body1');
    await noti.notify(['EMP-f3795df3'], 'absent', 'ทดสอบ 2', 'body2');
    await noti.notify(['EMP-อื่น'], 'absent', 'ของคนอื่น', 'x');

    assert.strictEqual((await noti.unreadCount('EMP-f3795df3')).unread, 2);

    const list = await noti.listNotifications('EMP-f3795df3');
    assert.strictEqual(list.unread, 2);
    assert.strictEqual(list.items.length, 2, 'ต้องเห็นเฉพาะของตัวเอง');

    await noti.markNotificationsRead('EMP-f3795df3');
    assert.strictEqual((await noti.unreadCount('EMP-f3795df3')).unread, 0);
    // ของคนอื่นต้องไม่ถูกอ่านไปด้วย
    assert.strictEqual((await noti.unreadCount('EMP-อื่น')).unread, 1);
  });

  await t('อ่านเฉพาะบางรายการได้', async () => {
    fake._data.notifications.length = 0;
    await noti.notify(['EMP-x'], 'absent', 'a', '');
    await noti.notify(['EMP-x'], 'absent', 'b', '');
    const before = await noti.listNotifications('EMP-x');
    await noti.markNotificationsRead('EMP-x', [before.items[0].notiId]);
    assert.strictEqual((await noti.unreadCount('EMP-x')).unread, 1);
  });

  await t('แจ้งเตือนใช้ได้ทั้งแอดมินและพนักงาน และตัวตนมาจาก session', () => {
    const rpc2 = require(path.join(LIB, 'rpc'));
    ['listNotifications', 'unreadCount', 'markNotificationsRead'].forEach((fn) => {
      assert.ok(rpc2.REGISTRY[fn], 'ไม่มี ' + fn);
      assert.ok(rpc2.EMPLOYEE_FNS.has(fn), fn + ' ต้องถูกเขียนทับ empId จาก session');
      assert.ok(!rpc2.ADMIN_FNS.has(fn), fn + ' ไม่ควรจำกัดเฉพาะแอดมิน');
    });
    // ยิงมาด้วย empId คนอื่นก็ต้องถูกเขียนทับ
    assert.strictEqual(
      rpc2.applyIdentity('listNotifications', ['EMP-เหยื่อ'], { empId: 'EMP-ฉัน' })[0],
      'EMP-ฉัน'
    );
  });

  console.log('\n── พนักงานเปลี่ยนรูปโปรไฟล์เอง ─────────────');

  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  await t('อัปเดตรูปของตัวเองได้', async () => {
    const r = await employeeApi.empUpdatePhoto('EMP-f3795df3', PNG_1PX);
    assert.strictEqual(r.ok, true);
    const row = fake._data.profiles.find((e) => e.empId === 'EMP-f3795df3');
    assert.strictEqual(row.photo, PNG_1PX);
  });

  await t('ส่งค่าว่าง = ลบรูปออก', async () => {
    const r = await employeeApi.empUpdatePhoto('EMP-f3795df3', '');
    assert.strictEqual(r.removed, true);
    const row = fake._data.profiles.find((e) => e.empId === 'EMP-f3795df3');
    assert.strictEqual(row.photo, null);
  });

  await t('ปฏิเสธค่าที่ไม่ใช่รูปภาพ (กันยัด payload แปลกปลอม)', async () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'https://example.com/a.jpg',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',   // svg รัน script ได้
      'not-a-data-url',
    ]) {
      await assert.rejects(
        () => employeeApi.empUpdatePhoto('EMP-f3795df3', bad),
        /ไฟล์รูปไม่ถูกต้อง/,
        'ควรปฏิเสธ: ' + bad.slice(0, 30)
      );
    }
  });

  await t('ปฏิเสธไฟล์ใหญ่เกิน 200 KB', async () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(300 * 1024);
    await assert.rejects(
      () => employeeApi.empUpdatePhoto('EMP-f3795df3', big),
      /ใหญ่เกินไป/
    );
  });

  await t('พนักงานที่ถูกระงับเปลี่ยนรูปไม่ได้', async () => {
    const me = fake._data.profiles.find((e) => e.empId === 'EMP-f3795df3');
    const before = me.status;
    me.status = 'inactive';
    await assert.rejects(() => employeeApi.empUpdatePhoto('EMP-f3795df3', PNG_1PX));
    me.status = before;
  });

  await t('empUpdatePhoto ถูกเขียนทับตัวตนจาก session (แก้รูปคนอื่นไม่ได้)', () => {
    const rpc2 = require(path.join(LIB, 'rpc'));
    assert.ok(rpc2.REGISTRY.empUpdatePhoto, 'ไม่มีใน REGISTRY');
    assert.ok(rpc2.EMPLOYEE_FNS.has('empUpdatePhoto'), 'ต้องอยู่ใน EMPLOYEE_FNS');
    assert.ok(!rpc2.ADMIN_FNS.has('empUpdatePhoto'));
    assert.strictEqual(
      rpc2.applyIdentity('empUpdatePhoto', ['EMP-เหยื่อ', PNG_1PX], { empId: 'EMP-ฉัน' })[0],
      'EMP-ฉัน'
    );
  });

  console.log('\n── สิทธิ์แอดมิน (ตรวจสดจากฐานข้อมูล) ───────');

  const auth = require(path.join(LIB, 'auth'));

  await t('เลื่อนเป็นแอดมินแล้วมีผลทันที ไม่ต้อง login ใหม่', async () => {
    const emp = fake._data.profiles.find((e) => e.empId === 'EMP-f3795df3');
    const before = emp.role;

    emp.role = 'employee';
    assert.strictEqual(await auth.isAdminNow({ empId: emp.empId }), false);

    emp.role = 'admin';               // แอดมินเพิ่งเลื่อนสิทธิ์ให้ (cookie ยังเป็น employee)
    assert.strictEqual(await auth.isAdminNow({ empId: emp.empId }), true,
      'ต้องเป็นแอดมินทันทีโดยไม่ต้องออกจากระบบ');

    emp.role = before;
  });

  await t('ถอดสิทธิ์แล้วถูกตัดทันที (ไม่ต้องรอ cookie หมดอายุ)', async () => {
    const emp = fake._data.profiles.find((e) => e.empId === 'EMP-admin1');
    assert.strictEqual(await auth.isAdminNow({ empId: emp.empId }), true);
    emp.role = 'employee';
    assert.strictEqual(await auth.isAdminNow({ empId: emp.empId }), false);
    emp.role = 'admin';
  });

  await t('แอดมินที่ถูกระงับ (inactive) ใช้สิทธิ์ไม่ได้', async () => {
    const emp = fake._data.profiles.find((e) => e.empId === 'EMP-admin1');
    emp.status = 'inactive';
    assert.strictEqual(await auth.isAdminNow({ empId: emp.empId }), false);
    const v = await auth.currentViewer({ empId: emp.empId });
    assert.strictEqual(v.active, false);
    assert.strictEqual(v.role, 'admin', 'role ยังเป็น admin แต่ใช้ไม่ได้');
    emp.status = 'active';
  });

  await t('ไม่มี session / พนักงานถูกลบ -> ไม่ใช่แอดมิน', async () => {
    assert.strictEqual(await auth.isAdminNow(null), false);
    assert.strictEqual(await auth.isAdminNow({ empId: 'EMP-ไม่มีจริง' }), false);
    assert.strictEqual(await auth.currentViewer({ empId: 'EMP-ไม่มีจริง' }), null);
  });

  await t('appUrl(): ตัด path ที่ใส่เกินมาออก (เคยตั้งเป็น .../admin)', () => {
    const invite = require(path.join(LIB, 'api/invite'));
    assert.strictEqual(
      invite.toOrigin('https://taptime-three.vercel.app/admin'),
      'https://taptime-three.vercel.app'
    );
    assert.strictEqual(
      invite.toOrigin('https://taptime-three.vercel.app/'),
      'https://taptime-three.vercel.app'
    );
    assert.strictEqual(
      invite.toOrigin('http://localhost:3000'),
      'http://localhost:3000'
    );
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

  await t('หน้าจัดการพนักงาน: มีค้นหา / ตัวกรอง 3 แบบ / แบ่งหน้า', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['emp_q', 'emp_branch', 'emp_status', 'emp_role',
     'empFilter(', 'empClearFilter(', 'empPer(', 'empPage(']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    // ตัวเลือกจำนวนรายการต่อหน้า
    assert.ok(/\[10,\s*20,\s*50,\s*100\]/.test(h), 'ตัวเลือกต่อหน้าไม่ครบ 10/20/50/100');
    assert.ok(/per\s*:\s*20/.test(h), 'ค่าเริ่มต้นต้องเป็น 20 รายการ');
  });

  await t('ตารางพนักงาน: ซ่อนอีเมล เบอร์โทร และตำแหน่ง', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    const i = h.indexOf('var rows=rowsData.map(');
    const j = h.indexOf('var branchOpts=');
    assert.ok(i > 0 && j > i, 'ไม่พบส่วนสร้างแถวตาราง');
    const rowCode = h.slice(i, j);

    assert.ok(!/e\.phone/.test(rowCode), 'ยังแสดงเบอร์โทรในตาราง');
    assert.ok(!/e\.email\?/.test(rowCode), 'ยังแสดงอีเมลในตาราง');
    assert.ok(!/e\.position/.test(rowCode), 'ยังแสดงตำแหน่งในตาราง');
    assert.ok(!/e\.salaryType/.test(rowCode), 'ยังแสดงประเภทเงินเดือนในตาราง');

    // หัวตาราง "ของหน้าจัดการพนักงาน" ต้องไม่มีคอลัมน์ตำแหน่ง
    // (หน้ารายงานรายวันยังมีคอลัมน์ตำแหน่งอยู่ ซึ่งถูกต้องแล้ว จึงต้องเจาะเฉพาะจุด)
    const thead = h.match(
      /'<table><thead><tr><th>ลำดับ<\/th><th>ชื่อ<\/th>[^;]*?<\/tr><\/thead><tbody>'/
    );
    assert.ok(thead, 'ไม่พบหัวตารางของหน้าจัดการพนักงาน');
    assert.ok(!thead[0].includes('ตำแหน่ง'), 'ยังมีคอลัมน์ตำแหน่งในตารางพนักงาน');
    // ระวัง: /<th/ จะไปตรงกับ <thead> ด้วย ต้องบังคับให้ตามด้วย > หรือช่องว่าง
    const cols = (thead[0].match(/<th[ >]/g) || []).length;
    assert.strictEqual(cols, 6, 'ควรเหลือ 6 คอลัมน์ แต่ได้ ' + cols);
    assert.ok(h.includes('colspan="6"'), 'colspan ของแถวว่างไม่ตรงกับจำนวนคอลัมน์');

    // ตัวกรองตำแหน่งต้องถูกถอดออก
    assert.ok(!h.includes('emp_pos'), 'ยังมีตัวกรองตำแหน่ง');
    assert.ok(!h.includes('ทุกตำแหน่ง'), 'ยังมีตัวเลือก "ทุกตำแหน่ง"');

    // แต่ยังต้องค้นหาด้วยอีเมล/เบอร์/ตำแหน่งได้อยู่
    assert.ok(/\[e\.name,e\.nickname,e\.phone,e\.email,e\.position/.test(h),
      'ต้องยังค้นหาจากข้อมูลที่ซ่อนได้');
    // และแก้ไขได้ในฟอร์ม
    ['e_phone', 'e_email', 'e_pos'].forEach((k) =>
      assert.ok(h.includes(k), 'ฟอร์มต้องยังมีช่อง ' + k));
  });

  await t('ตารางพนักงาน: ปุ่มจัดการเป็นไอคอน + มี tooltip', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    const i = h.indexOf('var rows=rowsData.map(');
    const rowCode = h.slice(i, h.indexOf('var branchOpts='));

    // ต้องไม่เหลือปุ่มแบบข้อความ
    ['>แก้ไข<', '>ลบ<'].forEach((k) =>
      assert.ok(!rowCode.includes(k), 'ยังมีปุ่มข้อความ ' + k));

    assert.ok(rowCode.includes('btn-ico'), 'ไม่ได้ใช้ปุ่มไอคอน');
    // ทุกปุ่มต้องมี title (tooltip)
    ['title="แก้ไขข้อมูลพนักงาน"', 'title="ลบพนักงาน"']
      .forEach((k) => assert.ok(rowCode.includes(k), 'ขาด tooltip: ' + k));
    assert.ok(/title="'\+esc\(acc\.btnTip\)\+'"/.test(rowCode),
      'ปุ่มส่งอีเมลไม่มี tooltip');
    // ไอคอนครบ 3 แบบ
    ["svgI('mail'", "svgI('edit'", "svgI('trash'"]
      .forEach((k) => assert.ok(rowCode.includes(k), 'ขาดไอคอน ' + k));
    assert.ok(h.includes('.btn-ico{'), 'ไม่มี CSS ของปุ่มไอคอน');
  });

  await t('ตารางพนักงาน: มีไอคอนบอกว่าใครเป็นแอดมิน', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(h.includes("role==='admin'"), 'ไม่ได้ตรวจ role admin');
    assert.ok(h.includes('badge-admin'), 'ไม่มีป้ายแอดมิน');
    assert.ok(h.includes('title="ผู้ดูแลระบบ'), 'ป้ายแอดมินไม่มี tooltip');
    assert.ok(h.includes("shield:'<path"), 'ขาดไอคอนโล่');
    assert.ok(h.includes('.badge-admin{'), 'ไม่มี CSS ของป้าย');
    // หัวหน้างานก็ควรแยกสีได้
    assert.ok(h.includes('badge-head'), 'ไม่มีป้ายหัวหน้างาน');
  });

  await t('ปุ่มไอคอนถูกล็อกตอนกด แต่ไอคอนไม่ถูกแทนด้วยข้อความ', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(h.includes("'.btn-ico'") || h.includes('.btn-ico,'),
      'BTN_SEL ไม่ครอบคลุมปุ่มไอคอน');
    assert.ok(h.includes("contains('btn-ico')"), 'ไม่ได้แยกกรณีปุ่มไอคอน');
    assert.ok(h.includes('if (!iconOnly) el.innerHTML = busyText(fn)'),
      'ปุ่มไอคอนจะถูกแทนด้วยข้อความ ทำให้ไอคอนหาย');
    assert.ok(h.includes('.btn-ico[data-busy]'), 'ไม่มี CSS ตอนปุ่มไอคอนถูกล็อก');
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

  console.log('\n── OT: computeOt (สูตรบริสุทธิ์) ───────────');

  /** นโยบายทดสอบ — ปรับเฉพาะฟิลด์ที่สนใจ */
  const pol = (over) => overtime.normalizePolicy({
    ...overtime.DEFAULT_POLICY, ...over,
  });
  /** เข้า 08:00 ออกตามที่ระบุ กะ 08:00-17:00 */
  const ot = (outHHMM, over, extra) => overtime.computeOt({
    checkInMin: 8 * 60,
    checkOutMin: helpers.toMinutes(outHHMM),
    workStartMin: 8 * 60,
    workEndMin: 17 * 60,
    dayType: (over && over.__day) || 'workday',
    policy: pol(over),
    ...(extra || {}),
  });

  await t('OT: โหมด off -> ไม่นับอะไรเลย', () => {
    const r = ot('20:00', { mode: 'off' });
    assert.deepStrictEqual(
      { raw: r.raw, countable: r.countable, status: r.status },
      { raw: 0, countable: 0, status: 'none' }
    );
  });

  await t('OT: เวลาออก <= เวลาเข้า -> 0 + note cross_midnight_unsupported', () => {
    for (const out of ['08:00', '02:00', '07:59']) {
      const r = overtime.computeOt({
        checkInMin: 8 * 60, checkOutMin: helpers.toMinutes(out),
        workStartMin: 480, workEndMin: 1020,
        dayType: 'workday', policy: pol({ mode: 'auto' }),
      });
      assert.strictEqual(r.countable, 0, 'ควรได้ 0 เมื่อออก ' + out);
      assert.strictEqual(r.note, 'cross_midnight_unsupported');
    }
  });

  await t('OT: grace ต้อง "เกิน" ไม่ใช่ "เท่ากับ"', () => {
    const p = { mode: 'auto', graceMinutes: 15, minMinutes: 0, roundMinutes: 0 };
    assert.strictEqual(ot('17:15', p).raw, 0, 'เท่ากับ grace พอดี ต้องไม่นับ');
    assert.strictEqual(ot('17:16', p).raw, 16, 'เกิน grace 1 นาที ต้องนับทั้ง 16 นาที');
  });

  await t('OT: ขั้นต่ำตัดทั้งก้อน ไม่ใช่ตัดเศษ', () => {
    const p = { mode: 'auto', graceMinutes: 0, minMinutes: 30, roundMinutes: 0 };
    assert.strictEqual(ot('17:25', p).countable, 0, '25 นาที < ขั้นต่ำ 30 -> 0');
    assert.strictEqual(ot('17:30', p).countable, 30, '30 นาที = ขั้นต่ำ -> ผ่าน');
  });

  await t('OT: ปัดเศษ 3 แบบ + roundMinutes = 0 คือไม่ปัด', () => {
    const base = { mode: 'auto', graceMinutes: 0, minMinutes: 0, roundMinutes: 30 };
    // ทำเกิน 100 นาที (17:00 -> 18:40)
    assert.strictEqual(ot('18:40', { ...base, roundMode: 'down' }).countable, 90);
    assert.strictEqual(ot('18:40', { ...base, roundMode: 'nearest' }).countable, 90);
    assert.strictEqual(ot('18:40', { ...base, roundMode: 'up' }).countable, 120);
    // 105 นาที -> nearest ควรขึ้นเป็น 120
    assert.strictEqual(ot('18:45', { ...base, roundMode: 'nearest' }).countable, 120);
    assert.strictEqual(ot('18:40', { ...base, roundMinutes: 0 }).countable, 100);
  });

  await t('OT: หักพักเมื่อถึง/ไม่ถึงเกณฑ์', () => {
    const p = {
      mode: 'auto', graceMinutes: 0, minMinutes: 0, roundMinutes: 0,
      otBreakMinutes: 30, otBreakAfterMinutes: 240,
    };
    assert.strictEqual(ot('20:59', p).countable, 239, 'ยังไม่ถึง 240 -> ไม่หัก');
    assert.strictEqual(ot('21:00', p).countable, 210, 'ถึง 240 -> หัก 30');
  });

  await t('OT: countBeforeShift เปิด/ปิด', () => {
    const p = {
      mode: 'auto', graceMinutes: 0, beforeShiftGraceMinutes: 15,
      minMinutes: 0, roundMinutes: 0,
    };
    const call = (before) => overtime.computeOt({
      checkInMin: helpers.toMinutes('06:30'), checkOutMin: helpers.toMinutes('17:00'),
      workStartMin: 480, workEndMin: 1020, dayType: 'workday',
      policy: pol({ ...p, countBeforeShift: before }),
    });
    assert.strictEqual(call(false).before, 0);
    assert.strictEqual(call(true).before, 90, 'มาก่อน 90 นาที เกินผ่อนผัน 15');
    assert.strictEqual(call(true).countable, 90);
  });

  await t('OT: เพดาน 3 ระดับซ้อนกัน + 0 = ไม่จำกัด', () => {
    const p = { mode: 'auto', graceMinutes: 0, minMinutes: 0, roundMinutes: 0 };
    // ทำ 300 นาที (17:00 -> 22:00)
    assert.strictEqual(ot('22:00', { ...p, maxPerDayMinutes: 0 }).countable, 300);
    assert.strictEqual(ot('22:00', { ...p, maxPerDayMinutes: 240 }).countable, 240);
    // เพดานสัปดาห์ 600 ใช้ไปแล้ว 480 -> เหลือ 120
    assert.strictEqual(
      ot('22:00', { ...p, maxPerDayMinutes: 0, maxPerWeekMinutes: 600 },
        { usedThisWeek: 480 }).countable, 120);
    // เพดานเดือนตัดต่อจากสัปดาห์อีกชั้น -> เหลือ 60
    assert.strictEqual(
      ot('22:00',
        { ...p, maxPerDayMinutes: 0, maxPerWeekMinutes: 600, maxPerMonthMinutes: 900 },
        { usedThisWeek: 480, usedThisMonth: 840 }).countable, 60);
    // ใช้เกินเพดานไปแล้ว -> 0 ไม่ใช่ค่าติดลบ
    assert.strictEqual(
      ot('22:00', { ...p, maxPerDayMinutes: 0, maxPerWeekMinutes: 600 },
        { usedThisWeek: 900 }).countable, 0);
  });

  await t('OT: วันหยุด นับทั้งวัน vs นับเฉพาะส่วนเกิน', () => {
    const p = { mode: 'auto', graceMinutes: 0, minMinutes: 0, roundMinutes: 0,
                maxPerDayMinutes: 0 };
    // ทำ 08:00-12:00 ในวันหยุด
    const all = overtime.computeOt({
      checkInMin: 480, checkOutMin: 720, workStartMin: 480, workEndMin: 1020,
      dayType: 'holiday', policy: pol({ ...p, holidayCountsAllHours: true }),
    });
    assert.strictEqual(all.countable, 240, 'นับทั้งวัน = 4 ชม.');
    const partial = overtime.computeOt({
      checkInMin: 480, checkOutMin: 720, workStartMin: 480, workEndMin: 1020,
      dayType: 'holiday', policy: pol({ ...p, holidayCountsAllHours: false }),
    });
    assert.strictEqual(partial.countable, 0, 'เลิกก่อน workEnd -> ไม่มีส่วนเกิน');
  });

  await t('OT: แต่ละโหมดให้ status ถูกต้อง', () => {
    const p = { graceMinutes: 0, minMinutes: 0, roundMinutes: 0 };
    assert.deepStrictEqual(
      ['auto', 'request_after', 'admin_only'].map((mode) => {
        const r = ot('19:00', { ...p, mode });
        return [r.countable, r.status];
      }),
      [[120, 'approved'], [120, 'pending'], [0, 'none']]
    );
    // ไม่มี OT เลย -> status ต้องเป็น none ไม่ใช่ approved/pending
    assert.strictEqual(ot('17:00', { ...p, mode: 'auto' }).status, 'none');
    assert.strictEqual(ot('17:00', { ...p, mode: 'request_after' }).status, 'none');
  });

  await t('OT: request_before ทำเกินใบที่ขอ -> ตัดตามใบ', () => {
    const p = { mode: 'request_before', graceMinutes: 0, minMinutes: 0, roundMinutes: 0 };
    const over = ot('19:00', p, { approvedMinutes: 60 });   // ทำ 120 ขอไว้ 60
    assert.strictEqual(over.countable, 60);
    assert.strictEqual(over.status, 'approved');
    assert.strictEqual(over.note, 'capped_by_request');
    // ทำน้อยกว่าที่ขอ -> ได้เท่าที่ทำจริง
    assert.strictEqual(ot('18:00', p, { approvedMinutes: 120 }).countable, 60);
    // ไม่มีใบอนุมัติ -> ไม่นับ
    assert.strictEqual(ot('19:00', p, { approvedMinutes: 0 }).countable, 0);
    assert.strictEqual(ot('19:00', p, { approvedMinutes: 0 }).status, 'none');
  });

  await t('OT: ค่าดิบถูกเก็บไว้เสมอแม้จะนับไม่ได้ (ไว้ตรวจย้อนหลัง)', () => {
    const r = ot('17:20', { mode: 'auto', graceMinutes: 0, minMinutes: 30 });
    assert.strictEqual(r.raw, 20, 'raw ต้องเก็บค่าจริง');
    assert.strictEqual(r.countable, 0, 'แต่ไม่ถึงขั้นต่ำจึงนับไม่ได้');
  });

  await t('OT: normalizePolicy แปลง string/checkbox จากฟอร์มได้', () => {
    const p = overtime.normalizePolicy({
      mode: 'auto', graceMinutes: '20', minMinutes: '0',
      countAfterShift: 'true', countBeforeShift: 'false',
      roundMode: 'ไม่มีค่านี้', maxPerDayMinutes: '-5',
    });
    assert.strictEqual(p.graceMinutes, 20);
    assert.strictEqual(p.countAfterShift, true);
    assert.strictEqual(p.countBeforeShift, false);
    assert.strictEqual(p.roundMode, 'down', 'ค่าที่ไม่รู้จักต้องกลับไปใช้ค่าเริ่มต้น');
    assert.strictEqual(p.maxPerDayMinutes, 0, 'ค่าติดลบต้องถูกตัดเป็น 0');
    assert.strictEqual(overtime.normalizePolicy({ mode: 'พิมพ์มั่ว' }).mode, 'request_after');
  });

  await t('OT: สัปดาห์นับจันทร์–อาทิตย์', () => {
    // 2026-08-04 คือวันอังคาร -> สัปดาห์คือ 03(จ) ถึง 09(อา)
    assert.deepStrictEqual(overtime.weekRange('2026-08-04'), ['2026-08-03', '2026-08-09']);
    // วันอาทิตย์ต้องเป็น "วันสุดท้าย" ของสัปดาห์ ไม่ใช่วันแรก
    assert.deepStrictEqual(overtime.weekRange('2026-08-09'), ['2026-08-03', '2026-08-09']);
    assert.deepStrictEqual(overtime.weekRange('2026-08-03'), ['2026-08-03', '2026-08-09']);
  });

  await t('OT: employeeOtView ไม่ส่งฟิลด์เกี่ยวกับเงินไปฝั่งพนักงาน', () => {
    const v = overtime.employeeOtView(pol({ mode: 'request_after' }));
    const keys = Object.keys(v).join(',');
    ['pay', 'rate', 'flat', 'hourly', 'amount', 'salary'].forEach((bad) => {
      assert.ok(keys.toLowerCase().indexOf(bad) === -1, 'หลุดฟิลด์เงิน: ' + bad);
    });
    assert.strictEqual(v.canRequest, true);
    assert.strictEqual(overtime.employeeOtView(pol({ mode: 'auto' })).canRequest, false);
    assert.strictEqual(overtime.employeeOtView(pol({ mode: 'off' })).enabled, false);
  });

  console.log('\n── OT: เชื่อมกับการเช็คเอาท์จริง ───────────');

  await t('OT: writeCheckOut เขียนคอลัมน์ OT ครบทุกช่อง', async () => {
    const att = await attendance.attendanceOf('TEST-2', '2026-07-31'); // เข้า 08:10
    const r = await attendance.writeCheckOut(att, '19:20');
    const row = await attendance.attendanceOf('TEST-2', '2026-07-31');
    ['otMinutes', 'otMinutesRaw', 'otBeforeMinutes', 'otAfterMinutes',
     'otDayType', 'otStatus', 'otPolicyId']
      .forEach((k) => assert.ok(row[k] !== undefined, 'ไม่ได้เขียน ' + k));
    assert.strictEqual(row.otMinutesRaw, 140);   // 19:20 - 17:00
    assert.strictEqual(row.otMinutes, 120);      // ปัดลงทีละ 30
    assert.strictEqual(row.otDayType, 'workday');
    assert.strictEqual(row.otStatus, 'pending'); // นโยบายเริ่มต้น = request_after
    assert.strictEqual(r.otNote, '');
  });

  await t('OT: ชั่วโมงงานปกติ + OT ต้องไม่นับซ้ำกัน', async () => {
    const row = await attendance.attendanceOf('TEST-2', '2026-07-31');
    // อยู่จริง 08:10-19:20 = 670 นาที, หักพัก 60 -> 610 นาที = 10.17 ชม.
    // OT ที่นับได้ 120 นาที = 2 ชม. -> ชั่วโมงงานปกติต้องเหลือ 8.17
    assert.strictEqual(row.workHours, 8.17);
    const total = row.workHours + row.otMinutes / 60;
    assert.ok(Math.abs(total - 10.17) < 0.02, 'ผลรวมต้องกระทบยอดได้: ' + total);
  });

  await t('OT: เช็คเอาท์ก่อนเช็คอิน -> ไม่คำนวณ + บันทึกเหตุผลไว้', async () => {
    const att = await attendance.attendanceOf('TEST-1', '2026-07-31'); // เข้า 08:37
    const r = await attendance.writeCheckOut(att, '02:00');
    assert.strictEqual(r.otMinutes, 0);
    assert.strictEqual(r.otNote, 'cross_midnight_unsupported');
    const row = await attendance.attendanceOf('TEST-1', '2026-07-31');
    assert.strictEqual(row.otNote, 'cross_midnight_unsupported');
  });

  await t('OT: getOtPolicy คืนนโยบายที่ isActive', async () => {
    const p = await overtime.getOtPolicy();
    assert.strictEqual(p.policyId, 'OTP-default');
    assert.strictEqual(p.mode, 'request_after');
    assert.strictEqual(p.isActive, true);
  });

  await t('OT: saveOtPolicy สร้างแถวใหม่ ไม่ทับของเก่า (เก็บประวัติกฎ)', async () => {
    const saved = await overtime.saveOtPolicy({ mode: 'auto', graceMinutes: 5 });
    assert.notStrictEqual(saved.policyId, 'OTP-default', 'ต้องได้ policyId ใหม่');
    assert.strictEqual(saved.mode, 'auto');
    assert.strictEqual(saved.graceMinutes, 5);

    const now = await overtime.getOtPolicy();
    assert.strictEqual(now.policyId, saved.policyId, 'แถวใหม่ต้องเป็นตัวที่ active');

    // แถวเก่ายังอยู่ แต่ถูกปิด active แล้ว (มี active ได้ทีละแถว)
    const rows = await require(path.join(LIB, 'db')).readObjects('ot_policies');
    assert.ok(rows.length >= 2, 'แถวเก่าต้องยังอยู่');
    assert.strictEqual(rows.filter((r) => r.isActive).length, 1);

    // คืนค่าเดิมเพื่อไม่ให้กระทบเทสต์ข้ออื่น
    await overtime.saveOtPolicy(overtime.DEFAULT_POLICY);
  });

  await t('OT: adminBootstrap ส่ง otPolicy มาให้หน้าแอดมินตั้งแต่โหลด', async () => {
    const b = await config.adminBootstrap();
    assert.ok(b.otPolicy, 'ไม่มี otPolicy ใน adminBootstrap');
    assert.ok(['off', 'auto', 'request_after', 'request_before', 'admin_only']
      .indexOf(b.otPolicy.mode) >= 0);
  });

  await t('OT: getOtPolicy/saveOtPolicy อยู่ในกลุ่มสิทธิ์แอดมิน', () => {
    const R = require(path.join(LIB, 'rpc'));
    assert.ok(R.ADMIN_FNS.has('getOtPolicy'));
    assert.ok(R.ADMIN_FNS.has('saveOtPolicy'));
    assert.ok(!R.EMPLOYEE_FNS.has('saveOtPolicy'), 'พนักงานต้องแก้นโยบายไม่ได้');
    assert.ok(R.REGISTRY.getOtPolicy && R.REGISTRY.saveOtPolicy);
  });

  await t('OT: ไม่มีโค้ดใดอ่าน/เขียนคอลัมน์ฝั่งการจ่ายในเฟสนี้', () => {
    const files = ['api/overtime.js', 'api/attendance.js', 'api/config.js', 'api/reports.js']
      .map((f) => {
        try { return fs.readFileSync(path.join(LIB, f), 'utf8'); } catch { return ''; }
      }).join('\n');
    // ชื่อคอลัมน์ต้องไม่ถูกอ้างถึงในโค้ดที่ทำงานจริง
    ['otRate', 'otAmount', 'otPaid', 'rateUsed', 'payMode', 'hourlyBasis',
     'rateWorkday', 'rateWeekend', 'rateHoliday', 'flatPerHour', 'flatPerSession']
      .forEach((col) => {
        assert.ok(files.indexOf(col) === -1, 'เฟสนี้ยังไม่ควรมีโค้ดแตะ ' + col);
      });
  });

  await t('OT: หน้าตั้งค่า OT มีครบทั้ง 4 การ์ด + พรีวิวสด', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    ['ตั้งค่า OT', 'โหมดการทำงาน', 'กฎการนับเวลา', 'เพดาน OT', 'การทำงานวันหยุด',
     'ทดลองคำนวณ', 'function otPreview', 'renderOtPolicy']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    // ครบทั้ง 5 โหมด
    ['off', 'auto', 'request_after', 'request_before', 'admin_only']
      .forEach((m) => assert.ok(h.includes("'" + m + "'"), 'ขาดโหมด ' + m));
    assert.ok(h.includes("otpolicy:renderOtPolicy"), 'ยังไม่ผูกกับเมนู');
    assert.ok(h.includes('data-tab="otpolicy"'), 'ยังไม่มีเมนูใน sidebar');
  });

  await t('OT: พรีวิวฝั่งหน้าเว็บใช้ลำดับขั้นเดียวกับเซิร์ฟเวอร์', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    // ลำดับต้องเป็น หักพัก -> ปัดเศษ -> ขั้นต่ำ -> เพดาน
    const order = ['2. หักพัก', '3. ปัดเศษ', '4. ขั้นต่ำ', '5. เพดานต่อวัน']
      .map((s) => h.indexOf(s));
    order.forEach((i, n) => assert.ok(i > 0, 'ไม่พบขั้นที่ ' + (n + 2)));
    for (let i = 1; i < order.length; i++)
      assert.ok(order[i] > order[i - 1], 'ลำดับขั้นในพรีวิวสลับกัน');
    assert.ok(h.includes('cross_midnight_unsupported'), 'พรีวิวไม่ได้เตือนเรื่องกะข้ามคืน');
  });

  console.log('\n── ปุ่มสไลด์เช็คอิน/เอาท์ ──────────────────');

  await t('ปุ่มสไลด์: มีตัวช่วยดึงสายตา (ข้อความกระพริบ + ลูกศร + วงแหวน)', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    ['slide-arrows', 'slide-hint', '@keyframes slBlink', '@keyframes slChev',
     '@keyframes slRing', '@keyframes slSheen']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    assert.ok(/\.slide-text\{[^}]*animation:slBlink/.test(h), 'ข้อความบนปุ่มไม่กระพริบ');
    assert.ok(/ลากปุ่มไปทางขวาจนสุด/.test(h), 'ไม่มีข้อความใบ้ใต้ปุ่ม');
  });

  await t('ปุ่มสไลด์: ทรงแคปซูลสีเข้ม ตัวหนังสือขาว (ตาม reference)', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(/\.slider\{[^}]*border-radius:999px/.test(h), 'ยังไม่เป็นทรงแคปซูล');
    assert.ok(/\.slide-knob\{[^}]*border-radius:50%/.test(h), 'ลูกบิดยังไม่กลม');
    assert.ok(/\.slider\.green\{[^}]*linear-gradient/.test(h), 'พื้นเขียวยังไม่เป็น gradient เข้ม');
    assert.ok(/\.slide-text\{[^}]*color:#fff/.test(h), 'ตัวหนังสือควรเป็นสีขาว');
    assert.ok(!/\.slider\.green\{background:#d6f3e2\}/.test(h), 'ยังเหลือสีจางแบบเดิม');
  });

  await t('ปุ่มสไลด์: JS ยังใช้ hook เดิมครบ และเพิ่ม --p / dragging', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    ["id=\"slideCtl\"", 'data-action=', 'slide-fill', 'slide-text', 'slide-knob',
     "classList.add('armed')", "classList.add('dragging')", "setProperty('--p'"]
      .forEach((k) => assert.ok(h.includes(k), 'ขาด hook ' + k));
    // ต้องกดที่ไหนบนแถบก็ลากได้ ไม่ใช่เฉพาะบนลูกบิด
    assert.ok(/el\.addEventListener\('touchstart',down/.test(h), 'ยังผูก drag ไว้กับลูกบิดอย่างเดียว');
    // transform ของลูกบิดถูก JS คุม ห้าม animate ทับ
    assert.ok(!/\.slide-knob\{[^}]*animation:/.test(h), 'ห้าม animate .slide-knob โดยตรง');
    assert.ok(h.includes('.slide-knob::before'), 'วงแหวนต้องอยู่บน pseudo-element');
  });

  await t('ปุ่มสไลด์: เคารพ prefers-reduced-motion และปิดอนิเมชันตอนลาก', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(h.includes('prefers-reduced-motion'), 'ไม่รองรับ prefers-reduced-motion');
    assert.ok(/\.slider\.dragging \.slide-text/.test(h), 'ตอนลากยังกระพริบอยู่');
    assert.ok(/\.slider\.gray \.slide-text\{[^}]*animation:none/.test(h), 'ปุ่มที่กดไม่ได้ไม่ควรกระพริบ');
  });

  await t('หน้าพนักงาน: ซ่อนโควตาของประเภทที่ตั้งค่าไม่ให้แสดง', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(h.includes('x.showQuota!==false'), 'ไม่ได้กรองตาม showQuota');
  });

  await t('กันกดปุ่มซ้ำ: มีอยู่ทั้งหน้า admin และ employee', () => {
    for (const page of ['admin.html', 'employee.html']) {
      const h = fs.readFileSync(path.join(GEN, page), 'utf8');
      ['lockBtn(', 'unlockBtn(', 'busyText(', 'ttBusy', 'กำลังบันทึก...']
        .forEach((k) => assert.ok(h.includes(k), page + ' ขาด ' + k));
      // ต้องปิดทั้ง <button> และ <span class="btn">
      assert.ok(h.includes("el.style.pointerEvents = 'none'"), page + ': ไม่ได้ปิด span');
      assert.ok(/if \('disabled' in el\) el\.disabled = true/.test(h),
        page + ': ไม่ได้ปิด button');
      // ต้องปลดล็อกทั้งตอนสำเร็จและตอน error
      assert.strictEqual((h.match(/unlockBtn\(btn\)/g) || []).length, 2,
        page + ': ต้องปลดล็อกทั้ง then และ catch');
    }
  });

  await t('กันกดปุ่มซ้ำ: ฟังก์ชันอ่านข้อมูลไม่ล็อกปุ่ม', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    const m = h.match(/function isReadOnly\(fn\) \{\s*return (\/[^/]+\/)\.test/);
    assert.ok(m, 'ไม่พบ isReadOnly');
    const re = new RegExp(m[1].slice(1, -1));
    ['listEmployees', 'adminBootstrap', 'employeeContext', 'dailyReport', 'unreadCount']
      .forEach((fn) => assert.ok(re.test(fn), fn + ' ควรถูกยกเว้น'));
    ['saveEmployee', 'decideLeave', 'deleteHoliday', 'empSubmitLeave']
      .forEach((fn) => assert.ok(!re.test(fn), fn + ' ต้องล็อกปุ่ม'));
  });

  await t('กระดิ่งแจ้งเตือน: ติดตั้งทั้ง admin และ employee', () => {
    for (const page of ['admin.html', 'employee.html']) {
      const h = fs.readFileSync(path.join(GEN, page), 'utf8');
      ['ttInitNotify', 'ttNotiBadge', 'tt-noti-panel', 'playBell', 'armSound']
        .forEach((k) => assert.ok(h.includes(k), page + ' ขาด ' + k));
      assert.ok(h.includes("'listNotifications'") || h.includes('listNotifications'),
        page + ': ไม่ได้เรียก listNotifications');
    }
  });

  await t('เสียงกระดิ่งรอ user gesture (เบราว์เซอร์บล็อก autoplay)', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(h.includes("addEventListener('pointerdown', fire, true)"),
      'ต้องรอการแตะจอครั้งแรก');
    assert.ok(h.includes('if (state.unread > 0) playBell()'),
      'ต้องเล่นเฉพาะเมื่อมีที่ยังไม่อ่าน');
    // ห้ามเรียก playBell ตรง ๆ ตอนโหลด
    assert.ok(!/window\.addEventListener\('load'[^)]*playBell/.test(h),
      'ห้ามเล่นเสียงทันทีตอนโหลดหน้า');
  });

  await t('ตัวนับสดหักเบรกด้วยสูตรเดียวกับเซิร์ฟเวอร์', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(h.includes('function netWorkMinutes('), 'ขาด netWorkMinutes');
    assert.ok(h.includes('netWorkMinutes(gross)'), 'ตัวนับสดไม่ได้หักเบรก');
    assert.ok(h.includes('breakAfterHours'), 'ไม่ได้ใช้เกณฑ์หักเบรก');
    assert.ok(h.includes('หักพักเบรกแล้ว'), 'ควรบอกผู้ใช้ว่าหักเบรกไปเท่าไร');
  });

  await t('หน้าตั้งค่าสาขามีช่องเกณฑ์หักเบรก', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(h.includes('b_breakafter'), 'ขาดช่องกรอก');
    assert.ok(h.includes('breakAfterHours:'), 'ไม่ได้ส่งค่าไปบันทึก');
  });

  await t('หน้าพนักงาน: แตะรูปโปรไฟล์เพื่อเปลี่ยนรูปได้', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    ['pickMyPhoto(', 'onMyPhoto(', 'saveMyPhoto(', 'myPhotoInput', 'avwrap']
      .forEach((k) => assert.ok(h.includes(k), 'ขาด ' + k));
    assert.ok(h.includes("run('empUpdatePhoto'"), 'ไม่ได้เรียก empUpdatePhoto');
  });

  await t('หน้าพนักงาน: ย่อรูปเป็น 150x150 ครอปกึ่งกลาง (เหมือนฝั่งแอดมิน)', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(/var SIZE=150/.test(h), 'ไม่ได้กำหนดขนาด 150');
    assert.ok(h.includes('Math.min(img.width,img.height)'), 'ไม่ได้ครอปเป็นจัตุรัส');
    assert.ok(h.includes('(img.width-side)/2'), 'ไม่ได้ครอปกึ่งกลาง');
    assert.ok(h.includes("toDataURL('image/jpeg',0.85)"), 'คุณภาพ/ชนิดไฟล์ไม่ตรงกับฝั่งแอดมิน');
  });

  await t('เมนูวันหยุดฝั่งพนักงาน: เหลือแค่ปฏิทิน', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(h.includes('id="empCal"'), 'ต้องยังมีปฏิทิน');
    // ตรวจ "หัวข้อที่แสดงผลจริง" ไม่ใช่ข้อความในคอมเมนต์
    assert.ok(!/<h4>วันหยุดที่จะถึง<\/h4>/.test(h), 'ยังมีหัวข้อ "วันหยุดที่จะถึง"');
    assert.ok(!h.includes('empHolList'), 'ยังมีกล่องรายการวันหยุดค้างอยู่');
    // คำอธิบายสีต้องยังอยู่
    assert.ok(h.includes('วันหยุดประจำสัปดาห์'), 'คำอธิบายสีหายไป');
  });

  await t('ตัวโหลดขนาด 60x60 มีอนิเมชัน (ทั้ง admin และ employee)', () => {
    for (const page of ['admin.html', 'employee.html']) {
      const h = fs.readFileSync(path.join(GEN, page), 'utf8');
      const m = h.match(/\.spinner\{width:(\d+)px;height:(\d+)px/);
      assert.ok(m, page + ': ไม่พบ .spinner');
      assert.strictEqual(m[1], '60', page + ': กว้างต้องเป็น 60px');
      assert.strictEqual(m[2], '60', page + ': สูงต้องเป็น 60px');
      assert.ok(h.includes('animation:spin'), page + ': ไม่มีอนิเมชัน');
    }
  });

  await t('ตอนเปิดแอปขึ้นตัวโหลดกึ่งกลาง (คนละวิธีตามโครงหน้า)', () => {
    // หน้าพนักงาน: เต็มความกว้าง ใช้ fixed กลางจอได้เลย
    const emp = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    assert.ok(emp.includes('<div class="wrap" id="app"><div class="spinner page"></div></div>'),
      'หน้าพนักงานยังใช้ spinner แบบเดิม');
    assert.ok(/\.spinner\.page\{[^}]*position:fixed/.test(emp),
      'หน้าพนักงาน: .spinner.page ต้องเป็น fixed');

    // หน้าแอดมิน: มี sidebar 230px จึงต้องจัดกึ่งกลางใน "พื้นที่เนื้อหา" แทน
    const adm = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(adm.includes("function loading(msg){"), 'loading() ต้องรับข้อความได้');
    assert.ok(adm.includes("$('content').innerHTML=loadBox(msg)"),
      'loading() ต้องใช้ loadBox');
    assert.ok(adm.includes("loading('กำลังเตรียมข้อมูลระบบ...')"),
      'ตอนเปิดหน้าแอดมินต้องขึ้นข้อความ');
  });

  await t('รูปโปรไฟล์ฝั่งพนักงานเป็น 60x60', () => {
    const h = fs.readFileSync(path.join(GEN, 'employee.html'), 'utf8');
    const m = h.match(/\.avatar\{width:(\d+)px;height:(\d+)px/);
    assert.ok(m, 'ไม่พบ .avatar');
    assert.strictEqual(m[1], '60', 'กว้างต้องเป็น 60px');
    assert.strictEqual(m[2], '60', 'สูงต้องเป็น 60px');
    // ยังต้องเป็นวงกลมและครอปพอดีกรอบ
    assert.ok(/\.avatar\{[^}]*border-radius:50%/.test(h), 'ต้องเป็นวงกลม');
    assert.ok(h.includes('img.avatar{object-fit:cover}'), 'รูปต้องไม่ยืด');
  });

  await t('Admin: กล่องโหลดจัดกึ่งกลางในพื้นที่เนื้อหา (ไม่เยื้องเพราะ sidebar)', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    // ต้องไม่ใช้ position:fixed เพราะ sidebar กว้าง 230px จะทำให้เยื้องไป 115px
    assert.ok(!/\.spinner\.page\{[^}]*position:fixed/.test(h),
      'ยังใช้ .spinner.page แบบ fixed อยู่');
    const m = h.match(/\.loadbox\{([^}]+)\}/);
    assert.ok(m, 'ไม่พบ .loadbox');
    ['display:flex', 'align-items:center', 'justify-content:center']
      .forEach((k) => assert.ok(m[1].includes(k), '.loadbox ขาด ' + k));
    assert.ok(h.includes('function loadBox('), 'ไม่มี helper loadBox');
  });

  await t('Admin: ทุกเมนูขึ้นข้อความ "กำลังโหลด" ตอนดึงข้อมูล', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    const expect = [
      'กำลังเตรียมข้อมูลระบบ...',        // ตอนเปิดหน้า
      'กำลังโหลดรายชื่อพนักงาน...',      // จัดการพนักงาน
      'กำลังโหลดข้อมูลการลงเวลา...',     // เช็คชื่อ เข้า-ออก
      'กำลังโหลดรายการลา...',            // ลา - ขาดงาน
      'กำลังโหลดคำขอแก้เวลา...',         // คำขอแก้เวลา
      'กำลังสร้างรายงานรายวัน...',
      'กำลังสร้างรายงานประจำเดือน...',
    ];
    expect.forEach((k) => assert.ok(h.includes(k), 'ขาดข้อความ: ' + k));
    // ค่าเริ่มต้นเมื่อไม่ระบุข้อความ
    assert.ok(h.includes("'กำลังโหลดข้อมูล...'"), 'ขาดข้อความเริ่มต้น');
  });

  await t('Admin: เปลี่ยนตัวกรองแล้วต้องขึ้นโหลด (ไม่ค้างตารางเดิม)', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    // ฟังก์ชันที่ถูกเรียกซ้ำเมื่อเปลี่ยนวันที่/สถานะ ต้องเคลียร์หน้าเป็นกล่องโหลดก่อน
    ['function loadAtt(', 'function loadLeaves(', 'function loadTimeEdits(']
      .forEach((fnStart) => {
        const i = h.indexOf(fnStart);
        assert.ok(i > 0, 'ไม่พบ ' + fnStart);
        const body = h.slice(i, i + 400);
        assert.ok(body.includes('loadBox('), fnStart + ' ไม่ได้แสดงกล่องโหลด');
      });
  });

  await t('Admin: กันกดเมนูซ้ำระหว่างโหลด', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(h.includes('if(NAV_BUSY) return;'), 'switchTab ไม่ได้กันกดซ้ำ');
    assert.ok(h.includes('function navBusy('), 'ไม่มี navBusy');
    assert.ok(h.includes('window.__ttIdle'), 'ไม่ได้ผูกกับตัวนับคำขอของ shim');
    assert.ok(h.includes('.side.nav-busy .nav-item{pointer-events:none'),
      'CSS ไม่ได้ปิดการคลิกเมนู');
    // ต้องมี watchdog กันค้างถาวร
    assert.ok(/setTimeout\(function\(\)\{navBusy\(false\);\},12000\)/.test(h),
      'ไม่มี watchdog ปลดล็อกเมนู');
  });

  await t('Admin: มีแถบ progress ด้านบนตอนมีคำขอค้าง', () => {
    const h = fs.readFileSync(path.join(GEN, 'admin.html'), 'utf8');
    assert.ok(h.includes("bar.id='ttBar'"), 'ไม่ได้สร้างแถบ progress');
    assert.ok(h.includes('html.tt-loading #ttBar'), 'ไม่มี CSS ของแถบ progress');
    assert.ok(h.includes("classList.toggle('tt-loading'"), 'shim ไม่ได้ตั้งสถานะโหลด');
    assert.ok(h.includes('window.ttPending'), 'ไม่มีตัวนับคำขอค้าง');
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
