#!/usr/bin/env python3
"""Task 141 part 5: extract railing_3 + related WAD textures from BSP miptex
lump, check palette transparency (index 255), save PNGs for visual check."""
import struct, zlib

BSP = "/home/z/my-project/upload/cs_office.bsp"
buf = open(BSP, "rb").read()
OUT = "/home/z/my-project/scripts/t141-tex"
import os
os.makedirs(OUT, exist_ok=True)

o2, l2 = struct.unpack_from("<ii", buf, 4 + 2 * 8)
n = struct.unpack_from("<i", buf, o2)[0]
print(f"miptex count: {n}")

TARGETS = {"railing_3", "railing_2", "railing_1", "sphinx_railing_1"}
found = {}
for i in range(n):
    rel = struct.unpack_from("<i", buf, o2 + 4 + i * 4)[0]
    if rel == -1:
        continue
    p = o2 + rel
    name = buf[p:p+16].split(b"\0")[0].decode("latin1")
    if name.lower() in {t.lower() for t in TARGETS} or "railing" in name.lower() or name.startswith("{"):
        found[name] = p

def read_miptex(p):
    name = buf[p:p+16].split(b"\0")[0].decode("latin1")
    w, h = struct.unpack_from("<2I", buf, p + 16)
    offs = struct.unpack_from("<4i", buf, p + 24)
    return name, w, h, offs

def save_png(path, w, h, rgb_rows):
    raw = b"".join(b"\x00" + b"".join(row) for row in rgb_rows)
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)

print("\nname               w    h    has_texdata  transparent(idx255)")
for name, p in sorted(found.items()):
    try:
        nm, w, h, offs = read_miptex(p)
        has_data = offs[0] > 0
        transparent = False
        pal_summary = ""
        if has_data:
            # palette sits after 4 mips: offset[3] + h/8*w/8 bytes
            mip3 = offs[3]
            sz3 = (w // 8) * (h // 8)
            pal_off = p + mip3 + sz3 + 2  # +2: ushort pal size
            pal = buf[pal_off + 2 - 2 : pal_off - 2 + 2 + 256*3]  # not exact; recompute below
            # proper: pal_off points AFTER 2-byte count
            cnt = struct.unpack_from("<H", buf, p + mip3 + sz3)[0]
            pal_start = p + mip3 + sz3 + 2
            pal = buf[pal_start:pal_start + cnt*3]
            pal_summary = f"pal_colors={cnt}"
            if cnt == 256:
                # index 255 color
                c255 = pal[255*3:255*3+3]
                transparent = True  # GoldSrc convention: idx 255 = transparent when '{' texture
                pal_summary += f" idx255=({c255[0]},{c255[1]},{c255[2]})"
        print(f"{nm:18s} {w:4d} {h:4d}  {str(has_data):5s}       {pal_summary}")
        if has_data and w > 0 and h > 0:
            px = buf[p + offs[0]: p + offs[0] + w * h]
            if cnt >= 256:
                rows = []
                for y in range(h):
                    row = b""
                    for x in range(w):
                        v = px[y * w + x]
                        if v == 255 and name.startswith("{"):
                            row += b"\x80\x40\xff"  # mark transparent magenta
                        else:
                            row += bytes(pal[v*3:v*3+3])
                    rows.append(row)
                save_png(f"{OUT}/{nm.replace('/','_').replace('{','brace')}.png", w, h, rows)
                print(f"   -> saved {OUT}/{nm.replace('/','_').replace('{','brace')}.png")
    except Exception as ex:
        print(f"{nm:18s} ERROR {ex}")
