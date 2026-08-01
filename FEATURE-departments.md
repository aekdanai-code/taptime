# FEATURE — แผนก ตำแหน่งงาน และสายอนุมัติ

> เอกสารสเปกสำหรับเพิ่มระบบ **แผนก (departments)** + **หัวหน้าแผนก** เพื่อรองรับ
> การอนุมัติใบลาและคำขอแก้เวลาโดยไม่ต้องพึ่งแอดมินเพียงคนเดียว
> พร้อมบันทึกว่า **ใครเป็นผู้อนุมัติ** และแจ้งเตือนผู้เกี่ยวข้อง
>
> สถานะ: **ร่างเพื่อพิจารณา** — ยังไม่ได้ลงมือแก้โค้ด

---

## สารบัญ

1. [ปัญหาและเป้าหมาย](#1-ปัญหาและเป้าหมาย)
2. [สถานะปัจจุบันของระบบ](#2-สถานะปัจจุบันของระบบ)
3. [ภาพรวมสถาปัตยกรรมใหม่](#3-ภาพรวมสถาปัตยกรรมใหม่)
4. [Phase 0 — เปลี่ยน `position` เป็น `posId`](#phase-0--เปลี่ยน-position-เป็น-posid)
5. [Phase 1 — ตาราง `departments`](#phase-1--ตาราง-departments)
6. [Phase 2 — บันทึกผู้อนุมัติ](#phase-2--บันทึกผู้อนุมัติ)
7. [Phase 3 — ตัวตัดสินสายอนุมัติ](#phase-3--ตัวตัดสินสายอนุมัติ)
8. [Phase 4 — สิทธิ์ role `head`](#phase-4--สิทธิ์-role-head)
9. [Phase 5 — เตือนซ้ำและ escalate](#phase-5--เตือนซ้ำและ-escalate)
10. [ตารางการแจ้งเตือน](#10-ตารางการแจ้งเตือน)
11. [แผนการทดสอบ](#11-แผนการทดสอบ)
12. [ความเสี่ยงและแผนถอย](#12-ความเสี่ยงและแผนถอย)

---

## 1. ปัญหาและเป้าหมาย

### ปัญหา

| # | ปัญหา | ผลกระทบ |
|---|---|---|
| 1 | ใบลาทุกใบต้องรอแอดมินอนุมัติคนเดียว | แอดมินเป็นคอขวด ใบลาค้าง |
| 2 | ไม่รู้ว่าใครอนุมัติใบไหน | ตรวจสอบย้อนหลังไม่ได้ มีข้อพิพาทแล้วชี้แจงไม่ได้ |
| 3 | ไม่มีโครงสร้างแผนก | รายงานแยกตามหน่วยงานไม่ได้ |
| 4 | `role = 'head'` เลือกได้แต่ไม่มีผลใด ๆ | ตั้งหัวหน้าไปก็เข้าระบบไม่ได้ |
| 5 | `profiles.position` เป็นข้อความ ไม่ใช่ FK | แก้ชื่อตำแหน่ง = พนักงานหลุดตำแหน่งเงียบ ๆ |

### เป้าหมาย

- จัดโครงสร้าง สาขา → แผนก → ตำแหน่ง → พนักงาน ได้ครบ
- หัวหน้าแผนกอนุมัติใบลา/คำขอแก้เวลาของลูกน้องตัวเองได้
- ทุกการอนุมัติมีหลักฐานว่า **ใคร อนุมัติอะไร เมื่อไหร่ ในฐานะอะไร**
- แจ้งเตือนไปที่ผู้มีอำนาจตัดสินใจโดยตรง ไม่ใช่กระจายหาแอดมินทุกคน
- ไม่ทำให้ระบบเดิมพัง — พนักงานที่ยังไม่มีแผนกต้องใช้งานได้ตามปกติ

---

## 2. สถานะปัจจุบันของระบบ

### 2.1 สิ่งที่มีอยู่แล้ว

| ส่วน | สถานะ |
|---|---|
| `positions` (`posId`, `name`, `type`, `isHead`) | มี — แต่ **`isHead` ไม่ถูกอ้างที่ไหนเลย** |
| ระบบแจ้งเตือน `notifications` + `notify()` + `notifyAdmins()` | ใช้งานได้ ต่อยอดได้ทันที |
| `NotiType` 5 ชนิด | `leave_submitted`, `leave_decided`, `timeedit_submitted`, `timeedit_decided`, `absent` |
| ตาราง `checkin_audit` | มีแล้ว ใช้เป็นต้นแบบของ `approval_log` ได้ |

### 2.2 ช่องว่างที่ต้องปิด (อ้างอิงโค้ดจริง)

**ก. `role = 'head'` ถูกทิ้งตั้งแต่ตอน login**

```ts
// app/api/auth/login/route.ts:58
const role = profile.role === 'admin' ? 'admin' : 'employee';
```

ต่อให้ตั้ง `role = 'head'` ในฐานข้อมูล session ก็จะเห็นเป็น `employee` เสมอ
นี่คือเหตุผลที่ตัวเลือก "หัวหน้างาน" ในฟอร์มพนักงานไม่มีผลอะไรเลย

**ข. จุดที่เช็คสิทธิ์แบบ binary (admin / ไม่ใช่ admin)**

| ไฟล์ | บรรทัด | เนื้อหา |
|---|---|---|
| `app/admin/route.ts` | 18 | `session.role !== 'admin'` → เด้งออก |
| `app/api/rpc/route.ts` | 55 | `session.role !== 'admin'` → 401 |
| `app/employee/route.ts` | 44 | `__TAPTIME_IS_ADMIN__` |
| `lib/device.ts` | 32 | ตัดสินหน้า landing |
| `app/login/route.ts` | 16 | redirect หลัง login |

**ค. `decideLeave` / `decideTimeEdit` ไม่บันทึกผู้อนุมัติ**

```ts
// lib/api/leaves.ts:22
await updateByKey(T.LEAVES, 'reqId', reqId, {
  status: decision,
  decidedAt: nowStamp(),   // <-- ไม่มี decidedBy
});
```

**ง. `profiles.position` เป็น text**

```sql
"position" text,   -- เก็บ "พนักงานขาย" ไม่ใช่ posId
```

---

## 3. ภาพรวมสถาปัตยกรรมใหม่

```
branches (สาขา)
   └── departments (แผนก)          ← ใหม่
          ├── headEmpId            ← หัวหน้าแผนก
          ├── deputyHeadEmpId      ← รองหัวหน้า / รักษาการ
          └── parentDeptId         ← ฝ่าย > แผนก > ทีม
                 │
profiles (พนักงาน)
   ├── branchId                    (มีอยู่แล้ว)
   ├── deptId                      ← ใหม่
   ├── posId                       ← เปลี่ยนจาก position (text)
   └── managerEmpId                ← ใหม่ — override สายอนุมัติรายคน

leave_requests / time_edit_requests
   ├── decidedBy / decidedByName / decidedByRole / decisionNote   ← ใหม่
   └── approval_log (ตารางแยก)                                    ← ใหม่
```

**หลักการที่ยึด**

1. **ผูกแผนกที่ `profiles` ไม่ใช่ที่ `positions`** — ตำแหน่งเดียวกันอยู่ได้หลายแผนก/สาขา และคนย้ายแผนกได้โดยไม่เปลี่ยนตำแหน่ง
2. **ไม่ลบข้อมูลอ้างอิง** — แผนก/ตำแหน่งใช้ `status` แทนการลบ เพราะมีประวัติผูกอยู่
3. **Fallback เสมอ** — ไม่มีแผนก/ไม่มีหัวหน้า → ตกไปที่แอดมิน ห้ามค้างเงียบ
4. **แอดมิน override ได้ทุกกรณี**

---

## Phase 0 — เปลี่ยน `position` เป็น `posId`

> **ทำก่อนทุกอย่าง** เพราะเป็น breaking change ที่ต้องย้ายข้อมูล
> และ Phase อื่นต้องอ้าง `posId` เป็นฐาน

### 0.1 กลยุทธ์ที่เลือก — เก็บ `position` ไว้เป็น "ชื่อสำหรับแสดงผล"

แทนที่จะไล่แก้ทุกจุดที่อ่าน `e.position` ให้ทำแบบเดียวกับที่ระบบทำกับ `branchName` อยู่แล้ว

```ts
// lib/api/employees.ts — listEmployees() ปัจจุบันทำแบบนี้กับสาขาอยู่แล้ว
e.branchName = branches[e.branchId] || '';
```

**ทำแบบเดียวกันกับตำแหน่ง:**

- `posId` = แหล่งความจริงในฐานข้อมูล
- `listEmployees()` / `employeeContext()` / `dailyReport()` เติม `e.position` = ชื่อตำแหน่งจาก join ให้อัตโนมัติ
- **ฝั่ง frontend แทบไม่ต้องแก้** — ยังอ่าน `e.position` เพื่อแสดงผลเหมือนเดิม
- แก้เฉพาะ **ฟอร์มบันทึก** ให้ส่ง `posId` แทนชื่อ

ข้อดี — ลดจุดที่ต้องแก้จาก 10+ จุด เหลือ 3 จุด และ rollback ง่าย

### 0.2 SQL — `supabase/migration-005-positions-fk.sql`

```sql
-- ============================================================================
-- Migration 005 — profiles.position (text) -> profiles.posId (FK)
--
-- รันทีละขั้น อย่ารันรวดเดียว — ขั้นที่ 3 ต้องดูผลก่อนไปต่อ
-- ============================================================================

------------------------------------------------------------------------------
-- ขั้นที่ 1: เพิ่มคอลัมน์ใหม่ (ยังไม่ใส่ FK)
------------------------------------------------------------------------------
alter table profiles add column if not exists "posId" text;

------------------------------------------------------------------------------
-- ขั้นที่ 2: สร้างตำแหน่งที่มีในข้อมูลพนักงานแต่ยังไม่มีในตาราง positions
--            (กันข้อมูลหายกรณีมีการพิมพ์ชื่อตำแหน่งเองในอดีต)
------------------------------------------------------------------------------
insert into positions ("posId", "name", "type", "isHead")
select
  'PS-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  d."posName",
  'พนักงานทั่วไป',
  false
from (
  select distinct btrim("position") as "posName"
  from profiles
  where "position" is not null and btrim("position") <> ''
) d
where not exists (
  select 1 from positions ps
  where lower(btrim(ps."name")) = lower(d."posName")
);

------------------------------------------------------------------------------
-- ขั้นที่ 3: จับคู่ชื่อตำแหน่ง -> posId
------------------------------------------------------------------------------
update profiles p
set "posId" = ps."posId"
from positions ps
where p."posId" is null
  and p."position" is not null
  and lower(btrim(p."position")) = lower(btrim(ps."name"));

------------------------------------------------------------------------------
-- ขั้นที่ 3.5: ⚠️ ตรวจก่อนไปต่อ — ต้องได้ 0 แถว
--             ถ้ามีแถวออกมา แปลว่ายังจับคู่ไม่ได้ ให้แก้ข้อมูลก่อน
------------------------------------------------------------------------------
select p."empId", p."name", p."position"
from profiles p
where p."position" is not null
  and btrim(p."position") <> ''
  and p."posId" is null;

------------------------------------------------------------------------------
-- ขั้นที่ 4: ใส่ FK + index
------------------------------------------------------------------------------
alter table profiles
  drop constraint if exists profiles_pos_fk;

alter table profiles
  add constraint profiles_pos_fk
  foreign key ("posId") references positions("posId") on delete set null;

create index if not exists profiles_pos_idx on profiles("posId");

------------------------------------------------------------------------------
-- ขั้นที่ 5: ฟิลด์เสริมของ positions ที่ Phase ถัดไปต้องใช้
------------------------------------------------------------------------------
alter table positions add column if not exists "code"   text;
alter table positions add column if not exists "level"  integer default 1;
alter table positions add column if not exists "status" text    default 'active';

comment on column positions."level"  is
  'ระดับตำแหน่ง 1-10 — ใช้เรียงลำดับ และตรวจว่าหัวหน้าควรมี level สูงกว่าลูกน้อง';
comment on column positions."isHead" is
  'true = เป็นตำแหน่งระดับหัวหน้า (ใช้กรองรายชื่อตอนตั้งหัวหน้าแผนก)';

------------------------------------------------------------------------------
-- ขั้นที่ 6: คอลัมน์เดิม — ยังไม่ลบ
--            เก็บไว้อย่างน้อย 1 เดือนเผื่อต้องถอย แล้วค่อยรัน migration ปิดท้าย
------------------------------------------------------------------------------
comment on column profiles."position" is
  'DEPRECATED — ใช้ posId แทน คงไว้ชั่วคราวเพื่อ rollback (ลบได้หลัง 2026-09)';
```

### 0.3 จุดที่ต้องแก้ในโค้ด

| # | ไฟล์ | บรรทัด | แก้เป็น |
|---|---|---|---|
| 1 | `lib/api/employees.ts` | `listEmployees()` | เพิ่ม join `positions` แล้วเติม `e.position` = ชื่อ, ส่ง `e.posId` ไปด้วย |
| 2 | `lib/api/employees.ts` | `saveEmployee()` | รับ `posId`; ถ้ามี `position` (ของเก่า) ให้แปลงเป็น `posId` แล้วทิ้ง |
| 3 | `lib/api/employeeApi.ts` | 134 | `position:` ดึงชื่อจาก join แทน `emp.position` |
| 4 | `lib/api/reports.ts` | 201 | เหมือนข้อ 3 |
| 5 | `src/frontend-admin/AdminEmployees.html` | 284 | `posOptions()` ส่ง `value = posId` (ตอนนี้ส่งชื่อ) |
| 6 | `src/frontend-admin/AdminEmployees.html` | 391 | `posId: $('e_pos').value` |
| 7 | `src/frontend-admin/AdminEmployees.html` | 24 | ตัวกรองเทียบด้วย `posId` |
| 8 | `src/frontend-admin/AdminCore.html` | 54 | `posOptions()` เปลี่ยนเป็น `opt2` (value/label) |

**ไม่ต้องแก้** — `AdminDaily.html:55`, `EmployeeCore.html:170`, `AdminSettings.html:232,245`
เพราะยังอ่าน `.position` ที่ backend เติมชื่อให้แล้ว

### 0.4 ทดสอบ

- [ ] `listEmployees()` คืนทั้ง `posId` และ `position` (ชื่อ) ครบทุกแถว
- [ ] แก้ชื่อตำแหน่งใน "ตั้งค่า" แล้ว **พนักงานยังอยู่ตำแหน่งเดิม** (เดิมจะหลุด)
- [ ] ลบตำแหน่งที่มีพนักงานใช้อยู่ → `posId` เป็น null ไม่ error
- [ ] พนักงานที่ `posId` เป็น null แสดงผลเป็นค่าว่าง ไม่พัง
- [ ] เพิ่ม/แก้พนักงานผ่านฟอร์ม แล้วตำแหน่งบันทึกถูก
- [ ] `dailyReport` / `employeeContext` ยังโชว์ชื่อตำแหน่งเหมือนเดิม

### 0.5 แผนถอย

`position` ยังอยู่ครบและไม่ถูกแก้ ถ้าต้องถอย — revert โค้ด แล้ว
`alter table profiles drop constraint profiles_pos_fk;` เท่านั้น ข้อมูลไม่หาย

---

## Phase 1 — ตาราง `departments`

### 1.1 SQL — `supabase/migration-006-departments.sql`

```sql
-- ============================================================================
-- Migration 006 — แผนก + หัวหน้าแผนก
-- ============================================================================

create table if not exists departments (
  "deptId"            text primary key,
  "code"              text,                       -- SALES, HR, OPS
  "name"              text not null,
  "branchId"          text references branches("branchId") on delete set null,
  "parentDeptId"      text references departments("deptId") on delete set null,

  -- สายอนุมัติ
  "headEmpId"         text,                       -- หัวหน้าแผนก
  "deputyHeadEmpId"   text,                       -- รองหัวหน้า / รักษาการ
  "approvalMode"      text default 'head',        -- head | admin | head_then_admin

  -- คุมพฤติกรรม
  "autoEscalateDays"  integer default 3,          -- ไม่ตอบกี่วันแล้วส่งต่อแอดมิน
  "status"            text default 'active',      -- active | inactive
  "note"              text,
  "createdAt"         timestamptz default now()
);

create index if not exists dept_branch_idx on departments("branchId");
create index if not exists dept_head_idx   on departments("headEmpId");
create index if not exists dept_parent_idx on departments("parentDeptId");

comment on column departments."branchId" is
  'null = แผนกส่วนกลาง ครอบทุกสาขา (เช่น HR, บัญชี)';
comment on column departments."deputyHeadEmpId" is
  'ใช้เมื่อหัวหน้าลาหรือ inactive — ถ้าไม่มีจะตกไปที่แอดมิน';
comment on column departments."approvalMode" is
  'head = หัวหน้าอนุมัติจบ | admin = แอดมินเท่านั้น | head_then_admin = สองขั้น';

------------------------------------------------------------------------------
-- profiles: ผูกแผนก + หัวหน้าโดยตรง
------------------------------------------------------------------------------
alter table profiles add column if not exists "deptId"       text;
alter table profiles add column if not exists "managerEmpId" text;

alter table profiles
  drop constraint if exists profiles_dept_fk;
alter table profiles
  add constraint profiles_dept_fk
  foreign key ("deptId") references departments("deptId") on delete set null;

create index if not exists profiles_dept_idx    on profiles("deptId");
create index if not exists profiles_manager_idx on profiles("managerEmpId");

comment on column profiles."managerEmpId" is
  'หัวหน้าโดยตรง — มีค่าเมื่อไรจะใช้ก่อน headEmpId ของแผนก (เคสพิเศษ)';

------------------------------------------------------------------------------
-- FK ของหัวหน้า: ใส่ทีหลังเพราะ departments กับ profiles อ้างกันไปมา
------------------------------------------------------------------------------
alter table departments
  drop constraint if exists dept_head_fk,
  drop constraint if exists dept_deputy_fk;

alter table departments
  add constraint dept_head_fk
    foreign key ("headEmpId") references profiles("empId") on delete set null,
  add constraint dept_deputy_fk
    foreign key ("deputyHeadEmpId") references profiles("empId") on delete set null;

alter table profiles
  drop constraint if exists profiles_manager_fk;
alter table profiles
  add constraint profiles_manager_fk
  foreign key ("managerEmpId") references profiles("empId") on delete set null;

alter table departments enable row level security;
```

### 1.2 กติกาความถูกต้อง (บังคับที่ชั้น API ไม่ใช่ DB)

| กติกา | เหตุผล |
|---|---|
| หัวหน้าแผนกต้องเป็นพนักงาน `status = active` | กันตั้งคนที่ลาออกแล้ว |
| หัวหน้าแผนกควรอยู่แผนกนั้นหรือแผนกแม่ | กันตั้งข้ามสายงานโดยไม่ตั้งใจ (เตือน ไม่บล็อก) |
| `headEmpId ≠ deputyHeadEmpId` | ไม่งั้นไม่มีตัวสำรองจริง |
| `parentDeptId` ห้ามวนซ้ำ | กัน infinite loop ตอนไล่สายขึ้น |
| แผนกที่มีพนักงานอยู่ ห้ามลบ | ให้ตั้ง `status = inactive` แทน |

### 1.3 UI ที่ต้องเพิ่ม

**เมนูใหม่: "แผนก"** (วางไว้ใต้ "ธุรกิจ / สาขา / ตำแหน่ง")

- ตารางรายการแผนก: ชื่อ · รหัส · สาขา · หัวหน้า · รองหัวหน้า · จำนวนพนักงาน · สถานะ
- ฟอร์มเพิ่ม/แก้ไข พร้อม dropdown เลือกหัวหน้า
  (กรองเฉพาะพนักงาน active และ **แนะนำคนที่ `positions.isHead = true` ขึ้นก่อน**)
- แสดงผังต้นไม้ถ้ามี `parentDeptId`

**ฟอร์มพนักงาน** — เพิ่ม dropdown "แผนก" ในหมวด *ข้อมูลการจ้างงาน*
และช่อง "หัวหน้าโดยตรง" (ไม่บังคับ) ในหมวด *การเข้าใช้ระบบ*

**ตัวกรองพนักงาน** — เพิ่ม "ทุกแผนก" ต่อจากตัวกรองสาขา

---

## Phase 2 — บันทึกผู้อนุมัติ

### 2.1 SQL — `supabase/migration-007-approvals.sql`

```sql
-- ============================================================================
-- Migration 007 — บันทึกผู้อนุมัติ + ประวัติการอนุมัติ
-- ============================================================================

------------------------------------------------------------------------------
-- สถานะล่าสุด (denormalized — อ่านเร็ว ใช้แสดงในตาราง)
------------------------------------------------------------------------------
alter table leave_requests add column if not exists "decidedBy"     text;
alter table leave_requests add column if not exists "decidedByName" text;
alter table leave_requests add column if not exists "decidedByRole" text;
alter table leave_requests add column if not exists "decisionNote"  text;
alter table leave_requests add column if not exists "assignedTo"    text;

alter table time_edit_requests add column if not exists "decidedBy"     text;
alter table time_edit_requests add column if not exists "decidedByName" text;
alter table time_edit_requests add column if not exists "decidedByRole" text;
alter table time_edit_requests add column if not exists "decisionNote"  text;
alter table time_edit_requests add column if not exists "assignedTo"    text;

comment on column leave_requests."decidedByName" is
  'snapshot ชื่อผู้อนุมัติ ณ เวลานั้น — กันชื่อหายเมื่อผู้อนุมัติลาออก';
comment on column leave_requests."decidedByRole" is
  'อนุมัติในฐานะอะไร: head | admin — สำคัญตอนตรวจสอบย้อนหลัง';
comment on column leave_requests."assignedTo" is
  'empId ของผู้ที่ระบบมอบหมายให้อนุมัติ (ใช้กรองรายการ + เตือนซ้ำ)';

------------------------------------------------------------------------------
-- ประวัติทุกก้าว — ห้ามลบ ห้ามแก้
------------------------------------------------------------------------------
create table if not exists approval_log (
  "logId"        bigserial primary key,
  "refType"      text not null,      -- leave | timeedit
  "refId"        text not null,      -- reqId / editId
  "action"       text not null,      -- submitted | approved | rejected
                                     -- | cancelled | reassigned | escalated
  "actorId"      text,               -- ผู้กระทำ (null = ระบบทำเอง เช่น escalate)
  "actorName"    text,               -- snapshot
  "actorRole"    text,               -- employee | head | admin | system
  "note"         text,
  "at"           timestamptz default now()
);

create index if not exists approval_log_ref_idx
  on approval_log("refType", "refId", "at");
create index if not exists approval_log_actor_idx
  on approval_log("actorId", "at" desc);

alter table approval_log enable row level security;
```

### 2.2 ทำไมต้องมีทั้งสองอย่าง

| | คอลัมน์ใน request | `approval_log` |
|---|---|---|
| ใช้ทำอะไร | แสดงในตาราง/รายงาน | ตรวจสอบย้อนหลัง |
| ความเร็ว | เร็ว (ไม่ต้อง join) | ช้ากว่า |
| เก็บอะไร | สถานะล่าสุดเท่านั้น | ทุกก้าว รวมที่ถูกยกเลิก |
| แก้ได้ไหม | ได้ (overwrite) | **ห้ามแก้** |

เรื่องวันลาเป็นข้อมูลที่มีข้อพิพาทได้จริง การมี log ที่แก้ไม่ได้จึงคุ้มกับต้นทุนที่เพิ่ม

### 2.3 จุดที่ต้องแก้

| ไฟล์ | แก้อะไร |
|---|---|
| `lib/api/leaves.ts` → `decideLeave()` | รับ `actor` จาก session, เขียน `decidedBy*`, เขียน `approval_log`, รับ `note` |
| `lib/api/timeEdits.ts` → `decideTimeEdit()` | เหมือนกัน |
| `lib/api/employeeApi.ts` → `empSubmitLeave()` | เขียน `approval_log` action `submitted` + set `assignedTo` |
| `lib/api/timeEdits.ts` → `empSubmitTimeEdit()` | เหมือนกัน |
| `app/api/rpc/route.ts` | ส่ง session actor เข้าฟังก์ชัน decide* |
| `src/frontend-admin/AdminLeaves.html` | แสดง "อนุมัติโดย ... เมื่อ ..." + ช่องกรอกเหตุผลตอนปฏิเสธ |
| `src/frontend-admin/AdminTimeEdits.html` | เหมือนกัน |
| `src/frontend-employee/EmployeeLeave.html` | พนักงานเห็นว่าใครอนุมัติ + เหตุผลที่ปฏิเสธ |

> **หมายเหตุการออกแบบ:** `decideLeave` ปัจจุบันรับแค่ `(reqId, decision)`
> ต้องเพิ่มเป็น `(reqId, decision, note)` และดึง actor จาก session ฝั่งเซิร์ฟเวอร์
> **ห้ามให้ client ส่ง actorId มาเอง** ตามหลักเดียวกับ `applyIdentity()` ที่ใช้อยู่

---

## Phase 3 — ตัวตัดสินสายอนุมัติ

### 3.1 `lib/api/approvals.ts` (ไฟล์ใหม่)

```ts
export type Approver = {
  empId: string;
  name: string;
  role: 'head' | 'admin';
  reason: string;   // เหตุผลที่ได้สิทธิ์ — ใช้ debug และแสดงใน UI
};

/**
 * หาผู้มีสิทธิ์อนุมัติของพนักงาน 1 คน
 * คืน array เพราะบางกรณีมีได้หลายคน (แอดมินหลายคน)
 */
export async function approversFor(
  empId: string,
  type: 'leave' | 'timeedit'
): Promise<Approver[]>;
```

### 3.2 ลำดับการตัดสิน

```
1. profiles.managerEmpId มีค่า และคนนั้น active
       -> [manager]

2. หา dept ของพนักงาน
   2.1 dept.approvalMode = 'admin'        -> [admins]
   2.2 dept.headEmpId = ผู้ยื่นเอง         -> ขึ้นไป parentDept.headEmpId
                                              ถ้าไม่มี -> [admins]
   2.3 dept.headEmpId active และไม่ลาวันนี้ -> [head]
   2.4 หัวหน้าลา/inactive                  -> [deputyHead] ถ้ามี
   2.5 ไม่มีใครเลย                         -> [admins]

3. ไม่มี dept                              -> [admins]

* approvalMode = 'head_then_admin' -> คืน head ก่อน อนุมัติแล้วค่อยส่งต่อ admin
* แอดมินอนุมัติแทนได้เสมอทุกกรณี (ไม่ผ่าน resolver)
```

### 3.3 เคสที่ต้องเขียนเทสต์ให้ครบ

| เคส | ผลที่ถูก |
|---|---|
| พนักงานปกติ มีแผนก มีหัวหน้า | หัวหน้าแผนก |
| หัวหน้าแผนกยื่นลาเอง | หัวหน้าแผนกแม่ ถ้าไม่มี → แอดมิน |
| หัวหน้าลาอยู่วันที่ยื่น | รองหัวหน้า |
| หัวหน้าและรองหัวหน้าลาพร้อมกัน | แอดมิน |
| หัวหน้าถูกตั้ง `status = inactive` | รองหัวหน้า → แอดมิน |
| พนักงานไม่มีแผนก | แอดมิน |
| แผนกไม่มีหัวหน้า | แอดมิน |
| มี `managerEmpId` ระบุไว้ | คนนั้นก่อนเสมอ |
| `managerEmpId` = ตัวเอง | ข้าม → ไปตามสายแผนก |
| แผนกวนลูป (A→B→A) | ต้องไม่ค้าง มีตัวนับความลึกสูงสุด |

---

## Phase 4 — สิทธิ์ role `head`

> **Phase ที่กระทบโค้ดมากที่สุด — ควรกันเวลาไว้มากกว่าที่ประเมิน**

### 4.1 แก้ที่ชั้น session ก่อน

```ts
// app/api/auth/login/route.ts — ของเดิมยุบ head ทิ้ง
const role = profile.role === 'admin' ? 'admin' : 'employee';

// ต้องเป็น
const role = ['admin', 'head'].includes(profile.role) ? profile.role : 'employee';
```

แล้วไล่แก้จุดที่เช็ค `role === 'admin'` ทั้ง 5 จุดในตาราง 2.2

### 4.2 แยกกลุ่มสิทธิ์ใน `lib/rpc.ts`

```ts
/** หัวหน้าเรียกได้ แต่ต้องผ่าน scope filter */
export const HEAD_FNS = new Set([
  'adminBootstrap',
  'listLeaves', 'decideLeave',
  'listTimeEdits', 'decideTimeEdit',
  'listEmployees',        // เฉพาะลูกน้อง
  'dailyReport', 'monthlyReport',
  'listNotifications', 'markNotificationRead',
]);
```

### 4.3 Scope filter — จุดที่พลาดง่ายที่สุด

**ซ่อนเมนูอย่างเดียวไม่พอ** เพราะยิง `/api/rpc` ตรงก็ยังได้ข้อมูลทั้งบริษัท
ต้องกรองที่ query ทุกตัว

```ts
/** empId ทั้งหมดที่ผู้ใช้คนนี้ดูได้ — null = ดูได้ทุกคน (แอดมิน) */
export async function visibleEmpIds(session): Promise<string[] | null> {
  if (session.role === 'admin') return null;
  if (session.role !== 'head')  return [session.empId];

  // หัวหน้า: ลูกน้องในแผนกที่ตัวเองเป็นหัวหน้า/รองหัวหน้า (รวมแผนกลูก)
  // + คนที่ระบุ managerEmpId = ตัวเอง
}
```

แล้วเอาไปใช้กับ `listLeaves`, `listTimeEdits`, `listEmployees`, `dailyReport`,
`monthlyReport`, `adminDashboard`

### 4.4 ตรวจสิทธิ์ตอนอนุมัติ

`decideLeave()` ต้องเช็คว่า actor อยู่ใน `approversFor(ownerEmpId)` จริง
หรือเป็นแอดมิน **ไม่ใช่แค่เช็คว่า role เป็น head** ไม่งั้นหัวหน้าแผนก A
อนุมัติใบลาของแผนก B ได้

### 4.5 UI

- sidebar ซ่อนเมนูที่หัวหน้าไม่มีสิทธิ์ (พนักงาน / ตั้งค่า / วันหยุด / ประเภทลา)
- หัวข้อหน้าเปลี่ยนเป็น "ใบลาของแผนก ..." ให้ชัดว่าเห็นแค่ขอบเขตตัวเอง
- `lib/device.ts` — หัวหน้าบนเดสก์ท็อปควรไป `/admin` เหมือนแอดมิน

---

## Phase 5 — เตือนซ้ำและ escalate

### 5.1 Cron รายวัน (ต่อจาก `vercel.json` ที่มีอยู่)

```
ทุกวัน 09:00 น. (Asia/Bangkok)
  หาใบลา / คำขอแก้เวลา ที่ status = 'pending'
    ├── ค้างเกิน 1 วัน            -> เตือนผู้อนุมัติซ้ำ
    ├── ค้างเกิน dept.autoEscalateDays -> เพิ่มแอดมินเป็นผู้อนุมัติ
    │                                     + เขียน approval_log action 'escalated'
    └── ค้างเกิน 7 วัน            -> แจ้งแอดมินว่ามีใบค้างผิดปกติ
```

### 5.2 ระวังเรื่อง idempotency

Cron อาจถูกเรียกซ้ำ ต้องไม่ส่งแจ้งเตือนซ้ำในวันเดียวกัน
เช็คจาก `approval_log` ว่ามี action `escalated` ของ refId นั้นแล้วหรือยัง

---

## 10. ตารางการแจ้งเตือน

`NotiType` ที่ต้องเพิ่มจากของเดิม 5 ชนิด

| เหตุการณ์ | ผู้รับ | NotiType | มีอยู่แล้ว |
|---|---|---|---|
| ยื่นใบลา | **ผู้อนุมัติที่ resolver คืนมา** (เดิม = แอดมินทุกคน) | `leave_submitted` | ✓ แก้ผู้รับ |
| อนุมัติ/ปฏิเสธใบลา | ผู้ยื่น | `leave_decided` | ✓ |
| ยื่นคำขอแก้เวลา | ผู้อนุมัติ | `timeedit_submitted` | ✓ แก้ผู้รับ |
| อนุมัติ/ปฏิเสธคำขอแก้เวลา | ผู้ยื่น | `timeedit_decided` | ✓ |
| ค้างเกินกำหนด | ผู้อนุมัติ | `approval_overdue` | ใหม่ |
| ส่งต่อให้แอดมิน | แอดมิน + ผู้อนุมัติเดิม | `approval_escalated` | ใหม่ |
| ถูกตั้งเป็นหัวหน้าแผนก | คนใหม่ + คนเก่า + แอดมิน | `dept_head_changed` | ใหม่ |
| เริ่มรักษาการแทนหัวหน้า | รองหัวหน้า | `acting_head` | ใหม่ |

`TAB_OF` ต้องเพิ่ม mapping ของ 4 ชนิดใหม่ด้วย

### หลักการที่ต้องรักษา

**การแจ้งเตือนล้มต้องไม่ทำให้การยื่นลาล้ม** — `notify()` ปัจจุบันครอบ try/catch
และคืน 0 เมื่อพลาด ซึ่งถูกแล้ว ให้รักษาแพตเทิร์นนี้ในทุกจุดที่เพิ่ม

---

## 11. แผนการทดสอบ

### 11.1 ต่อจากชุดทดสอบเดิม (`npm test`)

| กลุ่ม | จำนวนโดยประมาณ |
|---|---|
| `posId` migration + join ชื่อตำแหน่ง | 6 |
| `approversFor()` ทุกเคสในตาราง 3.3 | 10 |
| `visibleEmpIds()` — หัวหน้าเห็นเฉพาะลูกน้อง | 6 |
| `decideLeave` เขียน `decidedBy` + `approval_log` | 5 |
| หัวหน้าแผนก A อนุมัติใบของแผนก B → ต้องถูกปฏิเสธ | 2 |
| escalate ไม่ส่งซ้ำ (idempotent) | 3 |
| แจ้งเตือนไปถึงคนที่ถูกต้อง | 4 |

ต้องอัปเดต `test/fixture.json` เพิ่ม `departments` + `approval_log`
และ `test/fake-supabase.js` เพิ่ม `AUTO_ID` ของ `approval_log`

### 11.2 ทดสอบด้วยมือก่อนใช้จริง

- [ ] หัวหน้า login บนเดสก์ท็อป → เข้า `/admin` เห็นเฉพาะเมนูที่ควรเห็น
- [ ] หัวหน้าเห็นเฉพาะใบลาของลูกน้องตัวเอง
- [ ] ยิง `/api/rpc` ตรงด้วย session ของหัวหน้า ขอ `listEmployees` → ได้เฉพาะลูกน้อง
- [ ] หัวหน้ายื่นลาเอง → ใบไปหาหัวหน้าแผนกแม่/แอดมิน ไม่ใช่ตัวเอง
- [ ] แอดมินยังอนุมัติแทนได้ทุกใบ
- [ ] พนักงานที่ยังไม่มีแผนก → ใบลาไปหาแอดมิน ใช้งานได้ปกติ

---

## 12. ความเสี่ยงและแผนถอย

| ความเสี่ยง | ระดับ | การรับมือ |
|---|---|---|
| Migration `posId` จับคู่ชื่อไม่ครบ | **สูง** | ขั้นที่ 3.5 บังคับตรวจก่อนไปต่อ + สร้างตำแหน่งที่ขาดอัตโนมัติ |
| Scope filter หลุดบาง endpoint → ข้อมูลรั่วข้ามแผนก | **สูง** | เทสต์ยิง API ตรงทุกตัว ไม่ใช่ทดสอบผ่าน UI |
| หัวหน้าลาออก แผนกไม่มีคนอนุมัติ | กลาง | fallback แอดมิน + แจ้งเตือนตอนตั้ง `status = inactive` |
| `parentDeptId` วนลูป | กลาง | จำกัดความลึก + ตรวจตอนบันทึก |
| Escalate ส่งซ้ำทุกวัน | ต่ำ | เช็ค `approval_log` ก่อนส่ง |
| ใบลาเก่าไม่มี `decidedBy` | ต่ำ | แสดงเป็น "ไม่ระบุ (ก่อนใช้ระบบใหม่)" |

### ลำดับ deploy ที่ปลอดภัย

```
1. รัน migration 005 (posId)           -> deploy code Phase 0 -> ทดสอบ 1 สัปดาห์
2. รัน migration 006 (departments)     -> deploy UI จัดการแผนก -> ให้แอดมินกรอกข้อมูล
3. รัน migration 007 (approvals)       -> deploy Phase 2       -> ตรวจว่า log ครบ
4. deploy Phase 3 (resolver)           -> แจ้งเตือนเปลี่ยนปลายทาง
5. deploy Phase 4 (สิทธิ์ head)         -> เปิดให้หัวหน้าใช้จริง
6. deploy Phase 5 (escalate)
```

**อย่ารวบ Phase 4 กับ Phase อื่น** — เป็นจุดที่ผิดพลาดแล้วข้อมูลรั่วข้ามแผนก
ควร deploy เดี่ยวและทดสอบเต็มที่

### ประมาณการเวลา

| Phase | งาน | ประมาณการ |
|---|---|---|
| 0 | posId migration | 0.5 วัน |
| 1 | departments + UI | 1–1.5 วัน |
| 2 | approval log | 0.5–1 วัน |
| 3 | resolver + แจ้งเตือน | 1 วัน |
| 4 | สิทธิ์ head + scope | **2–3 วัน** |
| 5 | escalate | 0.5 วัน |
| | **รวม** | **5.5–7.5 วัน** |

---

## ภาคผนวก — คำถามที่ต้องตัดสินใจก่อนเริ่ม

1. **หนึ่งคนอยู่ได้กี่แผนก?** สเปกนี้ออกแบบไว้ที่ 1 คน = 1 แผนก
   ถ้าต้องรองรับหลายแผนก ต้องเปลี่ยนเป็นตาราง `employee_departments` (many-to-many)
2. **แผนกข้ามสาขาได้ไหม?** สเปกนี้ให้ `branchId = null` แทนแผนกส่วนกลาง
3. **ต้องการอนุมัติ 2 ขั้น (หัวหน้า → HR) เลยไหม?** โครงสร้างรองรับแล้วผ่าน
   `approvalMode = 'head_then_admin'` แต่ UI ยังไม่ได้ออกแบบ
4. **หัวหน้าดูรายงานย้อนหลังของลูกน้องได้แค่ไหน?** ทั้งหมด หรือเฉพาะช่วงที่อยู่แผนกเดียวกัน
5. **`positions.type`** ปัจจุบันเก็บ "พนักงานทั่วไป" — จะยุบรวมกับ `level` ไหม
