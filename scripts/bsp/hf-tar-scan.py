#!/usr/bin/env python3
"""Map which assets live at which offsets in a HF dataset tar (unsorted tars)."""
import sys
import requests

TAR_FMT = "https://huggingface.co/datasets/nyuuzyou/ambientcg/resolve/main/dataset_{n}.tar"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
S = requests.Session()
S.headers.update({"User-Agent": UA})


def header_at(data: bytes, rel_off: int):
    if rel_off + 512 > len(data):
        return None
    h = data[rel_off:rel_off + 512]
    if h[257:262] != b"ustar":
        return None
    name = h[0:100].rstrip(b"\x00").decode("utf-8", errors="replace")
    try:
        size = int(h[124:136].rstrip(b"\x00 ").decode(errors="ignore") or "0", 8)
    except ValueError:
        return None
    try:
        stored = int(h[148:156].rstrip(b"\x00 ").decode(errors="ignore") or "0", 8)
    except ValueError:
        return None
    calc = sum(h[:148]) + 8 * 0x20 + sum(h[156:512])
    if calc != stored:
        return None
    next_off = rel_off + 512 + ((size + 511) // 512) * 512
    return (name, size, next_off)


def scan(url: str, start: int, length: int):
    first = ((start + 511) // 512) * 512
    r = S.get(url, headers={"Range": f"bytes={first}-{first + length - 1}"}, timeout=60)
    d = r.content
    out = []
    o = 0
    while True:
        h = header_at(d, o)
        if h is None:
            # slide forward 512B at a time to find the next real header
            if o + 512 >= len(d):
                break
            o += 512
            continue
        name, size, nxt = h
        out.append((first + o, name, size))
        o = nxt
    return out


def asset_of(name: str) -> str:
    return name.split("_1K-JPG_")[0] if "_1K-JPG_" in name else name


def main():
    tar_no = int(sys.argv[1])
    url = TAR_FMT.format(n=f"{tar_no:02d}")
    r = S.head(url, timeout=60, allow_redirects=True)
    size = int(r.headers.get("Content-Length", 0))
    print(f"tar_{tar_no:02d}: {size/1e6:.0f} MB")
    step = int(sys.argv[2]) if len(sys.argv) > 2 else 50_000_000
    seen: list[str] = []
    for off in range(0, size, step):
        hdrs = scan(url, off, 3 << 20)
        if not hdrs:
            print(f"  {off/1e6:7.0f}MB  (no headers in window)")
            continue
        assets = []
        last = None
        for _, n, _s in hdrs:
            a = asset_of(n)
            if a != last:
                assets.append(a)
                last = a
        print(f"  {off/1e6:7.0f}MB  {', '.join(assets[:8])}")


if __name__ == "__main__":
    main()
