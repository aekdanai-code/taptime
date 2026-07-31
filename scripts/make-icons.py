#!/usr/bin/env python3
"""
make-icons.py — สร้างชุดไอคอน/favicon ของ TapTime จากไฟล์โลโก้ต้นฉบับ

    python3 scripts/make-icons.py <โลโก้ต้นฉบับ.png>

สิ่งที่ทำ
  1. ตัดขอบโปร่งใส/เงา ออกให้เหลือเฉพาะตัวไอคอน
  2. เติมพื้นหลังสีขาวเฉพาะ "ภายในรูปทรง" (หน้าปัดนาฬิกาในโลโก้เป็นพื้นโปร่งใส
     ถ้าไม่เติมจะกลายเป็นสีของพื้นหลังเว็บ ทำให้อ่านยากบนพื้นเข้ม)
  3. จัดให้เป็นสี่เหลี่ยมจัตุรัส แล้วย่อเป็นขนาดต่าง ๆ

ผลลัพธ์ทั้งหมดลงใน public/
  logo.png              512  โปร่งใส — ใช้ในหน้าเว็บ
  logo-192.png          192  โปร่งใส
  icon-192.png          192  PWA
  icon-512.png          512  PWA
  icon-maskable-512.png 512  PWA maskable (มี safe zone 80%)
  apple-touch-icon.png  180  iOS (ทึบ — iOS ไม่รองรับพื้นโปร่งใส)
  favicon-16/32/48.png       favicon แยกขนาด
  favicon.ico                รวม 16/32/48
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public'
WHITE = (255, 255, 255, 255)

# ระดับ alpha ที่ถือว่าเป็น "เนื้อไอคอน" (ต่ำกว่านี้คือเงา/แสงเรือง)
INK_THRESHOLD = 100


def trim(im: Image.Image) -> Image.Image:
    """ตัดให้เหลือเฉพาะตัวไอคอน (ทิ้งเงาและแสงเรืองรอบนอก)"""
    alpha = im.getchannel('A')
    box = alpha.point(lambda v: 255 if v > INK_THRESHOLD else 0).getbbox()
    return im.crop(box)


def corner_radius(im: Image.Image) -> int:
    """
    เดารัศมีมุมมนของการ์ด จากตำแหน่งที่ขอบบนสุด/ซ้ายสุดเริ่มมีเนื้อสี
    (แถวบนสุดจะเริ่มมีสีที่ x = radius พอดี)
    """
    ink = im.getchannel('A').point(lambda v: 255 if v > INK_THRESHOLD else 0)
    w, h = im.size
    top = [x for x in range(w) if ink.getpixel((x, 0))]
    left = [y for y in range(h) if ink.getpixel((0, y))]
    guesses = [v[0] for v in (top, left) if v]
    return int(sum(guesses) / len(guesses)) if guesses else int(w * 0.22)


def fill_card(im: Image.Image, color=WHITE) -> Image.Image:
    """
    เติมพื้นทึบใต้ตัวการ์ด

    ทำไมต้องทำ: การ์ดของโลโก้เป็นพื้น "โปร่งแสง" (glass) และหน้าปัดนาฬิกา
    เป็นรูโปร่งใสที่เชื่อมทะลุออกด้านนอกได้ ถ้าไม่เติมพื้น เวลาเอาไปวางบนพื้น
    สีเข้มหน้าปัดจะกลายเป็นสีดำ อ่านไม่ออก

    จึงวาดสี่เหลี่ยมมุมมนตามรูปทรงการ์ด เติมสีขาว แล้ววางโลโก้ทับ
    (ส่วนที่ยื่นออกนอกการ์ด เช่น นิ้วมือ ยังแสดงครบเพราะวางทับทีหลัง)
    """
    w, h = im.size
    side = min(w, h)          # การ์ดเป็นจัตุรัส ส่วนที่เกินคือนิ้วที่ยื่นออกมา
    r = corner_radius(im)

    card = Image.new('L', im.size, 0)
    ImageDraw.Draw(card).rounded_rectangle(
        [0, 0, side - 1, side - 1], radius=r, fill=255
    )

    base = Image.new('RGBA', im.size, (0, 0, 0, 0))
    base.paste(Image.new('RGBA', im.size, color), (0, 0), card)
    base.alpha_composite(im)
    return base


def squarify(im: Image.Image, pad_ratio=0.0) -> Image.Image:
    """จัดกึ่งกลางบนผืนสี่เหลี่ยมจัตุรัสโปร่งใส (pad_ratio = เว้นขอบกี่ % ของด้าน)"""
    w, h = im.size
    side = int(max(w, h) * (1 + pad_ratio * 2))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((side - w) // 2, (side - h) // 2))
    return canvas


def resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.LANCZOS)


def on_background(im: Image.Image, color=WHITE) -> Image.Image:
    bg = Image.new('RGBA', im.size, color)
    bg.alpha_composite(im)
    return bg


def main(src_path: str):
    OUT.mkdir(parents=True, exist_ok=True)

    src = Image.open(src_path).convert('RGBA')
    icon = trim(src)
    print(f'  ตัดขอบแล้ว: {icon.size}')

    solid = squarify(fill_card(icon))          # ทึบข้างใน ขอบมนโปร่งใส
    clear = squarify(icon)                         # โปร่งใสล้วน (ใช้ในหน้าเว็บ)

    # --- โลโก้สำหรับใช้ในหน้าเว็บ (พื้นโปร่งใส) ---
    resize(solid, 512).save(OUT / 'logo.png')
    resize(solid, 192).save(OUT / 'logo-192.png')

    # --- PWA ---
    resize(solid, 192).save(OUT / 'icon-192.png')
    resize(solid, 512).save(OUT / 'icon-512.png')

    # maskable: Android ครอบรูปทรงเอง ต้องเว้น safe zone ~20% รอบด้าน
    maskable = on_background(resize(squarify(fill_card(icon), 0.11), 512))
    maskable.save(OUT / 'icon-maskable-512.png')

    # --- iOS (ไม่รองรับพื้นโปร่งใส ต้องทึบ) ---
    on_background(resize(squarify(fill_card(icon), 0.04), 180)) \
        .save(OUT / 'apple-touch-icon.png')

    # --- favicon ---
    favicons = []
    for size in (16, 32, 48):
        f = on_background(resize(solid, size))
        f.save(OUT / f'favicon-{size}.png')
        favicons.append(f.convert('RGB'))

    favicons[2].save(
        OUT / 'favicon.ico',
        format='ICO',
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    for f in sorted(OUT.glob('*')):
        if f.suffix in ('.png', '.ico'):
            print(f'  ✓ public/{f.name}  ({f.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: python3 scripts/make-icons.py <โลโก้.png>')
        sys.exit(1)
    main(sys.argv[1])
