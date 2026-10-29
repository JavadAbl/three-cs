#!/usr/bin/env python3
"""Task 74: encode wall-texture variants for in-game A/B testing.

For each candidate: re-encode the already-downloaded 1K diff+disp raws in
scripts/.tmp/acg/ EXACTLY like fetch-map-textures.py does (albedo 1024 q82,
bump 512 gray q80) into scripts/.tmp/wall_variants/<n>-<asset>/ so a swap into
public/staging/textures/maps/ is a fast cp. Swapping script: swap-wall.py.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'scripts' / '.tmp' / 'acg'
OUT = ROOT / 'scripts' / '.tmp' / 'wall_variants'
BASE = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k'

# (asset_id, note) — all CC0 polyhaven
VARIANTS = [
    ('damaged_plaster', 'warm light tan, damage/cracks, no brick grid'),
    ('wall_bricks_plaster', 'tan plaster + exposed brick patches (design match)'),
    ('rough_plaster_brick', 'darker warm, most brick, highest detail'),
    ('worn_cracked_plaster', 'warm tan, cracks, medium detail'),
]


def ensure_raw(asset: str, kind: str) -> Path:
    """kind = diff | disp — download the 1k jpg if missing."""
    f = RAW / f'{asset}_{kind}_1k.jpg'
    if not f.exists() or f.stat().st_size < 1000:
        r = subprocess.run(
            ['curl', '-sL', f'{BASE}/{asset}/{asset}_{kind}_1k.jpg', '-o', str(f), '--max-time', '120'],
            capture_output=True, text=True)
        if r.returncode != 0 or not f.exists() or f.stat().st_size < 1000:
            raise RuntimeError(f'download failed: {asset}_{kind}')
    return f


def encode(asset: str, brighten: float = 1.0) -> Path:
    d = OUT / asset
    d.mkdir(parents=True, exist_ok=True)
    im = Image.open(ensure_raw(asset, 'diff')).convert('RGB')
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    if brighten != 1.0:
        im = ImageEnhance.Brightness(im).enhance(brighten)
    im.save(d / 'wall.jpg', 'JPEG', quality=82, optimize=True)
    bm = Image.open(ensure_raw(asset, 'disp')).convert('L')
    if bm.size != (512, 512):
        bm = bm.resize((512, 512), Image.LANCZOS)
    bm.save(d / 'wall_bump.jpg', 'JPEG', quality=80, optimize=True)
    return d


def main() -> int:
    for asset, note in VARIANTS:
        d = encode(asset)
        kb = (d / 'wall.jpg').stat().st_size // 1024
        print(f'{asset:24s} wall.jpg {kb}KB + wall_bump.jpg  — {note}')
    print('\nvariants ready in scripts/.tmp/wall_variants/')
    return 0


if __name__ == '__main__':
    sys.exit(main())
