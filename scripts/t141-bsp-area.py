#!/usr/bin/env python3
"""Task 141: what ORIGINAL BSP textures cover the 'scaffolding-looking'
concrete pillar jumble west of office CT spawn?
Transform (convert-office.ts): game_x = bsp_x*0.025, game_y = (bsp_z+576)*0.025,
game_z = -bsp_y*0.025. Inverse: bsp_x = game_x*40, bsp_z = game_y/0.025-576,
bsp_y = -game_z*40."""
import struct
from collections import Counter

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

tex_off, tex_len = lump(6); n_tex = tex_len // 40
face_off, face_len = lump(7); n_faces = face_len // 20
se_off, se_len = lump(13); n_se = se_len // 4
edge_off, edge_len = lump(12); n_edges = edge_len // 4
vtx_off, vtx_len = lump(3); n_verts = vtx_len // 12
mip_off, mip_len = lump(2)

(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]

verts = [struct.unpack_from("<3f", buf, vtx_off + i * 12) for i in range(n_verts)]
edges = [struct.unpack_from("<HH", buf, edge_off + i * 4) for i in range(n_edges)]
se = struct.unpack_from(f"<{n_se}i", buf, se_off)

SCALE = 0.025
def g(bx, by, bz):
    return (bx * SCALE, (bz + 576) * SCALE, -by * SCALE)

texinfos = []
for i in range(n_tex):
    o = tex_off + i * 40
    mtx = struct.unpack_from("<i", buf, o + 32)[0]
    texinfos.append(mtx)

# jumble area in game coords: x[-50,-28], z[22,52], y[4,14]
hits = Counter()
area_by_mip = Counter()
sizes = Counter()
for i in range(n_faces):
    o = face_off + i * 20
    fe, ne = struct.unpack_from("<iH", buf, o + 4)
    mtx_i = texinfos[struct.unpack_from("<h", buf, o + 10)[0]]
    if mtx_i >= len(mips):
        continue
    pts = []
    for k in range(ne):
        ei = se[fe + k]
        vi = edges[ei][0] if ei >= 0 else -edges[-ei][1]
        pts.append(g(*verts[vi]))
    if not pts:
        continue
    gxs = [p[0] for p in pts]; gys = [p[1] for p in pts]; gzs = [p[2] for p in pts]
    cx, cy, cz = sum(gxs)/len(pts), sum(gys)/len(pts), sum(gzs)/len(pts)
    if not (-50 <= cx <= -28 and 22 <= cz <= 52 and 4 <= cy <= 14):
        continue
    name = mips[mtx_i]
    hits[name] += 1
    # face area in game units
    import math
    a = 0
    for k in range(1, len(pts) - 1):
        ux, uy, uz = [pts[k][j] - pts[0][j] for j in range(3)]
        vx, vy, vz = [pts[k+1][j] - pts[0][j] for j in range(3)]
        a += math.sqrt((uy*vz-uz*vy)**2 + (uz*vx-ux*vz)**2 + (ux*vy-uy*vx)**2) / 2
    area_by_mip[name] += a
    h = max(gys) - min(gys)
    sizes[(name, round(h))] += 1

print("faces in CT-west jumble area by ORIGINAL miptex:")
for name, n in hits.most_common(20):
    print(f"  {name:22s} faces={n:3d}  area={area_by_mip[name]:8.1f} m2")
