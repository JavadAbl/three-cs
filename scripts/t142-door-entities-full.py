#!/usr/bin/env python3
"""Task 142: which ENTITIES own door-textured faces (func_wall door leaves)?"""
import struct, re
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
model_off, model_len = lump(14)

(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]

verts = [struct.unpack_from("<3f", buf, vtx_off + i * 12) for i in range(vtx_len // 12)]
edges = [struct.unpack_from("<HH", buf, edge_off + i * 4) for i in range(edge_len // 4)]
se = struct.unpack_from(f"<{n_se}i", buf, se_off)
texinfos = [struct.unpack_from("<i", buf, tex_off + i * 40 + 32)[0] for i in range(n_tex)]

# models: dmodel_t 64 bytes = mins[3]f maxs[3]f origin[3]f + 4i (headnode, firstface, numfaces... )
# In BSP30: mins, maxs, origin(x,y,z), headnode, firstface, numfaces (pad)
n_models = model_len // 64
models = []
for i in range(n_models):
    o = model_off + i * 64
    mins = struct.unpack_from("<3f", buf, o)
    maxs = struct.unpack_from("<3f", buf, o + 12)
    firstface, numfaces = struct.unpack_from("<ii", buf, o + 56)
    models.append((mins, maxs, firstface, numfaces))

# entities
eoff, eln = lump(0)
ents = []
for e in buf[eoff:eoff+eln].decode("latin-1").split("{"):
    if "}" not in e:
        continue
    kv = dict(re.findall(r'"([^"]+)"\s+"([^"]+)"', e))
    if "classname" in kv:
        ents.append(kv)

def face_miptex(fi):
    o = face_off + fi * 20
    fe, ne = struct.unpack_from("<iH", buf, o + 4)
    ti = struct.unpack_from("<h", buf, o + 10)[0]
    if ti < 0 or ti >= len(texinfos):
        return None, None, None
    mtx_i = texinfos[ti]
    if mtx_i < 0 or mtx_i >= len(mips):
        return None, None, None
    pts = []
    for k in range(ne):
        ei = se[fe + k]
        vi = edges[ei][0] if ei >= 0 else -edges[-ei][1]
        pts.append(verts[vi])
    return mips[mtx_i], pts, ne

SCALE = 0.025
g = lambda bx, by, bz: (bx * SCALE, (bz + 576) * SCALE, -by * SCALE)

print(f"{'entity':28s} {'model':6s} {'name':14s} bounds(game) + door faces")
for idx, kv in enumerate(ents):
    model_s = kv.get("model", "")
    if not model_s.startswith("*"):
        continue
    mi = int(model_s[1:])
    if mi >= n_models:
        continue
    mins, maxs, firstface, numfaces = models[mi]
    door_faces = []
    texes = Counter()
    for fi in range(firstface, firstface + numfaces):
        name, pts, ne = face_miptex(fi)
        if name is None:
            continue
        texes[name] += 1
        if "door" in name.lower() and name != "warehousedoor":
            gp = [g(*p) for p in pts]
            xs = [p[0] for p in gp]; ys = [p[1] for p in gp]; zs = [p[2] for p in gp]
            door_faces.append((name, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
    if door_faces:
        gm = [c * SCALE for c in mins]
        gx = [c * SCALE for c in maxs]
        gy_mins = (mins[2] + 576) * SCALE; gy_maxs = (maxs[2] + 576) * SCALE
        gz_mins = -maxs[1] * SCALE; gz_maxs = -mins[1] * SCALE
        print(f"{kv['classname']:28s} *{mi:<5d} {kv.get('targetname','-'):14s} "
              f"x[{gm[0]:7.2f},{gx[0]:7.2f}] y[{gy_mins:5.2f},{gy_maxs:5.2f}] z[{gz_mins:7.2f},{gz_maxs:7.2f}]")
        print(f"    textures: {dict(texes)}")
        for df in door_faces:
            print(f"    DOOR FACE {df[0]}: x[{df[1]:.2f},{df[2]:.2f}] y[{df[3]:.2f},{df[4]:.2f}] z[{df[5]:.2f},{df[6]:.2f}]")
