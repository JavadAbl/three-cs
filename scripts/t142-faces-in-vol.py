#!/usr/bin/env python3
"""Task 142: which BSP faces overlap a given doorway volume (game coords)?"""
import struct, sys

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

tex_off, tex_len = lump(6); n_tex = tex_len // 40
face_off = lump(7)[0]; n_faces = lump(7)[1] // 20
se_off, se_len = lump(13); n_se = se_len // 4
vtx_off, vtx_len = lump(3)
mip_off = lump(2)[0]
(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]
edges = [struct.unpack_from("<HH", buf, lump(12)[0] + i * 4) for i in range(lump(12)[1] // 4)]
se = struct.unpack_from(f"<{n_se}i", buf, se_off)
texinfos = [struct.unpack_from("<i", buf, tex_off + i * 40 + 32)[0] for i in range(n_tex)]

SCALE = 0.025
def g(bx, by, bz):
    return (bx * SCALE, (bz + 576) * SCALE, -by * SCALE)

# doorway volume to probe: (x0,x1,y0,y1,z0,z1)
VOL = tuple(float(a) for a in sys.argv[1:7]) if len(sys.argv) > 6 else (30.0, 31.6, 10.4, 12.9, 20.4, 22.5)

n_edge_verts = vtx_len // 12
for fi in range(n_faces):
    o = face_off + fi * 20
    fe, ne = struct.unpack_from("<iH", buf, o + 4)
    ti = struct.unpack_from("<h", buf, o + 10)[0]
    mtx = texinfos[ti] if 0 <= ti < n_tex else -1
    name = mips[mtx] if 0 <= mtx < len(mips) else "?"
    pts = []
    bad = False
    for k in range(ne):
        if fe + k >= n_se:
            bad = True
            break
        ei = se[fe + k]
        if abs(ei) >= len(edges):
            bad = True
            break
        vi = edges[ei][0] if ei >= 0 else edges[-ei][1]
        if vi >= n_edge_verts:
            bad = True
            continue
        bx, by, bz = struct.unpack_from("<3f", buf, vtx_off + vi * 12)
        pts.append(g(bx, by, bz))
    if bad or not pts:
        continue
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    # face bbox overlaps doorway volume?
    if (min(xs) < VOL[1] and max(xs) > VOL[0] and
            min(ys) < VOL[3] and max(ys) > VOL[2] and
            min(zs) < VOL[5] and max(zs) > VOL[4]):
        # substantial overlap (not just touching): shrink face bbox 0.05
        print(f"face {fi:5d} {name:16s} x[{min(xs):6.2f},{max(xs):6.2f}] "
              f"y[{min(ys):5.2f},{max(ys):5.2f}] z[{min(zs):6.2f},{max(zs):6.2f}] nverts={len(pts)}")
