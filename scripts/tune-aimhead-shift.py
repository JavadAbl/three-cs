#!/usr/bin/env python3
"""Task 77: tune the hue-shift bake for aimhead's aztec greens.

PolyHaven carries no saturated green lawn (every grass/forest floor is dry
brown, G-R < 0), but the original aim_headshot is de_aztec-based — bright
green lawn ground + grey-green mossy temple walls. This tunes reproducible
HSV shifts on the best-detail candidates until the tone lands.

Usage: tune-aimhead-shift.py   (prints stats grid + writes preview sheet)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAW = Path('/home/z/my-project/scripts/.tmp/acg')
OUT = Path('/home/z/my-project/download/aimhead-shift-tune.jpg')
FONT = ImageFont.truetype(
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)


def shift(im: Image.Image, hue: int, sat: float, val: float) -> Image.Image:
    hsv = im.convert('HSV')
    h, s, v = hsv.split()
    h = h.point(lambda x: (x + hue) % 256)
    s = s.point(lambda x: min(255, int(x * sat)))
    v = v.point(lambda x: min(255, int(x * val)))
    return Image.merge('HSV', (h, s, v)).convert('RGB')


def stats(im: Image.Image):
    px = list(im.resize((64, 64)).getdata())
    n = len(px)
    mr = sum(p[0] for p in px) // n
    mg = sum(p[1] for p in px) // n
    mb = sum(p[2] for p in px) // n
    lums = [0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in px]
    mean = sum(lums) / n
    std = (sum((l - mean) ** 2 for l in lums) / n) ** 0.5
    return mr, mg, mb, std


# candidate grids: (hue shift 0-255 scale, sat mult, val mult)
GRASS = Image.open(RAW / 'grass_path_2_diff_1k.jpg').convert('RGB')
WALL = Image.open(RAW / 'mossy_cobblestone_diff_1k.jpg').convert('RGB')

variants = [
    ('grass hue36 s1.3', GRASS, 36, 1.3, 1.0),
    ('grass hue44 s1.4', GRASS, 44, 1.4, 1.0),
    ('grass hue52 s1.5', GRASS, 52, 1.5, 0.95),
    ('grass hue60 s1.6', GRASS, 60, 1.6, 0.9),
    ('wall hue22 s1.15', WALL, 22, 1.15, 1.0),
    ('wall hue32 s1.25', WALL, 32, 1.25, 0.95),
    ('wall hue44 s1.3', WALL, 44, 1.3, 0.9),
    ('wall hue52 s1.4', WALL, 52, 1.4, 0.9),
]

sheet = Image.new('RGB', (260 * 4 + 40, 260 * 2 + 96), (24, 24, 24))
dr = ImageDraw.Draw(sheet)
for i, (label, im, hue, sat, val) in enumerate(variants):
    out = shift(im, hue, sat, val)
    mr, mg, mb, std = stats(out)
    x = 20 + (i % 4) * 260
    y = 40 + (i // 4) * 272
    sheet.paste(out.resize((256, 256)), (x, y))
    ok = 'OK' if (mg - mr > 20 if 'grass' in label else 8 < mg - mr < 45) else '..'
    dr.text((x, y + 260), f'{label}  RGB({mr},{mg},{mb}) G-R={mg - mr} std={std:.1f} {ok}',
            font=FONT, fill=(150, 220, 150) if ok == 'OK' else (230, 170, 140))
    print(f'{label:18s} RGB({mr:3d},{mg:3d},{mb:3d}) G-R={mg - mr:+3d} std={std:5.1f} {ok}')
sheet.save(OUT, quality=88)
print(f'sheet: {OUT}')
