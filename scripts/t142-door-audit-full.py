#!/usr/bin/env python3
"""Task 142 addendum: FULL-range (world faces 0..numfaces) door-family audit
with CORRECT surfedge vertex resolution (their t142-door-blockers.py has a
negated-index bug producing NaNs). For every door-textured WORLD face:
leaf cluster + nearby collision boxes from the REGENERATED map-office.ts,
to decide doorway-blocker vs decor for anything outside OPEN_DOOR_FACES."""
import struct, json
from collections import defaultdict

buf = open('/home/z/my-project/upload/cs_office.bsp', 'rb').read()
def lump(i): return struct.unpack_from('<ii', buf, 4 + i*8)

# miptex
off2, _ = lump(2)
ntex = struct.unpack_from('<I', buf, off2)[0]
offs = struct.unpack_from(f'<{ntex}I', buf, off2+4)
names = [buf[off2+o:off2+o+16].split(b'\0')[0].decode('ascii', errors='replace') if o != 0xFFFFFFFF else '<none>' for o in offs]
# texinfo
toff, tln = lump(6)
def ti_miptex(i): return struct.unpack_from('<i', buf, toff + i*40 + 32)[0]
# geometry
voff, vln = lump(3)
verts = [struct.unpack_from('<3f', buf, voff+i*12) for i in range(vln//12)]
eoff, eln = lump(12)
edges = [struct.unpack_from('<2H', buf, eoff+i*4) for i in range(eln//4)]
soff, sln = lump(13)
surfedges = struct.unpack_from(f'<{sln//4}i', buf, soff)
foff, fln = lump(7)
n_faces = fln // 20
# world model numfaces (dmodel 64B: mins3 maxs3 origin3 headnode4 visleafs firstface numfaces)
moff, mln = lump(14)
world = struct.unpack_from('<9f7i', buf, moff)
world_first, world_num = world[14], world[15]
print(f'world faces: {world_first}..{world_first+world_num-1} (num={world_num})')

DOORISH = {'door_2', 'door_3', 'c1a1_dr2', 'fifties_dr1k', 'warehousedoor',
           'babtech_dr1c', 'babtech_dr4c', 'elev2_dr'}
g = lambda p: (p[0]*0.025, (p[2]+576)*0.025, -p[1]*0.025)

def face_bbox(fi):
    base = foff + fi*20
    pnum = struct.unpack_from('<h', buf, base+8)[0]
    first = struct.unpack_from('<i', buf, base+4)[0]
    texi = struct.unpack_from('<h', buf, base+10)[0]
    if pnum < 3 or first < 0 or first + pnum > len(surfedges):
        return None
    pts = []
    for k in range(pnum):
        se = surfedges[first+k]
        e = edges[se if se >= 0 else -se]
        vi = e[0] if se >= 0 else e[1]
        if vi >= len(verts):
            return None
        pts.append(g(verts[vi]))
    mt = ti_miptex(texi)
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]; zs=[p[2] for p in pts]
    return names[mt] if 0 <= mt < ntex else '?', (min(xs),max(xs),min(ys),max(ys),min(zs),max(zs))

clusters = []
for fi in range(world_first, world_first + world_num):
    r = face_bbox(fi)
    if not r: continue
    name, (x0,x1,y0,y1,z0,z1) = r
    if name not in DOORISH: continue
    for c in clusters:
        if not (x0 > c['x1']+0.25 or x1 < c['x0']-0.25 or y0 > c['y1']+0.25 or
                y1 < c['y0']-0.25 or z0 > c['z1']+0.25 or z1 < c['z0']-0.25):
            c['x0']=min(c['x0'],x0); c['x1']=max(c['x1'],x1)
            c['y0']=min(c['y0'],y0); c['y1']=max(c['y1'],y1)
            c['z0']=min(c['z0'],z0); c['z1']=max(c['z1'],z1)
            c['tex'].add(name); c['faces'].append(fi)
            break
    else:
        clusters.append({'x0':x0,'x1':x1,'y0':y0,'y1':y1,'z0':z0,'z1':z1,'tex':{name},'faces':[fi]})

# collision boxes from REGENERATED map-office.ts
line = open('src/game/map-office.ts').readlines()[8]
boxes = json.loads(line.strip().rstrip(',').split('boxes: ')[1])
print(f'collision boxes (regen): {len(boxes)}\n')

OPEN = {1278,1279,1668,1669,2424,2425,5842,5907}
for c in sorted(clusters, key=lambda c: -len(c['faces'])):
    tag = 'OPENED' if set(c['faces']) & OPEN else 'not-in-OPEN_DOOR_FACES'
    cx, cz = (c['x0']+c['x1'])/2, (c['z0']+c['z1'])/2
    print(f"{tag:22s} tex={sorted(c['tex'])} faces={c['faces']} "
          f"x[{c['x0']:6.2f},{c['x1']:6.2f}] y[{c['y0']:5.2f},{c['y1']:5.2f}] z[{c['z0']:6.2f},{c['z1']:6.2f}]")
    if tag != 'OPENED':
        # collision boxes within 1.5m of the cluster rect, y-overlapping
        n = 0
        for b in boxes:
            bx0,bx1 = b['x']-b['w']/2, b['x']+b['w']/2
            by0,by1 = b['y']-b['h']/2, b['y']+b['h']/2
            bz0,bz1 = b['z']-b['d']/2, b['z']+b['d']/2
            if bx0 < c['x1']+0.4 and bx1 > c['x0']-0.4 and bz0 < c['z1']+0.4 and bz1 > c['z0']-0.4 and by0 < c['y1'] and by1 > c['y0']:
                n += 1
        print(f"    -> {n} collision boxes still intersect the leaf volume")
