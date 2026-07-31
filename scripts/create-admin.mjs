#!/usr/bin/env node
/**
 * create-admin.mjs — สร้างบัญชีผู้ดูแลระบบคนแรก
 *
 *   node scripts/create-admin.mjs <email> <password> ["ชื่อ-สกุล"]
 *
 * สิ่งที่ทำ
 *   1. สร้าง user ใน Supabase Auth (ยืนยันอีเมลให้อัตโนมัติ)
 *   2. ถ้ามี profile ที่อีเมลตรงกันอยู่แล้ว -> ผูก authUserId + ตั้ง role = admin
 *      ถ้าไม่มี -> สร้าง profile ใหม่ให้
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

/* ---- โหลด .env.local เอง (สคริปต์นี้รันนอก Next.js) ---- */
for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const [, , email, password, nameArg] = process.argv;
if (!email || !password) {
  console.error('ใช้งาน: node scripts/create-admin.mjs <email> <password> ["ชื่อ-สกุล"]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('ไม่พบ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env.local');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/* 1) สร้าง auth user (ถ้ามีอยู่แล้วให้หา id เดิม) */
let userId;
const { data: created, error: cErr } = await db.auth.admin.createUser({
  email, password, email_confirm: true,
});

if (cErr) {
  if (!/already|exist/i.test(cErr.message)) {
    console.error('สร้างบัญชีไม่สำเร็จ:', cErr.message);
    process.exit(1);
  }
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const found = list?.users?.find((u) => u.email === email);
  if (!found) { console.error('มีอีเมลนี้อยู่แล้วแต่หา user ไม่เจอ'); process.exit(1); }
  userId = found.id;
  await db.auth.admin.updateUserById(userId, { password });
  console.log('• มีบัญชีอยู่แล้ว — อัปเดตรหัสผ่านให้ใหม่');
} else {
  userId = created.user.id;
  console.log('• สร้างบัญชี Supabase Auth เรียบร้อย');
}

/* 2) ผูก / สร้าง profile */
const { data: existing } = await db
  .from('profiles').select('*').eq('email', email).limit(1).maybeSingle();

if (existing) {
  const { error } = await db.from('profiles')
    .update({ authUserId: userId, role: 'admin', status: 'active' })
    .eq('empId', existing.empId);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`• ผูกกับพนักงานเดิม "${existing.name}" (${existing.empId}) และตั้งเป็น admin`);
} else {
  const { data: branch } = await db
    .from('branches').select('branchId').limit(1).maybeSingle();
  const empId = 'EMP-' + randomUUID().substring(0, 8);
  const { error } = await db.from('profiles').insert({
    empId,
    authUserId: userId,
    name: nameArg || 'ผู้ดูแลระบบ',
    email,
    role: 'admin',
    status: 'active',
    branchId: branch?.branchId || null,
  });
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`• สร้าง profile ใหม่ ${empId} (role = admin)`);
}

console.log(`\nพร้อมใช้งาน — เข้าสู่ระบบที่ /login ด้วย ${email}`);
