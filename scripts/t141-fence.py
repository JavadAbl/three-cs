#!/usr/bin/env python3
"""Task 141 part 3: cluster fence-group triangles spatially; also dump CT-entrance area geometry."""
import json
from collections import Counter

ROOT = "/home/z/my-project"
geom = json.load(open(f"{ROOT}/public/assets/maps/office/geom.json", encoding="utf-8"))
fence = next(g for g in geom["groups"] if g["tex"] == "fence")
pos = fence["pos"]
idx = fence.get("idx")

tris = []
if idx:
    for i in range(0, len(idx), 3):
        a, b, c = idx[i], idx[i+1], idx[i+2]
        tri = [(pos[a*3], pos[a*3+1], pos[a*3+2]),
               (pos[b*3], pos[b*3+1], pos[b*3+2]),
               (pos[c*3], pos[c*3+1], pos[c*3+2])]
        tris.append(tri)
else:
    for i in range(0, len(pos), 9):
        tris.append([(pos[i], pos[i+1], pos[i+2]),
                     (pos[i+3], pos[i+4], pos[i+5]),
                     (pos[i+6], pos[i+7], pos[i+8])])

print(f"fence tris: {len(tris)}")
# cluster by 8-unit grid cell
cells = Counter()
for t in tris:
    xs = [v[0] for v in t]; ys = [v[1] for v in t]; zs = [v[2] for v in t]
    cell = (round((min(xs)+max(xs))/2/8), round((min(zs)+max(zs))/2/8))
    cells[cell] += 1
print("\nfence clusters (grid-cell -> tri count), top 20 by count:")
for (cx, cz), n in cells.most_common(20):
    # convert cell back to world coords
    print(f"  around x={cx*8:6.1f} z={cz*8:6.1f} : {n} tris")

# height stats per biggest clusters
print("\nheight ranges of fence tris in top clusters:")
top_cells = [c for c, _ in cells.most_common(5)]
for t in tris:
    pass
for cell in top_cells:
    ys = [v[1] for t in tris if (round((min(v[0] for v in t)+max(v[0] for v in t))/2/8), round((min(v[2] for v in t)+max(v[2] for v in t))/2/8)) == cell for v in t]
    if ys:
        print(f"  cell {cell}: y range [{min(ys):.1f}, {max(ys):.1f}]")
