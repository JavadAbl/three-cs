#!/usr/bin/env python3
"""Task 141 part 4: parse cs_office.bsp directly — list ORIGINAL texture names
of faces near the CT entrance, to judge if 'fence' mapping there is authentic
or a misclassification."""
import struct
from collections import defaultdict

BSP = "/home/z/my-project/upload/cs_office.bsp"
buf = open(BSP, "rb").read()
print(f"BSP size: {len(buf)}")

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

# miptex (lump 2): count + offsets
o2, l2 = lump(2)
n_miptex = struct.unpack_from("<i", buf, o2)[0]
miptex_names = []
for i in range(n_miptex):
    rel = struct.unpack_from("<i", buf, o2 + 4 + i * 4)[0]
    if rel == -1:
        miptex_names.append(f"wad{i}")
    else:
        p = o2 + rel
        name = buf[p:p+16].split(b"\0")[0].decode("latin1")
        miptex_names.append(name)

# texinfo (lump 6): 40 bytes each
o6, l6 = lump(6)
n_ti = l6 // 40
texinfos = []
for i in range(n_ti):
    vals = struct.unpack_from("<8f i", buf, o6 + i * 40)
    texinfos.append(vals[8])  # miptex index

# vertices (lump 3): 12 bytes
o3, l3 = lump(3)
verts = [struct.unpack_from("<3f", buf, o3 + i * 12) for i in range(l3 // 12)]

# edges (lump 12): 2 x uint16
o12, l12 = lump(12)
edges = [struct.unpack_from("<2H", buf, o12 + i * 4) for i in range(l12 // 4)]

# surfedges (lump 13): int32
o13, l13 = lump(13)
surfedges = [struct.unpack_from("<i", buf, o13 + i * 4)[0] for i in range(l13 // 4)]

# faces (lump 7): 20 bytes
o7, l7 = lump(7)
n_faces = l7 // 20

SCALE, Z_REBASE = 0.025, 576
def to_world(v):
    return (v[0] * SCALE, (v[2] + Z_REBASE) * SCALE, -v[1] * SCALE)

# CT entrance region (our coords, generous box around CT spawn courtyard + back door)
REG = {"x": (-45, 15), "z": (28, 56)}
# also a tighter box right at the CT-entrance clusters seen in geom
TIGHT = {"x": (-10, 20), "z": (32, 56)}

hits = defaultdict(lambda: {"n": 0, "area": 0.0, "ys": []})
for fi in range(n_faces):
    o = o7 + fi * 20
    planenum = struct.unpack_from("<H", buf, o)[0]
    side = buf[o + 2]
    firstedge, numedges = struct.unpack_from("<iH", buf, o + 4)
    texinfo = struct.unpack_from("<h", buf, o + 10)[0]
    if texinfo < 0 or numedges == 0:
        continue
    mt_idx = texinfos[texinfo]
    name = miptex_names[mt_idx] if 0 <= mt_idx < len(miptex_names) else "?"
    # face verts in world
    pts = []
    for k in range(numedges):
        se = surfedges[firstedge + k]
        e = edges[se] if se >= 0 else edges[-se]
        v = verts[e[0] if se >= 0 else e[1]]
        pts.append(to_world(v))
    cx = sum(p[0] for p in pts) / len(pts)
    cz = sum(p[2] for p in pts) / len(pts)
    if REG["x"][0] <= cx <= REG["x"][1] and REG["z"][0] <= cz <= REG["z"][1]:
        # area via fan triangulation
        a = 0.0
        for k in range(1, len(pts) - 1):
            ux, uy, uz = pts[k+1][0]-pts[0][0], pts[k+1][1]-pts[0][1], pts[k+1][2]-pts[0][2]
            vx, vy, vz = pts[k][0]-pts[0][0], pts[k][1]-pts[0][1], pts[k][2]-pts[0][2]
            nx, ny, nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
            a += (nx*nx+ny*ny+nz*nz) ** 0.5 / 2
        d = hits[name]
        d["n"] += 1
        d["area"] += a
        d["ys"] += [p[1] for p in pts]

print(f"\nFaces with center in CT-courtyard region x{REG['x']} z{REG['z']}:")
print(f"{'orig texture':22s} {'faces':>5s} {'area m2':>8s} {'y-range':>14s}")
for name, d in sorted(hits.items(), key=lambda kv: -kv[1]["area"]):
    print(f"{name:22s} {d['n']:5d} {d['area']:8.1f} [{min(d['ys']):5.1f},{max(d['ys']):5.1f}]")
