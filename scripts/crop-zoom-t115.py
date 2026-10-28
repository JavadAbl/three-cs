#!/usr/bin/env python3
# Task 115 — crop the center band of chase frames (bot is camera-centered)
# into 2x zoomed copies for close-range VLM reads.
import sys
from PIL import Image

for name in sys.argv[1:]:
    p = f"/home/z/my-project/scripts/{name}"
    im = Image.open(p)
    w, h = im.size
    # center crop: keep middle 55% width, middle 70% height (bot centered)
    cw, ch = int(w * 0.55), int(h * 0.70)
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    crop = im.crop((x0, y0, x0 + cw, y0 + ch))
    crop = crop.resize((cw * 2, ch * 2), Image.LANCZOS)
    out = p.replace(".png", "-zoom.png")
    crop.save(out)
    print(out, crop.size)
