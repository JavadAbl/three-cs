#!/usr/bin/env python3
"""Scan aimhead screenshots for the site-decal red (#e23a2c ~ rgb(226,58,44)).
Reports red pixel counts and bounding regions per image."""
import sys
from PIL import Image

def scan(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    red = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            # decal red: high R, low G/B, g ~58 b ~44 at 60% opacity over green floor:
            # blended -> r stays high-ish, g/b low-ish. Loose threshold:
            if r > 110 and r - g > 55 and r - b > 55:
                red.append((x, y))
    if not red:
        print(f"{path}: NO red-ish pixels (sampled {w//2}x{h//2})")
        return
    xs = [p[0] for p in red]; ys = [p[1] for p in red]
    print(f"{path}: {len(red)} red-ish px, bbox x {min(xs)}-{max(xs)} / y {min(ys)}-{max(ys)} (img {w}x{h})")
    # cluster roughly by grid buckets of 80px
    buckets = {}
    for x, y in red:
        buckets.setdefault((x // 80, y // 80), []).append((x, y))
    top = sorted(buckets.items(), key=lambda kv: -len(kv[1]))[:6]
    for (bx, by), pts in top:
        print(f"   cluster @({bx*80}-{bx*80+80}, {by*80}-{by*80+80}): {len(pts)} px")

for p in sys.argv[1:]:
    try:
        scan(p)
    except Exception as e:
        print(p, 'ERR', e)
