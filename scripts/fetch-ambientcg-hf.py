#!/usr/bin/env python3
"""Extract selected ambientCG 1K-JPG texture sets from the HuggingFace dataset
mirror (nyuuzyou/ambientcg) WITHOUT downloading the multi-GB tar files.

Why: ambientcg.com is unreachable from this box (TCP blackholed), but the HF
dataset resolve endpoint supports HTTP Range requests and the tars hold the
extracted 1K-JPG files with original filenames, alphabetically sorted per tar.

Method: POSIX-tar binary search. A ranged 512-byte-aligned window is fetched,
valid tar headers (checksum + ustar magic validated) are located inside it,
and the entry name decides the next bisection step. Once the target asset's
file block is found, its entries are walked sequentially and the wanted map
types (Color / NormalGL / Displacement / json) are fetched by byte range.

CC0 1.0 license (ambientcg.com / Lennart Demes) — provenance is recorded in
the per-asset json sidecar shipped inside the tar next to the jpgs.

Usage:
  python3 fetch-ambientcg-hf.py                 # extract all TARGETS
  python3 fetch-ambientcg-hf.py --probe 0 5e6    # debug: dump headers in window
"""
import json
import os
import sys

import requests

TAR_FMT = "https://huggingface.co/datasets/nyuuzyou/ambientcg/resolve/main/dataset_{n}.tar"
RAW = "/home/z/my-project/scripts/.tmp/ambientcg-raw"   # raw downloaded files
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

S = requests.Session()
S.headers.update({"User-Agent": UA})

# tar index per dataset number, filled lazily: {n: size_bytes}
TAR_SIZES: dict[int, int] = {}


# ---------------------------------------------------------------- tar parsing
def header_at(data: bytes, rel_off: int):
    """Parse a tar header at rel_off inside the fetched window.
    Returns (name, size, typeflag, next_off_rel) or None if not a valid header."""
    if rel_off + 512 > len(data):
        return None
    h = data[rel_off:rel_off + 512]
    if h[257:262] != b"ustar":        # POSIX magic (GNU tar writes ustar too)
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
    typeflag = h[156:157]
    next_off = rel_off + 512 + ((size + 511) // 512) * 512
    return (name, size, typeflag, next_off)


def scan_window(url: str, start: int, length: int):
    """Fetch [start, start+length) and return every valid header found as
    (abs_header_off, name, size, typeflag). 512-aligned from the FIRST 512-
    aligned offset >= start."""
    first = ((start + 511) // 512) * 512
    d = fetch_range(url, first, first + length)
    found = []
    o = 0
    while True:
        h = header_at(d, o)
        if h is None:
            break
        name, size, tf, nxt = h
        found.append((first + o, name, size, tf))
        o = nxt
    return found


def fetch_range(url: str, start: int, end: int, tries: int = 4) -> bytes:
    """GET bytes [start, end) with retries. end is exclusive."""
    for i in range(tries):
        try:
            r = S.get(url, headers={"Range": f"bytes={start}-{end - 1}"}, timeout=90)
            if r.status_code in (200, 206):
                return r.content
        except requests.RequestException as e:
            print(f"    [retry {i + 1}] {e}", file=sys.stderr)
    raise RuntimeError(f"range fetch failed {url} [{start},{end})")


def tar_size(url: str) -> int:
    if url in TAR_SIZES:
        return TAR_SIZES[url]
    for _ in range(3):
        try:
            r = S.head(url, timeout=60, allow_redirects=True)
            sz = int(r.headers.get("Content-Length", 0))
            if sz:
                TAR_SIZES[url] = sz
                return sz
        except requests.RequestException:
            pass
    raise RuntimeError(f"HEAD failed {url}")


# ---------------------------------------------------------------- locating
def locate_prefix(url: str, prefix: str, size: int):
    """Binary-search the tar for the first regular-file entry whose name starts
    with `prefix`. Returns list of (abs_off, name, size) for ALL entries with
    that prefix (they are contiguous), or [] if not present."""
    WINDOW = 3 << 20  # 3 MB probe window
    lo, hi = 0, size - 512
    while hi - lo > WINDOW:
        mid = (lo + hi) // 2
        hdrs = scan_window(url, mid, WINDOW)
        # first REGULAR entry in the window (skip pax/global headers)
        reg = [h for h in hdrs if h[3] in (b"0", b"\x00")]
        if not reg:
            # window fell entirely inside one huge file's data — try further back
            lo = max(lo, mid - WINDOW)
            hi = min(hi, mid + WINDOW)
            if hi - lo <= 2 * WINDOW:
                break
            continue
        off, name, sz, tf = reg[0]
        if name.startswith(prefix):
            hi = off  # might be an earlier matching entry; shrink from left of it
            # can't have an earlier match in this window than the first entry
            lo = off
            break
        if name < prefix:
            lo = off + 512 + ((sz + 511) // 512) * 512
        else:
            hi = off
    # final bounded scan from lo
    pos = ((lo + 511) // 512) * 512
    matches: list[tuple[int, str, int]] = []
    end = size
    while pos < end:
        hdrs = scan_window(url, pos, WINDOW)
        if not hdrs:
            pos += WINDOW
            continue
        took = False
        for off, name, sz, tf in hdrs:
            took = True
            if tf not in (b"0", b"\x00"):
                continue
            if name.startswith(prefix):
                matches.append((off, name, sz))
            elif matches and name > prefix and not name.startswith(prefix):
                return matches
            elif name > prefix and not matches:
                return []  # overshot: not present
        pos = hdrs[-1][0] + 512 + ((hdrs[-1][2] + 511) // 512) * 512 if took else pos + WINDOW
        if matches and pos > size:
            return matches
    return matches


# ---------------------------------------------------------------- extraction
WANT_SUFFIXES = ("_Color.jpg", "_NormalGL.jpg", "_Displacement.jpg", ".json")


def extract_asset(tar_no: int, asset: str, out_dir: str):
    """Find `asset`_ files in the given tar; save wanted map types to out_dir.
    Returns dict {suffix: path}."""
    url = TAR_FMT.format(n=f"{tar_no:02d}")
    size = tar_size(url)
    prefix = f"{asset}_1K-JPG_{asset}_1K-JPG_"
    prefix_json = f"{asset}_1K-JPG_{asset}_1K-JPG"
    print(f"  tar_{tar_no:02d} ({size / 1e6:.0f} MB): searching {asset} ...")
    entries = locate_prefix(url, prefix, size)
    if not entries:
        return {}
    os.makedirs(out_dir, exist_ok=True)
    got = {}
    for off, name, sz in entries:
        suffix = None
        for w in WANT_SUFFIXES:
            if w == ".json":
                if name.endswith(".json") and name.startswith(prefix_json):
                    suffix = ".json"
            elif name.endswith(w):
                suffix = w
        if not suffix:
            continue
        if sz > 30_000_000:
            continue
        print(f"    + {name} ({sz / 1e3:.0f} KB)")
        data = fetch_range(url, off + 512, off + 512 + sz)
        path = os.path.join(out_dir, name)
        with open(path, "wb") as f:
            f.write(data)
        got[suffix] = path
    return got


# ---------------------------------------------------------------- targets
# surface (game name) -> list of candidate ambientCG assets, tried in order.
# Aim Depot identity: sandy depot yard — beige river-sand ground, sandstone
# brick window walls (red factory brick alt), light-grey concrete perimeter,
# plywood-side crates (shared crate set stays as fallback).
TARGETS: dict[str, list[str]] = {
    "sand":   ["Ground083", "Ground080"],          # beige river sand / beach sand
    "brick":  ["Bricks084", "Bricks085"],          # beige sandstone / factory red
    "wall":   ["Concrete046", "Concrete035"],      # light smooth / dark rough plaster
    "crate":  ["Wood087"],                         # plywood side (crate candidate)
    # alternates for A/B:
    "alt_ground": ["Ground081"],                   # gravel dirt path
}

# tar ranges (batch1 = tars 00..03 alphabetical):
#   00: Bricks026 .. <Metal052B   01: Metal052B .. <PaintedPlaster003
#   02: PaintedPlaster003 .. <Wood006   03: Wood006 ..
#   04: Bricks086 .. <Facade015   05: Facade015 .. <Ice002   06: Ice002 ..
TAR_HINT: dict[str, list[int]] = {
    "Ground083": [0, 4], "Ground080": [0, 4], "Ground081": [0, 4],
    "Bricks084": [0, 4], "Bricks085": [0, 4],
    "Concrete046": [0], "Concrete035": [0],
    "Wood087": [3, 0],
}

# Task 126 — cs_office identity candidates (VLM A/B picks after extraction):
#   carpet   commercial office carpet (flecke loop pile)
#   offwall  warm off-white painted drywall
#   ceiling  mineral drop-ceiling tile (Plaster perforated candidates)
#   snow     the snow courtyard
#   tile     hallway ceramic floor
#   brick    classic RED brick courses (shared set is desert sandstone)
#   plank    clean oak desks/doors (shared set is dirt planks)
OFFICE_TARGETS: dict[str, list[str]] = {
    "carpet":  ["Fabric005", "Fabric011", "Fabric013"],
    "offwall": ["PaintedPlaster002", "PaintedPlaster004", "PaintedPlaster006"],
    "ceiling": ["Plaster004", "Plaster005"],
    "snow":    ["Snow001", "Snow002"],
    "tile":    ["Tiles010", "Tiles012", "Tiles089"],
    "brick":   ["Bricks085"],
    "plank":   ["Wood062", "Wood050"],
}
TAR_HINT_OFFICE: dict[str, list[int]] = {
    # NB: Fabric* sorts BEFORE Facade* (F-a-b < F-a-c) → tar 04, not 05
    "Fabric005": [4], "Fabric011": [4], "Fabric013": [4],
    "PaintedPlaster002": [2, 1], "PaintedPlaster004": [2], "PaintedPlaster006": [2],
    "Plaster004": [6], "Plaster005": [6],
    "Snow001": [6], "Snow002": [6],
    "Tiles010": [6], "Tiles012": [6], "Tiles089": [6],
    "Bricks085": [0, 4],
    "Wood062": [3], "Wood050": [3],
}


def main():
    ap = sys.argv[1:]
    if ap and ap[0] == "--probe":
        # debug: dump headers in a window
        tar_no, off = int(ap[1]), int(ap[2], 0)
        url = TAR_FMT.format(n=f"{tar_no:02d}")
        for o, n, s, t in scan_window(url, off, int(ap[3], 0) if len(ap) > 3 else (3 << 20)):
            print(f"{o:>12}  {n}  ({s} B, type {t!r})")
        return

    os.makedirs(RAW, exist_ok=True)
    office_mode = "--office" in ap
    targets = OFFICE_TARGETS if office_mode else TARGETS
    hint = TAR_HINT_OFFICE if office_mode else TAR_HINT
    raw_dir = os.path.join(RAW, "office") if office_mode else RAW
    os.makedirs(raw_dir, exist_ok=True)
    plan = []
    only = None
    if "--only" in ap:
        only = set(ap[ap.index("--only") + 1].split(","))
    for surface, assets in targets.items():
        for a in assets:
            if only and a not in only:
                continue
            plan.append((surface, a))

    # merge previously-extracted results so the run is resumable
    prev_path = os.path.join(raw_dir, "extracted.json")
    results = {}
    if os.path.exists(prev_path):
        with open(prev_path) as f:
            for k, v in json.load(f).items():
                results[k] = {"asset": v["asset"], "tar": v["tar"],
                              "files": {sk: os.path.join(raw_dir, v["asset"], sv)
                                        for sk, sv in v["files"].items()}}
    for surface, asset in plan:
        # skip assets whose wanted files are already on disk (resume support)
        adir = os.path.join(raw_dir, asset)
        if os.path.isdir(adir):
            have = {n for n in os.listdir(adir) if os.path.isfile(os.path.join(adir, n))}
            wanted = [f"{asset}_1K-JPG_{asset}_1K-JPG{s}" for s in WANT_SUFFIXES if s != ".json"]
            if all(w in have for w in wanted) or (wanted and any(w in have for w in wanted) and "--force" not in ap):
                print(f"  = {surface}: {asset} partially/fully extracted, skipping (use --force to redo)")
                continue
        tars = hint.get(asset, [0])
        for t in tars:
            got = extract_asset(t, asset, os.path.join(raw_dir, asset))
            if got:
                results[f"{surface}:{asset}"] = {"asset": asset, "tar": t, "files": got}
                break
        else:
            print(f"  !! {surface}: {asset} NOT FOUND in hinted tars {tars}")

    with open(os.path.join(raw_dir, "extracted.json"), "w") as f:
        json.dump({k: {"asset": v["asset"], "tar": v["tar"],
                       "files": {sk: os.path.basename(sv) for sk, sv in v["files"].items()}}
                   for k, v in results.items()}, f, indent=1)
    print("\n== extracted ==")
    for k, v in results.items():
        print(f"  {k}: {v['asset']} from tar_{v['tar']:02d} ({len(v['files'])} files)")


if __name__ == "__main__":
    main()
