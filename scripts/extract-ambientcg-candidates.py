#!/usr/bin/env python3
"""Task 88 — extract ambientCG candidate Color jpgs from the local HF tar
mirrors (acg-tar00/03.tar) + build a labeled contact sheet for VLM A/B."""
import json
import os
import sys
import tarfile

TMP = "/home/z/my-project/scripts/.tmp"
OUT = os.path.join(TMP, "ambientcg-raw", "candidates")

CANDIDATES = {
    "ground": ["Ground083", "Ground054", "Ground045", "Ground081"],
    "brick": ["Bricks074", "Bricks083", "Bricks085", "Bricks086"],
    "wall": ["Concrete044A", "Plaster003", "Concrete041A", "Concrete018"],
    "crate": ["Wood092", "Wood087", "Wood080", "Wood022"],
}

TARS = {
    "acg-tar00": os.path.join(TMP, "acg-tar00.tar"),
    "acg-tar03": os.path.join(TMP, "acg-tar03.tar"),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    wanted = {a for assets in CANDIDATES.values() for a in assets}
    extracted = {}
    for name, path in TARS.items():
        with tarfile.open(path) as tf:
            for m in tf:
                if m.name.endswith(".jpg") and "_Color.jpg" in m.name:
                    a = m.name.split("_1K")[0]
                    if a in wanted:
                        out = os.path.join(OUT, f"{a}_Color.jpg")
                        with open(out, "wb") as f:
                            f.write(tf.extractfile(m).read())
                        extracted[a] = out
    print(f"extracted {len(extracted)}/{len(wanted)} color jpgs")
    missing = wanted - set(extracted)
    if missing:
        print("MISSING:", ", ".join(sorted(missing)))

    # contact sheet: 4 rows (surface groups) x 4 cols, labeled
    from PIL import Image, ImageDraw

    rows = list(CANDIDATES.items())
    CW, CH, LBL = 320, 320, 34
    sheet = Image.new("RGB", (CW * 4, (CH + LBL) * 4), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for r, (surface, assets) in enumerate(rows):
        for c, a in enumerate(assets):
            x, y = c * CW, r * (CH + LBL)
            d.rectangle([x, y, x + CW, y + LBL], fill=(40, 40, 40))
            d.text((x + 8, y + 8), f"{surface.upper()}  {a}", fill=(255, 255, 120))
            if a in extracted:
                img = Image.open(extracted[a]).convert("RGB").resize((CW, CH))
                sheet.paste(img, (x, y + LBL))
    out = os.path.join(TMP, "ambientcg-raw", "candidates-sheet.jpg")
    sheet.save(out, quality=88)
    print("sheet:", out)
    json.dump({a: os.path.basename(p) for a, p in extracted.items()},
              open(os.path.join(OUT, "extracted.json"), "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
