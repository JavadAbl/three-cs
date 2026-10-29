#!/usr/bin/env python3
"""Task 141 verify: regenerated geom.json — fence shrunk to true-alpha props,
concrete grew by the railing walls; group inventory sane."""
import json
from collections import Counter

geom = json.load(open("/home/z/my-project/public/assets/maps/office/geom.json"))
groups = geom["groups"]
print(f"groups: {len(groups)}")
tot = 0
for g in groups:
    n = len(g["idx"]) // 3
    tot += n
    print(f"  {g['tex']:10s} {n:6d} tris")
print(f"total: {tot} tris")

fence = next(g for g in groups if g["tex"] == "fence")
concrete = next(g for g in groups if g["tex"] == "concrete")
# bbox of fence group now — should be small props near map edges (T side)
pos = fence["pos"]
xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
print(f"\nfence now: x[{min(xs):.1f},{max(xs):.1f}] y[{min(ys):.1f},{max(ys):.1f}] z[{min(zs):.1f},{max(zs):.1f}]")
cpos = concrete["pos"]
cxs, cys, czs = cpos[0::3], cpos[1::3], cpos[2::3]
print(f"concrete:  x[{min(cxs):.1f},{max(cxs):.1f}] y[{min(cys):.1f},{max(cys):.1f}] z[{min(czs):.1f},{max(czs):.1f}]")
# CT entrance sanity: count concrete tris inside CT corridor
n_ct = 0
idx = concrete["idx"]
for i in range(0, len(idx), 3):
    cx = sum(cpos[idx[i+k]*3] for k in range(3)) / 3
    cz = sum(cpos[idx[i+k]*3+2] for k in range(3)) / 3
    if -15 <= cx <= 20 and 34 <= cz <= 56:
        n_ct += 1
print(f"concrete tris in CT-entrance corridor: {n_ct}")
