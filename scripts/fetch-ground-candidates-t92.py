#!/usr/bin/env python3
"""Task 92 — fetch NON-SAND ground candidates for the AIM DEPOT yard re-skin.

User: "aim depot ground should not be sand" + linked ambientcg.com popular
list. ambientcg.com is TCP-blocked from this box, so candidates come from the
HuggingFace CC0 mirror via the ranged tar-search machinery imported from
scripts/fetch-ambientcg-hf.py (no multi-GB tar downloads).

Candidates are popular-list-style outdoor hardscape grounds (paving stones /
concrete / asphalt) that fit a freight-depot crate yard and contrast with the
existing sand. Output: raw Color/NormalGL/Displacement jpgs + json sidecar
under scripts/.tmp/ground-candidates-t92/<Asset>/ plus a labeled contact
sheet of the Color maps for VLM A/B selection.
"""
import json
import os
import sys

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "acg", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch-ambientcg-hf.py"))
acg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(acg)

from PIL import Image, ImageDraw  # noqa: E402

OUT = "/home/z/my-project/scripts/.tmp/ground-candidates-t92"

# popular-list-style hardscape grounds; tried across plausible tars
CANDIDATES = [
    ("PavingStones034", [1, 2]),   # city pavement (25k+ downloads)
    ("PavingStones050", [1, 2]),   # urban courtyard pavers
    ("PavingStones081", [1, 2]),   # large concrete pavers
    ("Concrete033",     [0]),      # cast concrete slab
    ("Concrete035",     [0]),      # rough light plaster concrete
    ("Asphalt012",      [0, 4, 5]),
    ("Asphalt013",      [0, 4, 5]),
    ("Ground049",       [0, 4]),   # damaged asphalt ground (if present)
]


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    found = {}
    for asset, tars in CANDIDATES:
        d = os.path.join(OUT, asset)
        got = {}
        for t in tars:
            got = acg.extract_asset(t, asset, d)
            if got:
                found[asset] = {"tar": t, "files": got}
                break
        if not got:
            print(f"  !! {asset}: not found in tars {tars}")
    with open(os.path.join(OUT, "extracted.json"), "w") as f:
        json.dump({k: {"tar": v["tar"],
                       "files": {sk: os.path.basename(sv) for sk, sv in v["files"].items()}}
                   for k, v in found.items()}, f, indent=1)

    # contact sheet of Color maps, labeled
    cells = []
    for asset, v in found.items():
        color = v["files"].get(".jpg") or next(
            (p for s, p in v["files"].items() if s.endswith("Color.jpg")), None)
        if not color:
            continue
        im = Image.open(color).convert("RGB").resize((320, 320))
        cells.append((asset, im))
    if cells:
        cols = 4
        rows = (len(cells) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * 330 + 10, rows * 370 + 10), (24, 24, 24))
        dr = ImageDraw.Draw(sheet)
        for i, (name, im) in enumerate(cells):
            x = 10 + (i % cols) * 330
            y = 10 + (i // cols) * 370
            sheet.paste(im, (x, y))
            dr.text((x + 4, y + 330), name, fill=(255, 255, 255))
        sheet.save(os.path.join(OUT, "ground-candidates-sheet.jpg"), quality=88)
        print(f"\nsheet: {OUT}/ground-candidates-sheet.jpg ({len(cells)} candidates)")
    print(f"found: {list(found)}")


if __name__ == "__main__":
    main()
