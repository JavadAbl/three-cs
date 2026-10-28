#!/usr/bin/env python3
# Task 99 — objective BEFORE/AFTER pixel diff at the two wall-cap vantages.
# The caps were 0.5m-tall light strips above the 6m charcoal walls. If the
# removal took visual effect, the skyline band (wall-top rows) changes
# systematically: cap pixels -> sky pixels. Bot/texture noise differs too,
# so we report per-region stats rather than a binary verdict.
from PIL import Image
import numpy as np

def load(p):
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.float32)

for name, before, after in [
    ('spawn', '/home/z/my-project/download/aimdepot-t99-spawn.png',
             '/home/z/my-project/download/aimdepot-t99-after-spawn.png'),
    ('windowwall', '/home/z/my-project/download/aimdepot-t99-windowwall.png',
                   '/home/z/my-project/download/aimdepot-t99-after-windowwall.png'),
]:
    b, a = load(before), load(after)
    if b.shape != a.shape:
        print(f'{name}: shape mismatch {b.shape} vs {a.shape}'); continue
    diff = np.abs(b - a).sum(axis=2)
    changed = diff > 60
    print(f'\n=== {name} ({b.shape[1]}x{b.shape[0]}) ===')
    print(f'changed pixels: {changed.mean()*100:.1f}%')
    # row profile: which horizontal bands changed most (caps live in the
    # upper third against the sky)
    H = b.shape[0]
    for band, lo, hi in [('top-third', 0, H//3), ('mid-third', H//3, 2*H//3), ('bottom', 2*H//3, H)]:
        pct = changed[lo:hi].mean()*100
        print(f'  {band:10s}: {pct:5.1f}% changed')
    # look specifically for BEFORE-light-strip-above-dark-wall signature:
    # rows where BEFORE is significantly LIGHTER than AFTER (cap removed ->
    # sky/edge behind). Sample columns in the left/center where E/W caps ran.
    lightrow = (b.sum(axis=2) - a.sum(axis=2)) > 90   # before brighter
    print(f'  rows where BEFORE brighter than AFTER (cap signature): {lightrow.sum()} / {H}')
