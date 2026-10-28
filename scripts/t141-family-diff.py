#!/usr/bin/env python3
"""Task 141: per-family diff — BSP faces the current converter WOULD emit vs
what the shipped geom.json actually contains. If wall families are missing
near CT-west, the 'scaffolding/under construction' look = missing wall faces."""
import struct, json, math
from collections import Counter, defaultdict

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()
def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

ent_off, ent_len = lump(0)
node_off, node_len = lump(5); n_nodes = node_len // 24
leaf_off, leaf_len = lump(10); n_leaves = leaf_len // 28
msrf_off, _ = lump(11)
se_off, se_len = lump(13); n_se = se_len // 4
edge_off, edge_len = lump(12); n_edges = edge_len // 4
vtx_off, vtx_len = lump(3); n_verts = vtx_len // 12
face_off, face_len = lump(7); n_faces = face_len // 20
tex_off, tex_len = lump(6); n_tex = tex_len // 40
mod_off, mod_len = lump(14); n_models = mod_len // 64

(mip_count,) = struct.unpack_from("<i", buf, mip_off) if False else (None,)
# mip_off used below
mip_off, mip_len = lump(2)
(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]
texinfo_miptex = [struct.unpack_from("<i", buf, tex_off + i * 40 + 32)[0] for i in range(n_tex)]

ents_raw = buf[ent_off:ent_off + ent_len].decode("latin1")
model_cls = {}
for blk in ents_raw.split("{")[1:]:
    if "}" not in blk: continue
    body = blk.split("}")[0]
    cls = None; mid = None
    for line in body.splitlines():
        kv = line.strip().strip('"').split('" "')
        if len(kv) != 2: continue
        k, v = kv
        if k == "classname": cls = v
        if k == "model" and v.startswith("*"): mid = int(v[1:])
    if cls and mid is not None: model_cls[mid] = cls

RENDER = {"func_wall", "func_breakable", "func_button", "func_illusionary"}
def role(mi):
    if mi == 0: return "world"
    return "keep" if model_cls.get(mi, "") in RENDER else "skip"

def collect_faces(root):
    out = set(); stack = [root]
    while stack:
        n = stack.pop()
        if n >= 0:
            a, b = struct.unpack_from("<hh", buf, node_off + n * 24 + 4)
            stack.extend((a, b))
        elif n != -1:
            l = ~n
            if l < 0 or l >= n_leaves: continue
            first, cnt = struct.unpack_from("<HH", buf, leaf_off + l * 28 + 20)
            for k in range(cnt):
                (fi,) = struct.unpack_from("<H", buf, msrf_off + (first + k) * 2)
                if fi < n_faces: out.add(fi)
    return out

def face_verts(fi):
    fe, ne = struct.unpack_from("<iH", buf, face_off + fi * 20 + 4)
    if ne < 3 or ne > 32: return []
    if fe < 0 or fe + ne > n_se: return []
    out = []
    for k in range(ne):
        (sv,) = struct.unpack_from("<i", buf, se_off + (fe + k) * 4)
        if abs(sv) >= n_edges: return []
        e = edge_off + abs(sv) * 4
        v = struct.unpack_from("<H", buf, e if sv >= 0 else e + 2)[0]
        if v >= n_verts: return []
        out.append(struct.unpack_from("<3f", buf, vtx_off + v * 12))
    return out if len(out) >= 3 else []

def our_tex(raw):
    n = raw.lower()
    if n.startswith("+"):
        k = 1
        while k < len(n) and n[k] in "0123456789ab": k += 1
        if k < len(n) and n[k] == "~": k += 1
        n = n[k:]
    alpha = n.startswith("{")
    n = n.lstrip("{")
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

S = 0.025; ZR = 576
# collect expected faces per family (world + solid + render models)
expected = defaultdict(list)   # tex -> list of (fi, game_verts)
for mi in range(n_models):
    if role(mi) == "skip": continue
    (root,) = struct.unpack_from("<i", buf, mod_off + mi * 64 + 36)
    for fi in collect_faces(root):
        ti = struct.unpack_from("<h", buf, face_off + fi * 20 + 10)[0]
        if not (0 <= ti < n_tex): continue
        mtx = texinfo_miptex[ti]
        if not (0 <= mtx < len(mips)): continue
        tex = our_tex(mips[mtx])
        if tex == "SKIP": continue
        vs = face_verts(fi)
        if not vs: continue
        g = [((v[0] * S), (v[2] + ZR) * S, (-v[1] * S)) for v in vs]
        expected[tex].append((fi, g))

geom = json.load(open("/home/z/my-project/public/assets/maps/office/geom.json"))
geom_verts = {}
for g in geom["groups"]:
    s = set()
    pos = g["pos"]
    for vi in range(0, len(pos), 3):
        s.add((round(pos[vi], 4), round(pos[vi + 1], 4), round(pos[vi + 2], 4)))
    geom_verts[g["tex"]] = s

print(f"{'family':10s} {'expected':>8s} {'present':>8s} {'missing':>8s}")
tot_miss = 0
for tex in sorted(expected):
    exp = expected[tex]
    gv = geom_verts.get(tex, set())
    miss = [e for e in exp if not all((round(x,4), round(y,4), round(z,4)) in gv for x, y, z in e[1])]
    tot_miss += len(miss)
    print(f"{tex:10s} {len(exp):8d} {len(exp)-len(miss):8d} {len(miss):8d}")
print(f"total missing: {tot_miss}")
