#!/usr/bin/env python3
"""Task 141: EXACT replication of convert-office.ts face pipeline; diff the
fence-family faces it would emit vs what geom.json actually contains."""
import struct, json, math

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()
def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

ent_off, ent_len = lump(0)
node_off, node_len = lump(5); n_nodes = node_len // 24
leaf_off, leaf_len = lump(10); n_leaves = leaf_len // 28
msrf_off, _ = lump(11)
plane_off, _ = lump(1)
face_off, face_len = lump(7); n_faces = face_len // 20
tex_off, tex_len = lump(6); n_tex = tex_len // 40
se_off, se_len = lump(13); n_se = se_len // 4
edge_off, edge_len = lump(12); n_edges = edge_len // 4
vtx_off, vtx_len = lump(3); n_verts = vtx_len // 12
mip_off, mip_len = lump(2)
mod_off, mod_len = lump(14); n_models = mod_len // 64

(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]

texinfo_miptex = [struct.unpack_from("<i", buf, tex_off + i * 40 + 32)[0] for i in range(n_tex)]

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

def face_verts(f):
    fe, ne = f
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

S = 0.025; ZR = 576
def gxform(vs):
    return [((v[0] * S), (v[2] + ZR) * S, (-v[1] * S)) for v in vs]

# build expected fence faces (game coords, quantized like the converter: .toFixed(4))
expected = []   # (fi, miptex, rounded vert tuple)
_dbg = {"walked": 0, "fam": 0, "verts": 0}
for mi in range(n_models):
    if role(mi) == "skip": continue
    (root,) = struct.unpack_from("<i", buf, mod_off + mi * 64 + 36)
    for fi in collect_faces(root):
        _dbg["walked"] += 1
        fe, ne = struct.unpack_from("<iH", buf, face_off + fi * 20 + 4)
        ti = struct.unpack_from("<h", buf, face_off + fi * 20 + 10)[0]
        mtx_i = texinfo_miptex[ti] if 0 <= ti < n_tex else -1
        if mtx_i >= len(mips): continue
        name = mips[mtx_i]
        if our_tex(name) != "fence": continue
        _dbg["fam"] += 1
        vs = face_verts((fe, ne))
        if not vs: continue
        _dbg["verts"] += 1
        g = gxform(vs)
        key = tuple(sorted((round(x, 4), round(y, 4), round(z, 4)) for x, y, z in g))
        expected.append((fi, name, key, g))
print("debug:", _dbg)

print(f"expected fence faces: {len(expected)}")

# geom fence faces
geom = json.load(open("/home/z/my-project/public/assets/maps/office/geom.json"))
gf = [x for x in geom["groups"] if x["tex"] == "fence"][0]
pos, idx = gf["pos"], gf["idx"]
geom_faces = set()
for f in range(0, len(idx), 3):
    pts = [pos[idx[f+k]*3: idx[f+k]*3+3] for k in range(3)]
    merged = {}
    # a geom face = triangle; but converter faces are n-gons triangulated.
    # Instead collect the VERTEX SET of the whole geom group and match per-BSP-face
    for p in pts:
        geom_faces.add((round(p[0], 4), round(p[1], 4), round(p[2], 4)))

missing = [e for e in expected if not all(v in geom_faces for v in e[3])]
present = [e for e in expected if all(v in geom_faces for v in e[3])]
print(f"present (all verts found in geom fence group): {len(present)}")
print(f"missing (some/all verts absent): {len(missing)}")
from collections import Counter
mc = Counter(e[1] for e in missing)
print("missing by miptex:", dict(mc))
print("\nmissing faces near CT-west (x[-50,-28] z[22,52] y[4,14] on vertex centroid):")
n = 0
for fi, name, key, g in missing:
    cxs = [p[0] for p in g]; cys = [p[1] for p in g]; czs = [p[2] for p in g]
    cx, cy, cz = sum(cxs)/len(g), sum(cys)/len(g), sum(czs)/len(g)
    if -50 <= cx <= -28 and 22 <= cz <= 52 and 4 <= cy <= 14:
        n += 1
        print(f"  face {fi} {name:14s} x[{min(cxs):7.1f},{max(cxs):7.1f}] y[{min(cys):5.1f},{max(cys):5.1f}] z[{min(czs):7.1f},{max(czs):7.1f}]")
print("  count:", n)
print("\nmissing faces anywhere (first 15 by area desc):")
def area(g):
    a = 0
    for k in range(1, len(g) - 1):
        ux, uy, uz = g[k][0]-g[0][0], g[k][1]-g[0][1], g[k][2]-g[0][2]
        vx, vy, vz = g[k+1][0]-g[0][0], g[k+1][1]-g[0][1], g[k+1][2]-g[0][2]
        a += math.sqrt((uy*vz-uz*vy)**2 + (uz*vx-ux*vz)**2 + (ux*vy-uy*vx)**2) / 2
    return a
missing.sort(key=lambda e: -area(e[3]))
for e in missing[:15]:
    g = e[3]
    cxs = [p[0] for p in g]; cys = [p[1] for p in g]; czs = [p[2] for p in g]
    print(f"  face {e[0]} {e[1]:14s} area={area(g):8.1f} x[{min(cxs):7.1f},{max(cxs):7.1f}] y[{min(cys):5.1f},{max(cys):5.1f}] z[{min(czs):7.1f},{max(czs):7.1f}]")
