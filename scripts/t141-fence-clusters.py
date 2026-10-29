#!/usr/bin/env python3
"""Task 141: which miptexes bucket to 'fence', and where fence faces sit near CT spawn."""
import json, struct
from collections import defaultdict

ROOT = "/home/z/my-project"
BSP = f"{ROOT}/upload/cs_office.bsp"
GEOM = f"{ROOT}/public/assets/maps/office/geom.json"

buf = open(BSP, "rb").read()
dv = struct.unpack_from

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

# LUMP_TEXINFO=6, LUMP_FACES=7, LUMP_SURFEDGES=13, LUMP_EDGES=12, LUMP_PLANES=1, LUMP_MIPTEX=2
tex_off, tex_len = lump(6)
n_tex = tex_len // 40
face_off, face_len = lump(7)
n_faces = face_len // 20
se_off, se_len = lump(13)
n_se = se_len // 4
edge_off, edge_len = lump(12)
n_edges = edge_len // 4
plane_off, plane_len = lump(1)
n_planes = plane_len // 20
mip_off, mip_len = lump(2)

# miptex names
mips = []
p = mip_off
while p + 4 <= mip_off + mip_len:
    (next_off,) = struct.unpack_from("<i", buf, p)
    if next_off <= 0:
        break
    name = buf[p + 4: p + 20].split(b"\x00")[0].decode("latin1")
    mips.append(name)
    p = mip_off + next_off if next_off else mip_off + mip_len
# above chain-walk is wrong for array miptex; simpler: parse count-based header
(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = []
for o in offsets:
    name = buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1")
    mips.append(name)

def our_tex(raw):
    n = raw.lower()
    n = n.lstrip("+0123456789ab~") if n.startswith("+") else n
    alpha = n.startswith("{")
    n = n.lstrip("{+")
    if alpha: return "fence"
    if n in ("sky", "aaatrigger"): return "SKIP"
    def has(*ps): return any(x in n for x in ps)
    if has("snow"): return "snow"
    if has("carpet", "couch"): return "carpet"
    if has("glass"): return "glass"
    if n == "window_1": return "glass"
    if has("ceil", "fifts_lght", "fifties_lgt", "light3c", "c1a4i_c1a"): return "ceiling"
    if has("railing", "rail1"): return "fence"
    if has("bricks_"): return "brick"
    if has("lab1_flr", "tnnl_flr"): return "tile"
    if has("asphalt", "comp_", "lab1_comp", "black", "fade"): return "dark"
    if has("wood", "desk", "file1", "file2_sp", "door_2", "door_3", "dr1k", "c1a1_dr2", "bks1", "sphinx_desk"): return "plank"
    if has("crate", "cardboard", "cardbox", "ammo0"): return "crate"
    if has("wall_", "hallway", "trim", "paper", "painting", "picture", "poster", "sign", "generic", "of_daddy", "of_boy", "of_got_milk",
           "fearferret", "stripes", "exit", "clock", "lab1_map", "overhead", "board_", "garage_", "sp_lock", "step_"): return "offwall"
    if has("cement", "crete", "cinder", "concrete", "step_"): return "concrete"
    if has("metal", "elev", "apc_", "vent", "warehousedoor", "babtech", "trsh", "freezer"): return "metal"
    return "offwall"

print(f"miptexes: {mip_count}")
fence_mips = [m for m in mips if our_tex(m) == "fence"]
print(f"fence-bucketed miptexes ({len(fence_mips)}):")
for m in fence_mips:
    print("  ", m)

# faces per texinfo → fence faces world positions
texinfos = []
for i in range(n_tex):
    o = tex_off + i * 40
    ti_s = struct.unpack_from("<4f", buf, o)
    ti_t = struct.unpack_from("<4f", buf, o + 16)
    miptex_i = struct.unpack_from("<i", buf, o + 32)[0]
    texinfos.append((ti_s, ti_t, miptex_i))

planes = []
for i in range(n_planes):
    o = plane_off + i * 20
    nx, ny, nz, d = struct.unpack_from("<4f", buf, o)
    planes.append((nx, ny, nz, d))

edges = []
for i in range(n_edges):
    a, b = struct.unpack_from("<HH", buf, edge_off + i * 4)
    edges.append((a, b))

se = struct.unpack_from(f"<{n_se}i", buf, se_off)
vtx_off, vtx_len = lump(3)
n_verts = vtx_len // 12
verts = [struct.unpack_from("<3f", buf, vtx_off + i * 12) for i in range(n_verts)]

def face_verts(f):
    fe, ne = f[2], f[3]
    pts = []
    for k in range(ne):
        ei = se[fe + k]
        vi = edges[ei][0] if ei >= 0 else -edges[-ei][1]
        pts.append(verts[vi])
    return pts

def face_tex(f):
    return texinfos[f[4]][2]

fence_pts = []
for i in range(n_faces):
    o = face_off + i * 20
    f = struct.unpack_from("<HHihh4xi", buf, o)
    mtx = face_tex(f)
    if mtx >= len(mips): continue
    if our_tex(mips[mtx]) != "fence": continue
    pts = face_verts(f)
    if not pts: continue
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; zs = [p[2] for p in pts]
    w = max(xs) - min(xs); d = max(zs) - min(zs); h = max(ys) - min(ys)
    cx, cy, cz = sum(xs)/len(xs), sum(ys)/len(ys), sum(zs)/len(zs)
    fence_pts.append((cx, cy, cz, w, d, h, mips[mtx], len(pts)))

print(f"\nfence faces total: {len(fence_pts)}")
print("\nfaces NEAR CT spawn (x[-48,-12] z[28,56]):")
near = [p for p in fence_pts if -48 <= p[0] <= -12 and 28 <= p[2] <= 56]
near.sort(key=lambda p: -max(p[3], p[5]))
for cx, cy, cz, w, d, h, name, nv in near[:40]:
    print(f"  at ({cx:7.1f},{cy:6.1f},{cz:6.1f})  size {w:5.1f}x{h:4.1f}x{d:5.1f}  tex={name:20s} verts={nv}")
print(f"\nnear-CT fence face count: {len(near)}")
# spatial clusters (crude grid merge)
from collections import Counter
grid = Counter()
for cx, cy, cz, *_ in near:
    grid[(int(cx)//8*8, int(cz)//8*8)] += 1
print("clusters (8m grid, top):", grid.most_common(12))
