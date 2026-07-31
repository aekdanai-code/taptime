/**********************************************************************
 * rpc.ts — ทะเบียนฟังก์ชันที่ frontend เรียกได้ + ระดับสิทธิ์
 *
 * เดิม frontend เรียกผ่าน  google.script.run.<fn>(...args)
 * ตอนนี้เรียกผ่าน          POST /api/rpc  { fn, args }
 * ชื่อฟังก์ชันและลำดับ argument "เหมือนเดิมทุกตัว" -> ไม่ต้องแก้โค้ดหน้าเว็บ
 **********************************************************************/
import { adminBootstrap, getConfig, setConfig } from './api/config';
import { adminDashboard } from './api/dashboard';
import {
  listEmployees, saveEmployee, deleteEmployee, setEmployeePassword,
  listEmployeeDevices, revokeEmployeeDevice, setWebauthnExempt, listCheckinAudit,
} from './api/employees';
import { inviteEmployee } from './api/invite';
import {
  listAttendance, manualCheckIn, manualCheckOut, editCheckOut,
} from './api/attendance';
import {
  employeeContext, empCheckIn, empCheckOut, empSubmitLeave,
} from './api/employeeApi';
import { listLeaves, decideLeave } from './api/leaves';
import { empSubmitTimeEdit, listTimeEdits, decideTimeEdit } from './api/timeEdits';
import {
  listHolidays, saveHoliday, deleteHoliday, saveWeeklyOff,
} from './api/holidays';
import {
  saveCompany, saveBranch, savePosition, deletePosition,
  saveLeaveType, deleteLeaveType,
} from './api/settings';
import { monthlyReport, dailyReport, exportMonthlyReportXlsx } from './api/reports';
import {
  listLeaveAssignments, saveLeaveAssignments, leaveAssignSummary,
} from './api/leaveAssign';

type Fn = (...args: any[]) => any;

/** ต้องเป็น "แอดมิน" เท่านั้น */
export const ADMIN_FNS = new Set([
  'adminBootstrap', 'adminDashboard',
  'listEmployees', 'saveEmployee', 'deleteEmployee',
  'setEmployeePassword', 'inviteEmployee',
  'listEmployeeDevices', 'revokeEmployeeDevice', 'setWebauthnExempt',
  'listCheckinAudit',
  'listAttendance', 'manualCheckIn', 'manualCheckOut', 'editCheckOut',
  'listLeaves', 'decideLeave',
  'listTimeEdits', 'decideTimeEdit',
  'listHolidays', 'saveHoliday', 'deleteHoliday', 'saveWeeklyOff',
  'saveCompany', 'saveBranch', 'savePosition', 'deletePosition',
  'saveLeaveType', 'deleteLeaveType',
  'listLeaveAssignments', 'saveLeaveAssignments', 'leaveAssignSummary',
  'monthlyReport', 'dailyReport', 'exportMonthlyReportXlsx',
  'getConfig', 'setConfig',
]);

/**
 * ฟังก์ชันฝั่งพนักงาน — ต้องมี session
 * /api/rpc จะ **เขียนทับ args[0] ด้วย empId จาก session** เสมอ
 */
export const EMPLOYEE_FNS = new Set([
  'employeeContext', 'empCheckIn', 'empCheckOut',
  'empSubmitLeave', 'empSubmitTimeEdit',
]);

/**
 * ฟังก์ชันที่ต้องยืนยันตัวตนด้วย WebAuthn (Face ID / ลายนิ้วมือ) ทุกครั้ง
 * — เฉพาะการลงเวลาเท่านั้น เพราะเป็นจุดที่มีแรงจูงใจให้เช็คอินแทนกัน
 */
export const BIOMETRIC_FNS = new Set(['empCheckIn', 'empCheckOut']);

/**
 * บรรทัดที่สำคัญที่สุดด้านความปลอดภัย
 *
 * สำหรับฟังก์ชันฝั่งพนักงาน จะ **เขียนทับ args[0] ด้วย empId จาก session เสมอ**
 * ไม่ว่า client จะส่งอะไรมาก็ตาม -> แก้ JavaScript ในหน้าเว็บแล้วเช็คอินแทนคนอื่นไม่ได้
 * (แยกออกมาเป็นฟังก์ชันเพื่อให้ทดสอบได้)
 */
export function applyIdentity(
  fn: string,
  args: any[],
  session: { empId: string } | null
): any[] {
  const out = Array.isArray(args) ? [...args] : [];
  if (EMPLOYEE_FNS.has(fn)) out[0] = session ? session.empId : null;
  return out;
}

export const REGISTRY: Record<string, Fn> = {
  /* Config */
  adminBootstrap, getConfig, setConfig,
  /* Dashboard */
  adminDashboard,
  /* Employees (profiles) */
  listEmployees, saveEmployee, deleteEmployee, setEmployeePassword,
  inviteEmployee,
  /* Devices / passkey / audit */
  listEmployeeDevices, revokeEmployeeDevice, setWebauthnExempt, listCheckinAudit,
  /* Attendance */
  listAttendance, manualCheckIn, manualCheckOut, editCheckOut,
  /* Employee API */
  employeeContext, empCheckIn, empCheckOut, empSubmitLeave,
  /* Leaves */
  listLeaves, decideLeave,
  /* Time edits */
  empSubmitTimeEdit, listTimeEdits, decideTimeEdit,
  /* Holidays */
  listHolidays, saveHoliday, deleteHoliday, saveWeeklyOff,
  /* Settings */
  saveCompany, saveBranch, savePosition, deletePosition,
  saveLeaveType, deleteLeaveType,
  /* Leave assignments */
  listLeaveAssignments, saveLeaveAssignments, leaveAssignSummary,
  /* Reports */
  monthlyReport, dailyReport, exportMonthlyReportXlsx,
};
