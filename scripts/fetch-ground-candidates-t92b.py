#!/usr/bin/env python3
"""Task 92 (v2) — download tar_00 + tar_02 of the HuggingFace ambientCG CC0
mirror fully (the ranged binary-search was too slow per asset), then extract
the NON-SAND ground candidates locally + build the labeled contact sheet.

tar layout (alphabetical): tar_00: Bricks026..<Metal052B (Concrete033/035),
tar_02: PaintedPlaster003..<Wood006 (PavingStones034/050/081).
"""
import io
import json
import os
import tarfile

import requests
from PIL import Image, ImageDraw

TMP = "/home/z/my-project/scripts/.tmp"
OUT = os.path.join(TMP, "ground-candidates-t92")
TARS = {
    0: os.path.join(TMP, "acg-tar00.tar"),
    2: os.path.join(TMP, "acg-tar02.tar"),
}
URL = "https://huggingface.co/datasets/nyuuzyou/ambientcg/resolve/main/dataset_{n:02d}.tar"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

CANDIDATES = [
    "PavingStones034",  # city pavement (popular)
    "PavingStones050",  # urban courtyard pavers
    "PavingStones081",  # large concrete pavers
    "Concrete033",      # cast concrete slab
    "Concrete035",      # rough light concrete
    "Concrete034",      # (may not exist — skipped silently)
]


def download(n: int, path: str) -> None:
    if os.path.exists(path) and os.path.getsize(path) > 500_000_000:
        print(f"tar_{n:02d}: already downloaded ({os.path.getsize(path)/1e6:.0f} MB)")
        return
    print(f"tar_{n:02d}: downloading ...")
    with requests.get(URL.format(n=n), headers={"User-Agent": UA}, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(path + ".part", "wb") as f:
            for chunk in r.iter_content(1 << 22):
                f.write(chunk)
    os.rename(path + ".part", path)
    print(f"tar_{n:02d}: {os.path.getsize(path)/1e6:.0f} MB")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for n, p in TARS.items():
        download(n, p)

    want_suffixes = ("Color.jpg", "NormalGL.jpg", "Displacement.jpg")
    found = {}
    for n, p in TARS.items():
        with tarfile.open(p) as tf:
            for m in tf:
                name = m.name
                asset = name.split("_")[0]
                if asset not in CANDIDATES:
                    continue
                if not any(name.endswith(s) for s in want_suffixes) and not name.endswith(".json"):
                    continue
                d = os.path.join(OUT, asset)
                os.makedirs(d, exist_ok=True)
                data = tf.extractfile(m).read()
                with open(os.path.join(d, os.path.basename(name)), "wb") as f:
                    f.write(data)
                found.setdefault(asset, []).append(os.path.basename(name))
                print(f"  + {asset}: {os.path.basename(name)}")

    # contact sheet
    cells = []
    for asset in sorted(found):
        cpath = next((os.path.join(OUT, asset, f) for f in found[asset] if f.endswith("Color.jpg")), None)
        if not cpath:
            continue
        im = Image.open(cpath).convert("RGB").resize((320, 320))
        cells.append((asset, im))
    if cells:
        cols = 3
        rows = (len(cells) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * 330 + 10, rows * 370 + 10), (24, 24, 24))
        dr = ImageDraw.Draw(sheet)
        for i, (name, im) in enumerate(cells):
            x = 10 + (i % cols) * 330
            y = 10 + (i // cols) * 370
            sheet.paste(im, (x, y))
            dr.text((x + 4, y + 332), name, fill=(255, 255, 255))
        sheet.save(os.path.join(OUT, "ground-candidates-sheet.jpg"), quality=88)
        print(f"sheet: {len(cells)} candidates -> {OUT}/ground-candidates-sheet.jpg")

    with open(os.path.join(OUT, "extracted.json"), "w") as f:
        json.dump(found, f, indent=1)


if __name__ == "__main__":
    main()
