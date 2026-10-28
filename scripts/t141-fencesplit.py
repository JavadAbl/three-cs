#!/usr/bin/env python3
"""Task 141 part 8: whole-map — which original textures feed the 'fence' family;
area split opaque(railing_*) vs true-alpha({*)."""
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
SCALE = 0.025

stats = defaultdict(lambda: [0, 0.0])   # texname -> [faces, area]
for fi in range(l7 // 20):
    o = o7 + fi * 20
    firstedge, numedges = struct.unpack_from("<iH", buf, o + 4)
    ti = struct.unpack_from("<h", buf, o + 10)[0]
    if ti < 0 or numedges == 0:
        continue
    nm = mt_name(texinfos[ti])
    nl = nm.lower()
    is_fence = nl.startswith("{") or "railing" in nl or "rail1" in nl
    if not is_fence:
        continue
    pts = []
    for k in range(numedges):
        se = surfedges[firstedge + k]
        e = edges[se] if se >= 0 else edges[-se]
        v = verts[e[0] if se >= 0 else e[1]]
        pts.append((v[0]*SCALE, v[2]*SCALE, -v[1]*SCALE))
    a = 0.0
    for k in range(1, len(pts)-1):
        ux,uy,uz = pts[k+1][0]-pts[0][0], pts[k+1][1]-pts[0][1], pts[k+1][2]-pts[0][2]
        vx,vy,vz = pts[k][0]-pts[0][0], pts[k][1]-pts[0][1], pts[k][2]-pts[0][2]
        nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        a += (nx*nx+ny*ny+nz*nz)**0.5/2
    stats[nm][0] += 1
    stats[nm][1] += a

tot_opaque = sum(v[1] for k, v in stats.items() if not k.startswith("{"))
tot_alpha = sum(v[1] for k, v in stats.items() if k.startswith("{"))
print("textures feeding the 'fence' family (whole map):")
for nm, (cnt, area) in sorted(stats.items(), key=lambda kv: -kv[1][1]):
    kind = "TRUE-alpha (keep fence)" if nm.startswith("{") else "OPAQUE (was solid in CS1.6!)"
    print(f"  {nm:18s} {cnt:4d} faces {area:8.1f} m²  {kind}")
print(f"\nTOTAL opaque railing: {tot_opaque:.0f} m²   true-alpha: {tot_alpha:.0f} m²")
