#!/usr/bin/env python3
"""Task 142: enumerate func_door* entities in cs_office.bsp with world-space bounds.
BSP v30: lump 0 = entities (LUMP_ENTITIES), lump 14 = models (dmodel_t: bbox + face ranges).
Game transform (convert-office.ts): gx = x*0.025, gy = (z+576)*0.025, gz = -y*0.025.
"""
import struct, re

buf = open("/home/z/my-project/upload/cs_office.bsp", "rb").read()

# lump directory
def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

# entities lump = 0
eoff, eln = lump(0)
ents_raw = buf[eoff:eoff + eln].decode("latin-1").replace("\n", " ")
ents = [e for e in ents_raw.split("{") if "}" in e]

# models lump = 14 (dmodel_t = 64 bytes: mins[3] floats, maxs[3] floats, origin[3], 4 ints)
moff, mln = lump(14)
n_models = mln // 64

doors = []
for e in ents:
    cls = re.search(r'"classname"\s+"([^"]+)"', e)
    if not cls or "door" not in cls.group(1):
        continue
    model = re.search(r'"model"\s+"\*?(\d+)"', e)
    origin = re.search(r'"origin"\s+"(-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"', e)
    angle = re.search(r'"angle"\s+"(-?[\d.]+)"', e)
    movedir = re.search(r'"movedir"\s+"(-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"', e)
    name = re.search(r'"targetname"\s+"([^"]+)"', e)
    d = {"cls": cls.group(1),
         "model": int(model.group(1)) if model else None,
         "origin": origin.groups() if origin else None,
         "angle": angle.group(1) if angle else None,
         "movedir": movedir.groups() if movedir else None,
         "name": name.group(1) if name else None}
    if d["model"] is not None and d["model"] < n_models:
        o = moff + d["model"] * 64
        mins = struct.unpack_from("<3f", buf, o)
        maxs = struct.unpack_from("<3f", buf, o + 12)
        d["bsp_mins"], d["bsp_maxs"] = mins, maxs
        # game coords
        g = lambda x, y, z: (x * 0.025, (z + 576) * 0.025, -y * 0.025)
        d["game_mins"] = g(*mins)
        d["game_maxs"] = g(*maxs)
    doors.append(d)

print(f"models in bsp: {n_models}; door entities: {len(doors)}\n")
for d in doors:
    print(f"{d['cls']:22s} name={str(d['name']):14s} model=*{d['model']} "
          f"angle={d['angle']} movedir={d['movedir']}")
    if "game_mins" in d:
        gm, gx = d["game_mins"], d["game_maxs"]
        print(f"   game bbox x[{gm[0]:7.2f},{gx[0]:7.2f}] y[{gm[1]:6.2f},{gx[1]:6.2f}] "
              f"z[{gm[2]:7.2f},{gx[2]:7.2f}]  (w={gx[0]-gm[0]:.2f} h={gx[1]-gm[1]:.2f} d={gx[2]-gm[2]:.2f})")
