#!/usr/bin/env python3
"""Task 141 part 9: where are the true-alpha ({) fence faces? After remap they
are the ONLY fence left — verify they're small props, not big structures."""
import struct
from collections import defaultdict

BSP = "/home/z/my-project/upload/cs_office.bsp"
buf = open(BSP, "rb").read()

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

o2, _ = lump(2)
n = struct.unpack_from("<i", buf, o2)[0]
def mt_name(mt):
    rel = struct.unpack_from("<i", buf, o2 + 4 + mt * 4)[0]
    return f"wad{mt}" if rel == -1 else buf[o2+rel:o2+rel+16].split(b"\0")[0].decode("latin1")

o6, l6 = lump(6); o3, l3 = lump(3); o12, l12 = lump(12); o13, l13 = lump(13); o7, l7 = lump(7)
texinfos = [struct.unpack_from("<i", buf, o6 + i*40 + 32)[0] for i in range(l6 // 40)]
verts = [struct.unpack_from("<3f", buf, o3 + i*12) for i in range(l3 // 12)]
edges = [struct.unpack_from("<2H", buf, o12 + i*4) for i in range(l12 // 4)]
surfedges = [struct.unpack_from("<i", buf, o13 + i*4)[0] for i in range(l13 // 4)]
SCALE, Z_REBASE = 0.025, 576

clusters = defaultdict(lambda: [0, 0.0, []])
for fi in range(l7 // 20):
    o = o7 + fi * 20
    firstedge, numedges = struct.unpack_from("<iH", buf, o + 4)
    ti = struct.unpack_from("<h", buf, o + 10)[0]
    if ti < 0 or numedges == 0:
        continue
    nm = mt_name(texinfos[ti])
    if not nm.startswith("{"):
        continue
    pts = []
    for k in range(numedges):
        se = surfedges[firstedge + k]
        e = edges[se] if se >= 0 else edges[-se]
        v = verts[e[0] if se >= 0 else e[1]]
        pts.append((v[0]*SCALE, (v[2]+Z_REBASE)*SCALE, -v[1]*SCALE))
    a = 0.0
    for k in range(1, len(pts)-1):
        ux,uy,uz = pts[k+1][0]-pts[0][0], pts[k+1][1]-pts[0][1], pts[k+1][2]-pts[0][2]
        vx,vy,vz = pts[k][0]-pts[0][0], pts[k][1]-pts[0][1], pts[k][2]-pts[0][2]
        nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        a += (nx*nx+ny*ny+nz*nz)**0.5/2
    cx = sum(p[0] for p in pts)/len(pts); cz = sum(p[2] for p in pts)/len(pts)
    cy = sum(p[1] for p in pts)/len(pts)
    cell = (round(cx/8), round(cz/8))
    c = clusters[(nm, cell)]
    c[0] += 1; c[1] += a; c[2] += [cy]

print("true-alpha '{' texture clusters (8m grid), by area:")
for (nm, (gx, gz)), (cnt, area, ys) in sorted(clusters.items(), key=lambda kv: -kv[1][1])[:12]:
    print(f"  {nm:10s} x≈{gx*8:5.0f} z≈{gz*8:5.0f} : {cnt:3d} faces {area:6.1f} m²  y[{min(ys):5.1f},{max(ys):5.1f}]")
