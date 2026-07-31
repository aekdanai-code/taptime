#!/usr/bin/env node
/**
 * build-html.mjs — ประกอบไฟล์ HTML ของ Admin / Employee / Login
 *
 * แทนที่ `include(name)` ของ Apps Script:
 *   <?!= include('AdminStyles'); ?>  ->  เนื้อหาไฟล์ AdminStyles.html
 *   <?= token ?>                     ->  __TAPTIME_TOKEN__ (route handler แทนค่าจริง)
 *
 * แล้วแทรก shim.html (จำลอง google.script.run + ชั้น WebAuthn) ไว้ก่อนสคริปต์อื่น
 * -> ไฟล์ต้นฉบับใน src/frontend-* ไม่ถูกแก้ไขแม้แต่บรรทัดเดียว UI จึงเหมือนเดิม 100%
 *
 * ผลลัพธ์: generated/admin.html, generated/employee.html, generated/login.html,
 *          generated/set-password.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'generated');

const DIRS = [join(SRC, 'frontend-admin'), join(SRC, 'frontend-employee'), SRC];

/* -------------------------------------------------- ไอคอน / favicon / PWA */

/**
 * viewport — สำคัญมาก
 *
 * ของเดิมบน Apps Script ใส่แท็กนี้จาก `doGet()` ด้วย `.addMetaTag('viewport', ...)`
 * ไม่ได้อยู่ในไฟล์ HTML ตอนพอร์ตมา Next.js จึงหายไป
 * ผลคือมือถือเดาความกว้างหน้าเว็บเป็น ~980px แล้วย่อทั้งหน้าลง
 * ทำให้ `.wrap{max-width:440px}` กลายเป็นคอลัมน์แคบ ๆ กลางจอ มีขอบขาวสองข้าง
 */
const VIEWPORT = {
  // มือถือ: ล็อกไม่ให้ย่อ/ขยาย (ตรงกับสเปกเดิม)
  employee: 'width=device-width, initial-scale=1, maximum-scale=1',
  // เดสก์ท็อป: ให้ซูมได้ตามปกติ
  admin: 'width=device-width, initial-scale=1',
};

/** แท็ก <link> ชุดไอคอน — ใส่ในทุกหน้าของแอป */
const HEAD_ICONS = `
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#12a150">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="TapTime">`;

/** แทรก viewport + แท็กไอคอนเข้าไปใน <head> */
function injectIcons(html, viewport) {
  const tags =
    (viewport ? `\n<meta name="viewport" content="${viewport}">` : '') + HEAD_ICONS;
  if (html.includes('</head>')) return html.replace('</head>', tags + '\n</head>');
  return tags + html;
}

const LOGOUT_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M14 4.5h4a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-4"/><path d="M9 16l-4-4 4-4M5 12h10.5"/></svg>';

const AUTH_CSS = `
  :root{
    --green:#12a150; --green2:#0e8a44; --orange:#e8820c; --red:#e0453b;
    --gray:#3a4048; --muted:#8a9099; --blue:#3b6ef5;
    --ink:#1a1d21; --line:#eceef1; --bg:#f2f3f5; --radius:18px;
  }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:var(--bg);font-family:'Noto Sans Thai',Sarabun,system-ui,sans-serif;
    color:var(--ink);padding:20px}
  .card{width:100%;max-width:400px;background:#fff;border-radius:var(--radius);
    padding:34px 30px;box-shadow:0 10px 40px rgba(20,25,35,.09)}
  .brand{display:flex;align-items:center;gap:11px;font-size:23px;font-weight:700;margin-bottom:6px}
  .logo{width:40px;height:40px;border-radius:11px;display:block;object-fit:contain}
  .sub{color:var(--muted);font-size:15px;margin-bottom:26px}
  label{display:block;font-size:14px;font-weight:500;margin:0 0 6px}
  input[type=email],input[type=password]{width:100%;padding:12px 14px;border:1px solid var(--line);
    border-radius:11px;font-size:16px;font-family:inherit;margin-bottom:16px;outline:none;background:#fbfbfc}
  input:focus{border-color:var(--green);background:#fff}
  .remember{display:flex;align-items:center;gap:9px;margin:2px 0 20px;
    font-size:15px;color:#4a505a;cursor:pointer;user-select:none}
  .remember input{width:19px;height:19px;accent-color:var(--green);margin:0;cursor:pointer}
  button{width:100%;padding:13px;border:0;border-radius:11px;background:var(--gray);color:#fff;
    font-size:16px;font-weight:600;font-family:inherit;cursor:pointer;transition:.15s}
  button:hover{background:#22262c}
  button:disabled{opacity:.6;cursor:default}
  .err{background:#fdeaea;color:var(--red);border-radius:10px;padding:11px 13px;
    font-size:14px;margin-bottom:16px;display:none}
  .err.show{display:block}
  .ok{background:#e8f6ee;color:var(--green2);border-radius:10px;padding:11px 13px;
    font-size:14px;margin-bottom:16px;display:none}
  .ok.show{display:block}
  .hint{margin-top:20px;font-size:13px;color:var(--muted);line-height:1.7;text-align:center}
`;

function readPartial(name) {
  for (const d of DIRS) {
    const p = join(d, name + '.html');
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error(`ไม่พบไฟล์ partial: ${name}.html`);
}

/** แทน <?!= include('X'); ?> แบบวนซ้ำ (เผื่อ partial ซ้อน partial) */
function expand(html, depth = 0) {
  if (depth > 10) throw new Error('include ซ้อนกันลึกเกินไป');
  const re = /<\?!?=\s*include\(\s*['"]([\w-]+)['"]\s*\)\s*;?\s*\?>/g;
  if (!re.test(html)) return html;
  re.lastIndex = 0;
  return expand(html.replace(re, (_, name) => readPartial(name)), depth + 1);
}

const SHIM = readPartial('shim');

/** แทรกสคริปต์ทันทีหลัง <body> เพื่อให้ประกาศก่อนสคริปต์ของหน้า */
function injectHead(html, code) {
  if (html.includes('<body>')) return html.replace('<body>', '<body>\n' + code);
  return code + html;
}

mkdirSync(OUT, { recursive: true });

/* ---------------- Admin ---------------- */
{
  let html = expand(readFileSync(join(SRC, 'frontend-admin', 'Admin.html'), 'utf8'));
  html = injectIcons(html, VIEWPORT.admin);
  html = injectHead(html, SHIM);
  html = html.replace('</body>', `${ADMIN_EXTRA()}\n</body>`);
  writeFileSync(join(OUT, 'admin.html'), html);
  console.log('  ✓ generated/admin.html');
}

/* ---------------- Employee ---------------- */
{
  let html = expand(readFileSync(join(SRC, 'frontend-employee', 'Employee.html'), 'utf8'));
  html = injectIcons(html, VIEWPORT.employee);
  html = html.replace(/<\?=\s*token\s*\?>/g, '__TAPTIME_TOKEN__');
  // ค่าจาก server ต้องประกาศ "ก่อน" shim เพราะ shim อ่าน WEBAUTHN ตอนโหลด
  const bootstrap =
    '<script>\n' +
    'var WEBAUTHN = __TAPTIME_WEBAUTHN__;\n' +
    'var IS_ADMIN = __TAPTIME_IS_ADMIN__;\n' +
    '</script>\n';
  html = injectHead(html, bootstrap + SHIM);
  html = html.replace('</body>', `${EMPLOYEE_EXTRA()}\n</body>`);
  writeFileSync(join(OUT, 'employee.html'), html);
  console.log('  ✓ generated/employee.html');
}

/* ---------------- Login / Set password ---------------- */
writeFileSync(join(OUT, 'login.html'), injectIcons(LOGIN_PAGE()));   // มี viewport ในเทมเพลตแล้ว
console.log('  ✓ generated/login.html');
writeFileSync(join(OUT, 'set-password.html'), injectIcons(SET_PASSWORD_PAGE()));
console.log('  ✓ generated/set-password.html');

/* ========================================================================== */

function ADMIN_EXTRA() {
  return `<!-- เพิ่มโดย build-html.mjs: ปุ่มออกจากระบบ + แจ้งผลส่งอีเมลเชิญ -->
<style>
  /* ใช้โลโก้จริงแทนตัวอักษร "T" ใน sidebar (ไม่แก้ Admin.html) */
  .brand .logo{background:url('/logo.png') center/contain no-repeat !important;
    font-size:0 !important;border-radius:7px !important;width:28px !important;height:28px !important}
  .topbar{position:relative}
  .tt-logout{position:absolute;right:18px;top:50%;transform:translateY(-50%);
    display:flex;align-items:center;gap:7px;font-size:14px;color:#6b7280;
    cursor:pointer;padding:7px 12px;border:1px solid #e5e7eb;border-radius:9px;
    background:#fff;transition:.15s}
  .tt-logout:hover{color:#e0453b;border-color:#f3c9c6;background:#fff7f6}
</style>
<script>
(function(){
  /* แจ้งผลการส่งอีเมลเชิญตั้งรหัสผ่าน หลังบันทึกพนักงาน */
  window.__ttAfterRpc = function(fn, data){
    if(fn !== 'saveEmployee' || !data) return;
    setTimeout(function(){
      if(typeof toast !== 'function') return;
      if(data.invited){
        if(data.redirectTo && /localhost|127\\.0\\.0\\.1/.test(data.redirectTo)){
          toast('ส่งอีเมลแล้ว แต่ลิงก์ชี้ไป ' + data.redirectTo + ' — ตรวจ Site URL ใน Supabase');
        } else {
          toast('ส่งอีเมลตั้งรหัสผ่านไปที่ ' + data.email + ' แล้ว');
        }
      } else if(data.inviteError){
        toast('บันทึกแล้ว แต่ส่งอีเมลไม่สำเร็จ: ' + data.inviteError);
      }
    }, 2300);   /* รอ toast 'บันทึกพนักงานแล้ว' หายก่อน */
  };

  window.addEventListener('load', function(){
    var bar = document.querySelector('.topbar');
    if(!bar) return;
    var b = document.createElement('div');
    b.className = 'tt-logout';
    b.innerHTML = '${LOGOUT_SVG} ออกจากระบบ';
    b.onclick = function(){
      fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})
        .then(function(){ location.href = '/login'; });
    };
    bar.appendChild(b);
  });
})();
</script>`;
}

function EMPLOYEE_EXTRA() {
  return `<!-- เพิ่มโดย build-html.mjs: ออกจากระบบ / ทางเข้าแอดมิน / ผูก passkey -->
<style>
  .tt-fab{position:fixed;top:14px;right:14px;z-index:60;display:flex;gap:8px}
  .tt-fab > div{background:rgba(255,255,255,.92);border:1px solid #e5e7eb;border-radius:10px;
    padding:8px 10px;font-size:15px;color:#6b7280;cursor:pointer;backdrop-filter:blur(4px);
    display:flex;align-items:center;gap:6px}
  .tt-fab > div:active{background:#f3f4f6}
  .tt-enroll{position:fixed;left:0;right:0;bottom:0;z-index:70;background:#fff;
    border-top:1px solid #eceef1;padding:20px 18px calc(20px + env(safe-area-inset-bottom));
    box-shadow:0 -8px 30px rgba(20,25,35,.12)}
  .tt-enroll h4{margin:0 0 6px;font-size:19px}
  .tt-enroll p{margin:0 0 14px;color:#8a9099;font-size:16px;line-height:1.55}
  .tt-enroll button{width:100%;padding:14px;border:0;border-radius:12px;background:#12a150;
    color:#fff;font-size:17px;font-weight:600;font-family:inherit;cursor:pointer}
  .tt-enroll button:disabled{opacity:.6}
  .tt-enroll .err{color:#e0453b;font-size:15px;margin-top:10px;display:none}
</style>
<script>
(function(){
  window.addEventListener('load', function(){
    /* ---- ปุ่มลอยมุมขวาบน ---- */
    var box = document.createElement('div');
    box.className = 'tt-fab';

    if (typeof IS_ADMIN !== 'undefined' && IS_ADMIN) {
      var a = document.createElement('div');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9 5 4.5h14L20.5 9"/><path d="M4.5 9v10.5h15V9"/></svg>';
      a.title = 'หน้าผู้ดูแลระบบ';
      a.onclick = function(){ location.href = '/admin?force=1'; };
      box.appendChild(a);
    }

    var out = document.createElement('div');
    out.innerHTML = '${LOGOUT_SVG}';
    out.title = 'ออกจากระบบ';
    out.onclick = function(){
      fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'})
        .then(function(){ location.href = '/login'; });
    };
    box.appendChild(out);
    document.body.appendChild(box);

    /* ---- แผ่นชวนผูกอุปกรณ์ (ถ้าบังคับใช้ passkey แต่ยังไม่ได้ผูก) ---- */
    var wa = (typeof WEBAUTHN !== 'undefined') ? WEBAUTHN : null;
    if (!wa || !wa.required || wa.enrolled) return;

    var panel = document.createElement('div');
    panel.className = 'tt-enroll';
    var supported = window.ttSupportsWebAuthn && window.ttSupportsWebAuthn();
    panel.innerHTML = supported
      ? '<h4>ผูกอุปกรณ์ก่อนเริ่มใช้งาน</h4>' +
        '<p>เพื่อป้องกันการลงเวลาแทนกัน ระบบจะขอปลดล็อกเครื่องนี้ทุกครั้งที่เช็คอิน-เอาท์ ' +
        'ด้วย Face ID, ลายนิ้วมือ <b>หรือ PIN/รูปแบบปลดล็อกหน้าจอ</b> ก็ได้</p>' +
        '<button id="ttEnrollBtn">ผูกอุปกรณ์นี้</button>' +
        '<div class="err" id="ttEnrollErr"></div>'
      : '<h4>อุปกรณ์นี้ยังใช้ลงเวลาไม่ได้</h4>' +
        '<p>เครื่องนี้ยังยืนยันตัวตนไม่ได้ ลองทำตามนี้ก่อน<br>' +
        '1. ตั้งล็อกหน้าจอ (PIN / รูปแบบ / ลายนิ้วมือ) ในการตั้งค่าเครื่อง<br>' +
        '2. เปิดผ่าน Chrome หรือ Safari โดยตรง ไม่ใช่เบราว์เซอร์ในแอป LINE/Facebook<br>' +
        'ถ้ายังไม่ได้ แจ้งผู้ดูแลระบบเพื่อขอยกเว้น</p>';
    document.body.appendChild(panel);

    var btn = document.getElementById('ttEnrollBtn');
    if (!btn) return;
    btn.onclick = function(){
      var err = document.getElementById('ttEnrollErr');
      err.style.display = 'none';
      btn.disabled = true; btn.textContent = 'กำลังยืนยัน...';
      window.ttEnrollPasskey().then(function(){
        panel.remove();
        if (typeof toast === 'function') toast('ผูกอุปกรณ์เรียบร้อย');
      }).catch(function(e){
        err.textContent = window.ttWebAuthnMessage ? window.ttWebAuthnMessage(e) : (e.message || e);
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'ผูกอุปกรณ์นี้';
      });
    };
  });
})();
</script>`;
}

/* ---------------------------------------------------------------- หน้า login */



function LOGIN_PAGE() {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>เข้าสู่ระบบ - TapTime</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${AUTH_CSS}</style>
</head>
<body>
<form class="card" id="f" autocomplete="on">
  <div class="brand"><img class="logo" src="/logo.png" alt="TapTime"> TapTime</div>
  <div class="sub">ระบบลงเวลาเข้า-ออกงาน</div>

  <div class="err" id="err"></div>

  <label for="email">อีเมล</label>
  <input id="email" name="email" type="email" autocomplete="username" required placeholder="you@example.com">

  <label for="password">รหัสผ่าน</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••">

  <label class="remember">
    <input type="checkbox" id="remember" checked>
    <span>จดจำฉันไว้ในเครื่องนี้ (30 วัน)</span>
  </label>

  <button type="submit" id="btn">เข้าสู่ระบบ</button>

  <div class="hint">ยังไม่มีรหัสผ่าน? ตรวจอีเมลเชิญจากผู้ดูแลระบบ<br>หรือติดต่อผู้ดูแลระบบให้ส่งอีเมลใหม่</div>
</form>
<script>
var f=document.getElementById('f'), err=document.getElementById('err'), btn=document.getElementById('btn');

/* บอกเซิร์ฟเวอร์ว่าเป็นจอเล็กหรือใหญ่ — แม่นกว่าเดา user-agent อย่างเดียว
   (iPad รุ่นใหม่ปลอม UA เป็น Mac) */
function deviceHint(){
  var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var narrow = Math.min(screen.width, screen.height) <= 820;
  return (coarse && narrow) ? 'mobile' : (coarse ? 'mobile' : 'desktop');
}

f.addEventListener('submit', function(e){
  e.preventDefault();
  err.classList.remove('show'); btn.disabled=true; btn.textContent='กำลังเข้าสู่ระบบ...';
  fetch('/api/auth/login',{
    method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin',
    body: JSON.stringify({
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
      remember: document.getElementById('remember').checked,
      device: deviceHint()
    })
  }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok, d:d}; }); })
    .then(function(res){
      if(!res.ok) throw new Error(res.d.error||'เข้าสู่ระบบไม่สำเร็จ');
      var next = new URLSearchParams(location.search).get('next');
      location.href = next || res.d.redirect || '/employee';
    })
    .catch(function(e){
      err.textContent = e.message; err.classList.add('show');
      btn.disabled=false; btn.textContent='เข้าสู่ระบบ';
    });
});
</script>
</body>
</html>`;
}

function SET_PASSWORD_PAGE() {
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ตั้งรหัสผ่าน - TapTime</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${AUTH_CSS}</style>
</head>
<body>
<form class="card" id="f">
  <div class="brand"><img class="logo" src="/logo.png" alt="TapTime"> TapTime</div>
  <div class="sub">ตั้งรหัสผ่านสำหรับเข้าใช้งาน</div>

  <div class="err" id="err"></div>
  <div class="ok"  id="ok"></div>

  <label for="p1">รหัสผ่านใหม่</label>
  <input id="p1" type="password" autocomplete="new-password" required placeholder="อย่างน้อย 8 ตัวอักษร">

  <label for="p2">ยืนยันรหัสผ่าน</label>
  <input id="p2" type="password" autocomplete="new-password" required placeholder="พิมพ์อีกครั้ง">

  <button type="submit" id="btn">บันทึกรหัสผ่าน</button>
  <div class="hint">ลิงก์นี้ใช้ได้ครั้งเดียวและมีอายุจำกัด</div>
</form>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script>
var err=document.getElementById('err'), ok=document.getElementById('ok'), btn=document.getElementById('btn');
function fail(m){ err.textContent=m; err.classList.add('show'); }

var sb = window.supabase.createClient('__SUPABASE_URL__','__SUPABASE_ANON__',{
  auth:{ detectSessionInUrl:true, flowType:'implicit', persistSession:false }
});

/* ลิงก์จากอีเมลของ Supabase ส่ง token มาใน hash (#access_token=...) */
var ready = sb.auth.getSession().then(function(r){
  if(!r.data.session){
    fail('ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว — กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ');
    btn.disabled = true;
  }
});

document.getElementById('f').addEventListener('submit', function(e){
  e.preventDefault();
  err.classList.remove('show'); ok.classList.remove('show');
  var p1=document.getElementById('p1').value, p2=document.getElementById('p2').value;
  if(p1.length < 8) return fail('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  if(p1 !== p2)     return fail('รหัสผ่านทั้งสองช่องไม่ตรงกัน');

  btn.disabled=true; btn.textContent='กำลังบันทึก...';
  sb.auth.updateUser({ password: p1 }).then(function(r){
    if(r.error) throw new Error(r.error.message);
    ok.textContent='ตั้งรหัสผ่านเรียบร้อย กำลังพาไปหน้าเข้าสู่ระบบ...';
    ok.classList.add('show');
    return sb.auth.signOut();
  }).then(function(){
    setTimeout(function(){ location.href='/login'; }, 1500);
  }).catch(function(e){
    fail(e.message); btn.disabled=false; btn.textContent='บันทึกรหัสผ่าน';
  });
});
</script>
</body>
</html>`;
}
