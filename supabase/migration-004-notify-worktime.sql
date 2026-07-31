-- ============================================================================
-- TapTime — Migration 004
--   * ระบบแจ้งเตือนในแอป (ตาราง notifications)
--   * เกณฑ์การหักเวลาพักเบรก (branches."breakAfterHours")
--
-- รันบน Supabase: SQL Editor -> New query -> วางไฟล์นี้ -> Run  (รันซ้ำได้)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. branches — เกณฑ์หักเวลาพัก
--    หักเวลาพัก (breakHours) ก็ต่อเมื่อทำงานถึงจำนวนชั่วโมงนี้เท่านั้น
--    เดิมหักทุกกรณี ทำให้คนทำงาน 08:00-11:00 (3 ชม.) เหลือ 2 ชม.
--    ตั้ง 0 = หักเสมอ (พฤติกรรมเดิม)
-- ---------------------------------------------------------------------------
alter table branches add column if not exists "breakAfterHours" numeric default 6;

comment on column branches."breakAfterHours" is
  'หักเวลาพักเมื่อทำงานถึงกี่ชั่วโมง (0 = หักเสมอ)';

-- ---------------------------------------------------------------------------
-- 2. notifications — แจ้งเตือนในแอป
--
--    "empId"  = ผู้รับ (1 แถว = 1 คน แม้เหตุการณ์เดียวกันจะแจ้งหลายคน)
--    "type"   = leave_submitted | leave_decided
--               | timeedit_submitted | timeedit_decided | absent
--    "tab"    = แท็บที่จะพาไปเมื่อกดจากรายการแจ้งเตือน
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  "notiId"    bigserial primary key,
  "empId"     text not null,
  "type"      text not null,
  "title"     text not null,
  "body"      text,
  "tab"       text,
  "refId"     text,
  "actorId"   text,           -- คนที่ทำให้เกิดเหตุการณ์
  "isRead"    boolean     default false,
  "createdAt" timestamptz default now()
);

create index if not exists noti_emp_idx
  on notifications("empId", "createdAt" desc);
create index if not exists noti_unread_idx
  on notifications("empId") where "isRead" = false;

alter table notifications enable row level security;
