#!/usr/bin/env python3
"""Task 141 part 7: CT-entrance corridor — split faces by exact source texture."""
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
    if rel == -1:
        return f"wad{mt}"
    return buf[o2+rel:o2+rel+16].split(b"\0")[0].decode("latin1")

o6, l6 = lump(6); o3, l3 = lump(3); o12, l12 = lump(12); o13, l13 = lump(13); o7, l7 = lump(7)
texinfos = [struct.unpack_from("<i", buf, o6 + i*40 + 32)[0] for i in range(l6 // 40)]
verts = [struct.unpack_from("<3f", buf, o3 + i*12) for i in range(l3 // 12)]
edges = [struct.unpack_from("<2H", buf, o12 + i*4) for i in range(l12 // 4)]
surfedges = [struct.unpack_from("<i", buf, o13 + i*4)[0] for i in range(l13 // 4)]
SCALE, Z_REBASE = 0.025, 576

# The CT entrance corridor: CT spawn (-28,44) east toward the building door.
# Generous corridor: x in [-15, 20], z in [34, 56]
CORR = (-15, 20, 34, 56)
stats = defaultdict(lambda: [0, 0.0, [], []])  # name -> [faces, area, ys, centers]
for fi in range(l7 // 20):
    o = o7 + fi * 20
    firstedge, numedges = struct.unpack_from("<iH", buf, o + 4)
    ti = struct.unpack_from("<h", buf, o + 10)[0]
    if ti < 0 or numedges == 0:
        continue
    nm = mt_name(texinfos[ti])
    if nm in ("sky", "aaatrigger"):
        continue
    pts = []
    for k in range(numedges):
        se = surfedges[firstedge + k]
        e = edges[se] if se >= 0 else edges[-se]
        v = verts[e[0] if se >= 0 else e[1]]
        pts.append((v[0]*SCALE, (v[2]+Z_REBASE)*SCALE, -v[1]*SCALE))
    cx = sum(p[0] for p in pts)/len(pts); cz = sum(p[2] for p in pts)/len(pts)
    if CORR[0] <= cx <= CORR[1] and CORR[2] <= cz <= CORR[3]:
        a = 0.0
        for k in range(1, len(pts)-1):
            ux,uy,uz = pts[k+1][0]-pts[0][0], pts[k+1][1]-pts[0][1], pts[k+1][2]-pts[0][2]
            vx,vy,vz = pts[k][0]-pts[0][0], pts[k][1]-pts[0][1], pts[k][2]-pts[0][2]
            nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
            a += (nx*nx+ny*ny+nz*nz)**0.5/2
        s = stats[nm]
        s[0] += 1; s[1] += a
        s[2] += [p[1] for p in pts]
        s[3].append((round(cx,1), round(cz,1), round(a,1)))

print(f"CT-entrance corridor x[{CORR[0]},{CORR[1]}] z[{CORR[2]},{CORR[3]}] — non-sky faces:")
print(f"{'texture':18s} {'family':8s} {'faces':>5s} {'area m2':>8s} {'y-range':>13s}")
def family(nm):
    n = nm.lower()
    alpha = n.startswith("{")
    if alpha: return "fence"
    if "railing" in n or "rail1" in n: return "fence*"
    if "snow" in n: return "snow"
    if "carpet" in n or "couch" in n: return "carpet"
    if "glass" in n or n == "window_1": return "glass"
    if "bricks_" in n: return "brick"
    if "lab1_flr" in n or "tnnl_flr" in n: return "tile"
    if any(x in n for x in ("asphalt","comp_","lab1_comp","black","fade")): return "dark"
    if any(x in n for x in ("wood","desk","file1","file2_sp","door_2","door_3","dr1k","c1a1_dr2","bks1")): return "plank"
    if any(x in n for x in ("crate","cardboard","cardbox","ammo0")): return "crate"
    if any(x in n for x in ("wall_","hallway","trim","paper","painting","picture","poster","sign","generic","stripes","exit","clock","step_")): return "offwall"
    if any(x in n for x in ("cement","crete","cinder","concrete")): return "concrete"
    if any(x in n for x in ("metal","elev","apc_","vent","warehousedoor","trsh","freezer")): return "metal"
    return "offwall"

for nm, s in sorted(stats.items(), key=lambda kv: -kv[1][1]):
    print(f"{nm:18s} {family(nm):8s} {s[0]:5d} {s[1]:8.1f} [{min(s[2]):5.1f},{max(s[2]):5.1f}]")
