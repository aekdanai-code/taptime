-- ============================================================================
-- TapTime V2 — Supabase / PostgreSQL schema
-- แปลงจากฐานข้อมูล Google Sheets เดิม (TapTime.xlsx — 9 ชีต)
--
-- หลักการ:
--   * ชื่อ "ตาราง" เป็น snake_case (ไม่ต้อง quote)
--   * ชื่อ "คอลัมน์" คงเดิมจากชีต (camelCase) จึงต้องใส่ double-quote เสมอ
--     -> ทำให้ frontend เดิมใช้ key เดิมได้ 100% โดยไม่ต้องแก้
--   * ชีต Employees  ->  ตาราง profiles (ผูกกับ Supabase Auth ผ่าน "authUserId")
--   * เวลา (HH:mm) เก็บเป็น text เพื่อเลี่ยงปัญหา timezone / Date serialization
--     ที่สเปกเดิมต้องใช้ normalizer แก้ (asHHMM / asDateStr)
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ -> Run
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ลบของเดิม (รันซ้ำได้)
-- ---------------------------------------------------------------------------
drop table if exists leave_assignments   cascade;
drop table if exists checkin_audit        cascade;
drop table if exists webauthn_credentials cascade;
drop table if exists time_edit_requests cascade;
drop table if exists leave_requests    cascade;
drop table if exists attendance        cascade;
drop table if exists holidays          cascade;
drop table if exists leave_types       cascade;
drop table if exists positions         cascade;
drop table if exists profiles          cascade;
drop table if exists branches          cascade;
drop table if exists config            cascade;

-- ---------------------------------------------------------------------------
-- 1. config — ค่าตั้งค่าระบบ (key-value)  [ชีต Config]
--    key ที่ใช้: appName, companyName, businessName, weeklyOff,
--               otRateType, otFlatHours, otFlatAmount
--    weeklyOff = CSV ของเลขวัน 0-6 (0 = อาทิตย์)
-- ---------------------------------------------------------------------------
create table config (
  "key"   text primary key,
  "value" text
);

-- ---------------------------------------------------------------------------
-- 2. branches — สาขา + จุด GPS + เวลาทำงาน  [ชีต Branches]
-- ---------------------------------------------------------------------------
create table branches (
  "branchId"        text primary key,
  "name"            text not null,
  "code"            text,
  "address"         text,
  "province"        text,
  "district"        text,
  "subdistrict"     text,
  "postcode"        text,
  "lat"             double precision,
  "lng"             double precision,
  "radius"          numeric        default 50,    -- เมตร
  "workStart"       text           default '08:00',
  "workEnd"         text           default '17:00',
  "breakHours"      numeric        default 1,
  "lateThreshold"   numeric        default 15,    -- นาที
  "earlyCheckinMin" numeric        default 30,    -- นาที
  "createdAt"       timestamptz    default now()
);

-- ---------------------------------------------------------------------------
-- 3. positions — ตำแหน่งงาน  [ชีต Positions]
-- ---------------------------------------------------------------------------
create table positions (
  "posId"  text primary key,
  "name"   text not null,
  "type"   text,
  "isHead" boolean default false
);

-- ---------------------------------------------------------------------------
-- 4. leave_types — ประเภทวันลา + โควตา  [ชีต LeaveTypes]
-- ---------------------------------------------------------------------------
create table leave_types (
  "typeId"      text primary key,
  "name"        text not null,
  "daysPerYear" numeric default 0,
  "expireDate"  date,
  "advanceDays" numeric default 0,
  "showQuota"   boolean default true,   -- แสดงจำนวนวัน/ปี ในหน้าพนักงานไหม
  "assignAll"   boolean default true    -- true = ทุกคนได้สิทธิ์
);

-- ---------------------------------------------------------------------------
-- 4.1 leave_assignments — assign ประเภทลาให้พนักงานรายคน + โควตาเฉพาะคน
--     (เช่น อายุงานเกิน 1 ปี ได้ลาพักร้อนมากกว่าคนอื่น)
-- ---------------------------------------------------------------------------
create table leave_assignments (
  "typeId"       text not null references leave_types("typeId") on delete cascade,
  "empId"        text not null,
  "daysOverride" numeric,          -- null = ใช้ daysPerYear ของประเภทนั้น
  "note"         text,
  "createdAt"    timestamptz default now(),
  primary key ("typeId", "empId")
);

create index leave_assign_emp_idx  on leave_assignments("empId");
create index leave_assign_type_idx on leave_assignments("typeId");

-- ---------------------------------------------------------------------------
-- 5. profiles — พนักงาน  [ชีต Employees เดิม]
--    "authUserId"     ผูกกับ auth.users ของ Supabase (ทุกคนต้อง login)
--    "token"          เลิกใช้แล้ว — คงไว้เพื่อ import ข้อมูลเก่าเท่านั้น
--    "webauthnExempt" true = ยกเว้นไม่ต้องใช้ passkey ตอนลงเวลา
-- ---------------------------------------------------------------------------
create table profiles (
  "empId"          text primary key,
  "authUserId"     uuid unique references auth.users(id) on delete set null,
  "name"           text not null,
  "phone"          text,
  "email"          text,
  "branchId"       text references branches("branchId") on delete set null,
  "position"       text,
  "salaryType"     text,
  "salary"         numeric,
  "startDate"      date,
  "status"         text default 'active',
  "role"           text default 'employee',   -- 'employee' | 'admin'
  "nickname"       text,
  "gender"         text,
  "birthDate"      date,
  "nationalId"     text,
  "nationality"    text,
  "address"        text,
  "photo"          text,                      -- data URL base64
  "token"          text unique,               -- legacy (เลิกใช้)
  "webauthnExempt" boolean     default false,
  "invitedAt"      timestamptz,
  "lastLoginAt"    timestamptz,
  "createdAt"      timestamptz default now()
);

create index profiles_token_idx    on profiles("token");
create index profiles_branch_idx   on profiles("branchId");
create index profiles_status_idx   on profiles("status");

-- ---------------------------------------------------------------------------
-- 6. attendance — บันทึกลงเวลา (1 แถว = 1 คน/วัน)  [ชีต Attendance]
-- ---------------------------------------------------------------------------
create table attendance (
  "recId"        text primary key,
  "empId"        text not null references profiles("empId") on delete cascade,
  "empName"      text,
  "branchId"     text,
  "date"         date not null,
  "checkInTime"  text,          -- 'HH:mm'
  "checkOutTime" text,          -- 'HH:mm'
  "lateMinutes"  numeric default 0,
  "otMinutes"    numeric default 0,
  "workHours"    numeric,
  "dayType"      text default 'วันปกติ',
  "status"       text,          -- 'ontime' | 'late'
  "checkInLat"   double precision,
  "checkInLng"   double precision,
  "note"         text,
  "createdAt"    timestamptz default now(),
  unique ("empId", "date")      -- 1 คน 1 แถวต่อวัน (ตามตรรกะเดิม)
);

create index attendance_date_idx      on attendance("date");
create index attendance_emp_date_idx  on attendance("empId", "date");
create index attendance_branch_idx    on attendance("branchId");

-- ---------------------------------------------------------------------------
-- 7. leave_requests — คำขอลา  [ชีต LeaveRequests]
-- ---------------------------------------------------------------------------
create table leave_requests (
  "reqId"       text primary key,
  "empId"       text not null references profiles("empId") on delete cascade,
  "empName"     text,
  "branchId"    text,
  "leaveType"   text,
  "startDate"   date,
  "endDate"     date,
  "days"        numeric,
  "reason"      text,
  "status"      text default 'pending',    -- pending | approved | rejected
  "requestedAt" text,                      -- 'yyyy-MM-dd HH:mm'
  "decidedAt"   text
);

create index leave_requests_emp_idx    on leave_requests("empId");
create index leave_requests_status_idx on leave_requests("status");
create index leave_requests_range_idx  on leave_requests("startDate", "endDate");

-- ---------------------------------------------------------------------------
-- 8. holidays — วันหยุดราชการ  [ชีต Holidays]
-- ---------------------------------------------------------------------------
create table holidays (
  "holidayId" text primary key,
  "date"      date not null,
  "name"      text not null
);

create index holidays_date_idx on holidays("date");

-- ---------------------------------------------------------------------------
-- 9. time_edit_requests — คำขอแก้เวลา  [ชีต TimeEditRequests]
-- ---------------------------------------------------------------------------
create table time_edit_requests (
  "editId"      text primary key,
  "empId"       text not null references profiles("empId") on delete cascade,
  "empName"     text,
  "branchId"    text,
  "date"        date not null,
  "oldCheckIn"  text,
  "oldCheckOut" text,
  "newCheckIn"  text,
  "newCheckOut" text,
  "reason"      text,
  "status"      text default 'pending',
  "requestedAt" text,
  "decidedAt"   text
);

create index time_edit_emp_idx    on time_edit_requests("empId");
create index time_edit_status_idx on time_edit_requests("status");

-- ---------------------------------------------------------------------------
-- 10. webauthn_credentials — passkey (Face ID / ลายนิ้วมือ) ที่ผูกกับพนักงาน
--     1 พนักงาน มีได้หลายอุปกรณ์
-- ---------------------------------------------------------------------------
create table webauthn_credentials (
  "credentialId" text primary key,          -- base64url
  "empId"        text not null references profiles("empId") on delete cascade,
  "publicKey"    text not null,             -- base64url (COSE)
  "counter"      bigint      default 0,     -- กัน replay / ตรวจการโคลน
  "transports"   text,
  "deviceName"   text,
  "backedUp"     boolean     default false,
  "createdAt"    timestamptz default now(),
  "lastUsedAt"   timestamptz
);

create index webauthn_emp_idx on webauthn_credentials("empId");

-- ---------------------------------------------------------------------------
-- 11. checkin_audit — หลักฐานทุกครั้งที่มีความพยายามลงเวลา
--     ใช้ตรวจย้อนหลังเมื่อสงสัยว่ามีการเช็คอินแทนกัน / ปลอมพิกัด
-- ---------------------------------------------------------------------------
create table checkin_audit (
  "auditId"      bigserial primary key,
  "empId"        text,
  "action"       text,          -- 'checkin' | 'checkout'
  "at"           timestamptz default now(),
  "result"       text,          -- 'ok' | เหตุผลที่ถูกปฏิเสธ
  "lat"          double precision,
  "lng"          double precision,
  "accuracy"     double precision,
  "distance"     double precision,
  "credentialId" text,
  "ip"           text,
  "userAgent"    text
);

create index checkin_audit_emp_idx on checkin_audit("empId", "at" desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ทุกการอ่าน/เขียนของแอปวิ่งผ่าน API route ฝั่งเซิร์ฟเวอร์ด้วย service_role key
-- (service_role bypass RLS) จึงเปิด RLS ไว้แบบ "ไม่มี policy" = ปิดตายจากฝั่ง
-- browser/anon key ทั้งหมด -> ปลอดภัยที่สุด และตรรกะสิทธิ์อยู่ที่ชั้น API
-- ---------------------------------------------------------------------------
alter table config             enable row level security;
alter table branches           enable row level security;
alter table positions          enable row level security;
alter table leave_types        enable row level security;
alter table profiles           enable row level security;
alter table attendance         enable row level security;
alter table leave_requests     enable row level security;
alter table holidays           enable row level security;
alter table time_edit_requests enable row level security;
alter table webauthn_credentials enable row level security;
alter table checkin_audit         enable row level security;
alter table leave_assignments     enable row level security;

-- ให้ผู้ใช้ที่ล็อกอินอ่าน profile ของตัวเองได้ (เผื่อใช้ฝั่ง client ในอนาคต)
create policy "own profile readable"
  on profiles for select
  to authenticated
  using ("authUserId" = auth.uid());
