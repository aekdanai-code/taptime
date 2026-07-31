# คู่มือขึ้น GitHub + Vercel — TapTime

> **สถานะปัจจุบัน:** git ถูกเตรียมไว้ให้แล้วในโฟลเดอร์ `taptime-web/`
> — `git init` เสร็จ, commit แรกเสร็จ, อยู่บน branch `main`
> เหลือแค่สร้าง repo บน GitHub แล้ว push

---

## สารบัญ

1. [ก่อนเริ่ม](#1-ก่อนเริ่ม)
2. [สร้าง repo บน GitHub แล้ว push](#2-สร้าง-repo-บน-github-แล้ว-push)
3. [เชื่อม Vercel](#3-เชื่อม-vercel)
4. [ตั้งค่า Environment Variables](#4-ตั้งค่า-environment-variables)
5. [สิ่งที่ต้องทำหลัง deploy ครั้งแรก](#5-สิ่งที่ต้องทำหลัง-deploy-ครั้งแรก-สำคัญมาก)
6. [ตรวจสอบว่าใช้งานได้จริง](#6-ตรวจสอบว่าใช้งานได้จริง)
7. [การทำงานต่อจากนี้](#7-การทำงานต่อจากนี้)
8. [ปัญหาที่เจอบ่อย](#8-ปัญหาที่เจอบ่อย)

---

## 1. ก่อนเริ่ม

ต้องมี

- บัญชี [GitHub](https://github.com)
- บัญชี [Vercel](https://vercel.com) — สมัครด้วย GitHub ได้เลย จะเชื่อมให้อัตโนมัติ
- โปรเจกต์ Supabase ที่รัน `schema.sql` + `seed.sql` + migration ครบแล้ว
- ค่าใน `.env.local` ที่ใช้รันบนเครื่องได้แล้ว (จะเอาไปใส่ใน Vercel)

### ⚠️ เรื่องความเป็นส่วนตัวที่ต้องรู้ก่อน

ไฟล์เหล่านี้ **มีข้อมูลส่วนบุคคลจริง** (ชื่อ-สกุล เบอร์โทร อีเมล รูปถ่าย base64)

- `supabase/seed.sql`
- `test/fixture.json`

**repo ต้องตั้งเป็น Private เท่านั้น** ถ้าจะเปลี่ยนเป็น Public ในอนาคต
ต้องลบสองไฟล์นี้ออกจากประวัติ git ก่อน (ไม่ใช่แค่ลบไฟล์ — ต้องลบจาก history ด้วย)

> Vercel ต่อกับ repo แบบ Private ได้ฟรี ไม่ต้องอัปเกรดแพ็กเกจ

---

## 2. สร้าง repo บน GitHub แล้ว push

### วิธี A — ผ่านหน้าเว็บ (ง่ายสุด)

**2.1 สร้าง repo เปล่า**

1. เข้า <https://github.com/new>
2. **Repository name**: `taptime`
3. เลือก **Private** ⬅️ สำคัญ
4. **อย่า** ติ๊ก "Add a README file", "Add .gitignore", "Choose a license"
   (ถ้าติ๊กจะชนกับ commit ที่มีอยู่แล้ว)
5. กด **Create repository**

**2.2 push ขึ้นไป**

เปิด Terminal แล้วรัน (เปลี่ยน `<username>` เป็นชื่อผู้ใช้ GitHub ของคุณ)

```bash
cd "/Users/loftster/Mac HD/ClaudeCodex/TapTime/taptime-web"

git remote add origin https://github.com/<username>/taptime.git
git push -u origin main
```

ถ้าถามรหัสผ่าน ให้ใส่ **Personal Access Token** ไม่ใช่รหัสผ่าน GitHub
สร้างที่ <https://github.com/settings/tokens> → *Generate new token (classic)* → ติ๊ก **repo**

> เก็บ token ไว้ในเครื่องครั้งเดียวได้ด้วย
> `git config --global credential.helper osxkeychain`

### วิธี B — ใช้ GitHub CLI (ถ้าติดตั้งไว้)

```bash
cd "/Users/loftster/Mac HD/ClaudeCodex/TapTime/taptime-web"

gh auth login                       # ครั้งแรกเท่านั้น
gh repo create taptime --private --source=. --remote=origin --push
```

จบในคำสั่งเดียว — สร้าง repo, ตั้ง remote และ push ให้เลย

### 2.3 ตรวจว่าขึ้นครบ

เปิด repo บน GitHub แล้วเช็ก

- [ ] เห็น 76 ไฟล์ (`app/`, `lib/`, `src/`, `public/`, `supabase/`, `scripts/`, `test/`)
- [ ] **ไม่เห็น** `node_modules/`, `.env.local`, `generated/`
- [ ] มุมขวาบนขึ้นป้าย **Private**

---

## 3. เชื่อม Vercel

1. เข้า <https://vercel.com/new>
2. กด **Import Git Repository** → เลือก repo `taptime`
   - ครั้งแรก Vercel จะขอสิทธิ์เข้าถึง GitHub → กด **Install** แล้วเลือก
     *Only select repositories* → เลือก `taptime`
3. หน้า **Configure Project** ตั้งค่าดังนี้

| ช่อง | ค่า |
|---|---|
| Project Name | `taptime` (หรือชื่อที่ชอบ — มีผลกับ URL) |
| Framework Preset | **Next.js** (Vercel ตรวจให้เอง) |
| **Root Directory** | `./` — **ปล่อยไว้เฉย ๆ** เพราะ repo root คือ `taptime-web` อยู่แล้ว |
| Build Command | ปล่อยว่าง (ใช้ `npm run build` อัตโนมัติ) |
| Output Directory | ปล่อยว่าง |
| Install Command | ปล่อยว่าง |

> `npm run build` จะรัน `prebuild` → `build-html.mjs` ประกอบไฟล์ HTML ให้เองก่อน build
> จึงไม่ต้องตั้งค่าอะไรเพิ่ม

4. **ยังไม่กด Deploy** — ไปใส่ Environment Variables ก่อน (ข้อ 4)

---

## 4. ตั้งค่า Environment Variables

ในหน้า Configure Project กดขยายหัวข้อ **Environment Variables** แล้วใส่ให้ครบ **5 ตัว**

| Name | Value | เอามาจาก |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhb...` | API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhb...` | API → `service_role` **(ห้ามเผยแพร่)** |
| `SESSION_SECRET` | สุ่มเอง | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | `https://taptime.vercel.app` | โดเมนที่ Vercel จะให้ (เดาไว้ก่อนได้ เดี๋ยวมาแก้) |

ทุกตัวติ๊กให้ครบทั้ง **Production / Preview / Development**

> ค่าเดียวกับใน `.env.local` บนเครื่อง ยกเว้น `NEXT_PUBLIC_APP_URL`
> ที่ต้องเปลี่ยนจาก `http://localhost:3000` เป็นโดเมนจริง

5. กด **Deploy** แล้วรอประมาณ 1–2 นาที

---

## 5. สิ่งที่ต้องทำหลัง deploy ครั้งแรก (สำคัญมาก)

deploy ผ่านแล้วยังใช้งานไม่ได้เต็มที่จนกว่าจะทำ 3 ข้อนี้

### 5.1 แก้ `NEXT_PUBLIC_APP_URL` ให้ตรงโดเมนจริง

หลัง deploy Vercel จะบอกโดเมน เช่น `https://taptime-abc123.vercel.app`

1. Vercel → **Settings → Environment Variables**
2. แก้ `NEXT_PUBLIC_APP_URL` ให้เป็นโดเมนจริง (ไม่ต้องมี `/` ปิดท้าย)
3. ไปแท็บ **Deployments** → จุดสามจุดที่ deploy ล่าสุด → **Redeploy**

> ค่านี้ไม่ได้ใช้แค่สร้างลิงก์ — มันกำหนด **rpID ของ passkey** ด้วย
> ถ้าผิด พนักงานจะผูกอุปกรณ์ไม่ได้และเช็คอินไม่ผ่าน

### 5.2 ตั้งค่า URL ใน Supabase Auth

Supabase Dashboard → **Authentication → URL Configuration**

| ช่อง | ค่า |
|---|---|
| Site URL | `https://taptime-abc123.vercel.app` |
| Redirect URLs | เพิ่ม `https://taptime-abc123.vercel.app/set-password` |

ถ้าไม่ทำ ลิงก์ในอีเมลเชิญตั้งรหัสผ่านจะพาไป `localhost` แล้วใช้ไม่ได้

### 5.3 ตั้ง Custom SMTP — **บังคับ ไม่ใช่ทางเลือก**

#### ทำไมต้องทำ

SMTP ที่ Supabase แถมมาให้ **ไม่ได้แค่ส่งได้น้อย แต่ส่งหาพนักงานไม่ได้เลย**

| ข้อจำกัดของ SMTP ในตัว | ผลกับ TapTime |
|---|---|
| ส่งได้เฉพาะอีเมลที่เป็น **สมาชิกทีมใน organization** ของ Supabase | อีเมลพนักงานทั่วไปถูกปฏิเสธด้วย `Email address not authorized` |
| จำกัด **2 ฉบับ/ชั่วโมง** | เพิ่มพนักงาน 3 คนติดกันก็ตันแล้ว |
| ไม่มี SLA | Supabase ระบุเองว่าใช้ได้แค่ทดลอง/เดโม |

หลังตั้ง Custom SMTP เพดานจะเป็น **30 ฉบับ/ชั่วโมง** และปรับเพิ่มเองได้

#### ขั้นตอน (ตัวอย่างด้วย Resend — ฟรี 3,000 ฉบับ/เดือน)

**1. สมัครและยืนยันโดเมน**

1. สมัครที่ [resend.com](https://resend.com)
2. **Domains → Add Domain** ใส่โดเมนของบริษัท เช่น `example.com`
3. เอา DNS records ที่ให้มา (SPF / DKIM / DMARC) ไปใส่ในผู้ให้บริการโดเมน
   รอ verify สักครู่จนขึ้น **Verified**

> ยังไม่มีโดเมน? ใช้ `onboarding@resend.dev` ส่งได้ แต่**ส่งได้เฉพาะอีเมลตัวเอง**
> จะทดสอบได้ แต่เชิญพนักงานจริงไม่ได้ — สุดท้ายต้องมีโดเมน

**2. สร้าง API key** — Resend → **API Keys → Create** แล้วคัดลอกไว้

**3. กรอกใน Supabase** → **Authentication → Emails → SMTP Settings** → เปิด *Enable Custom SMTP*

| ช่อง | ค่า |
|---|---|
| Sender email | `no-reply@example.com` (ต้องเป็นโดเมนที่ verify แล้ว) |
| Sender name | `TapTime` |
| Host | `smtp.resend.com` |
| Port | `465` (SSL) หรือ `587` (STARTTLS) |
| Username | `resend` |
| Password | API key จากขั้นตอนที่ 2 |

กด **Save**

**4. ปรับเพดานการส่ง** → **Authentication → Rate Limits**

หา *Rate limit for sending emails* แล้วปรับตามจำนวนพนักงานที่จะเพิ่มต่อชั่วโมง
(เริ่มต้นหลังตั้ง SMTP = 30/ชม.) เช่นจะเพิ่มพนักงาน 100 คนรวดเดียว ให้ตั้ง ≥ 100

> ค่านี้เป็นเพดานของ **Supabase** ส่วนโควตารวมต่อเดือนเป็นของ **Resend** แยกกัน

**5. ทดสอบ** — เพิ่มพนักงานทดลอง 1 คนด้วยอีเมลที่ไม่ใช่ของคุณ แล้วดูว่าอีเมลถึงไหม

#### ผู้ให้บริการอื่นที่ Supabase รองรับ

| บริการ | Host | Port | Username | โควตาฟรี |
|---|---|---|---|---|
| **Resend** | `smtp.resend.com` | 465 / 587 | `resend` | 3,000/เดือน |
| **Brevo** | `smtp-relay.brevo.com` | 587 | อีเมลที่สมัคร | 300/วัน |
| **SendGrid** | `smtp.sendgrid.net` | 587 | `apikey` | 100/วัน |
| **Postmark** | `smtp.postmarkapp.com` | 587 | Server token | 100/เดือน |
| **AWS SES** | `email-smtp.<region>.amazonaws.com` | 587 | SMTP credentials | ถูกมากเมื่อใช้เยอะ |
| **Google Workspace** | `smtp.gmail.com` | 587 | อีเมลบริษัท | 2,000/วัน (ต้องใช้ App Password) |

ทั้งหมดใช้วิธีตั้งค่าเหมือนกัน เปลี่ยนแค่ Host / Port / Username / Password

#### ข้อควรรู้เพื่อไม่ให้อีเมลตกถังขยะ

- ตั้ง **SPF, DKIM, DMARC** ให้ครบ (ผู้ให้บริการจะบอก DNS records มาให้)
- **แยกโดเมนอีเมลระบบออกจากอีเมลการตลาด** เช่น `no-reply@auth.example.com`
  ถ้าชื่อเสียงของฝั่งการตลาดเสีย จะได้ไม่ลามมาถึงอีเมล login
- อย่าใส่เนื้อหาโปรโมชันในอีเมลเชิญ — ตัวกรองสแปมจะจัดเป็นอีเมลการตลาดทันที
- ถ้าจะเพิ่มพนักงานจำนวนมากรวดเดียว แจ้งผู้ให้บริการล่วงหน้า
  เพราะการส่งพุ่งขึ้นกะทันหันกระทบชื่อเสียงโดเมน

---

## 6. ตรวจสอบว่าใช้งานได้จริง

ไล่ตามนี้ทีละข้อ

| # | ทดสอบ | ผลที่ควรได้ |
|---|---|---|
| 1 | เปิด `https://<โดเมน>/` | เด้งไป `/login` |
| 2 | ดู favicon บนแท็บ | เป็นโลโก้ TapTime |
| 3 | login ด้วยบัญชีแอดมิน **บนคอมพิวเตอร์** | เข้าหน้า `/admin` |
| 4 | login ด้วยบัญชีเดียวกัน **บนมือถือ** | เข้าหน้า `/employee` (มีปุ่มเข้าแอดมินมุมขวาบน) |
| 5 | หน้าแอดมิน → จัดการพนักงาน | เห็นรายชื่อ ค้นหา/กรอง/แบ่งหน้าได้ |
| 6 | เพิ่มพนักงานใหม่พร้อมใส่อีเมล | ได้รับอีเมลเชิญตั้งรหัสผ่าน |
| 7 | กดลิงก์ในอีเมล | เข้าหน้า `/set-password` ตั้งรหัสได้ |
| 8 | login เป็นพนักงาน **บนมือถือจริง** | ขึ้นแผ่น "ผูกอุปกรณ์นี้" |
| 9 | กดผูกอุปกรณ์ | ขึ้น Face ID / ลายนิ้วมือ แล้วผูกสำเร็จ |
| 10 | ลากสไลด์เช็คอินที่หน้างาน | ขอ biometric แล้วเช็คอินสำเร็จ |
| 11 | กด "เพิ่มลงหน้าจอโฮม" บนมือถือ | ติดตั้งเป็นแอป เปิดเต็มจอ |

> ข้อ 8–10 **ต้องทดสอบบนมือถือจริงเท่านั้น** — WebAuthn ใช้ไม่ได้บน desktop
> ที่ไม่มีตัวอ่านชีวมิติ และต้องเป็น HTTPS (Vercel ให้มาอยู่แล้ว)

---

## 7. การทำงานต่อจากนี้

### แก้โค้ดแล้วอัปขึ้น

```bash
cd "/Users/loftster/Mac HD/ClaudeCodex/TapTime/taptime-web"

git add -A
git commit -m "อธิบายสั้น ๆ ว่าแก้อะไร"
git push
```

Vercel จะ build และ deploy ให้อัตโนมัติทุกครั้งที่ push เข้า `main`
ดูสถานะได้ที่แท็บ **Deployments**

### ถ้า deploy แล้วพัง — ย้อนกลับได้ทันที

Vercel → **Deployments** → เลือก deploy ตัวที่เคยดี → จุดสามจุด → **Promote to Production**
กลับไปเวอร์ชันเดิมภายในไม่กี่วินาที โดยไม่ต้อง revert git

### ใช้โดเมนของตัวเอง

Vercel → **Settings → Domains** → เพิ่มโดเมน แล้วตั้ง DNS ตามที่บอก

> ⚠️ **passkey ผูกกับโดเมน** ถ้าย้ายจาก `*.vercel.app` ไปโดเมนใหม่
> พนักงานทุกคนต้องผูกอุปกรณ์ใหม่ทั้งหมด — ควรตั้งโดเมนจริงให้เรียบร้อย
> **ก่อน** ให้พนักงานเริ่มใช้งาน
>
> อย่าลืมแก้ `NEXT_PUBLIC_APP_URL` และ Supabase URL Configuration ตามด้วย

---

## 8. ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Build ล้มเหลว `Module not found` | ลืม commit `package.json` หรือ `package-lock.json` — เช็กว่าอยู่ใน repo แล้ว |
| Build ผ่านแต่เปิดหน้าแล้ว error `ENOENT: generated/admin.html` | `prebuild` ไม่ทำงาน — ตรวจว่า Build Command ปล่อยว่างไว้ (อย่าเขียนทับเป็น `next build` เฉย ๆ) |
| `ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL` | ใส่ env ไม่ครบ หรือใส่แล้วไม่ได้ Redeploy — env ใหม่มีผลเฉพาะ deploy รอบถัดไป |
| login ได้แต่เด้งกลับหน้า login ตลอด | `SESSION_SECRET` ไม่ตรงกัน/ว่าง หรือเปลี่ยนค่าแล้ว cookie เดิมใช้ไม่ได้ → ล้าง cookie แล้ว login ใหม่ |
| ผูก passkey ไม่ได้ / เช็คอินแล้วขึ้น "ยืนยันตัวตนไม่สำเร็จ" | `NEXT_PUBLIC_APP_URL` ไม่ตรงกับโดเมนที่เปิดอยู่ → แก้ให้ตรงแล้ว Redeploy |
| อีเมลเชิญไม่ถึง / ขึ้น `Email address not authorized` | ยังไม่ได้ตั้ง Custom SMTP — SMTP ในตัวส่งได้เฉพาะอีเมลสมาชิกทีม → ดูข้อ 5.3 |
| อีเมลเชิญไม่ถึง (ตั้ง SMTP แล้ว) | ชน rate limit หรือโดเมนยังไม่ verify → เช็ก Authentication → Rate Limits และหน้า log ของผู้ให้บริการ |
| ลิงก์ในอีเมลพาไป localhost | Site URL ใน Supabase ยังเป็น localhost → แก้ตามข้อ 5.2 |
| Preview deployment ใช้ passkey ไม่ได้ | ปกติ — preview ได้โดเมนสุ่มทุกครั้ง ซึ่งไม่ตรงกับ rpID ให้ทดสอบ passkey บน production เท่านั้น |
| หน้าแอดมินเปิดบนมือถือแล้วเด้งไปหน้าพนักงาน | ตั้งใจให้เป็นแบบนั้น — ถ้าจำเป็นให้เข้า `/admin?force=1` |

---

## ภาคผนวก — คำสั่ง git ที่ใช้บ่อย

```bash
git status                  # ดูว่ามีอะไรเปลี่ยนบ้าง
git log --oneline           # ดูประวัติ commit
git diff                    # ดูรายละเอียดที่แก้ (ยังไม่ add)
git restore <ไฟล์>          # ยกเลิกการแก้ไฟล์นั้น
git remote -v               # ดูว่าต่อกับ repo ไหนอยู่
```

**สิ่งที่ห้าม commit เด็ดขาด**

`.gitignore` กันไว้ให้แล้ว แต่ควรรู้ไว้ว่าห้ามมี

- `.env.local` — มี `service_role` key ที่เข้าถึงฐานข้อมูลได้ทั้งหมด
- `node_modules/` — ใหญ่และไม่จำเป็น (`npm install` สร้างใหม่ได้)
- `generated/` — สร้างอัตโนมัติตอน build

> ถ้าเผลอ commit `.env.local` ไปแล้ว: **เปลี่ยน key ใหม่ทันที**
> ที่ Supabase → Project Settings → API → Reset ไม่ใช่แค่ลบไฟล์ออกจาก repo
