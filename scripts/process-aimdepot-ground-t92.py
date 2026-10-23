#!/usr/bin/env python3
"""Task 92 — replace AIM DEPOT's sand ground with PavingStones034 (ambientCG,
CC0, popular list — city pavement, mid-grey pavers).

User: "aim depot ground should not be sand" + linked ambientcg.com popular
sort. VLM A/B over 8 hardscape candidates (ground-candidates-sheet.jpg) picked
PavingStones034: mid-tone grey pavers, industrial depot fit, clean 8-10 m
tiling, contrast with the tan sandstone + charcoal concrete.

Same conventions as Task 88 (process-aimdepot-textures.py): albedo 1024 q82
sRGB, bump = displacement -> L 512 q80, normal = NormalGL 1024 q85 linear.
Overwrites the aimdepot identity files for the ground slot (game surface
name stays 'sand' — the mapdata box tex key), updates provenance.
"""
import io
import json
import os
from PIL import Image

SRC = "/home/z/my-project/scripts/.tmp/ground-candidates-t92/PavingStones034"
OUT = "/home/z/my-project/public/assets/textures/maps/aimdepot"
SURFACE = "sand"
ASSET = "PavingStones034"


def main() -> None:
    files = {os.path.basename(f): f for f in os.listdir(SRC)}
    color = os.path.join(SRC, next(f for f in files if f.endswith("Color.jpg")))
    normal = os.path.join(SRC, next(f for f in files if f.endswith("NormalGL.jpg")))
    disp = os.path.join(SRC, next(f for f in files if f.endswith("Displacement.jpg")))
    meta = os.path.join(SRC, next(f for f in files if f.endswith(".json")))

    Image.open(color).convert("RGB").resize((1024, 1024), Image.LANCZOS).save(
        os.path.join(OUT, f"{SURFACE}.jpg"), quality=82)
    Image.open(disp).convert("L").resize((512, 512), Image.LANCZOS).save(
        os.path.join(OUT, f"{SURFACE}_bump.jpg"), quality=80)
    Image.open(normal).convert("RGB").save(
        os.path.join(OUT, f"{SURFACE}_normal.jpg"), quality=85)
    with open(meta, "rb") as f, open(os.path.join(OUT, f"{SURFACE}_meta.json"), "wb") as g:
        g.write(f.read())

    sp = os.path.join(OUT, "sources.json")
    src = json.load(open(sp))
    src[SURFACE] = {
        "asset": ASSET, "site": "ambientcg.com", "license": "CC0 1.0",
        "url": f"https://ambientcg.com/a?id={ASSET}",
        "task": "92 — user: ground should not be sand (popular-list pick); "
                "VLM A/B over 8 hardscape candidates (scripts/.tmp/ground-candidates-t92)",
        "files": {},
    }
    for f in (f"{SURFACE}.jpg", f"{SURFACE}_bump.jpg", f"{SURFACE}_normal.jpg"):
        src[SURFACE]["files"][f] = os.path.getsize(os.path.join(OUT, f))
    with open(sp, "w") as f:
        json.dump(src, f, indent=1)
    print("ground slot ->", ASSET)
    for f in (f"{SURFACE}.jpg", f"{SURFACE}_bump.jpg", f"{SURFACE}_normal.jpg", f"{SURFACE}_meta.json"):
        print(" ", f, os.path.getsize(os.path.join(OUT, f)), "B")


if __name__ == "__main__":
    main()
