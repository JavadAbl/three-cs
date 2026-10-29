#!/usr/bin/env python3
"""Task 141 part 6: railing_3 pixel stats + PNG dump + face cluster map."""
import struct, zlib, os
from collections import Counter, defaultdict

BSP = "/home/z/my-project/upload/cs_office.bsp"
buf = open(BSP, "rb").read()
OUT = "/home/z/my-project/scripts/t141-tex"
os.makedirs(OUT, exist_ok=True)

def lump(i):
    off, ln = struct.unpack_from("<ii", buf, 4 + i * 8)
    return off, ln

o2, _ = lump(2)
n = struct.unpack_from("<i", buf, o2)[0]
texdata = {}
for i in range(n):
    rel = struct.unpack_from("<i", buf, o2 + 4 + i * 4)[0]
    if rel == -1:
        continue
    p = o2 + rel
    name = buf[p:p+16].split(b"\0")[0].decode("latin1")
    texdata[name] = p

def dump(name):
    p = texdata[name]
    w, h = struct.unpack_from("<2I", buf, p + 16)
    offs = struct.unpack_from("<4i", buf, p + 24)
    px = buf[p + offs[0]: p + offs[0] + w * h]
    mip3, sz3 = offs[3], (w // 8) * (h // 8)
    cnt = struct.unpack_from("<H", buf, p + mip3 + sz3)[0]
    pal_start = p + mip3 + sz3 + 2
    pal = buf[pal_start:pal_start + cnt * 3]
    # stats
    hist = Counter(px)
    print(f"\n== {name} ({w}x{h}, {cnt}-color palette) ==")
    print("top-8 palette idx by pixel count:")
    for idx, c in hist.most_common(8):
        col = (pal[idx*3], pal[idx*3+1], pal[idx*3+2]) if idx < cnt else "?"
        pct = 100 * c / (w * h)
        print(f"  idx {idx:3d} rgb {col} : {pct:5.1f}%")
    # row structure: average brightness per row band (is it a railing pattern?)
    band = h // 8
    print("per-band mean brightness (top->bottom):")
    for b in range(8):
        seg = px[b*band*w:(b+1)*band*w]
        print(f"  band{b}: {sum(seg)/len(seg):6.1f}")
    # PNG (2x upscale for visibility)
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            v = px[y * w + x]
            row += pal[v*3:v*3+3]
        rows.append(bytes(row))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    raw = b"".join(b"\x00" + r for r in rows)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    fn = f"{OUT}/{name.replace('{','brace')}.png"
    open(fn, "wb").write(png)
    print(f"saved {fn}")

for t in ("railing_3", "sphinx_railing_"):
    if t in texdata:
        dump(t)
    else:
        print(f"{t}: NOT EMBEDDED (external wad)")

# --- where are railing_3 faces? cluster centers ---
o6, l6 = lump(6); o3, l3 = lump(3); o12, l12 = lump(12); o13, l13 = lump(13); o7, l7 = lump(7)
texinfos = [struct.unpack_from("<i", buf, o6 + i*40 + 32)[0] for i in range(l6 // 40)]
verts = [struct.unpack_from("<3f", buf, o3 + i*12) for i in range(l3 // 12)]
edges = [struct.unpack_from("<2H", buf, o12 + i*4) for i in range(l12 // 4)]
surfedges = [struct.unpack_from("<i", buf, o13 + i*4)[0] for i in range(l13 // 4)]
SCALE, Z_REBASE = 0.025, 576
clusters = defaultdict(lambda: [0, 0.0])
for fi in range(l7 // 20):
    o = o7 + fi * 20
    firstedge, numedges = struct.unpack_from("<iH", buf, o + 4)
    ti = struct.unpack_from("<h", buf, o + 10)[0]
    if ti < 0 or numedges == 0:
        continue
    name = texdata.get(("?" if not (0 <= texinfos[ti] < n) else None) or "", None)
    mt = texinfos[ti]
    p = o2 + 4  # placeholder
    # resolve miptex name properly
    rel = struct.unpack_from("<i", buf, o2 + 4 + mt*4)[0]
    nm = buf[o2+rel:o2+rel+16].split(b"\0")[0].decode("latin1") if rel != -1 else f"wad{mt}"
    if nm not in ("railing_3", "sphinx_railing_"):
        continue
    pts = []
    for k in range(numedges):
        se = surfedges[firstedge + k]
        e = edges[se] if se >= 0 else edges[-se]
        v = verts[e[0] if se >= 0 else e[1]]
        pts.append((v[0]*SCALE, (v[2]+Z_REBASE)*SCALE, -v[1]*SCALE))
    cx = sum(p2[0] for p2 in pts)/len(pts); cz = sum(p2[2] for p2 in pts)/len(pts)
    cell = (round(cx/6), round(cz/6))
    a = 0.0
    for k in range(1, len(pts)-1):
        ux,uy,uz = pts[k+1][0]-pts[0][0], pts[k+1][1]-pts[0][1], pts[k+1][2]-pts[0][2]
        vx,vy,vz = pts[k][0]-pts[0][0], pts[k][1]-pts[0][1], pts[k][2]-pts[0][2]
        nx,ny,nz = uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx
        a += (nx*nx+ny*ny+nz*nz)**0.5/2
    clusters[cell][0] += 1
    clusters[cell][1] += a

print("\n== railing_3 + sphinx_railing_ face clusters (6m grid) ==")
for (cx, cz), (cnt, area) in sorted(clusters.items(), key=lambda kv: -kv[1][1])[:15]:
    print(f"  x≈{cx*6:6.1f} z≈{cz*6:6.1f} : {cnt:3d} faces, {area:7.1f} m²")
