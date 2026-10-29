#!/usr/bin/env python3
"""Task 141 step 2: what wall-like surfaces exist near the office CT spawn?
geom.json is in game space. For each group, split faces (idx triples), keep
faces whose bbox intersects the CT region, report per-family stats and the
biggest vertical (wall-like) faces per family."""
import json, math

ROOT = "/home/z/my-project"
geom = json.load(open(f"{ROOT}/public/assets/maps/office/geom.json"))
groups = geom["groups"]

# CT spawn pts from map-office.ts
SPAWNS = [(-26.6,37.4),(-26.6,42.3),(-23.2,44.6),(-33,41.4),(-33,45.5),(-20,44.8),(-27.2,50.1),(-22.3,48.9),(-32.5,50),(-32.9,36.8)]
cx = sum(p[0] for p in SPAWNS)/len(SPAWNS)
cz = sum(p[1] for p in SPAWNS)/len(SPAWNS)
print(f"CT spawn centroid: ({cx:.1f},{cz:.1f})")

# region of interest: spawn + a 14m halo toward map center (+x direction and hallways)
def in_roi(x, z):
    return (-48 <= x <= 2) and (26 <= z <= 58)

for g in groups:
    pos = g["pos"]; idx = g["idx"]
    faces = []
    for f in range(0, len(idx), 3):
        a,b,c = idx[f], idx[f+1], idx[f+2]
        pa = pos[a*3:a*3+3]; pb = pos[b*3:b*3+3]; pc = pos[c*3:c*3+3]
        xs = (pa[0],pb[0],pc[0]); ys = (pa[1],pb[1],pc[1]); zs = (pa[2],pb[2],pc[2])
        if not (in_roi(min(xs), min(zs)) or in_roi(max(xs), max(zs))):
            # also check centroid
            mx, mz = sum(xs)/3, sum(zs)/3
            if not in_roi(mx, mz): continue
        # normal
        ux,uy,uz = pb[0]-pa[0],pb[1]-pa[1],pb[2]-pa[2]
        vx,vy,vz = pc[0]-pa[0],pc[1]-pa[1],pc[2]-pa[2]
        nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        ln = math.sqrt(nx*nx+ny*ny+nz*nz) or 1
        area = ln/2
        vertical = abs(ny)/ln < 0.4   # mostly-horizontal normal => wall
        h = max(ys)-min(ys); w = max(xs)-min(xs); d = max(zs)-min(zs)
        faces.append((area, vertical, max(w,h,d), (sum(xs)/3,sum(ys)/3,sum(zs)/3)))
    if not faces: continue
    n_wall = sum(1 for f in faces if f[1])
    wall_area = sum(f[0] for f in faces if f[1])
    print(f"\n== {g['tex']} ==  faces in ROI: {len(faces)}  wall-like: {n_wall} (area {wall_area:.0f} m2)")
    for f in sorted(faces, key=lambda f:-f[0])[:6]:
        if not f[1]: continue
        c = f[3]
        print(f"   wall {f[0]:6.1f} m2  maxdim {f[2]:5.1f}  at ({c[0]:7.1f},{c[1]:5.1f},{c[2]:6.1f})")
