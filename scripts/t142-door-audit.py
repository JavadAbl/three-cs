#!/usr/bin/env python3
"""Task 142: office door blocker audit.
Hypothesis: cs_office.bsp has the door leaves baked into WORLD brushes (only 1
func_door exists — the warehouse roller). The converter then renders them and
derives collision boxes -> doorways permanently blocked.
Audit: find faces whose miptex is door-ish, world-space bbox, convert to game
coords (game_x = bsp_x*0.025, game_y = (bsp_z+576)*0.025, game_z = -bsp_y*0.025),
then check which collision boxes from map-office.ts cover those bboxes.
"""
import struct, json, re
from collections import Counter, defaultdict

BSP = '/home/z/my-project/upload/cs_office.bsp'
buf = open(BSP, 'rb').read()

def lump(i):
    return struct.unpack_from('<ii', buf, 4 + i * 8)

# --- miptex names (lump 2) ---
off, ln = lump(2)
ntex = struct.unpack_from('<I', buf, off)[0]
offs = struct.unpack_from(f'<{ntex}I', buf, off + 4)
names = []
for o in offs:
    if o == 0xFFFFFFFF:
        names.append('<none>')
    else:
        names.append(buf[off + o:off + o + 16].split(b'\0')[0].decode('ascii', errors='replace'))

DOORISH = {i for i, n in enumerate(names)
           if n.lower() in ('door_2', 'door_3', 'warehousedoor', 'c1a1_dr2',
                            'babtech_dr1c', 'babtech_dr4c', 'elev2_dr', 'fifties_dr1k')}

# --- texinfo (lump 6): 8 floats S/T axis + miptex + flags = 40 bytes ---
toff, tln = lump(6)
texinfo_n = tln // 40
def ti_miptex(i):
    return struct.unpack_from('<i', buf, toff + i * 40 + 32)[0]

# --- geometry ---
voff, vln = lump(3)          # vertices: 3 floats
verts = [struct.unpack_from('<3f', buf, voff + i * 12) for i in range(vln // 12)]
eoff, eln = lump(12)         # edges: 2 u16
edges = [struct.unpack_from('<2H', buf, eoff + i * 4) for i in range(eln // 4)]
soff, sln = lump(13)         # surfedges: i32
surfedges = struct.unpack_from(f'<{sln // 4}i', buf, soff, )
foff, fln = lump(7)          # faces: 4 u32 (plane,sides,edg0,num) + styles + texinfo = 20 bytes
faces_n = fln // 20

def face_pts(fi):
    base = foff + fi * 20
    pnum = struct.unpack_from('<h', buf, base + 8)[0]
    first = struct.unpack_from('<i', buf, base + 4)[0]
    texi = struct.unpack_from('<h', buf, base + 10)[0]
    idxs = [surfedges[first + k] for k in range(pnum)]
    pts = []
    for se in idxs:
        ei = edges[se][0] if se >= 0 else edges[-se][1]
        pts.append(verts[ei])
    return pts, texi

# --- models (lump 14): world = model 0, first face 0, nfaces = numfaces ---
moff, mln = lump(14)
m0 = struct.unpack_from('<4f9f', buf, moff)  # bounds + origin (don't care)
world_nfaces = struct.unpack_from('<I', buf, moff + 48 + 4)[0]
print(f'world model faces: {world_nfaces} of {faces_n}')

# --- collect door faces (world only) ---
g = lambda p: (p[0] * 0.025, (p[2] + 576) * 0.025, -p[1] * 0.025)  # -> game x,y,z
hits = []
texc = Counter()
for fi in range(world_nfaces):
    pts, texi = face_pts(fi)
    mt = ti_miptex(texi)
    if mt not in DOORISH:
        continue
    if not pts:
        continue
    texc[names[mt]] += 1
    gp = [g(p) for p in pts]
    xs = [p[0] for p in gp]; ys = [p[1] for p in gp]; zs = [p[2] for p in gp]
    hits.append((names[mt], (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs)), len(gp)))

print('world door-face count by texture:', dict(texc))
# cluster into bboxes: merge hits that overlap (simple grid cluster on x,z)
boxes_out = []
for name, xr, yr, zr, npts in hits:
    placed = False
    for b in boxes_out:
        if not (xr[0] > b['xmax'] + 0.3 or xr[1] < b['xmin'] - 0.3 or
                zr[0] > b['zmax'] + 0.3 or zr[1] < b['zmin'] - 0.3 or
                yr[0] > b['ymax'] + 0.3 or yr[1] < b['ymin'] - 0.3):
            b['xmin'] = min(b['xmin'], xr[0]); b['xmax'] = max(b['xmax'], xr[1])
            b['ymin'] = min(b['ymin'], yr[0]); b['ymax'] = max(b['ymax'], yr[1])
            b['zmin'] = min(b['zmin'], zr[0]); b['zmax'] = max(b['zmax'], zr[1])
            b['tex'].add(name); b['faces'] += 1
            placed = True
            break
    if not placed:
        boxes_out.append({'xmin': xr[0], 'xmax': xr[1], 'ymin': yr[0], 'ymax': yr[1],
                          'zmin': zr[0], 'zmax': zr[1], 'tex': {name}, 'faces': 1})

print(f'\n{len(boxes_out)} clustered door-leaf volumes (game coords):')
for b in sorted(boxes_out, key=lambda b: -b["faces"]):
    cx, cz = (b['xmin'] + b['xmax']) / 2, (b['zmin'] + b['zmax']) / 2
    print(f"  tex={sorted(b['tex'])} faces={b['faces']:3d} "
          f"x[{b['xmin']:6.2f},{b['xmax']:6.2f}] y[{b['ymin']:5.2f},{b['ymax']:5.2f}] "
          f"z[{b['zmin']:6.2f},{b['zmax']:6.2f}] center=({cx:6.2f},{cz:6.2f})")

json.dump([{**b, 'tex': sorted(b['tex'])} for b in boxes_out],
          open('/home/z/my-project/scripts/t142-door-volumes.json', 'w'), indent=1)
