#!/usr/bin/env python3
"""Task 141: which BSP model owns each railing_3 face near CT-west?
Replicates convert-office.ts collectFaces + modelRole to see whether the
missing railings are on SKIPPED entity models (func_door etc.) or the world."""
import struct
from collections import defaultdict

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()
def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

ent_off, ent_len = lump(0)
node_off, node_len = lump(5); n_nodes = node_len // 24
leaf_off, leaf_len = lump(10); n_leaves = leaf_len // 28
msrf_off, msrf_len = lump(11)
face_off, face_len = lump(7); n_faces = face_len // 20
tex_off, tex_len = lump(6); n_tex = tex_len // 40
mip_off, mip_len = lump(2)
mod_off, mod_len = lump(14); n_models = mod_len // 64

(mip_count,) = struct.unpack_from("<i", buf, mip_off)
offsets = struct.unpack_from(f"<{mip_count}i", buf, mip_off + 4)
mips = [buf[mip_off + o: mip_off + o + 16].split(b"\x00")[0].decode("latin1") for o in offsets]
texinfos = [struct.unpack_from("<i", buf, tex_off + i * 40 + 32)[0] for i in range(n_tex)]

# entities → model index mapping (model "*N")
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
    if cls and mid is not None:
        model_cls[mid] = cls

def collect_faces(root):
    out = set()
    stack = [root]
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

model_faces = {}
for mi in range(n_models):
    (root,) = struct.unpack_from("<i", buf, mod_off + mi * 64 + 36)
    model_faces[mi] = collect_faces(root)

face2model = {}
for mi, fs in model_faces.items():
    for fi in fs:
        face2model.setdefault(fi, mi)

TARGETS = [3277, 3297, 3354, 3438, 5760, 5939, 5965, 5974, 5986]
for fi in TARGETS:
    mi = face2model.get(fi, -1)
    cls = model_cls.get(mi, "WORLD(model0)" if mi == 0 else "?")
    role = "world" if mi == 0 else ("SOLID" if cls in ("func_wall", "func_breakable", "func_button") else ("render" if cls == "func_illusionary" else "SKIP"))
    print(f"face {fi}: model={mi} class={cls:22s} role={role}")

# also: count total railing_3 faces per model role
cnt = defaultdict(int)
for i in range(n_faces):
    mtx_i = texinfos[struct.unpack_from("<h", buf, face_off + i * 20 + 10)[0]]
    if mtx_i < len(mips) and mips[mtx_i] == "railing_3":
        mi = face2model.get(i, -1)
        cls = model_cls.get(mi, "WORLD" if mi == 0 else "?")
        cnt[cls] += 1
print("\nrailing_3 faces by entity class:")
for cls, n in sorted(cnt.items(), key=lambda kv: -kv[1]):
    print(f"  {cls:22s} {n}")
