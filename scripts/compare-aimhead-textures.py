#!/usr/bin/env python3
"""Task 77: compare grass + mossy-wall candidates for the aimhead aztec set.

Target identity: de_aztec — saturated green lawn ground (AzGrass) and
grey/green weathered temple stone walls (AzWll). Prints tone/detail stats
(mean RGB, green dominance G-R, luminance stddev = detail) and writes a
labeled contact sheet for VLM judging.

Usage: compare-aimhead-textures.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAW = Path('/home/z/my-project/scripts/.tmp/acg')
OUT = Path('/home/z/my-project/download/aimhead-candidates.jpg')
FONT = ImageFont.truetype(
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)

GRASS = ['grass_ground', 'leafy_grass', 'sparse_grass', 'grass_path_2',
         'grassy_cobblestone', 'aerial_grass_rock', 'grass_concrete_pavement']
WALLS = ['mossy_sandstone', 'mossy_cobblestone', 'castle_brick_02_white',
         'mossy_brick', 'cobblestone_05', 'castle_brick_07']


def stats(asset: str):
    im = Image.open(RAW / f'{asset}_diff_1k.jpg').convert('RGB')
    px = list(im.resize((64, 64)).getdata())
    n = len(px)
    mr = sum(p[0] for p in px) // n
    mg = sum(p[1] for p in px) // n
    mb = sum(p[2] for p in px) // n
    lums = [0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in px]
    mean = sum(lums) / n
    std = (sum((l - mean) ** 2 for l in lums) / n) ** 0.5
    return mr, mg, mb, std


def row(assets: list, label: str, y: int, sheet, dr) -> int:
    x = 8
    for a in assets:
        im = Image.open(RAW / f'{a}_diff_1k.jpg').convert('RGB')
        tile = im.resize((200, 200))
        sheet.paste(tile, (x, y))
        mr, mg, mb, std = stats(a)
        dr.text((x, y + 204), a[:22], font=FONT, fill=(240, 240, 240))
        dr.text((x, y + 228), f"RGB({mr},{mg},{mb}) G-R={mg-mr} std={std:.1f}",
                font=FONT, fill=(150, 220, 150) if mg > mr else (230, 170, 140))
        x += 208
    dr.text((8, y - 26), label, font=FONT, fill=(255, 210, 90))
    return y + 258


sheet = Image.new('RGB', (208 * 7 + 16, 258 * 2 + 90), (24, 24, 24))
dr = ImageDraw.Draw(sheet)
y = row(GRASS, 'GROUND candidates (target: saturated green lawn)', 40, sheet, dr)
y = row(WALLS, 'WALL candidates (target: grey/green mossy temple stone)', y + 10, sheet, dr)
sheet.save(OUT, quality=88)

print(f'{"asset":26s} {"RGB":15s} {"G-R":>4s} {"std":>5s}  verdict')
for a in GRASS + WALLS:
    mr, mg, mb, std = stats(a)
    green = 'GREEN' if mg - mr > 10 else ('neutral' if abs(mg - mr) <= 10 else 'BROWN')
    print(f'{a:26s} ({mr:3d},{mg:3d},{mb:3d})   {mg-mr:+4d} {std:5.1f}  {green}')
print(f'\nsheet: {OUT}')
