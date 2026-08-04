# TapTime — Master Prompt: ระบบ OT (V1.0)

เอกสารสั่งงานสำหรับเพิ่ม **ระบบล่วงเวลา (OT)** เข้าไปในระบบ TapTime ที่มีอยู่แล้ว

อ่านเอกสารนี้จบแล้วต้องสร้างฟีเจอร์ขึ้นใหม่ได้ทั้งหมด โดยไม่ต้องอ้างอิงบทสนทนาใด ๆ

| | |
|---|---|
| สถานะ | ร่างสเปก — ยังไม่เริ่มพัฒนา |
| ขอบเขต | เก็บชั่วโมง OT · ยังไม่คิดเงิน |
| ข้อยกเว้น | ไม่ทำกะกลางคืน / OT ข้ามเที่ยงคืน |
| ไฟล์ migration | `supabase/migration-005-overtime.sql` |

---

## สารบัญ

0. [บริบทของระบบเดิม](#0-บริบทของระบบเดิม-ต้องอ่านก่อน)
1. [เป้าหมายและขอบเขต](#1-เป้าหมายและขอบเขต)
2. [โครงสร้างฐานข้อมูล](#2-โครงสร้างฐานข้อมูล)
3. [ตรรกะการคำนวณ](#3-ตรรกะการคำนวณ)
4. [การเช็คอินวันหยุด](#4-การเช็คอินวันหยุด)
5. [ฟังก์ชัน RPC](#5-ฟังก์ชัน-rpc)
6. [หน้าจอฝั่ง Admin](#6-หน้าจอฝั่ง-admin)
7. [หน้าจอฝั่ง Employee](#7-หน้าจอฝั่ง-employee)
8. [กฎการตรวจสอบและข้อความ error](#8-กฎการตรวจสอบและข้อความ-error)
9. [ชุดทดสอบที่ต้องผ่าน](#9-ชุดทดสอบที่ต้องผ่าน)
10. [Definition of Done](#10-definition-of-done)
11. [คำสั่งสรุป (Master Prompt)](#11-คำสั่งสรุป-master-prompt)

---

## 0. บริบทของระบบเดิม (ต้องอ่านก่อน)

TapTime เป็นระบบลงเวลาเข้า-ออกงานด้วย GPS รันบน **Next.js 14 (App Router) + Supabase (PostgreSQL) + Vercel**

### ข้อตกลงการเขียนโค้ดที่ต้องทำตามเคร่งครัด

| หัวข้อ | กติกา |
|---|---|
| ชื่อตาราง | `snake_case` ไม่ต้อง quote |
| ชื่อคอลัมน์ | `camelCase` **ต้อง** ใส่ double-quote ใน SQL เสมอ |
| เวลา (นาฬิกา) | ชนิด `text` เก็บ `'HH:mm'` — ห้ามใช้ `time` |
| วันที่ | ชนิด `date` → PostgREST คืน `'yyyy-MM-dd'` |
| timestamp ของใบคำขอ | ชนิด `text` เก็บ `'yyyy-MM-dd HH:mm'` (ให้เหมือน `leave_requests`) |
| เขตเวลา | `Asia/Bangkok` ใช้ `today()` / `nowHHMM()` / `nowStamp()` จาก `lib/helpers.ts` เท่านั้น |
| การเรียก backend | ทุกอย่างผ่าน `POST /api/rpc` `{fn, args}` เท่านั้น |
| สิทธิ์ | ลงทะเบียนใน `lib/rpc.ts` → `ADMIN_FNS` หรือ `EMPLOYEE_FNS` |
| ตัวตนพนักงาน | `applyIdentity()` เขียนทับ `args[0]` ด้วย `empId` จาก session เสมอ — **ห้ามเชื่อค่าจาก client** |
| ฐานข้อมูล | ผ่าน `lib/db.ts` (`readObjects` / `appendObject` / `updateByKey` / `findOne`) ด้วย service_role |
| หน้าเว็บ | HTML/CSS/JS แบบเดิมใน `src/frontend-admin/` และ `src/frontend-employee/` ประกอบด้วย `scripts/build-html.mjs` |
| ทดสอบ | เพิ่มใน `test/run-tests.js` ใช้ `test/fake-supabase.js` (ฐานข้อมูลจำลองในหน่วยความจำ) |
| ปุ่มกันกดซ้ำ | ทำอัตโนมัติที่ชั้น `src/shim.html` แล้ว — เพิ่มแค่คำในตาราง `busyText` |

### ไฟล์ที่เกี่ยวข้องโดยตรง

```
lib/api/attendance.ts    writeCheckIn / writeCheckOut  <- แกนคำนวณเวลา
lib/api/employeeApi.ts   empCheckIn / empCheckOut / employeeContext
lib/api/timeEdits.ts     decideTimeEdit เรียก writeCheckOut ต่อ
lib/api/reports.ts       dailyReport / monthlyReport / exportMonthlyReportXlsx
lib/api/notifications.ts notify / notifyAdmins
lib/helpers.ts           computeWorkHours / toMinutes / today / nowStamp
lib/rpc.ts               ทะเบียนฟังก์ชัน + สิทธิ์ + applyIdentity
lib/auth.ts              currentViewer / isAdminNow (อ่าน role สดจาก DB)
```

### สภาพ OT ปัจจุบัน (ที่ต้องถูกแทนที่)

`writeCheckOut` คำนวณ `otMinutes = max(0, เวลาออก − workEnd)` บรรทัดเดียว

- ไม่มีขั้นต่ำ ไม่มีปัดเศษ ไม่มีเพดาน ไม่มีการอนุมัติ
- ไม่ปรากฏในรายงานใดเลย
- `config` มี key ตกค้าง `otRateType` / `otFlatHours` / `otFlatAmount` ที่ **ไม่มีโค้ดอ่าน**
- `profiles.salary` และ `salaryType` เก็บไว้เฉย ๆ ไม่เคยถูกใช้คำนวณ
- `empCheckIn` **ปฏิเสธการเช็คอินในวันหยุดทุกกรณี** → บันทึก OT วันหยุดไม่ได้เลย

---

## 1. เป้าหมายและขอบเขต

**เป้าหมาย** — เก็บ "ชั่วโมง OT" ที่เชื่อถือได้ ตรวจสอบย้อนหลังได้ และส่งออกไปให้ระบบเงินเดือนภายนอกใช้ต่อได้

### อยู่ในขอบเขต

- นโยบาย OT **ชุดเดียวใช้ทั้งบริษัท** ทุกสาขาใช้กฎเดียวกัน
- โหมดการทำงาน 5 แบบ ให้แอดมินเลือก
- กฎการนับ: ช่วงผ่อนผัน (grace) · ขั้นต่ำ · ปัดเศษ · หักพัก · เพดานวัน/สัปดาห์/เดือน
- flow ยื่น–อนุมัติ + แจ้งเตือนในแอป
- **รองรับ OT ในวันหยุด** (ต้องปลดบล็อกการเช็คอินวันหยุดที่ปัจจุบันปิดตายอยู่)
- รายงาน OT + export Excel

### ไม่อยู่ในขอบเขต (แต่ต้องวางโครงรองรับ)

- ❌ **คำนวณเงิน อัตราคูณ ค่าแรงต่อชั่วโมง** — สร้างคอลัมน์ไว้ในตารางแต่ห้ามเขียนโค้ดคำนวณ
- ❌ **กะกลางคืน / OT ข้ามเที่ยงคืน**
- ❌ นโยบายแยกรายสาขา / รายพนักงาน
- ❌ วันหยุดชดเชยแทนเงิน (comp time)
- ❌ ให้พนักงานเห็นยอดเงิน

### กติกาสำคัญเรื่องข้ามเที่ยงคืน

ระบบนี้ยึดโครงสร้าง **"1 คน 1 แถวต่อวัน"** (`attendance` มี `unique(empId, date)`) และเก็บเวลาเป็น `'HH:mm'` ภายในวันเดียว

> ถ้า `เวลาออก <= เวลาเข้า` ให้ถือว่าเป็นข้อมูลผิดพลาด **ห้ามคำนวณ OT**
> คืน `0` พร้อมเหตุผล `cross_midnight_unsupported` และแจ้งพนักงานว่า
> *"เวลาออกงานต้องอยู่หลังเวลาเข้างานภายในวันเดียวกัน — ถ้าทำงานข้ามคืน กรุณายื่นคำขอแก้เวลาให้แอดมินบันทึกให้"*
>
> **ห้ามพยายามเดา +1440 นาทีเด็ดขาด** เพราะจะทำให้ข้อมูลผิดโดยไม่มีใครรู้

---

## 2. โครงสร้างฐานข้อมูล

สร้างไฟล์ `supabase/migration-005-overtime.sql` — ต้องรันซ้ำได้อย่างปลอดภัย

```sql
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

create index if not exists attendance_otstatus_idx
  on attendance("otStatus") where "otStatus" = 'pending';

-- ---------------------------------------------------------------------------
-- 4. ข้อมูลเดิม — ย้ายค่าที่คิดด้วยกฎเก่าไปช่องดิบ ไม่ให้ปนกับของใหม่
-- ---------------------------------------------------------------------------
update attendance
   set "otMinutesRaw" = coalesce("otMinutes", 0),
       "otStatus"     = 'none'
 where "otStatus" is null;

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
```

### สิ่งที่ต้องทำเพิ่มนอกไฟล์ migration

- อัปเดต `supabase/schema.sql` ให้ตรงกัน สำหรับการติดตั้งใหม่จากศูนย์
- เพิ่ม `OTPOLICIES: 'ot_policies'` และ `OTREQUESTS: 'ot_requests'` ใน `T` ของ `lib/db.ts`
- เพิ่ม primary key ทั้งสองตารางใน `PK`
- เพิ่มคอลัมน์ตัวเลขใหม่ทั้งหมดเข้า `NUMERIC_COLS` ของ `lib/db.ts`
- เพิ่ม `ot_policies` / `ot_requests` ใน `test/fixture.json`

---

## 3. ตรรกะการคำนวณ

สร้างไฟล์ใหม่ `lib/api/overtime.ts` ฟังก์ชันหลักต้อง **บริสุทธิ์ (pure)** เพื่อทดสอบได้โดยไม่ต้องต่อฐานข้อมูล

```ts
export type OtResult = {
  raw: number;            // นาทีดิบ
  before: number;         // ส่วนก่อนเข้างาน
  after: number;          // ส่วนหลังเลิกงาน
  countable: number;      // นาทีที่นับได้จริง
  status: 'none' | 'pending' | 'approved';
  note?: string;          // เหตุผลกรณีไม่นับ
};

export function computeOt(input: {
  checkInMin: number;
  checkOutMin: number;
  workStartMin: number;
  workEndMin: number;
  dayType: 'workday' | 'weekend' | 'holiday';
  policy: OtPolicy;
  approvedMinutes?: number;   // จากใบที่อนุมัติแล้ว (ใช้กับ request_before)
  usedThisWeek?: number;
  usedThisMonth?: number;
}): OtResult
```

### ลำดับการคำนวณ — ห้ามสลับลำดับ

| # | ขั้น | รายละเอียด |
|---|---|---|
| 0 | ปิดระบบ | `mode === 'off'` → คืน 0 ทั้งหมด `status='none'` |
| 0.5 | **กันข้ามเที่ยงคืน** | `checkOutMin <= checkInMin` → คืน 0 พร้อม `note='cross_midnight_unsupported'` |
| 1 | เวลาดิบ | วันหยุด + `holidayCountsAllHours` → `after = ออก − เข้า` (ทั้งวันเป็น OT)<br>วันทำงาน → `after = ออก − workEnd` เมื่อ **เกิน** `graceMinutes` เท่านั้น<br>ถ้า `countBeforeShift` → `before = workStart − เข้า` เมื่อเกิน `beforeShiftGraceMinutes` |
| 2 | หักพัก | ถ้า `otBreakMinutes > 0` และ `raw >= otBreakAfterMinutes` → ลบออก |
| 3 | ปัดเศษ | `roundMinutes > 0` → `down` / `nearest` / `up` |
| 4 | ขั้นต่ำ | `< minMinutes` → เป็น 0 **ทั้งก้อน** (ไม่ใช่ตัดเศษ) |
| 5 | เพดาน | วัน → สัปดาห์ (เหลือเท่าไร) → เดือน (เหลือเท่าไร) · `0 = ไม่จำกัด` |
| 6 | แยกตามโหมด | ตามตารางด้านล่าง |

### พฤติกรรมตามโหมด (ขั้นที่ 6)

| โหมด | `countable` | `status` | สร้างใบ `ot_requests` ไหม |
|---|---|---|---|
| `auto` | ค่าที่คำนวณได้ | `approved` | ไม่สร้าง |
| `request_after` | ค่าที่คำนวณได้ | `pending` | **สร้างอัตโนมัติ** `source='system'`, `status='pending'`, reason ว่าง |
| `request_before` | `min(คำนวณได้, approvedMinutes)` | `approved` ถ้า > 0 | ไม่สร้าง (มีอยู่แล้ว) |
| `admin_only` | 0 | `none` | ไม่สร้าง |

### โครงสร้างอ้างอิง (pseudocode)

```ts
export function computeOt(input): OtResult {
  const { policy, dayType } = input;
  const zero = { raw: 0, before: 0, after: 0, countable: 0, status: 'none' as const };

  // ---- 0. ปิดระบบ ----
  if (policy.mode === 'off') return zero;

  // ---- 0.5 กันข้ามเที่ยงคืน ----
  if (input.checkOutMin <= input.checkInMin)
    return { ...zero, note: 'cross_midnight_unsupported' };

  // ---- 1. เวลาดิบ ----
  let before = 0, after = 0;
  if (dayType !== 'workday' && policy.holidayCountsAllHours) {
    after = input.checkOutMin - input.checkInMin;        // วันหยุด = ทั้งวันเป็น OT
  } else {
    if (policy.countAfterShift) {
      const d = input.checkOutMin - input.workEndMin;
      if (d > policy.graceMinutes) after = d;            // ต้อง "เกิน" grace
    }
    if (policy.countBeforeShift) {
      const d = input.workStartMin - input.checkInMin;
      if (d > policy.beforeShiftGraceMinutes) before = d;
    }
  }
  const raw = Math.max(0, before + after);

  // ---- 2. หักพักระหว่าง OT ----
  let m = raw;
  if (policy.otBreakMinutes > 0 && m >= policy.otBreakAfterMinutes)
    m = Math.max(0, m - policy.otBreakMinutes);

  // ---- 3. ปัดเศษ ----
  const r = policy.roundMinutes;
  if (r > 0) {
    m = policy.roundMode === 'up'      ? Math.ceil(m / r) * r
      : policy.roundMode === 'nearest' ? Math.round(m / r) * r
      :                                  Math.floor(m / r) * r;
  }

  // ---- 4. ขั้นต่ำ ----
  if (m < policy.minMinutes) m = 0;

  // ---- 5. เพดาน ----
  if (policy.maxPerDayMinutes > 0)
    m = Math.min(m, policy.maxPerDayMinutes);
  if (policy.maxPerWeekMinutes > 0)
    m = Math.min(m, Math.max(0, policy.maxPerWeekMinutes - (input.usedThisWeek || 0)));
  if (policy.maxPerMonthMinutes > 0)
    m = Math.min(m, Math.max(0, policy.maxPerMonthMinutes - (input.usedThisMonth || 0)));

  // ---- 6. แยกตามโหมด ----
  switch (policy.mode) {
    case 'auto':
      return { raw, before, after, countable: m, status: m > 0 ? 'approved' : 'none' };
    case 'request_after':
      return { raw, before, after, countable: m, status: m > 0 ? 'pending' : 'none' };
    case 'request_before': {
      const allowed = Math.min(m, input.approvedMinutes || 0);
      return { raw, before, after, countable: allowed,
               status: allowed > 0 ? 'approved' : 'none' };
    }
    case 'admin_only':
    default:
      return { raw, before, after, countable: 0, status: 'none' };
  }
}
```

### กติกาเพิ่มเติม

- **การนับในรายงาน** — ทุกรายงานและสถิตินับเฉพาะ `otStatus = 'approved'` เท่านั้น
  ส่วน `pending` แสดงแยกเป็นคอลัมน์ "รออนุมัติ" **ห้ามรวมกัน**
- **ประสิทธิภาพ** — ถ้า `maxPerWeekMinutes = 0` และ `maxPerMonthMinutes = 0`
  ให้ **ข้าม query** หายอดสะสม ไม่ต้องยิงฐานข้อมูลโดยไม่จำเป็น
- **จุดเรียกใช้** — `writeCheckOut` เป็นผู้เรียก `computeOt()` และเนื่องจาก
  `decideTimeEdit` เรียก `writeCheckOut` อยู่แล้ว การอนุมัติแก้เวลาจะคำนวณ OT ใหม่ให้เองอัตโนมัติ

---

## 4. การเช็คอินวันหยุด

แก้ `empCheckIn` ใน `lib/api/employeeApi.ts` — เดิมปฏิเสธวันหยุดทุกกรณีด้วย `reason: 'holiday'`

```
ถ้า dayType !== 'work':
    ถ้า !policy.allowHolidayWork          -> ปฏิเสธ reason='holiday'   (เหมือนเดิม)
    ถ้า policy.holidayNeedsRequest:
        หาใบ ot_requests ของ empId + วันนี้ ที่ status='approved'
        ไม่พบ -> ปฏิเสธ reason='holiday_needs_request'
    ผ่าน -> เช็คอินได้ · dayType='วันหยุด'
            · otDayType = 'holiday' หรือ 'weekend'
```

- การแยก `weekend` กับ `holiday` ใช้ผลจาก `dayTypeOf()` ที่มีอยู่แล้ว (คืน `type: 'weekend' | 'holiday' | 'work'`)
- ฝั่งหน้าเว็บ `handleFail()` มี fallback อยู่แล้ว แต่ต้องเพิ่มข้อความเฉพาะสำหรับ
  `holiday_needs_request` พร้อมปุ่มลัดไปยื่นขอ OT

---

## 5. ฟังก์ชัน RPC

| ฟังก์ชัน | กลุ่มสิทธิ์ | หน้าที่ |
|---|---|---|
| `getOtPolicy()` | ADMIN | อ่านนโยบายที่ `isActive` |
| `saveOtPolicy(policy)` | ADMIN | สร้างแถวใหม่ + ย้าย `isActive` (ไม่ทับของเก่า) |
| `listOtRequests(params)` | ADMIN | กรองตาม status / ช่วงวัน / empId / สาขา |
| `decideOtRequest(otId, decision, minutesApproved?, note?)` | ADMIN | อนุมัติ/ปฏิเสธ + แก้จำนวนนาที + อัปเดต `attendance` |
| `adminCreateOt(payload)` | ADMIN | คีย์ OT ให้พนักงาน (`source='admin'`, `status='approved'`) |
| `otSummary(params)` | ADMIN | สรุปรายคน/ช่วงวัน แยกตามประเภทวัน |
| `empSubmitOtRequest(empId, payload)` | EMPLOYEE | ยื่นขอ OT |
| `empCancelOtRequest(empId, otId)` | EMPLOYEE | ยกเลิกใบที่ยัง `pending` เท่านั้น |
| `empOtHistory(empId)` | EMPLOYEE | ประวัติ OT ของตัวเอง |

**ข้อบังคับ**

- ฟังก์ชันฝั่งพนักงานทั้ง 3 ตัวต้องอยู่ใน `EMPLOYEE_FNS`
  เพื่อให้ `applyIdentity()` เขียนทับ `empId` จาก session — ยื่นแทนคนอื่นไม่ได้
- **แจ้งเตือน** ต่อยอด `lib/api/notifications.ts` เพิ่ม type
  `ot_submitted` (→ `notifyAdmins`) และ `ot_decided` (→ `notify` หาเจ้าของใบ)
  พร้อมเพิ่มใน `TAB_OF` — ไม่ต้องแตะ schema ของ notifications
- **เพิ่ม `otPolicy` เข้า `adminBootstrap()`** เพื่อให้หน้าแอดมินรู้โหมดตั้งแต่โหลด
- **เพิ่มเข้า `employeeContext()`** เฉพาะฟิลด์ที่พนักงานต้องใช้
  (`mode`, `allowHolidayWork`, `holidayNeedsRequest`)
  **ห้ามส่งฟิลด์เกี่ยวกับเงินไปฝั่งพนักงาน**

---

## 6. หน้าจอฝั่ง Admin

### 6.1 เมนูใหม่ "ตั้งค่า OT"

แบ่งเป็น 4 การ์ด

1. **โหมดการทำงาน** — radio 5 ตัวเลือก พร้อมคำอธิบายว่าแต่ละแบบต่างกันอย่างไร
2. **กฎการนับ** — `countAfterShift`, `countBeforeShift`, grace, ขั้นต่ำ,
   ปัดเศษ (+ dropdown down/nearest/up), หักพัก
3. **เพดาน** — ต่อวัน/สัปดาห์/เดือน (กรอกเป็นชั่วโมง แปลงเป็นนาทีตอนบันทึก)
4. **วันหยุด** — `allowHolidayWork`, `holidayNeedsRequest`, `holidayCountsAllHours`

**บังคับต้องมี: กล่องพรีวิวสด**

ให้กรอกเวลาเข้า-ออกสมมติแล้วแสดงผลทีละขั้นทันที เช่น

> เข้า 08:00 · ออก 19:20 → ดิบ 140 นาที → หักพัก 0 → ปัดลง 30 = **120 นาที (2 ชม. 0 นาที)**

กฎ 5 ชั้นซ้อนกันทำให้คนตั้งค่างงง่ายมาก พรีวิวนี้ไม่ใช่ของเสริม

### 6.2 เมนูใหม่ "อนุมัติ OT"

- ตารางใบรออนุมัติ: ชื่อ · วันที่ · ประเภทวัน · เวลาเข้า-ออกจริง · นาทีดิบ · นาทีที่จะนับ · เหตุผล
- แก้จำนวนนาทีก่อนกดอนุมัติได้
- เลือกหลายรายการอนุมัติพร้อมกัน
- ตัวกรอง: สถานะ · ช่วงวัน · สาขา · ชื่อ

### 6.3 หน้าเดิมที่ต้องแก้

| หน้า | แก้อะไร |
|---|---|
| ลงเวลา | คอลัมน์ OT เป็น `ดิบ / นับได้ / สถานะ` + ปุ่มคีย์ OT ให้ (โหมด `admin_only`) |
| รายงานรายวัน | เพิ่มคอลัมน์ OT (นับได้) |
| รายงานเดือน | เพิ่มยอดรวม OT ต่อคน + ใส่ในไฟล์ Excel |
| รายงาน OT (ใหม่) | สรุปแยกตามประเภทวัน — ตารางนี้คือตัวที่ส่งต่อระบบเงินเดือน |

---

## 7. หน้าจอฝั่ง Employee

- **กล่องสรุปหลังเช็คเอาท์** แยก `เวลาทำงาน` กับ `OT` ให้ชัด
  พร้อม badge สถานะ (นับแล้ว / รออนุมัติ / ไม่นับ)
- **ปุ่มยื่นขอ OT** แสดงเฉพาะโหมดที่ยื่นได้ (`request_before` / `request_after`)
  โหมด `off` และ `admin_only` ต้อง **ซ่อนทุกอย่างที่เกี่ยวกับ OT**
- **แท็บ "การลา" เปลี่ยนเป็น "คำขอ"** รวมใบลา ใบแก้เวลา และใบ OT ไว้ที่เดียว
- **วันหยุด** ถ้า `allowHolidayWork` เปิด สไลด์เช็คอินไม่เทา
  แต่ขึ้นข้อความ *"วันนี้เป็นวันหยุด — เช็คอินจะนับเป็น OT ทั้งวัน"*
- **สถิติเดือน** เพิ่มชั่วโมง OT (เฉพาะที่อนุมัติแล้ว) — **ห้ามแสดงยอดเงิน**

---

## 8. กฎการตรวจสอบและข้อความ error

| เงื่อนไข | ข้อความ |
|---|---|
| เวลาออก ≤ เวลาเข้า | `เวลาออกงานต้องอยู่หลังเวลาเข้างานภายในวันเดียวกัน — ถ้าทำงานข้ามคืน กรุณายื่นคำขอแก้เวลา` |
| ยื่นใบซ้ำวัน+ประเภทเดิม | `มีใบขอ OT ของวันนี้อยู่แล้ว (สถานะ: รออนุมัติ)` |
| ยื่นโดยที่โหมด = `off` | `ระบบ OT ปิดอยู่` |
| ยื่นโดยที่โหมด = `admin_only` | `ผู้ดูแลระบบเป็นผู้บันทึก OT ให้` |
| `plannedEnd <= plannedStart` | `เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม` |
| ยกเลิกใบที่ไม่ใช่ `pending` | `ยกเลิกได้เฉพาะใบที่ยังรออนุมัติ` |
| เช็คอินวันหยุดโดยไม่มีใบ | `วันนี้เป็นวันหยุด — ต้องได้รับอนุมัติ OT ก่อนจึงจะเช็คอินได้` |
| อนุมัตินาทีเกินที่ขอ | `จำนวนนาทีที่อนุมัติต้องไม่เกินที่ยื่นขอ` |

---

## 9. ชุดทดสอบที่ต้องผ่าน

เพิ่มใน `test/run-tests.js` (ปัจจุบันมี 135 ข้อ) ประมาณ 25–30 ข้อ

### `computeOt` (pure — ไม่ต้องต่อ DB)

- ทุกโหมด × ทุกประเภทวัน
- ปัดเศษ 3 แบบ + `roundMinutes = 0`
- grace ทำงานถูก (ต้อง **เกิน** ไม่ใช่ **เท่ากับ**)
- ขั้นต่ำตัดทั้งก้อน ไม่ใช่ตัดเศษ
- เพดาน 3 ระดับซ้อนกัน + `0 = ไม่จำกัด`
- `countBeforeShift` เปิด/ปิด
- หักพักเมื่อถึง/ไม่ถึงเกณฑ์
- วันหยุดนับทั้งวัน vs นับเฉพาะส่วนเกิน
- **`checkOut <= checkIn` → คืน 0 + note `cross_midnight_unsupported`**
- `request_before` ที่ทำเกินใบที่ขอ → ตัดตามใบ

### end-to-end (ใช้ `fake-supabase`)

- `writeCheckOut` เขียนคอลัมน์ OT ครบทุกช่อง
- อนุมัติแก้เวลา (`decideTimeEdit`) → OT คำนวณใหม่ถูกต้อง
- ยื่นใบซ้ำวันเดียวกัน → ถูกปฏิเสธ
- อนุมัติ/ปฏิเสธ → `attendance.otStatus` และ `otMinutes` อัปเดตตาม
- แจ้งเตือนถูกส่งถึงแอดมิน/พนักงานถูกคน
- เช็คอินวันหยุดตามผัง (มีใบ / ไม่มีใบ / ปิดฟีเจอร์)
- รายงานนับเฉพาะ `approved` ไม่ปน `pending`
- `empSubmitOtRequest` ถูกเขียนทับ `empId` จาก session (ยื่นแทนคนอื่นไม่ได้)
- ฟิลด์เกี่ยวกับเงินไม่ถูกส่งไปฝั่ง `employeeContext`

---

## 10. Definition of Done

- [ ] `npm run typecheck` ผ่านสะอาด
- [ ] `npm test` ผ่านทุกข้อ รวมของเดิม 135 ข้อ
- [ ] `migration-005-overtime.sql` รันซ้ำได้ไม่ error และ `schema.sql` ตรงกัน
- [ ] เปลี่ยนโหมดในหน้าตั้งค่า แล้ว UI ฝั่งพนักงานเปลี่ยนตามทันทีโดยไม่ต้อง logout
- [ ] `mode = 'off'` ซ่อน UI ที่เกี่ยวกับ OT ทั้งหมดทั้งสองฝั่ง
- [ ] รายงานเดือน export Excel มีคอลัมน์ OT
- [ ] ไม่มีโค้ดใดอ่าน/เขียนคอลัมน์ `otRate` `otAmount` `payMode` `rate*` `flat*` — ต้องยังว่างอยู่
- [ ] `README.md` อัปเดตหัวข้อระบบ OT + จำนวนข้อทดสอบใหม่

---

## 11. คำสั่งสรุป (Master Prompt)

> เพิ่มระบบ **OT** เข้าไปใน TapTime (Next.js 14 + Supabase) ตามเอกสารนี้
>
> **เก็บเฉพาะชั่วโมง ยังไม่คิดเงิน** แต่ต้องสร้างคอลัมน์ฝั่งการจ่ายไว้ในฐานข้อมูล
> ตั้งแต่ตอนนี้ เพื่อให้เฟสถัดไปไม่ต้อง migrate ซ้ำ — และห้ามมีโค้ดใดอ่านหรือเขียน
> คอลัมน์เหล่านั้นในเฟสนี้
>
> **ห้ามทำระบบกะกลางคืนหรือ OT ข้ามเที่ยงคืน** ถ้า `เวลาออก <= เวลาเข้า`
> ให้คืน OT = 0 พร้อม note `cross_midnight_unsupported` ห้ามเดา +1440 นาที
>
> นโยบาย OT **ชุดเดียวใช้ทั้งบริษัท** เก็บในตาราง `ot_policies` โดยมีแถวที่
> `isActive = true` ได้ทีละแถวเดียว และ **snapshot `otPolicyId` ลงทุกแถวข้อมูล**
> เพื่อให้ข้อมูลย้อนหลังอ้างอิงกฎ ณ เวลานั้นเสมอ
>
> แอดมินเลือกโหมดได้ 5 แบบ: `off` · `auto` · `request_after` · `request_before` · `admin_only`
>
> ลำดับการคำนวณต้องเป็น: กันข้ามเที่ยงคืน → เวลาดิบ (แยกวันทำงาน/วันหยุด) →
> หักพัก → ปัดเศษ → ขั้นต่ำ → เพดาน → แยกตามโหมด
> แล้วบันทึกทั้งค่าดิบและค่าที่นับได้
>
> ต้อง **ปลดบล็อกการเช็คอินในวันหยุด** ตามผังในข้อ 4 เพราะปัจจุบัน `empCheckIn`
> ปฏิเสธวันหยุดทุกกรณี ทำให้บันทึก OT วันหยุดไม่ได้เลย
>
> ทำตามข้อตกลงการเขียนโค้ดในข้อ 0 อย่างเคร่งครัด โดยเฉพาะ: ทุก RPC ผ่าน `/api/rpc`,
> ฟังก์ชันฝั่งพนักงานต้องอยู่ใน `EMPLOYEE_FNS` เพื่อให้ `applyIdentity()` เขียนทับ
> `empId` จาก session, เวลาเก็บเป็น text `'HH:mm'`, และเขตเวลาใช้ `Asia/Bangkok`
> ผ่าน helper เดิมเท่านั้น
>
> ทุกรายงานนับเฉพาะ `otStatus = 'approved'` ห้ามรวม `pending`
>
> ทำตาม Definition of Done ในข้อ 10 ให้ครบทุกข้อ

---

## ภาคผนวก — แผนแบ่งเฟส (ถ้าอยากทยอยทำ)

| ขั้น | งาน | ใช้งานได้แล้วหรือยัง |
|---|---|---|
| 1 | migration + `computeOt` + `writeCheckOut` + หน้าตั้งค่า (โหมด `auto`) | ✅ ตัวเลข OT เชื่อถือได้แล้ว |
| 2 | `ot_requests` + flow อนุมัติ + แจ้งเตือน + โหมด `request_after` / `admin_only` | ✅ มีคนรับผิดชอบ |
| 3 | ปลดล็อกวันหยุด + โหมด `request_before` | ✅ ครบทุกเคส |
| 4 | รายงาน OT + Excel | ✅ ส่งต่อระบบเงินเดือนได้ |

ขั้น 1–2 เพียงพอสำหรับใช้งานจริงแล้ว ส่วนขั้น 3 ทำต่อเมื่อบริษัทมี OT วันหยุดจริง ๆ

---

## ภาคผนวก — สิ่งที่ตัดสินใจไว้แล้ว (ไม่ต้องถามซ้ำ)

| คำถาม | คำตอบ |
|---|---|
| นโยบายผูกกับอะไร | ทั้งบริษัท 1 ชุด ทุกสาขาใช้กฎเดียวกัน |
| คิดเงินในระบบนี้ไหม | ไม่ — เก็บชั่วโมงแล้วส่งต่อระบบเงินเดือนภายนอก |
| พนักงานเห็นยอดเงินไหม | ไม่เห็น (เฟสนี้ไม่มีเงินอยู่แล้ว) |
| รองรับ OT วันหยุดไหม | รองรับ — ต้องปลดบล็อกการเช็คอินวันหยุด |
| กะกลางคืน / ข้ามเที่ยงคืน | **ไม่ทำ** — กันไว้ด้วย guard และแจ้ง error ชัดเจน |
| วันหยุดชดเชยแทนเงิน | ไม่ทำในเฟสนี้ |
