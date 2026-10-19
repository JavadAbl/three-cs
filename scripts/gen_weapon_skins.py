#!/usr/bin/env python3
"""
Generate original demo weapon skins for the external skin system.
Artwork is 100% procedurally generated here (no game assets involved).
Output: /home/z/my-project/public/assets/textures/weapons/
  ak47.png       "Jungle Digital"  — olive digital camo + 7.62x39 stencil
  ak47_bump.png  subtle bump aligned with the camo blobs
  awp.png        "Arctic Splinter" — white base, grey-blue angular strokes
  deagle.png     "Carbon Blaze"    — carbon weave + orange streaks
  skins.json     manifest (tells the client which skins exist, avoids 404 probing)
"""
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path('/home/z/my-project/public/assets/textures/weapons')
OUT.mkdir(parents=True, exist_ok=True)
S = 512
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def wrap_offsets():
    for dx in (-S, 0, S):
        for dy in (-S, 0, S):
            yield dx, dy


def add_grain(img, sigma=14, alpha=0.05):
    noise = Image.effect_noise((S, S), sigma).convert('RGB')
    return Image.blend(img, noise, alpha)


# ---------------------------------------------------------------- ak47
def gen_ak47():
    rng = random.Random(47)
    palette = [
        (51, 64, 42), (109, 122, 77), (138, 125, 85),
        (43, 51, 34), (122, 106, 66), (95, 108, 66),
    ]
    # blobs: list of (color, [(x0,y0,x1,y1), ...]) — reused for the bump map
    blobs = []
    for _ in range(40):
        col = rng.choice(palette)
        cx, cy = rng.randint(0, S), rng.randint(0, S)
        rects = []
        for _ in range(rng.randint(6, 14)):
            w = rng.randint(9, 30)
            h = rng.randint(9, 30)
            ox, oy = rng.randint(-22, 22), rng.randint(-22, 22)
            rects.append((cx + ox, cy + oy, cx + ox + w, cy + oy + h))
            cx += rng.randint(-18, 18)
            cy += rng.randint(-18, 18)
        blobs.append((col, rects))

    img = Image.new('RGB', (S, S), (74, 91, 60))  # olive base
    d = ImageDraw.Draw(img)
    for col, rects in blobs:
        for dx, dy in wrap_offsets():
            for (x0, y0, x1, y1) in rects:
                d.rectangle([x0 + dx, y0 + dy, x1 + dx, y1 + dy], fill=col)

    # stencil marking
    font = ImageFont.truetype(FONT, 30)
    d.text((26, 442), '7.62x39', font=font, fill=(226, 226, 214))
    font2 = ImageFont.truetype(FONT, 20)
    d.text((30, 478), 'AUTO  KALASH', font=font2, fill=(190, 198, 178))

    img = add_grain(img, 14, 0.05)
    img.save(OUT / 'ak47.png', optimize=True)

    # bump map: same blob layout, slight height steps + raised edges
    b = Image.new('RGB', (S, S), (128, 128, 128))
    bd = ImageDraw.Draw(b)
    up = True
    for _, rects in blobs:
        v = 142 if up else 112
        up = not up
        for dx, dy in wrap_offsets():
            for (x0, y0, x1, y1) in rects:
                bd.rectangle([x0 + dx, y0 + dy, x1 + dx, y1 + dy], fill=(v, v, v))
                bd.rectangle([x0 + dx, y0 + dy, x1 + dx, y1 + dy],
                             outline=(160, 160, 160), width=2)
    b = add_grain(b, 18, 0.08)
    b.save(OUT / 'ak47_bump.png', optimize=True)


# ---------------------------------------------------------------- awp
def gen_awp():
    rng = random.Random(338)
    img = Image.new('RGB', (S, S), (216, 221, 224))  # arctic white
    d = ImageDraw.Draw(img)
    stroke_cols = [(168, 182, 192), (125, 143, 160), (90, 106, 120), (196, 204, 210)]
    for _ in range(34):
        col = rng.choice(stroke_cols)
        # angular splinter polyline
        x, y = rng.randint(0, S), rng.randint(0, S)
        pts = [(x, y)]
        for _ in range(rng.randint(3, 6)):
            x += rng.randint(-70, 70)
            y += rng.randint(-70, 70)
            pts.append((x, y))
        wdt = rng.randint(10, 24)
        for dx, dy in wrap_offsets():
            d.line([(px + dx, py + dy) for px, py in pts], fill=col, width=wdt, joint='curve')
    # sparse dark flecks
    for _ in range(120):
        x, y = rng.randint(0, S), rng.randint(0, S)
        r = rng.randint(1, 4)
        for dx, dy in wrap_offsets():
            d.ellipse([x - r + dx, y - r + dy, x + r + dx, y + r + dy], fill=(58, 66, 72))
    font = ImageFont.truetype(FONT, 26)
    d.text((300, 40), '.338 MAG', font=font, fill=(74, 88, 100))
    font2 = ImageFont.truetype(FONT, 18)
    d.text((304, 72), 'MARKSMAN', font=font2, fill=(120, 134, 146))
    img = add_grain(img, 10, 0.03)
    img.save(OUT / 'awp.png', optimize=True)


# ---------------------------------------------------------------- deagle
def gen_deagle():
    rng = random.Random(700)
    img = Image.new('RGB', (S, S), (30, 33, 36))
    d = ImageDraw.Draw(img)
    tile = 64
    for ty in range(0, S, tile):
        for tx in range(0, S, tile):
            parity = ((tx // tile) + (ty // tile)) % 2
            j1 = rng.randint(-3, 3)
            j2 = rng.randint(-3, 3)
            a_dark = (24 + j1, 27 + j1, 30 + j1)
            a_lite = (40 + j2, 44 + j2, 48 + j2)
            if parity == 0:
                # \\ weave
                d.polygon([(tx, ty), (tx + tile, ty), (tx, ty + tile)], fill=a_lite)
                d.polygon([(tx + tile, ty), (tx + tile, ty + tile), (tx, ty + tile)], fill=a_dark)
            else:
                # // weave
                d.polygon([(tx, ty), (tx + tile, ty + tile), (tx, ty + tile)], fill=a_dark)
                d.polygon([(tx, ty), (tx + tile, ty), (tx + tile, ty + tile)], fill=a_lite)
    # orange blaze streaks (wrapped for tiling)
    streaks = [
        ([(0, 400), (330, 90)], 34, (232, 114, 28)),
        ([(60, 470), (400, 150)], 22, (255, 155, 46)),
        ([(130, 520), (480, 220)], 12, (255, 186, 92)),
        ([(-40, 330), (250, 60)], 10, (255, 155, 46)),
    ]
    for pts, wdt, col in streaks:
        for dx, dy in wrap_offsets():
            d.line([(px + dx, py + dy) for px, py in pts], fill=col, width=wdt, joint='curve')
    # thin bright cores
    for pts, wdt, col in streaks:
        for dx, dy in wrap_offsets():
            d.line([(px + dx, py + dy) for px, py in pts], fill=(255, 214, 150), width=max(2, wdt // 5))
    font = ImageFont.truetype(FONT, 24)
    d.text((300, 450), '50 AE', font=font, fill=(240, 240, 236))
    img = add_grain(img, 12, 0.04)
    img.save(OUT / 'deagle.png', optimize=True)


# ---------------------------------------------------------------- manifest
def gen_manifest():
    manifest = {'ak47': 1, 'awp': 1, 'deagle': 1}
    (OUT / 'skins.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    gen_ak47()
    gen_awp()
    gen_deagle()
    gen_manifest()
    for f in sorted(OUT.iterdir()):
        if f.suffix in ('.png', '.json'):
            kb = f.stat().st_size / 1024
            print(f'{f.name:20s} {kb:8.1f} KB')
