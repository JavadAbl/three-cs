#!/usr/bin/env python3
"""Task 90: pixel-level check of the aimhead BEFORE/AFTER VLM claims.

The A/B VLM flagged in the AFTER shot: (1) left-side statues as near-black
flat shapes, (2) a white horizontal line mid-scene. Both shots came from
DIFFERENT server spawns (26,2.4,0) vs (26,2.4,4.8) with different yaw, so the
claim may be a vantage difference, not a normal-map regression. Objective
check: same-region brightness stats across both frames + row-wise bright-band
detection, plus region stats of the left third (statue area).

Read-only comparison; prints a verdict table. No repo state touched."""
from PIL import Image
import sys

def region_stats(im, box):
    px = list(im.crop(box).convert('L').getdata())
    n = len(px)
    mean = sum(px) / n
    dark = sum(1 for v in px if v < 35) / n
    return mean, dark

def brightest_band(im, label):
    g = im.convert('L')
    w, h = g.size
    rows = []
    data = list(g.getdata())
    for y in range(h):
        row = data[y * w:(y + 1) * w]
        rows.append(sum(row) / w)
    best = max(range(h), key=lambda y: rows[y])
    return best, rows[best]

before = Image.open('download/aimhead-t90-before.png')
after = Image.open('download/aimhead-t90-after.png')
print(f"before {before.size}  after {after.size}")
w, h = before.size
# left third, vertical band below the sky (statue area)
for label, im in [('BEFORE', before), ('AFTER ', after)]:
    m, d = region_stats(im, (0, int(h * 0.30), int(w * 0.33), int(h * 0.85)))
    yb, vb = brightest_band(im, label)
    print(f"{label}: left-third mean lum {m:6.1f}  dark(<35) {d * 100:5.1f}%  brightest row y={yb} mean {vb:.1f}")
sys.exit(0)
