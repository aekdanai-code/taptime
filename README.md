# TapTime V2 — Web App (Next.js + Supabase)

ระบบลงเวลาเข้า-ออกงานด้วย GPS — แปลงมาจาก **Google Apps Script + Google Sheets** (V1.1)
มาเป็นเว็บแอปจริงที่รันบน **Next.js + Supabase (PostgreSQL) + Vercel**

> **ตอนย้ายระบบ UI ถูกยกมาทั้งดุ้นโดยไม่แก้แม้แต่บรรทัดเดียว**
> ต่อมาจึงมีการปรับหน้าจอตามที่ร้องขอเพิ่มเติม (ดูข้อ 4.7)
> โครงสร้างการเชื่อมต่อยังเป็นแบบเดิม — ดู [ทำอย่างไรถึงไม่ต้องแก้ UI](#5-ทำอย่างไรถึงไม่ต้องแก้-ui)

---

## 1. โครงสร้างโปรเจกต์

```
taptime-web/
├── app/                          Next.js App Router
│   ├── route.ts                  GET /            router (แทน doGet)
│   ├── admin/route.ts            GET /admin       (admin + เดสก์ท็อป)
│   ├── employee/route.ts         GET /employee    (ต้อง login)
│   ├── login/route.ts            GET /login
│   ├── set-password/route.ts     GET /set-password (จากอีเมลเชิญ)
│   └── api/
│       ├── rpc/route.ts          POST /api/rpc    <- แทน google.script.run
│       ├── auth/login|logout/    เข้า/ออกจากระบบ
│       └── webauthn/             ผูกอุปกรณ์ / ยืนยันตัวตน (passkey)
│
├── lib/
│   ├── db.ts                     ชั้นเข้าถึง Supabase (แทน readObjects/appendObject...)
│   ├── helpers.ts                พอร์ตจาก Helpers.gs (เวลา/GPS/normalizer)
│   ├── rpc.ts                    ทะเบียนฟังก์ชัน + สิทธิ์ + เขียนทับตัวตน
│   ├── session.ts                session cookie (HMAC) + remember me
│   ├── webauthn.ts               passkey / biometric
│   ├── device.ts                 แยก desktop / mobile
│   ├── page.ts                   อ่าน HTML จาก generated/
│   └── api/                      พอร์ต backend เดิมทั้ง 12 ไฟล์ .gs
│       ├── config.ts             <- Config.gs
│       ├── dashboard.ts          <- Dashboard.gs
│       ├── employees.ts          <- Employees.gs
│       ├── attendance.ts         <- Attendance.gs
│       ├── employeeApi.ts        <- EmployeeApi.gs
│       ├── leaves.ts             <- Leaves.gs
│       ├── timeEdits.ts          <- TimeEdits.gs
│       ├── holidays.ts           <- Holidays.gs
│       ├── settings.ts           <- Settings.gs
│       ├── reports.ts            <- Reports.gs
│       ├── invite.ts             อีเมลเชิญตั้งรหัสผ่าน (ของใหม่)
│       ├── leaveAssign.ts        สิทธิ์การลารายคน + โควตาเฉพาะราย (ของใหม่)
│       └── notifications.ts      แจ้งเตือนในแอป (ของใหม่)
│
├── src/                          ไฟล์ frontend (HTML/CSS/JS แบบเดิม)
│   ├── frontend-admin/           Admin*.html  (11 ไฟล์)
│   ├── frontend-employee/        Employee*.html (6 ไฟล์)
│   ├── shim.html                 สะพาน google.script.run -> /api/rpc + กันกดซ้ำ
│   └── notify.html               กระดิ่งแจ้งเตือน + badge + เสียง
│
├── generated/                    HTML ที่ประกอบแล้ว (สร้างอัตโนมัติ, ไม่ commit)
│
├── public/                       ไฟล์ static (ไอคอน / manifest)
├── assets/logo-source.png        โลโก้ต้นฉบับความละเอียดสูง
│
├── scripts/
│   ├── build-html.mjs            ประกอบ include() -> generated/*.html
│   ├── make-icons.py             สร้างชุดไอคอน/favicon จากโลโก้
│   ├── xlsx-to-sql.py            แปลง TapTime.xlsx -> supabase/seed.sql
│   └── create-admin.mjs          สร้างบัญชีผู้ดูแลระบบคนแรก
│
├── test/                         ชุดทดสอบ (npm test)
│
└── supabase/
    ├── schema.sql                โครงสร้างตาราง 11 ตาราง
    ├── seed.sql                  ข้อมูลเดิมจาก TapTime.xlsx
    ├── migration-002-*.sql       passkey + audit log
    ├── migration-003-*.sql       ฟิลด์พนักงานใหม่ + สิทธิ์การลารายคน
    └── migration-004-*.sql       แจ้งเตือน + เกณฑ์หักเวลาพัก
```

---

## 2. แผนที่ฐานข้อมูล: ชีต -> ตาราง

| ชีตเดิม (Google Sheets) | ตารางใหม่ (PostgreSQL) | หมายเหตุ |
|---|---|---|
| `Config`           | `config`             | key-value |
| `Branches`         | `branches`           | เพิ่ม `breakAfterHours` |
| `Positions`        | `positions`          | |
| `LeaveTypes`       | `leave_types`        | เพิ่ม `showQuota`, `assignAll` |
| **`Employees`**    | **`profiles`**       | เพิ่ม `authUserId`, `webauthnExempt`, `nickname`, `nationality`, `invitedAt`, `lastLoginAt` |
| `Attendance`       | `attendance`         | เพิ่ม unique (`empId`,`date`) |
| `LeaveRequests`    | `leave_requests`     | |
| `Holidays`         | `holidays`           | |
| `TimeEditRequests` | `time_edit_requests` | |
| *(ใหม่)* | `webauthn_credentials` | passkey ที่ผูกกับพนักงานแต่ละคน |
| *(ใหม่)* | `checkin_audit` | หลักฐานทุกครั้งที่พยายามลงเวลา |
| *(ใหม่)* | `leave_assignments` | ใครได้สิทธิ์ลาประเภทไหน + โควตาเฉพาะราย |
| *(ใหม่)* | `notifications` | แจ้งเตือนในแอป (1 แถว = 1 ผู้รับ) |

**ชื่อคอลัมน์คงเดิมทุกตัว** (camelCase เช่น `empId`, `checkInTime`) จึงต้อง quote ด้วย `"` ใน SQL
ผลคือ payload ที่ส่งให้หน้าเว็บมี key เหมือนเดิม → frontend ไม่ต้องแก้

**การเก็บวันที่/เวลา**
- วันที่ (`date`, `startDate`, ...) → ชนิด `date` → PostgREST คืนเป็น `'yyyy-MM-dd'`
- เวลา (`checkInTime`, `workStart`, ...) → ชนิด `text` เก็บ `'HH:mm'` ตรง ๆ
  → **หมดปัญหา Date เพี้ยน** ที่สเปกเดิมต้องใช้ normalizer แก้

---

## 3. ติดตั้งและรันบนเครื่อง (ขั้นตอนแรก)

### 3.1 สร้างโปรเจกต์ Supabase
1. ไปที่ [supabase.com](https://supabase.com) → **New project** (เลือก region Singapore จะเร็วที่สุด)
2. จด **Database password** ไว้

### 3.2 สร้างตาราง + นำเข้าข้อมูลเดิม
Supabase Dashboard → **SQL Editor** → **New query**
1. วางเนื้อหาไฟล์ `supabase/schema.sql` → กด **Run**
2. วางเนื้อหาไฟล์ `supabase/seed.sql` → กด **Run**

> ถ้าเคยรัน schema เวอร์ชันก่อนหน้าไปแล้ว ให้รัน migration ตามลำดับแทนการสร้างใหม่
> (ข้อมูลไม่หาย):
> 1. `supabase/migration-002-auth-webauthn.sql` — passkey + audit log
> 2. `supabase/migration-003-employees-leaves.sql` — ฟิลด์พนักงานใหม่ + สิทธิ์การลารายคน
> 3. `supabase/migration-004-notify-worktime.sql` — ระบบแจ้งเตือน + เกณฑ์หักเวลาพัก

> ถ้าอยากสร้าง `seed.sql` ใหม่จากไฟล์ xlsx ที่อัปเดตแล้ว:
> ```bash
> pip install openpyxl
> npm run sql        # = python3 scripts/xlsx-to-sql.py ../TapTime.xlsx supabase/seed.sql
> ```

### 3.3 ตั้งค่า environment
```bash
cd taptime-web
cp .env.local.example .env.local
```
กรอกค่าจาก **Supabase → Project Settings → API**

| ตัวแปร | เอามาจาก |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key **(ห้ามเผยแพร่)** |
| `SESSION_SECRET` | สุ่มเอง: `openssl rand -hex 32` (ใช้เซ็น session + challenge) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` |

### 3.4 ติดตั้ง + รัน
```bash
npm install
npm run dev
```
เปิด <http://localhost:3000>

### 3.5 ตั้งค่า Supabase Auth (สำหรับอีเมลเชิญ)
Supabase Dashboard → **Authentication → URL Configuration**
- **Site URL**: `http://localhost:3000` (ตอน deploy เปลี่ยนเป็นโดเมนจริง)
- **Redirect URLs**: เพิ่ม `http://localhost:3000/set-password`

### 3.6 สร้างบัญชีผู้ดูแลระบบคนแรก
```bash
node scripts/create-admin.mjs admin@example.com "รหัสผ่านอย่างน้อย6ตัว" "ชื่อ-สกุล"
```
- ถ้าอีเมลตรงกับพนักงานที่มีอยู่แล้วใน `profiles` → จะผูกให้และตั้ง `role = 'admin'`
- ถ้าไม่มี → สร้าง profile ใหม่ให้

จากนั้นเข้า <http://localhost:3000/login>

---

## 4. ระบบสมาชิกและความปลอดภัย

### 4.1 เส้นทาง (routes)

| URL | ใคร | หมายเหตุ |
|---|---|---|
| `/` | ทุกคน | เด้งไปหน้าที่เหมาะสมตามอุปกรณ์ |
| `/login` | ทุกคน | หน้าเดียวสำหรับทั้งแอดมินและพนักงาน + "จดจำฉันไว้" |
| `/set-password` | ผู้ได้รับอีเมลเชิญ | ตั้งรหัสผ่านครั้งแรก / รีเซ็ตรหัสผ่าน |
| `/admin` | `role = 'admin'` + เดสก์ท็อป | บนมือถือจะเด้งไป `/employee` (เข้าได้ด้วย `?force=1`) |
| `/employee` | ทุกคนที่ login แล้ว | หน้าลงเวลา (UI เดิม) |
| `/api/rpc` | POST | endpoint เดียวสำหรับทุกฟังก์ชัน backend |
| `/api/webauthn/*` | POST/GET | ผูกอุปกรณ์ / ยืนยันตัวตน |

### 4.2 เข้าสู่ระบบ

**ยกเลิกลิงก์ `?token=` ทั้งหมดแล้ว** — ทุกคนต้องเข้าผ่าน `/login` ด้วย email/password
เพราะลิงก์เฉพาะตัวแบบเดิมส่งต่อให้เพื่อนเช็คอินแทนได้ในคลิกเดียว

| | ปลายทางหลัง login |
|---|---|
| `role = 'admin'` + เดสก์ท็อป | `/admin` |
| `role = 'admin'` + มือถือ/แท็บเล็ต | `/employee` (มีปุ่มเข้าหน้าแอดมินมุมขวาบน) |
| `role = 'employee'` | `/employee` |

การแยกอุปกรณ์ใช้ user-agent ร่วมกับ client hint (`pointer: coarse` + ขนาดจอ)
เพราะ iPad รุ่นใหม่ปลอม user-agent เป็น Mac

**จดจำฉันไว้**

| | อายุ cookie |
|---|---|
| ติ๊ก | 30 วัน (อยู่ข้ามการปิดเบราว์เซอร์) |
| ไม่ติ๊ก | หายเมื่อปิดเบราว์เซอร์ (สูงสุด 12 ชม.) |

### 4.3 อีเมลเชิญตั้งรหัสผ่าน

เพิ่มพนักงานในหน้า "จัดการพนักงาน" **พร้อมกรอกอีเมล** → ระบบส่งอีเมลเชิญให้อัตโนมัติ
พนักงานกดลิงก์ → `/set-password` → ตั้งรหัสผ่านเอง → เข้าใช้งานได้ทันที

- ถ้าแก้ไขพนักงานเดิมแล้วเพิ่งใส่อีเมลครั้งแรก ก็ส่งเชิญให้เช่นกัน
- **ส่งซ้ำได้จากปุ่มในตารางหน้าจัดการพนักงาน** (ไอคอนซองจดหมาย)
- ถ้ามีบัญชีอยู่แล้ว จะส่งลิงก์ **รีเซ็ตรหัสผ่าน** แทนอัตโนมัติ

คอลัมน์ **บัญชีผู้ใช้** ในตารางบอกสถานะและเปลี่ยนข้อความบนปุ่มให้เอง

| สถานะ | ความหมาย | ปุ่ม |
|---|---|---|
| ไม่มีอีเมล | ยังเข้าใช้ระบบไม่ได้ | *(ไม่มีปุ่ม)* |
| ยังไม่ได้เชิญ | มีอีเมลแล้วแต่ยังไม่เคยส่ง | ส่งอีเมลเชิญ |
| รอตั้งรหัสผ่าน | ส่งคำเชิญแล้ว ยังไม่เคย login | ส่งอีเมลเชิญใหม่ |
| พร้อมใช้งาน | เคย login แล้ว | ส่งลิงก์ตั้งรหัสใหม่ |

> ถ้าลิงก์ที่ส่งออกไปยังชี้ `localhost` ระบบจะเตือนบนหน้าจอทันที
> แปลว่ายังไม่ได้ตั้ง **Site URL / Redirect URLs** ใน Supabase (ดูข้อ 5.2 ของ `DEPLOY.md`)

> **สำคัญมาก — ต้องตั้ง Custom SMTP ก่อนใช้งานจริง**
>
> SMTP ที่ Supabase ให้มาในตัวมีข้อจำกัด 2 ข้อที่ทำให้เชิญพนักงานไม่ได้เลย
> 1. **ส่งได้เฉพาะอีเมลที่เป็นสมาชิกทีมของ organization** อีเมลอื่นถูกปฏิเสธด้วย
>    `Email address not authorized`
> 2. จำกัด **2 ฉบับ/ชั่วโมง** และไม่มี SLA
>
> ตั้ง Custom SMTP ที่ Authentication → Emails → SMTP Settings
> แล้วปรับเพดานที่ Authentication → Rate Limits (หลังตั้งเสร็จค่าเริ่มต้นคือ 30 ฉบับ/ชม.)
>
> **ยังไม่มีโดเมนบริษัท?** ใช้ Gmail + App Password ได้เลย ฟรีและส่งได้ 500 ผู้รับ/วัน
> — ขั้นตอนละเอียดใน `DEPLOY.md` ข้อ 5.3
>
> และต้องเพิ่ม `https://<โดเมนของคุณ>/set-password` ใน
> Authentication → URL Configuration → **Redirect URLs** ด้วย ไม่งั้นลิงก์ในอีเมลจะใช้ไม่ได้

### 4.4 WebAuthn / passkey (Face ID / ลายนิ้วมือ)

**บังคับใช้ทุกครั้งที่เช็คอินและเช็คเอาท์** เพื่อกันการลงเวลาแทนกัน

1. เข้าใช้งานครั้งแรก → หน้าพนักงานขึ้นแผ่น "ผูกอุปกรณ์นี้"
2. ผูกแล้ว passkey ถูกเก็บใน Secure Enclave / TEE ของเครื่อง — คัดลอกออกไม่ได้
3. ทุกครั้งที่ลากสไลด์เช็คอิน ระบบขอ Face ID / ลายนิ้วมือ **ก่อน** ส่งข้อมูลไปเซิร์ฟเวอร์
4. เซิร์ฟเวอร์ตรวจลายเซ็นและตรวจว่า credential นั้น "เป็นของพนักงานคนนี้จริง"

ตั้งค่าเป็น `authenticatorAttachment: 'platform'` + `userVerification: 'required'`
→ ใช้กุญแจ USB ที่ถอดไปให้คนอื่นไม่ได้ และต้องปลดล็อกด้วยชีวมิติ/PIN ของเครื่องเสมอ

> **ไม่มี Face ID / ลายนิ้วมือ ก็ใช้ได้** — WebAuthn ตั้งไว้ที่ `userVerification: 'required'`
> ซึ่งรับ **PIN / รูปแบบปลดล็อกหน้าจอ** ได้ด้วย ขอแค่เครื่องมีล็อกหน้าจอก็พอ

**ลำดับการแก้เมื่อพนักงานผูกอุปกรณ์ไม่ได้**

1. ให้ตั้งล็อกหน้าจอ (PIN / รูปแบบ / ลายนิ้วมือ) ในการตั้งค่าเครื่อง — แก้ได้เกือบทุกเคส
2. เปิดผ่าน Chrome / Safari โดยตรง ไม่ใช่เบราว์เซอร์ในแอป LINE หรือ Facebook
3. ถ้ายังไม่ได้ → **ยกเว้นรายคน** ที่หน้าจัดการพนักงาน → แก้ไข →
   หมวด *การยืนยันตัวตนตอนลงเวลา* → ติ๊ก "ยกเว้นไม่ต้องยืนยันตัวตนด้วยอุปกรณ์"
   (เก็บที่ `profiles.webauthnExempt` — ตารางจะขึ้นป้าย "ยกเว้น passkey" ให้เห็นชัด)

**จัดการอุปกรณ์** ในฟอร์มแก้ไขพนักงานจะเห็นรายการอุปกรณ์ที่ผูกไว้ พร้อมวันที่ผูก
และวันที่ใช้ล่าสุด กดปุ่ม "ปลด" เมื่อพนักงานเปลี่ยนเครื่องหรือทำเครื่องหาย

**จัดการอุปกรณ์**

| ฟังก์ชัน | ใช้ทำอะไร |
|---|---|
| `listEmployeeDevices(empId)` | ดูอุปกรณ์ที่ผูกไว้ + ใช้ล่าสุดเมื่อไร |
| `revokeEmployeeDevice(credentialId)` | ปลดอุปกรณ์ (เปลี่ยนมือถือ / ทำเครื่องหาย) |
| `setWebauthnExempt(empId, bool)` | ยกเว้นการใช้ passkey |

### 4.5 ชั้นป้องกันอื่น

| กลไก | รายละเอียด |
|---|---|
| **เขียนทับตัวตน** | `/api/rpc` เขียนทับ `args[0]` ด้วย `empId` จาก session เสมอ — แก้ JavaScript ในหน้าเว็บแล้วเช็คอินแทนคนอื่นไม่ได้ |
| **geofence fail-closed** | ไม่ส่งพิกัด / ส่งค่าที่ไม่ใช่ตัวเลข = ถูกปฏิเสธ (ของเดิม NaN หลุดผ่าน) |
| **ตรวจความแม่นยำ** | ปฏิเสธถ้า `accuracy > 200 ม.` (กันพิกัดหยาบจาก Wi-Fi/IP) |
| **audit log** | ทุกครั้งที่พยายามลงเวลา บันทึก พิกัด/ระยะ/accuracy/IP/user-agent/credential ที่ใช้ ลงตาราง `checkin_audit` ทั้งที่ผ่านและไม่ผ่าน |
| **กันการโคลน passkey** | ตรวจ signature counter — ถ้าไม่เพิ่มขึ้นแปลว่า credential ถูกโคลน → ปฏิเสธ |
| **challenge ใช้ครั้งเดียว** | เก็บใน cookie เซ็น HMAC อายุ 2 นาที ผูกกับ `empId` และล้างทิ้งหลังใช้ |

> ยังเป็นจริงอยู่: **เว็บตรวจจับ mock GPS ไม่ได้** (Geolocation API ไม่มีฟิลด์บอก)
> แต่ passkey + การผูกอุปกรณ์ทำให้ "ฝากเพื่อนเช็คอิน" ทำไม่ได้แล้ว
> ส่วนคนที่ปลอมพิกัดของตัวเอง จะทิ้งร่องรอยไว้ใน `checkin_audit` ให้ตรวจย้อนหลังได้

---

### 4.6 โลโก้ / ไอคอน / PWA

โลโก้ต้นฉบับอยู่ที่ `assets/logo-source.png` สร้างชุดไอคอนทั้งหมดด้วย

```bash
npm run icons        # = python3 scripts/make-icons.py assets/logo-source.png
```

| ไฟล์ใน `public/` | ขนาด | ใช้ที่ไหน |
|---|---|---|
| `favicon.ico` | 16/32/48 รวมในไฟล์เดียว | แท็บเบราว์เซอร์ |
| `favicon-16/32/48.png` | | เบราว์เซอร์รุ่นใหม่ |
| `apple-touch-icon.png` | 180 | iOS "เพิ่มลงหน้าจอโฮม" |
| `icon-192.png` / `icon-512.png` | 192 / 512 | PWA |
| `icon-maskable-512.png` | 512 | Android (มี safe zone) |
| `logo.png` / `logo-192.png` | 512 / 192 | ใช้ในหน้าเว็บ |
| `manifest.webmanifest` | | ติดตั้งเป็นแอปบนมือถือได้ |

**หมายเหตุทางเทคนิค** — การ์ดของโลโก้เป็นพื้นโปร่งแสง และหน้าปัดนาฬิกาเป็นรูโปร่งใส
ที่ทะลุออกด้านนอกได้ ถ้าเอาไปวางบนพื้นสีเข้มตรง ๆ หน้าปัดจะกลายเป็นสีดำอ่านไม่ออก
`make-icons.py` จึงวาดสี่เหลี่ยมมุมมนตามรูปทรงการ์ด เติมพื้นขาว แล้ววางโลโก้ทับ
(นิ้วมือที่ยื่นออกนอกการ์ดยังแสดงครบเพราะวางทีหลัง)

โลโก้ถูกนำไปใช้ใน sidebar ของหน้าแอดมิน และหัวหน้า login/ตั้งรหัสผ่าน
โดย **ไม่แก้ไฟล์ต้นฉบับใน `src/`** (sidebar แทนที่ตัวอักษร "T" ผ่าน CSS override)

พนักงานกด "เพิ่มลงหน้าจอโฮม" บนมือถือได้ → เปิดแบบเต็มจอเหมือนแอปจริง
และเข้าหน้าลงเวลาทันที (`start_url` = `/employee`)

---

### 4.7 ฟีเจอร์ที่เพิ่มในหน้าแอดมิน

**หน้าจัดการพนักงาน**

- คอลัมน์ **บัญชีผู้ใช้** + ปุ่ม **ส่งอีเมลเชิญใหม่** (ดูข้อ 4.3)
- เอาปุ่ม "ลิงก์/QR" ออก (ไม่มีระบบ token แล้ว) — ฟังก์ชัน `employeeLink` ถูกถอดออกจาก backend ด้วย
- ค้นหาจาก ชื่อ / ชื่อเล่น / เบอร์โทร / อีเมล / ตำแหน่ง / สาขา / เลขบัตร
- กรองด้วย **สาขา · ตำแหน่ง · สถานะ · สิทธิ์** (กรองพร้อมกันได้)
- แบ่งหน้า **10 / 20 / 50 / 100** รายการ (ค่าเริ่มต้น 20)
- รูปพนักงานถูก **ครอปกึ่งกลางเป็นจัตุรัสและย่อเป็น 150×150 px** ก่อนบันทึก
  (คุณภาพ JPEG 0.85 พร้อมพื้นขาวรองกัน PNG โปร่งใส)
- ฟอร์มจัดใหม่เป็น 4 หมวด

| หมวด | ฟิลด์ |
|---|---|
| ข้อมูลส่วนตัว | ชื่อ-นามสกุล, **ชื่อเล่น**, **เพศ**, **วันเกิด**, **สัญชาติ**, เลขบัตรประชาชน, **ที่อยู่** |
| ข้อมูลติดต่อ | เบอร์โทรศัพท์, อีเมล |
| ข้อมูลการจ้างงาน | สาขา, ตำแหน่ง, ประเภทเงินเดือน, วันเริ่มงาน |
| การเข้าใช้ระบบ | สิทธิ์การใช้งาน, **สถานะ (ทำงานอยู่ / ลาออก)** |

**ตั้งค่าวันลา — กำหนดสิทธิ์รายคน**

กดปุ่ม "กำหนดสิทธิ์" ในแต่ละประเภทการลา:

- ติ๊ก **"ให้สิทธิ์พนักงานทุกคน"** → ทุกคนได้โควตากลาง
- ไม่ติ๊ก → ได้เฉพาะคนที่เลือกไว้เท่านั้น
- ใส่ตัวเลขข้างชื่อพนักงาน = **โควตาเฉพาะคนนั้น** (เว้นว่าง = ใช้โควตากลาง)
  เช่น ลาพักร้อนโควตากลาง 6 วัน แต่คนที่อายุงานเกิน 1 ปี ใส่ 10 → ได้ 10 วัน
  โดยไม่ต้องสร้างประเภทการลาซ้ำ
- ติ๊ก **"แสดงจำนวนวันลา/ปี ในหน้าพนักงาน"** ในฟอร์มแก้ไขประเภทการลา
  ถ้าไม่ติ๊ก พนักงานยังยื่นลาได้ แต่จะไม่เห็นตัวเลขโควตาคงเหลือ

ตรรกะการคิดสิทธิ์อยู่ใน `lib/api/leaveAssign.ts` (`entitlementsFor`):

| มีแถวใน `leave_assignments` | `assignAll` | ผลลัพธ์ |
|---|---|---|
| มี | – | ได้สิทธิ์ · โควตา = `daysOverride ?? daysPerYear` |
| ไม่มี | `true` | ได้สิทธิ์ · โควตา = `daysPerYear` |
| ไม่มี | `false` | **ไม่ได้สิทธิ์** (ไม่โผล่ทั้งในโควตาและฟอร์มยื่นลา) |

**เมนูวันหยุด**

- เอาตารางวันหยุดราชการ/พิเศษออก เหลือแค่ **ปฏิทิน**
- คลิกวันว่างในปฏิทิน → เพิ่มวันหยุด (เติมวันที่ให้อัตโนมัติ)
- คลิกวันที่เป็นวันหยุดอยู่แล้ว → แก้ไข หรือกดลบได้ในกล่องเดียวกัน
- วันนี้มีกรอบสีน้ำเงินให้เห็นชัด

---

### 4.8 แจ้งเตือน / กันกดซ้ำ / การคำนวณเวลา / รูปโปรไฟล์

**กันกดปุ่มซ้ำ (ทุกฟอร์ม ทั้ง Admin และ Employee)**

ทำที่ชั้น `src/shim.html` ชั้นเดียว — จำปุ่มที่ผู้ใช้เพิ่งกด พอมี RPC ตามมาก็ปิดปุ่มนั้น
เปลี่ยนข้อความเป็น "กำลังบันทึก..." จนกว่าจะได้คำตอบ แล้วคืนสภาพเดิม
จึงครอบคลุมทุกฟอร์มโดยไม่ต้องแก้ handler ทีละตัว

- ปิดได้ทั้ง `<button>` (`disabled`) และ `<span class="btn">` (`pointer-events:none`)
- ข้อความเปลี่ยนตามงาน: บันทึก / ลบ / ส่ง / สร้างไฟล์ / ส่งคำขอ
- ฟังก์ชันที่แค่อ่านข้อมูล (`list*`, `get*`, รายงาน) ไม่ล็อกปุ่ม
- ปลดล็อกทั้งกรณีสำเร็จและกรณี error

**แจ้งเตือนในแอป**

| เหตุการณ์ | ผู้รับ |
|---|---|
| พนักงานยื่นลา | แอดมินทุกคน (ไม่แจ้งตัวผู้ยื่นเอง) |
| แอดมินอนุมัติ/ปฏิเสธใบลา | พนักงานเจ้าของใบ |
| พนักงานยื่นคำขอแก้เวลา | แอดมินทุกคน |
| แอดมินอนุมัติ/ปฏิเสธคำขอแก้เวลา | พนักงานเจ้าของคำขอ |
| มีคนขาดงาน (cron รายวัน) | แอดมินทุกคน |

- ไอคอนกระดิ่งพร้อม badge — หน้าพนักงาน (มุมขวาบน) และ topbar ของแอดมิน
- กดแล้วเปิดรายการ · เลื่อนดูได้ · กดรายการเพื่อกระโดดไปแท็บที่เกี่ยวข้อง
- เช็คของใหม่ทุก 1 นาที และทุกครั้งที่กลับมาที่แท็บ
- **เสียงกระดิ่ง** สร้างด้วย WebAudio (ไม่ต้องมีไฟล์เสียง)

> เบราว์เซอร์บล็อกเสียงที่เล่นเองตอนเปิดหน้า เสียงจึงเล่นตอน**ผู้ใช้แตะจอครั้งแรก**
> และเล่นเฉพาะเมื่อยังมีแจ้งเตือนที่ไม่ได้อ่าน — เป็นข้อจำกัดของเบราว์เซอร์ เลี่ยงไม่ได้

**พนักงานเปลี่ยนรูปโปรไฟล์เองได้**

แตะที่รูปในหัวหน้าพนักงาน (มีไอคอนกล้องมุมล่างขวา) → เลือกรูป → บันทึกทันที
ใช้หลักการเดียวกับตอนแอดมินอัปโหลด: **ครอปกึ่งกลางเป็นจัตุรัสแล้วย่อเป็น 150×150 px**
(JPEG q0.85 พร้อมพื้นขาวรองกัน PNG โปร่งใส)

ฝั่งเซิร์ฟเวอร์ (`empUpdatePhoto`) ตรวจซ้ำอีกชั้นเพราะ client ปลอมค่าได้เสมอ

- รับเฉพาะ data URL ของ `jpeg` / `png` / `webp` — ปฏิเสธ `svg` (รัน script ได้) และ URL ภายนอก
- จำกัดไม่เกิน 200 KB
- `empId` ถูกเขียนทับด้วยค่าจาก session → แก้รูปคนอื่นไม่ได้
- ส่งค่าว่าง = ลบรูปออก

**เมนูวันหยุดฝั่งพนักงาน** เหลือเฉพาะปฏิทิน (เอากล่อง "วันหยุดที่จะถึง" ออกแล้ว)

**ตัวโหลด (spinner)** ขนาด 60×60 px ทั้งสองฝั่ง
- `.spinner` — แบบอยู่ในกล่อง (ใช้กับรายงาน/ประวัติ/modal)
- `.spinner.page` — `position:fixed` ลอยกลางจอพอดี ใช้ตอนเปิดแอปและตอนสลับเมนู
  (ไม่ขึ้นกับความสูงของเนื้อหา จึงอยู่กลางจอจริงเสมอ)

**รูปโปรไฟล์ในหน้าพนักงาน** แสดงผลขนาด 60×60 px (เดิม 46×46)

**สถานะกำลังโหลดฝั่งแอดมิน**

| กลไก | รายละเอียด |
|---|---|
| `loadBox(msg)` | วงหมุน 60×60 + ข้อความ จัดกึ่งกลาง **ในพื้นที่เนื้อหา** ด้วย flex |
| แถบ progress | เส้นบางบนสุดจอ ขึ้นทุกครั้งที่มีคำขอค้าง (`html.tt-loading`) |
| กันกดเมนูซ้ำ | ระหว่างโหลด เมนูถูกปิดคลิกและจางลง เมนูที่กดมีวงหมุนเล็กกำกับ |
| `window.ttPending()` | จำนวนคำขอที่ยังค้าง — shim เรียก `__ttIdle()` เมื่อเหลือ 0 |

ข้อความจะบอกว่ากำลังทำอะไรอยู่ เช่น "กำลังโหลดรายชื่อพนักงาน..."
"กำลังโหลดข้อมูลการลงเวลา..." "กำลังสร้างรายงานประจำเดือน..."

> **ทำไมไม่ใช้ `position:fixed` ฝั่งแอดมิน** — sidebar กว้าง 230px
> ถ้าจัดกึ่งกลางจอ วงหมุนจะเยื้องไปทางซ้ายจากกึ่งกลางเนื้อหาจริง 115px
> จึงใช้ flex จัดกึ่งกลางในพื้นที่เนื้อหาแทน (ฝั่งพนักงานไม่มี sidebar จึงใช้ fixed ได้)

**เปลี่ยนสิทธิ์แล้วมีผลทันที**

`/admin` และ `/api/rpc` อ่าน `role` สดจากตาราง `profiles` ทุกครั้ง ไม่ได้เชื่อค่าใน cookie

- เลื่อนใครเป็นแอดมิน → เข้าหน้าจัดการได้ทันที ไม่ต้องออกจากระบบแล้วเข้าใหม่
- ถอดสิทธิ์ → ถูกตัดทันที ไม่ต้องรอ cookie หมดอายุ (เดิมค้างได้ถึง 30 วัน)
- พนักงานที่ตั้งเป็น `inactive` ใช้สิทธิ์แอดมินไม่ได้แม้ `role` ยังเป็น admin

**กันยื่นลาซ้ำ/ทับกัน**

ตรวจ overlap กับใบที่ `pending` หรือ `approved` ของคนเดียวกัน
(ทับเมื่อ `start1 <= end2 && start2 <= end1`) ครอบคลุมทั้งแบบครอบทั้งใบ คร่อมหัว และคร่อมท้าย
ใบที่ถูกปฏิเสธไปแล้วไม่กันสิทธิ์ · พร้อมตรวจว่าวันสิ้นสุดต้องไม่ก่อนวันเริ่ม

**การคำนวณชั่วโมงทำงาน — แก้ 2 จุด**

| ปัญหาเดิม | ผลที่เกิด | แก้เป็น |
|---|---|---|
| ตัวนับสด**ไม่หัก**เบรก แต่ยอดรวมหลังเช็คเอาท์**หัก** | ตัวนับขึ้น 09:00 แต่พอเช็คเอาท์เหลือ 8 ชม. — เวลาหายไป 1 ชม. | ใช้สูตรเดียวกันทั้งสองที่ (`computeWorkHours`) และบอกบนจอว่าหักเบรกไปเท่าไร |
| หักเบรก**ทุกกรณี** | ทำงาน 08:00-11:00 (3 ชม.) เหลือ 2 ชม. · ทำงาน 30 นาทีเหลือ 0 | หักเมื่อทำงานถึงเกณฑ์ `breakAfterHours` (ค่าเริ่มต้น 6 ชม.) |

ตั้งค่าเกณฑ์ได้ที่ **ธุรกิจ/สาขา → หักเวลาพักเมื่อทำงานถึง (ชั่วโมง)**
ใส่ `0` = กลับไปหักทุกกรณีแบบเดิม

> ข้อมูลเก่าที่บันทึกไปแล้วยังเป็นค่าที่คิดด้วยกฎเดิม ระบบไม่ย้อนแก้ให้
> ถ้าต้องการให้ตรงกัน ใช้ "แก้เวลาออก" ในหน้าลงเวลาเพื่อให้คำนวณใหม่

---

## 5. ทำอย่างไรถึงไม่ต้องแก้ UI

โค้ดหน้าเว็บเดิมคุยกับ backend ผ่านจุดเดียว:

```js
google.script.run.withSuccessHandler(f).withFailureHandler(g).fnName(...args)
```

`src/shim.html` จำลอง API ตัวนี้ขึ้นมาใหม่ทั้งหมด โดยยิง `fetch('/api/rpc')` แทน
และคืนผลลัพธ์เป็น **JSON string** เหมือนที่ `J()` ของ Apps Script เคยทำ
→ helper `run()` เดิมที่ `JSON.parse` ผลลัพธ์จึงทำงานได้เหมือนเดิมทุกประการ

`scripts/build-html.mjs` ทำหน้าที่แทน `include()` ของ Apps Script:
แทน `<?!= include('AdminStyles'); ?>` ด้วยเนื้อไฟล์จริง แล้วแทรก shim ไว้ต้น `<body>`

ผลลัพธ์: การย้ายจาก Apps Script มา Next.js **ไม่ต้องแตะไฟล์ UI เลย**
และการแก้หน้าจอในภายหลังก็ยังทำแบบเดิม — แก้ไฟล์ใน `src/` แล้วรัน `npm run html`

shim ยัง **แทรกขั้นตอนยืนยันตัวตนด้วย Face ID / ลายนิ้วมือ** ก่อนส่ง `empCheckIn`/`empCheckOut`
โดยที่โค้ดหน้าเว็บเดิมไม่รู้ตัวเลย — และดักอ่านค่า `accuracy` จาก `getCurrentPosition`
เพื่อส่งไปให้เซิร์ฟเวอร์ตรวจ ทั้งหมดนี้ไม่ต้องแก้ `EmployeeCore.html` แม้แต่บรรทัดเดียว

สิ่งที่ "เพิ่มเข้ามา" บนหน้าจอมีแค่: ปุ่มออกจากระบบ, ปุ่มเข้าหน้าแอดมิน (เฉพาะแอดมินบนมือถือ)
และแผ่นชวนผูกอุปกรณ์ครั้งแรก — ทั้งหมดแทรกจาก build script ไม่ได้แก้ไฟล์เดิม

---

## 6. ฟังก์ชัน backend (เรียกผ่าน `/api/rpc`)

ชื่อและลำดับ argument **เหมือน Apps Script เดิมทุกตัว**

| กลุ่ม | ฟังก์ชัน |
|---|---|
| Config | `adminBootstrap`, `getConfig`, `setConfig` |
| Dashboard | `adminDashboard(date, branchId)` |
| พนักงาน | `listEmployees`, `saveEmployee`, `deleteEmployee`, `setEmployeePassword`, `inviteEmployee` |
| อุปกรณ์ / passkey | `listEmployeeDevices`, `revokeEmployeeDevice`, `setWebauthnExempt`, `listCheckinAudit` |
| ลงเวลา | `listAttendance`, `manualCheckIn`, `manualCheckOut`, `editCheckOut` |
| ฝั่งพนักงาน | `employeeContext`, `empCheckIn`, `empCheckOut`, `empSubmitLeave`, `empSubmitTimeEdit` |
| ลา | `listLeaves`, `decideLeave` |
| แก้เวลา | `listTimeEdits`, `decideTimeEdit` |
| วันหยุด | `listHolidays`, `saveHoliday`, `deleteHoliday`, `saveWeeklyOff` |
| ตั้งค่า | `saveCompany`, `saveBranch`, `savePosition`, `deletePosition`, `saveLeaveType`, `deleteLeaveType` |
| สิทธิ์การลา | `listLeaveAssignments`, `saveLeaveAssignments`, `leaveAssignSummary` |
| แจ้งเตือน | `listNotifications`, `unreadCount`, `markNotificationsRead` |
| รายงาน | `monthlyReport`, `dailyReport`, `exportMonthlyReportXlsx` |

สูตรคำนวณ (มาสาย / OT / ชั่วโมงงาน / โควตาลา / ประเภทวัน) ยกมาตรง ๆ จากสเปกข้อ 4
ของ `TapTime-Master-Spec.md` ไม่มีการเปลี่ยนตรรกะ

**Export Excel** เดิมสร้าง Spreadsheet ชั่วคราวบน Drive แล้ว export
ตอนนี้สร้างไฟล์ในหน่วยความจำด้วย SheetJS แล้วคืน `{filename, mime, b64}` แบบเดิม
(เร็วกว่า และไม่ต้องขอสิทธิ์ Drive)

---

## 7. ทดสอบความถูกต้อง

```bash
npm test
```

รันชุดทดสอบ **145 ข้อ** บนฐานข้อมูลจำลองในหน่วยความจำที่โหลด **ข้อมูลจริงจาก TapTime.xlsx**
(`test/fixture.json`) — ไม่ต้องต่อ Supabase

ครอบคลุม:
- สูตรคำนวณ มาสาย / OT / ชั่วโมงงาน — เทียบกับแถวจริง `AT-154005fb` (สาย 37 น., OT 2 น., 7.42 ชม.)
- Haversine + การตรวจรัศมี GPS (`out_of_zone`)
- การจำแนกประเภทวัน (ราชการ / ประจำสัปดาห์ / วันทำงาน) และ `weeklyOff = 0`
- โควตาวันลาคงเหลือรายประเภท และเงื่อนไข `advanceDays`
- flow คำขอแก้เวลา → อนุมัติ → คำนวณใหม่
- รายงานรายวัน/รายเดือน ครบทุกสถานะ (`present/late/leave/absent/holiday/future`)
  รวมกรณี "ลาย้อนหลังอนุมัติแล้ว เปลี่ยนขาด → ลา"
- export .xlsx ได้ไฟล์ ZIP จริง
- **ฟังก์ชันทั้ง 29 ตัวที่หน้าเว็บเรียก มีอยู่จริงและถูกกำหนดสิทธิ์ครบ**
- HTML ที่ประกอบแล้วไม่เหลือ template tag ค้าง และลำดับสคริปต์ถูกต้อง
  (`WEBAUTHN` → shim → `TOKEN` → โค้ดหน้าเว็บ)

ด้านความปลอดภัย:
- **geofence fail-closed** — ยิง `empCheckIn` โดยไม่ส่งพิกัด / ส่ง `"abc"` / `(0,0)` ต้องถูกปฏิเสธทุกกรณี
- **ปฏิเสธพิกัดความแม่นยำต่ำ** (accuracy > 200 ม.)
- **เขียนทับตัวตน** — ส่ง `empId` ของคนอื่นมา ต้องถูกแทนด้วย `empId` จาก session เสมอ
- **audit** — ทุกความพยายามลงเวลาถูกบันทึกพร้อมพิกัด/ระยะ/IP/credential
- **session cookie** — ปลอมแปลง `role` เป็น admin → ถูกปฏิเสธ
- **remember me** — ติ๊ก = 30 วัน มี maxAge / ไม่ติ๊ก = session cookie
- **WebAuthn challenge** — แก้ให้เป็นพนักงานคนอื่น หรือหมดอายุ → ถูกปฏิเสธ
- **แยกอุปกรณ์** — UA ของ iPhone/Android/iPad/Mac/Windows + client hint ทับได้
- **พนักงาน inactive** ใช้งานไม่ได้

ด้านไอคอน/แบรนด์:
- ไฟล์ไอคอนครบทุกขนาดและมิติถูกต้อง (อ่านจาก PNG header จริง)
- ทุกหน้ามี favicon / apple-touch-icon / manifest อยู่ใน `<head>`
- `manifest.webmanifest` ถูกตามสเปก PWA และไม่อ้างไฟล์ที่ไม่มีอยู่
- โลโก้ถูกใช้แทนตัวอักษร "T" จริง และ CSS มาหลัง AdminStyles (override ได้)

ตรวจชนิดข้อมูลอย่างเดียว: `npm run typecheck`

> **หมายเหตุ** ไฟล์ UI 4 ไฟล์ถูกแก้ตามคำขอเพิ่มเติมแล้ว จึงไม่ตรงกับ md5 ใน
> `MANIFEST.txt` ของ V1.1 อีกต่อไป ได้แก่ `AdminEmployees.html`, `AdminHolidays.html`,
> `AdminSettings.html`, `AdminStyles.html` และ `EmployeeCore.html` (แก้เฉพาะ `leaveBalanceList`)
> ไฟล์ที่เหลือยังตรงกับต้นฉบับทุก byte

---

## 8. ขึ้น GitHub + Vercel

### 8.1 GitHub
```bash
cd taptime-web          # หรือ cd .. ถ้าอยากเก็บทั้งโปรเจกต์รวม Apps Script เดิม
git init
git add .
git commit -m "TapTime V2 — Next.js + Supabase"
git branch -M main
git remote add origin https://github.com/<user>/taptime.git
git push -u origin main
```

> `.gitignore` กัน `.env.local`, `node_modules/`, `generated/` ไว้แล้ว

### 8.2 Vercel
1. [vercel.com](https://vercel.com) → **Add New → Project** → เลือก repo
2. **Root Directory**: `taptime-web` (ถ้า push ทั้งโฟลเดอร์ TapTime)
3. **Environment Variables** — ใส่ให้ครบทั้ง 5 ตัว (ค่าเดียวกับ `.env.local`
   แต่ `NEXT_PUBLIC_APP_URL` ให้ใช้โดเมนจริงของ Vercel)
4. **Deploy**

> **หลัง deploy ครั้งแรกต้องทำ 3 อย่าง** ไม่งั้น passkey และอีเมลเชิญจะใช้ไม่ได้
> 1. แก้ `NEXT_PUBLIC_APP_URL` ให้เป็นโดเมนจริง แล้ว redeploy
>    — ค่านี้ใช้กำหนด **rpID** ของ passkey ด้วย ถ้าผิด passkey จะยืนยันไม่ผ่าน
> 2. Supabase → Authentication → URL Configuration → **Site URL** = โดเมนจริง
>    และเพิ่ม `https://<โดเมน>/set-password` ใน **Redirect URLs**
> 3. ตั้ง **Custom SMTP** — จำเป็นเสมอถ้าจะเชิญพนักงานจริง (ไม่ใช่แค่เรื่องโควตา)
>
> หมายเหตุ: passkey ผูกกับโดเมน — ถ้าย้ายโดเมนภายหลัง พนักงานต้องผูกอุปกรณ์ใหม่ทุกคน

### 8.3 ความปลอดภัย
- ทุกตารางเปิด **RLS** และไม่มี policy สำหรับ anon → อ่าน/เขียนจาก browser ตรง ๆ ไม่ได้
- ทุก query วิ่งผ่าน API route ด้วย `service_role` key ที่อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
- ตรรกะสิทธิ์อยู่ใน `lib/rpc.ts` (`ADMIN_FNS` / `EMPLOYEE_FNS` / `BIOMETRIC_FNS`)
- ตัวตนของพนักงานมาจาก session เท่านั้น (`applyIdentity`) — client กำหนดเองไม่ได้
- WebAuthn ต้องรันบน **HTTPS** (ยกเว้น `localhost`) — Vercel ให้มาอยู่แล้ว

---

## 9. สิ่งที่เปลี่ยนจาก V1.1

| หัวข้อ | เดิม | ใหม่ |
|---|---|---|
| ฐานข้อมูล | Google Sheets | Supabase (PostgreSQL) |
| Backend | Apps Script `.gs` | Next.js API route (TypeScript) |
| การเรียก backend | `google.script.run` | `POST /api/rpc` (มี shim ให้โค้ดเดิมทำงานได้) |
| ตารางพนักงาน | ชีต `Employees` | ตาราง `profiles` (+ Supabase Auth) |
| การเข้าถึง Admin | ใครมี URL ก็เข้าได้ | ต้อง login + `role = 'admin'` (มือถือเด้งไปหน้าพนักงาน) |
| เข้าหน้าพนักงาน | ลิงก์ `?token=` ส่งต่อได้ | **ต้อง login** — ยกเลิก token แล้ว |
| ตั้งรหัสผ่านพนักงาน | ไม่มี | อีเมลเชิญอัตโนมัติเมื่อเพิ่มพนักงานพร้อมอีเมล |
| จดจำการเข้าสู่ระบบ | — | checkbox "จดจำฉันไว้" 30 วัน |
| กันเช็คอินแทนกัน | ไม่มี | **WebAuthn / passkey** (Face ID / ลายนิ้วมือ) ทุกครั้ง |
| ตรวจ GPS | `NaN > radius` = หลุดผ่าน | fail-closed + ตรวจ accuracy + บันทึก audit |
| Export Excel | Drive + UrlFetch | SheetJS ในหน่วยความจำ |
| Deploy | Apps Script deployment | GitHub → Vercel (auto deploy ทุก push) |
| โลโก้ / ไอคอน | ไม่มี | favicon + apple-touch + PWA (ติดตั้งเป็นแอปได้) |
| UI | — | **ไม่เปลี่ยน** (นอกจากโลโก้แทนตัว "T" และปุ่มที่จำเป็น) |
