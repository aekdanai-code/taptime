-- ============================================================================
-- TapTime — Migration 002
--   * ยกเลิกการใช้ "ลิงก์ token" ในการเช็คอิน -> ทุกคนเข้าผ่านหน้า login
--   * เพิ่ม WebAuthn / passkey (ผูกอุปกรณ์ + biometric) สำหรับเช็คอิน-เอาท์
--   * เพิ่ม audit log ของการเช็คอิน-เอาท์
--
-- รันบน Supabase: SQL Editor -> New query -> วางไฟล์นี้ -> Run
-- (รันซ้ำได้ ปลอดภัย)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — ฟิลด์เพิ่มเติมสำหรับระบบสมาชิก
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists "webauthnExempt" boolean  default false;
alter table profiles add column if not exists "invitedAt"      timestamptz;
alter table profiles add column if not exists "lastLoginAt"    timestamptz;

comment on column profiles."webauthnExempt" is
  'true = ยกเว้นไม่ต้องใช้ passkey ตอนเช็คอิน (สำหรับเครื่องที่ไม่รองรับ biometric)';
comment on column profiles."token" is
  'เลิกใช้แล้ว (legacy จาก Apps Script) — คงไว้เพื่ออ้างอิงข้อมูลเก่าเท่านั้น';

-- ---------------------------------------------------------------------------
-- 2. webauthn_credentials — passkey ที่ผูกกับพนักงานแต่ละคน
--    1 พนักงาน มีได้หลายอุปกรณ์ (มือถือ + แท็บเล็ต)
-- ---------------------------------------------------------------------------
create table if not exists webauthn_credentials (
  "credentialId" text primary key,          -- base64url
  "empId"        text not null references profiles("empId") on delete cascade,
  "publicKey"    text not null,             -- base64url (COSE)
  "counter"      bigint      default 0,     -- กัน replay (signature counter)
  "transports"   text,                      -- internal / hybrid / usb ...
  "deviceName"   text,                      -- ชื่อที่พนักงานตั้ง / จาก user-agent
  "backedUp"     boolean     default false,
  "createdAt"    timestamptz default now(),
  "lastUsedAt"   timestamptz
);

create index if not exists webauthn_emp_idx on webauthn_credentials("empId");

-- ---------------------------------------------------------------------------
-- 3. checkin_audit — บันทึกหลักฐานทุกครั้งที่มีการเช็คอิน/เอาท์
--    ใช้ตรวจย้อนหลังเมื่อสงสัยว่ามีการเช็คอินแทนกัน / ปลอมพิกัด
-- ---------------------------------------------------------------------------
create table if not exists checkin_audit (
  "auditId"      bigserial primary key,
  "empId"        text,
  "action"       text,          -- 'checkin' | 'checkout'
  "at"           timestamptz default now(),
  "result"       text,          -- 'ok' | เหตุผลที่ถูกปฏิเสธ
  "lat"          double precision,
  "lng"          double precision,
  "accuracy"     double precision,
  "distance"     double precision,
  "credentialId" text,          -- passkey ที่ใช้ (null = ได้รับการยกเว้น)
  "ip"           text,
  "userAgent"    text
);

create index if not exists checkin_audit_emp_idx on checkin_audit("empId", "at" desc);

-- ---------------------------------------------------------------------------
-- 4. RLS — ปิดจากฝั่ง browser ทั้งหมด (แอปเข้าถึงผ่าน service_role เท่านั้น)
-- ---------------------------------------------------------------------------
alter table webauthn_credentials enable row level security;
alter table checkin_audit        enable row level security;
