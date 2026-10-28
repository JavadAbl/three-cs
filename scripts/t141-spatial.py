#!/usr/bin/env python3
"""Task 141 part 2: spatial analysis — which geom groups sit near CT spawn/entrance."""
import json

ROOT = "/home/z/my-project"
geom = json.load(open(f"{ROOT}/public/assets/maps/office/geom.json", encoding="utf-8"))
CT = [(-26.6, 37.4), (-26.6, 42.3), (-23.2, 44.6), (-33, 41.4), (-33, 45.5),
      (-20, 44.8), (-27.2, 50.1), (-22.3, 48.9), (-32.5, 50), (-32.9, 36.8)]
cx = sum(p[0] for p in CT) / len(CT)
cz = sum(p[1] for p in CT) / len(CT)
print(f"CT spawn centroid: x={cx:.1f} z={cz:.1f}\n")

for g in geom["groups"]:
    pos = g["pos"]
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    n_tri = len(pos) // 9
    # horizontal distance from CT centroid to group bbox (0 if inside)
    dx = max(min(xs) - cx, cx - max(xs), 0)
    dz = max(min(zs) - cz, cz - max(zs), 0)
    dist = (dx * dx + dz * dz) ** 0.5
    extra = sorted(k for k in g.keys() if k not in ("pos", "tex"))
    print(f"tex={g['tex']:10s} tris={n_tri:5d} bbox x[{min(xs):7.1f},{max(xs):7.1f}] "
          f"y[{min(ys):5.1f},{max(ys):5.1f}] z[{min(zs):7.1f},{max(zs):7.1f}] "
          f"dist_to_CT={dist:6.1f} keys={extra}")
