/**********************************************************************
 * settings.ts — พอร์ตจาก Settings.gs
 *   ตั้งค่าบริษัท / สาขา / ตำแหน่ง / ประเภทวันลา
 **********************************************************************/
import { T, findOne, appendObject, updateByKey, deleteByKey } from '../db';
import { uid } from '../helpers';
import { setConfig } from './config';

/** บันทึกชื่อบริษัท (แสดงบนหัวเว็บ) */
export async function saveCompany(name: string) {
  await setConfig('companyName', name || '');
  return true;
}

export async function saveBranch(branch: any) {
  branch = { ...branch };
  if (branch.branchId) {
    const found = await findOne(T.BRANCHES, 'branchId', branch.branchId);
    if (found) {
      await updateByKey(T.BRANCHES, 'branchId', branch.branchId, branch);
      return branch.branchId;
    }
  }
  branch.branchId = uid('BR-');
  await appendObject(T.BRANCHES, branch);
  return branch.branchId;
}

export async function savePosition(pos: any) {
  pos = { ...pos };
  if (pos.posId) {
    const found = await findOne(T.POSITIONS, 'posId', pos.posId);
    if (found) {
      await updateByKey(T.POSITIONS, 'posId', pos.posId, pos);
      return pos.posId;
    }
  }
  pos.posId = uid('PS-');
  await appendObject(T.POSITIONS, pos);
  return pos.posId;
}

export async function deletePosition(posId: string) {
  return deleteByKey(T.POSITIONS, 'posId', posId);
}

/**
 * เพิ่ม/แก้ไขประเภทการลา
 *   advanceDays = ต้องยื่นล่วงหน้ากี่วัน
 *   showQuota   = แสดงจำนวนวัน/ปี ในหน้าพนักงานไหม
 *   assignAll   = ให้สิทธิ์ทุกคน หรือเฉพาะคนที่ assign ไว้
 */
export async function saveLeaveType(lt: any) {
  lt = { ...lt };
  if (lt.showQuota !== undefined) lt.showQuota = !!lt.showQuota;
  if (lt.assignAll !== undefined) lt.assignAll = !!lt.assignAll;
  if (lt.typeId) {
    const found = await findOne(T.LEAVETYPES, 'typeId', lt.typeId);
    if (found) {
      await updateByKey(T.LEAVETYPES, 'typeId', lt.typeId, lt);
      return lt.typeId;
    }
  }
  lt.typeId = uid('LT-');
  await appendObject(T.LEAVETYPES, lt);
  return lt.typeId;
}

export async function deleteLeaveType(typeId: string) {
  return deleteByKey(T.LEAVETYPES, 'typeId', typeId);
}
