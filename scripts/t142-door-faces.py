#!/usr/bin/env python3
"""Task 142: find DOOR-textured faces in cs_office.bsp and their game-space extents.
Lump/tex walking adapted from t141-bsp-area.py."""
import struct, math
from collections import Counter, defaultdict

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

tex_off, tex_len = lump(6); n_tex = tex_len // 40
face_off, face_len = lump(7); n_faces = face_len // 20
se_off, se_len = lump(13); n_se = se_len // 4
edge_off, edge_len = lump(12); n_edges = edge_len // 4
vtx_off, vtx_len = lump(3)
mip_off, _ = lump(2)

(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]

verts = [struct.unpack_from("<3f", buf, vtx_off + i * 12) for i in range(vtx_len // 12)]
edges = [struct.unpack_from("<HH", buf, edge_off + i * 4) for i in range(edge_len // 4)]
se = struct.unpack_from(f"<{n_se}i", buf, se_off)

texinfos = [struct.unpack_from("<i", buf, tex_off + i * 40 + 32)[0] for i in range(n_tex)]

SCALE = 0.025
g = lambda bx, by, bz: (bx * SCALE, (bz + 576) * SCALE, -by * SCALE)

door_mips = {i: n for i, n in enumerate(mips) if "door" in n.lower()}
print("door-textured miptex:", door_mips, "\n")

# collect faces using door textures
regions = defaultdict(list)  # mip name -> list of face bboxes (game)
for i in range(n_faces):
    o = face_off + i * 20
    fe, ne = struct.unpack_from("<iH", buf, o + 4)
    mtx_i = texinfos[struct.unpack_from("<h", buf, o + 10)[0]]
    if mtx_i not in door_mips:
        continue
    pts = []
    for k in range(ne):
        ei = se[fe + k]
        vi = edges[ei][0] if ei >= 0 else -edges[-ei][1]
        pts.append(g(*verts[vi]))
    if not pts:
        continue
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    regions[door_mips[mtx_i]].append((min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

# cluster faces into door panels (faces within 1m of each other = same panel)
for name, faces in sorted(regions.items()):
    print(f"--- {name}: {len(faces)} faces ---")
    panels = []
    for f in faces:
        placed = False
        for p in panels:
            if (abs(f[0] - p[0]) < 1.5 and abs(f[2] - p[2]) < 1.5 and
                abs(f[5] - p[5]) < 1.5):
                p[0] = min(p[0], f[0]); p[1] = max(p[1], f[1])
                p[2] = min(p[2], f[2]); p[3] = max(p[3], f[3])
                p[4] = min(p[4], f[4]); p[5] = max(p[5], f[5])
                placed = True
                break
        if not placed:
            panels.append(list(f))
    print(f"  clustered into {len(panels)} panels:")
    for p in sorted(panels, key=lambda p: (p[0], p[4])):
        w = p[1] - p[0]; h = p[3] - p[2]; d = p[5] - p[4]
        print(f"    x[{p[0]:7.2f},{p[1]:7.2f}] y[{p[2]:5.2f},{p[3]:5.2f}] z[{p[4]:7.2f},{p[5]:7.2f}]  (w={w:.2f} h={h:.2f} d={d:.2f}) center=({(p[0]+p[1])/2:.2f},{(p[2]+p[3])/2:.2f},{(p[4]+p[5])/2:.2f})")
