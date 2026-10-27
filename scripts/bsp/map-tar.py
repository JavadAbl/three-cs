#!/usr/bin/env python3
"""Shared HF ambientcg-dataset-tar helpers (reconstructed Task 129).

Rebuilt after the Task-129 container rollback wiped the untracked original —
hf-tar-index.py + extract-office-hf.py import this module, so it is now
COMMITTED (the Task-127 commit shipped the importers but not this helper).

Contents (recovered from the committed hf-tar-scan.py, same contract):
  TAR_FMT  dataset tar URL with a {n} slot (e.g. ...dataset_{n}.tar)
  S        requests session with browser UA
  header_at(data, rel_off) -> (name, size, next_rel_off) | None   ustar validation
  scan(url, start, length) -> [(abs_header_off, name, size), ...]
       FIXED 512B-sliding-window scanner: when a window starts mid-file the
       original scan_window validated no headers and the fetch script's tar
       binary search diverged (batch-2 tars are NOT alphabetically sorted).
       This version slides 512B at a time until the next real header.
  fetch_range(url, start, end) -> bytes   retried ranged GET (3 tries)
  tar_size(url) -> int
  asset_of(name) -> str                  'Fabric005_1K-JPG_..._Color.jpg' -> 'Fabric005'
"""
import time

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


def fetch_range(url: str, start: int, end: int, tries: int = 3):
    for attempt in range(tries):
        try:
            r = S.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=90)
            if r.status_code in (200, 206):
                return r.content
        except requests.RequestException:
            pass
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"fetch_range failed after {tries} tries: {url} bytes={start}-{end}")


def tar_size(url: str) -> int:
    r = S.head(url, timeout=60, allow_redirects=True)
    return int(r.headers.get("Content-Length", 0))


def scan(url: str, start: int, length: int):
    first = ((start + 511) // 512) * 512
    d = fetch_range(url, first, first + length - 1)
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
