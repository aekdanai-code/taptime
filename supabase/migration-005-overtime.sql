-- ============================================================================
-- TapTime — Migration 005 : ระบบ OT
--
--   เฟสนี้เก็บ "ชั่วโมง" อย่างเดียว ยังไม่คิดเงิน
--   คอลัมน์ฝั่งการจ่ายถูกสร้างไว้แล้วเพื่อให้เฟสถัดไปไม่ต้อง migrate ซ้ำ
--
--   ไม่รองรับ OT ข้ามเที่ยงคืน — ทุกการคำนวณอยู่ภายในวันเดียว
--
-- รันบน Supabase: SQL Editor -> New query -> วางไฟล์นี้ -> Run  (รันซ้ำได้)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ot_policies — นโยบาย OT (ใช้ทั้งบริษัท ทุกสาขาใช้กฎเดียวกัน)
--
--    เก็บได้หลายแถวเพื่อทำประวัติเวอร์ชัน แต่ใช้งานจริงทีละ 1 แถว (isActive)
--    แถวเก่าถูกเก็บไว้ให้ข้อมูลย้อนหลังอ้างอิงกฎ ณ เวลานั้นได้
-- ---------------------------------------------------------------------------
create table if not exists ot_policies (
  "policyId" text primary key,
  "name"     text not null default 'นโยบาย OT',
  "isActive" boolean default false,

  -- ===== โหมดการเกิด OT =====
  --   off            ปิดระบบ OT ทั้งหมด (ซ่อน UI ทุกจุด)
  --   auto           เช็คเอาท์เกินเวลา -> นับให้เลย ไม่ต้องอนุมัติ
  --   request_after  นับให้แต่ขึ้นสถานะ "รออนุมัติ" จนแอดมินกด
  --   request_before ต้องยื่นและอนุมัติ "ก่อน" ทำ ถึงจะนับ
  --   admin_only     พนักงานยื่นไม่ได้ แอดมินคีย์ให้อย่างเดียว
  "mode" text not null default 'request_after',

  -- ===== กฎการนับเวลา =====
  "countAfterShift"         boolean default true,
  "countBeforeShift"        boolean default false,
  "graceMinutes"            int default 15,
  "beforeShiftGraceMinutes" int default 15,
  "minMinutes"              int default 30,
  "roundMinutes"            int default 30,
  "roundMode"               text default 'down',   -- down | nearest | up
  "otBreakMinutes"          int default 0,
  "otBreakAfterMinutes"     int default 240,

  -- ===== เพดาน (0 = ไม่จำกัด) =====
  "maxPerDayMinutes"   int default 240,
  "maxPerWeekMinutes"  int default 0,
  "maxPerMonthMinutes" int default 0,

  -- ===== วันหยุด =====
  "allowHolidayWork"      boolean default true,
  "holidayNeedsRequest"   boolean default true,
  "holidayCountsAllHours" boolean default true,

  -- ===== เตรียมไว้สำหรับเฟสคิดเงิน — ห้ามมีโค้ดอ่านในเฟสนี้ =====
  "payMode"        text    default 'none',
  "hourlyBasis"    text    default 'monthly_30_8',
  "customHourly"   numeric,
  "rateWorkday"    numeric default 1.5,
  "rateWeekend"    numeric default 2,
  "rateHoliday"    numeric default 3,
  "flatPerHour"    numeric,
  "flatPerSession" numeric,
  "showAmountToEmployee" boolean default false,

  "createdAt" timestamptz default now(),
  "updatedAt" timestamptz default now(),
  "updatedBy" text
);

-- มีนโยบายที่ใช้งานอยู่ได้ทีละ 1 แถวเท่านั้น
create unique index if not exists ot_policy_single_active
  on ot_policies (("isActive")) where "isActive" = true;

-- ---------------------------------------------------------------------------
-- 2. ot_requests — ใบขอ/ใบอนุมัติ OT  (flow เดียวกับ leave_requests)
-- ---------------------------------------------------------------------------
create table if not exists ot_requests (
  "otId"     text primary key,
  "empId"    text not null references profiles("empId") on delete cascade,
  "empName"  text,
  "branchId" text,
  "date"     date not null,

  "dayType" text,   -- workday | weekend | holiday
  "source"  text,   -- employee | system | admin
  "kind"    text,   -- after_shift | before_shift | holiday_work

  "plannedStart" text,   -- 'HH:mm'  ใช้กับ request_before
  "plannedEnd"   text,
  "actualStart"  text,
  "actualEnd"    text,

  "minutesRequested" int default 0,
  "minutesApproved"  int,
  "reason"    text,
  "adminNote" text,

  "status"      text default 'pending',  -- pending|approved|rejected|cancelled
  "requestedAt" text,
  "decidedAt"   text,
  "decidedBy"   text,

  "policyId" text,   -- snapshot กฎที่ใช้ ณ ตอนนั้น

  -- เตรียมไว้สำหรับเฟสคิดเงิน
  "rateUsed" numeric,
  "amount"   numeric,

  "createdAt" timestamptz default now()
);

create index if not exists ot_req_emp_idx    on ot_requests("empId", "date" desc);
create index if not exists ot_req_status_idx on ot_requests("status");
create index if not exists ot_req_date_idx   on ot_requests("date");

-- 1 คน 1 ใบต่อวันต่อประเภท (กันยื่นซ้ำ / กันระบบสร้างซ้ำ)
create unique index if not exists ot_req_unique_active
  on ot_requests("empId", "date", "kind")
  where "status" in ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- 3. attendance — คอลัมน์ OT เพิ่มเติม
--
--    "otMinutes" (ของเดิม) ถูกนิยามใหม่เป็น "นาทีที่นับได้จริง"
--    เพื่อไม่ให้หน้าจอเดิมพัง ส่วนค่าดิบย้ายไป "otMinutesRaw"
-- ---------------------------------------------------------------------------
alter table attendance add column if not exists "otMinutesRaw"    int  default 0;
alter table attendance add column if not exists "otBeforeMinutes" int  default 0;
alter table attendance add column if not exists "otAfterMinutes"  int  default 0;
alter table attendance add column if not exists "otDayType"       text;
alter table attendance add column if not exists "otStatus"        text default 'none';
alter table attendance add column if not exists "otRequestId"     text;
alter table attendance add column if not exists "otPolicyId"      text;
alter table attendance add column if not exists "otNote"          text;

-- เตรียมไว้สำหรับเฟสคิดเงิน
alter table attendance add column if not exists "otRate"   numeric;
alter table attendance add column if not exists "otAmount" numeric;
alter table attendance add column if not exists "otPaid"   boolean default false;

comment on column attendance."otMinutes" is
  'นาที OT ที่นับได้จริง (หลังปัดเศษ/เพดาน/อนุมัติ) — ตัวที่เอาไปใช้ต่อ';
comment on column attendance."otMinutesRaw" is
  'นาทีดิบก่อนปัดเศษและตัดเพดาน — เก็บไว้ตรวจสอบย้อนหลัง';
comment on column attendance."otStatus" is
  'none | pending | approved | rejected';
comment on column attendance."otNote" is
  'เหตุผลกรณีคำนวณไม่ได้ เช่น cross_midnight_unsupported';
comment on column attendance."workHours" is
  'ชั่วโมงงานปกติ (หักพักและ "หัก OT ที่นับได้" ออกแล้ว) — workHours + otMinutes/60 = เวลาที่อยู่จริง - เวลาพัก';

create index if not exists attendance_otstatus_idx
  on attendance("otStatus") where "otStatus" = 'pending';

-- ---------------------------------------------------------------------------
-- 4. ข้อมูลเดิม — ย้ายค่าที่คิดด้วยกฎเก่าไปช่องดิบ ไม่ให้ปนกับของใหม่
--
--    กฎเก่า (otMinutes = max(0, ออก - workEnd)) ไม่มีขั้นต่ำ/ปัดเศษ/เพดาน
--    และไม่เคยผ่านการอนุมัติ จึงยกไปเป็น "ค่าดิบ" แล้วรีเซ็ตค่าที่นับได้เป็น 0
--    ไม่อย่างนั้นข้อมูลเก่าจะถูกนับเป็น approved โดยไม่มีใครเคยกดอนุมัติ
-- ---------------------------------------------------------------------------
update attendance
   set "otMinutesRaw"   = coalesce("otMinutes", 0),
       "otAfterMinutes" = coalesce("otMinutes", 0),
       "otMinutes"      = 0,
       "otStatus"       = 'none',
       "otNote"         = 'legacy_pre_ot_policy'
 where "otStatus" is null or "otStatus" = '';

-- ---------------------------------------------------------------------------
-- 5. นโยบายเริ่มต้น
-- ---------------------------------------------------------------------------
insert into ot_policies ("policyId", "name", "isActive", "mode")
values ('OTP-default', 'นโยบาย OT เริ่มต้น', true, 'request_after')
on conflict ("policyId") do nothing;

-- ---------------------------------------------------------------------------
-- 6. ล้าง config ขยะที่ตกค้างจากระบบเดิม (ไม่มีโค้ดอ่านแล้ว)
-- ---------------------------------------------------------------------------
delete from config where "key" in ('otRateType', 'otFlatHours', 'otFlatAmount');

-- ---------------------------------------------------------------------------
-- 7. RLS — ปิดจากฝั่ง browser ทั้งหมด (แอปเข้าถึงผ่าน service_role เท่านั้น)
-- ---------------------------------------------------------------------------
alter table ot_policies enable row level security;
alter table ot_requests enable row level security;
