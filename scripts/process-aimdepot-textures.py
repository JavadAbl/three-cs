#!/usr/bin/env python3
"""Task 88 — build the aimdepot per-map ambientCG texture identity.

Extracts the chosen ambientCG 1K-JPG sets (CC0, ambientcg.com) from the local
HuggingFace tar mirror (nyuuzyou/ambientcg — ambientcg.com itself is TCP-
blocked from this box; see scripts/fetch-ambientcg-hf.py for the mirror
pipeline), then processes them into the game's surface-file conventions:

  public/assets/textures/maps/aimdepot/<surface>.jpg         albedo 1024 q82 (sRGB)
  public/assets/textures/maps/aimdepot/<surface>_bump.jpg    height 512 q80 (L)
  public/assets/textures/maps/aimdepot/<surface>_normal.jpg  OpenGL tangent-space normal 1024 q85 (linear)
  public/assets/textures/maps/aimdepot/sources.json          provenance

VLM-picked set (candidates-sheet.jpg A/B): Ground054 / Bricks083 /
Concrete044A / Wood092 — bright sand yard, tan sandstone window walls,
charcoal concrete perimeter, warm wood crates.
"""
import json
import os
import sys
import tarfile

from PIL import Image

TMP = "/home/z/my-project/scripts/.tmp"
OUT = "/home/z/my-project/public/assets/textures/maps/aimdepot"
TARS = [os.path.join(TMP, "acg-tar00.tar"), os.path.join(TMP, "acg-tar03.tar")]

# game surface -> ambientCG asset (CC0). crate = warm crate wood; aimdepot's
# other surfaces (metal/dark/plank/door...) are NOT overridden — they fall
# back to the shared desert set through the loader chain.
SURFACES = {
    "sand":   "Ground054",     # Beach/Dirt/Ground/Mud/Sand — clean bright desert sand
    "brick":  "Bricks083",     # Medieval sandstone blocks — tan weathered wall
    "wall":   "Concrete044A",  # smooth concrete — charcoal industrial perimeter
    "crate":  "Wood092",       # fine warm brown wood — crate faces
}


def extract(asset: str) -> dict:
    """Pull Color / NormalGL / Displacement jpgs + the per-asset json sidecar."""
    want = {
        f"{asset}_1K-JPG_{asset}_1K-JPG_Color.jpg": "color",
        f"{asset}_1K-JPG_{asset}_1K-JPG_NormalGL.jpg": "normal",
        f"{asset}_1K-JPG_{asset}_1K-JPG_Displacement.jpg": "disp",
        f"{asset}_1K-JPG_{asset}.json": "meta",
    }
    got: dict[str, bytes] = {}
    for tar in TARS:
        if got:
            break
        with tarfile.open(tar) as tf:
            for m in tf:
                if m.name in want:
                    got[want[m.name]] = tf.extractfile(m).read()
    missing = set(want.values()) - set(got)
    if missing:
        raise RuntimeError(f"{asset}: missing {missing}")
    return got


def process(surface: str, asset: str) -> dict:
    raw = extract(asset)
    os.makedirs(OUT, exist_ok=True)
    provenance = {"asset": asset, "site": "ambientcg.com", "license": "CC0 1.0",
                  "url": f"https://ambientcg.com/a?id={asset}",
                  "files": {}}

    # albedo — 1024 sRGB q82 (shared-set convention)
    p = os.path.join(OUT, f"{surface}.jpg")
    Image.open(_bytesio(raw["color"])).convert("RGB").resize((1024, 1024), Image.LANCZOS).save(p, quality=82)

    # bump — displacement -> grayscale 512 q80 (offline fallback relief)
    p = os.path.join(OUT, f"{surface}_bump.jpg")
    Image.open(_bytesio(raw["disp"])).convert("L").resize((512, 512), Image.LANCZOS).save(p, quality=80)

    # normal — OpenGL tangent-space, keep native 1024, linear data (no resize:
    # resampling normals without proper filtering bends gradients)
    p = os.path.join(OUT, f"{surface}_normal.jpg")
    Image.open(_bytesio(raw["normal"])).convert("RGB").save(p, quality=85)

    for f in [f"{surface}.jpg", f"{surface}_bump.jpg", f"{surface}_normal.jpg"]:
        provenance["files"][f] = os.path.getsize(os.path.join(OUT, f))

    # keep the per-asset license json verbatim (CC0 proof, straight from the tar)
    with open(os.path.join(OUT, f"{surface}_meta.json"), "wb") as f:
        f.write(raw["meta"])
    return provenance


def _bytesio(b: bytes):
    import io
    return io.BytesIO(b)


def main():
    src = {}
    for surface, asset in SURFACES.items():
        print(f"{surface:6} <- {asset}")
        src[surface] = process(surface, asset)
        print("   ", src[surface]["files"])
    src["_pipeline"] = {
        "fetch": "scripts/fetch-ambientcg-hf.py + extract step — HuggingFace tar mirror "
                 "huggingface.co/datasets/nyuuzyou/ambientcg (ambientcg.com TCP-blocked "
                 "from the build box; tar mirror carries the same CC0 bytes with original "
                 "filenames; per-map license json saved as <surface>_meta.json)",
        "pick": "VLM A/B over candidates-sheet.jpg (16 Color jpgs, 4 per surface)",
        "conventions": "albedo 1024 q82 sRGB · bump = displacement -> L 512 q80 · "
                      "normal = NormalGL 1024 q85 linear (OpenGL Y+ = three.js default)",
    }
    with open(os.path.join(OUT, "sources.json"), "w") as f:
        json.dump(src, f, indent=1)
    print("\nwrote", os.path.join(OUT, "sources.json"))


if __name__ == "__main__":
    sys.exit(main())
