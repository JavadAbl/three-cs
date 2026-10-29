#!/usr/bin/env python3
"""Task 142 addendum 2: BSP leaf-content probe on both sides of each
unverified doorish leaf. SOLID behind = embedded decor; EMPTY both sides =
real blocked doorway; SKY = exterior opening."""
import struct

buf = open('/home/z/my-project/upload/cs_office.bsp', 'rb').read()
def lump(i): return struct.unpack_from('<ii', buf, 4 + i*8)

off2, _ = lump(2)
ntex = struct.unpack_from('<I', buf, off2)[0]
offs = struct.unpack_from(f'<{ntex}I', buf, off2+4)
names = [buf[off2+o:off2+o+16].split(b'\0')[0].decode('ascii', errors='replace') if o != 0xFFFFFFFF else '<none>' for o in offs]
toff, tln = lump(6)
def ti_miptex(i): return struct.unpack_from('<i', buf, toff + i*40 + 32)[0]
voff, vln = lump(3)
verts = [struct.unpack_from('<3f', buf, voff+i*12) for i in range(vln//12)]
eoff, eln = lump(12)
edges = [struct.unpack_from('<2H', buf, eoff+i*4) for i in range(eln//4)]
soff, sln = lump(13)
surfedges = struct.unpack_from(f'<{sln//4}i', buf, soff)
foff, fln = lump(7)
poff, pln = lump(1)
nleaf = lump(10)[1] // 28

def plane(pd):
    return struct.unpack_from('<4f', buf, poff + pd*20)

def leaf_contents(li):
    return struct.unpack_from('<i', buf, lump(10)[0] + li*28)[0]

def node_children(ni):
    o = lump(5)[0] + ni*24
    return struct.unpack_from('<2h', buf, o+4)

moff, mln = lump(14)
world = struct.unpack_from('<9f7i', buf, moff)
head = world[9]   # headnode[0] = hull 0 root (9,10,11,12 = headnodes 0..3)

def content_at(p):
    """point in game coords -> contents name (walk BSP hull 0)"""
    # convert game -> bsp: bx = gx/0.025, bz = gy/0.025 - 576, by = -gz/0.025
    bsp = (p[0]/0.025, -p[2]/0.025, p[1]/0.025 - 576)
    n = head
    while n >= 0:
        pd = struct.unpack_from('<I', buf, lump(5)[0] + n*24)[0]
        nx, ny, nz, nd = plane(pd)
        d = nx*bsp[0] + ny*bsp[1] + nz*bsp[2] - nd
        c = node_children(n)
        n = c[0] if d < 0 else c[1]
    li = ~n
    if li >= nleaf: return 'OUT'
    ct = leaf_contents(li)
    return {-1: 'EMPTY', -2: 'SOLID', -3: 'WINDOW', -6: 'SKY'}.get(ct, f'c{ct}')

def face_info(fi):
    base = foff + fi*20
    pnum = struct.unpack_from('<h', buf, base+8)[0]
    first = struct.unpack_from('<i', buf, base+4)[0]
    texi = struct.unpack_from('<h', buf, base+10)[0]
    pd = struct.unpack_from('<I', buf, base)[0]
    pts = []
    for k in range(pnum):
        se = surfedges[first+k]
        e = edges[se if se >= 0 else -se]
        vi = e[0] if se >= 0 else e[1]
        pts.append(verts[vi])
    mt = ti_miptex(texi)
    g = lambda p: (p[0]*0.025, (p[2]+576)*0.025, -p[1]*0.025)
    gp = [g(p) for p in pts]
    return names[mt], plane(pd), gp

CANDS = {
    'A fifties_dr1k mid-west door?':  [1635, 1640, 1642, 1643],
    'B fifties_dr1k mid-east door?':  [1786, 1791, 1793, 1794],
    'C fifties_dr1k mid-east 2?':     [1797, 2698, 2700, 2701],
    'D warehousedoor x35.6 gate?':    [2219, 2220, 2221, 2222],
    'E warehousedoor z-9.2 gate?':    [4322, 4351, 4525, 4557],
    'G warehousedoor z51.8 gate?':    [5875, 5876, 5931, 5932],
    'H door_2 z-21.2 (skirting?)':    [3608, 3609],
    'I warehousedoor z1.2 big gate?': [611, 997],
}

for label, fis in CANDS.items():
    print(f'=== {label} ===')
    for fi in fis:
        try:
            name, (nx, ny, nz, nd), gp = face_info(fi)
        except Exception as ex:
            print(f'  face {fi}: ERR {ex}'); continue
        xs = [p[0] for p in gp]; ys = [p[1] for p in gp]; zs = [p[2] for p in gp]
        cx, cy, cz = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2, (min(zs)+max(zs))/2
        # step along plane normal (game space): normal in bsp (nx,ny,nz) is game (nx*0.025, nz*0.025, -ny*0.025) dir
        gx_n, gy_n, gz_n = nx*0.025, nz*0.025, -ny*0.025
        norm = (gx_n**2 + gy_n**2 + gz_n**2) ** 0.5 or 1
        ux, uy, uz = gx_n/norm, gy_n/norm, gz_n/norm
        probes = []
        for off in (-0.7, 0.7):
            p = (cx + ux*off, cy, cz + uz*off)
            probes.append(content_at(p))
        # also probe at walking height (y0+0.9)
        wprobes = []
        for off in (-0.7, 0.7):
            p = (cx + ux*off, min(ys) + 0.9, cz + uz*off)
            wprobes.append(content_at(p))
        print(f'  face {fi:5d} {name:14s} bbox x[{min(xs):6.2f},{max(xs):6.2f}] y[{min(ys):5.2f},{max(ys):5.2f}] z[{min(zs):6.2f},{max(zs):6.2f}]')
        print(f'          mid-height sides: {probes}   walking-height sides: {wprobes}')
    print()
