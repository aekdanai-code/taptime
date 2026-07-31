/**********************************************************************
 * page.ts — อ่านไฟล์ HTML ที่ประกอบไว้แล้วใน generated/
 **********************************************************************/
import { readFileSync } from 'fs';
import { join } from 'path';

const cache = new Map<string, string>();

export function readGenerated(name: string): string {
  if (process.env.NODE_ENV === 'production' && cache.has(name)) {
    return cache.get(name)!;
  }
  const p = join(process.cwd(), 'generated', name);
  const html = readFileSync(p, 'utf8');
  cache.set(name, html);
  return html;
}

export function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
