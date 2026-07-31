-- ============================================================================
-- TapTime — Migration 003
--   * เพิ่มฟิลด์พนักงาน: ชื่อเล่น, สัญชาติ
--   * ประเภทวันลา: เลือกได้ว่าจะแสดงจำนวนวัน/ปี ในหน้าพนักงานไหม
--   * ตาราง leave_assignments — assign ประเภทการลาให้พนักงานรายคน
--     พร้อมกำหนดจำนวนวันเฉพาะคนได้ (เช่น อายุงานเกิน 1 ปี ได้ลาพักร้อนเพิ่ม)
--
-- รันบน Supabase: SQL Editor -> New query -> วางไฟล์นี้ -> Run  (รันซ้ำได้)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — ฟิลด์ข้อมูลส่วนตัวเพิ่มเติม
--    (gender / birthDate / address มีอยู่แล้วตั้งแต่ schema แรก)
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists "nickname"    text;
alter table profiles add column if not exists "nationality" text;

comment on column profiles."nickname"    is 'ชื่อเล่น';
comment on column profiles."nationality" is 'สัญชาติ เช่น ไทย';

-- ---------------------------------------------------------------------------
-- 2. leave_types — ตัวเลือกการแสดงผลฝั่งพนักงาน
--    showQuota = false -> หน้าพนักงานไม่แสดง "คงเหลือ x/y วัน" ของประเภทนี้
-- ---------------------------------------------------------------------------
alter table leave_types add column if not exists "showQuota" boolean default true;
alter table leave_types add column if not exists "assignAll" boolean default true;

comment on column leave_types."showQuota" is
  'แสดงจำนวนวันลา/ปี ในหน้าพนักงานหรือไม่';
comment on column leave_types."assignAll" is
  'true = พนักงานทุกคนได้สิทธิ์ | false = เฉพาะคนที่อยู่ใน leave_assignments';

-- ---------------------------------------------------------------------------
-- 3. leave_assignments — ใครได้สิทธิ์ลาประเภทไหน + โควตาเฉพาะคน
--
--    การคิดโควตาของพนักงาน 1 คน ต่อประเภทลา 1 ประเภท:
--      ถ้ามีแถวใน leave_assignments  -> ใช้ daysOverride (ถ้าเป็น null ใช้ daysPerYear)
--      ไม่มีแถว และ assignAll = true -> ใช้ daysPerYear ของประเภทนั้น
--      ไม่มีแถว และ assignAll = false-> ไม่ได้สิทธิ์ลาประเภทนี้เลย
-- ---------------------------------------------------------------------------
create table if not exists leave_assignments (
  "typeId"       text not null references leave_types("typeId") on delete cascade,
  "empId"        text not null references profiles("empId")     on delete cascade,
  "daysOverride" numeric,          -- null = ใช้โควตากลางของประเภทนั้น
  "note"         text,
  "createdAt"    timestamptz default now(),
  primary key ("typeId", "empId")
);

create index if not exists leave_assign_emp_idx  on leave_assignments("empId");
create index if not exists leave_assign_type_idx on leave_assignments("typeId");

alter table leave_assignments enable row level security;
