#!/usr/bin/env python3
"""Task 76: build the labeled BEFORE/AFTER composite for the tiling fix.

Stacks two same-vantage screenshots vertically with labels, so the VLM (and
the user) can judge whether the world-space variation + per-face UV phase
offsets killed the grid-repetition on the long wall.

Usage: compare-tile-fix.py before.png after.png out.jpg
"""
import sys
from PIL import Image, ImageDraw, ImageFont

BEFORE, AFTER, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
LABEL_H = 56
FONT = ImageFont.truetype(
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)

imgs = [Image.open(p).convert("RGB") for p in (BEFORE, AFTER)]
w = min(i.width for i in imgs)
imgs = [i.resize((w, int(i.height * w / i.width))) for i in imgs]
labels = ["BEFORE - shared 3m tile, same phase everywhere",
          "AFTER - per-face phase + world-space variation"]

canvas = Image.new("RGB", (w, sum(i.height for i in imgs) + 2 * LABEL_H),
                   (18, 18, 18))
d = ImageDraw.Draw(canvas)
y = 0
for img, lab in zip(imgs, labels):
    d.rectangle([0, y, w, y + LABEL_H], fill=(40, 40, 46))
    d.text((16, y + 8), lab, font=FONT, fill=(240, 240, 240))
    y += LABEL_H
    canvas.paste(img, (0, y))
    y += img.height

canvas.save(OUT, quality=88)
print(f"wrote {OUT} ({canvas.width}x{canvas.height})")
