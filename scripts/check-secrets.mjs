#!/usr/bin/env node
/**
 * check-secrets.mjs — กันความลับหลุดขึ้น git
 *
 * รันอัตโนมัติก่อน build / test / dev
 * ถ้าเจอค่าที่ดูเหมือนของจริงในไฟล์ที่ถูก commit ขึ้น git จะหยุดทันที
 *
 * เคยเกิดจริง: มีการกรอกค่าจริงลงใน .env.local.example (ซึ่งถูก track ใน git)
 * ถ้าเผลอ commit ไป service_role key จะหลุดออกสาธารณะ
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** ไฟล์ที่ commit ขึ้น git และต้องไม่มีค่าจริง */
const TRACKED = ['.env.local.example'];

const PATTERNS = [
  { name: 'Supabase JWT (anon / service_role)', re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{20,}/ },
  { name: 'ค่า secret แบบ hex ยาว (SESSION_SECRET / CRON_SECRET)', re: /^(SESSION_SECRET|CRON_SECRET)=[0-9a-f]{32,}\s*$/m },
  { name: 'Supabase project URL จริง', re: /^NEXT_PUBLIC_SUPABASE_URL=https:\/\/[a-z0-9]{15,}\.supabase\.co/m },
];

let bad = false;

for (const file of TRACKED) {
  const p = join(ROOT, file);
  if (!existsSync(p)) continue;
  const text = readFileSync(p, 'utf8');

  for (const { name, re } of PATTERNS) {
    if (re.test(text)) {
      bad = true;
      console.error(`\n❌ พบค่าจริงใน ${file}: ${name}`);
    }
  }
}

/* NEXT_PUBLIC_APP_URL ต้องเป็นโดเมนล้วน ไม่มี path ต่อท้าย */
const envLocal = join(ROOT, '.env.local');
if (existsSync(envLocal)) {
  const m = readFileSync(envLocal, 'utf8').match(/^NEXT_PUBLIC_APP_URL=(.+)$/m);
  if (m) {
    const v = m[1].trim().replace(/\/+$/, '');
    try {
      const u = new URL(v);
      if (u.pathname && u.pathname !== '/') {
        console.error(
          `\n⚠️  NEXT_PUBLIC_APP_URL มี path ต่อท้าย: ${v}` +
          `\n    ต้องใส่แค่โดเมน -> ${u.origin}` +
          `\n    ไม่งั้นลิงก์ในอีเมลเชิญจะพาไปหน้า 404`
        );
      }
    } catch {
      console.error(`\n⚠️  NEXT_PUBLIC_APP_URL ไม่ใช่ URL ที่ถูกต้อง: ${v}`);
    }
  }
}

if (bad) {
  console.error(
    '\nไฟล์นี้ถูก commit ขึ้น git — ห้ามมีค่าจริง' +
    '\nย้ายค่าจริงไปไว้ใน .env.local (ถูก .gitignore ไว้แล้ว) แล้วคืนไฟล์ตัวอย่างเป็นค่าว่าง' +
    '\n\nถ้าเผลอ commit ไปแล้ว: ต้อง **เปลี่ยน key ใหม่** ที่ Supabase ไม่ใช่แค่ลบไฟล์\n'
  );
  process.exit(1);
}
