#!/usr/bin/env python3
"""Task 126 — bake the cs_office ambientCG set into game staging jpgs.

Input : scripts/.tmp/ambientcg-raw/office/<Asset>/<Asset>_1K-JPG_<Asset>_1K-JPG_{Color,NormalGL,Displacement}.jpg
        (fetched by fetch-ambientcg-hf.py --office, HF mirror of ambientcg.com)
Output: public/staging/textures/maps/office/<family>.jpg        albedo 1024 q82
                     <family>_bump.jpg   grayscale height 512 q80
                     <family>_normal.jpg tangent normal 1024 q85
        + sources.json (CC0 provenance, aimdepot format)

Re-run safe: winner picks are recorded in office-picks.json; --sheet rebuilds
the per-family labeled contact sheets for VLM A/B.
"""
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'scripts' / '.tmp' / 'ambientcg-raw' / 'office'
OUT = ROOT / 'public' / 'staging' / 'textures' / 'maps' / 'office'
PICKS = RAW / 'office-picks.json'

# family -> (candidates in sheet order, identity description for VLM/records)
FAMILIES: dict[str, tuple[list[str], str]] = {
    'carpet':  (['Fabric005', 'Fabric011', 'Fabric013'],
                'commercial office carpet, dense flecked loop pile, blue-grey'),
    'offwall': (['PaintedPlaster002', 'PaintedPlaster004', 'PaintedPlaster006'],
                'warm off-white painted drywall, subtle roller texture'),
    'ceiling': (['Plaster004', 'Plaster005'],
                'mineral drop-ceiling tile, fine perforation, light grey'),
    'snow':    (['Snow001', 'Snow002'],
                'compacted snow yard with drifts, blue-white, footpath wear'),
    'tile':    (['Tiles010', 'Tiles012', 'Tiles089'],
                'indoor hallway ceramic floor tiles, light beige/grey, grout lines'),
    'brick':   (['Bricks085'],
                'classic red brick courses, grey mortar'),
    'plank':   (['Wood062', 'Wood050'],
                'clean oak desk/door wood, warm honey grain, not weathered'),
}

# deterministic fallbacks if VLM is unavailable (indices into candidate list)
DEFAULT_PICK = {
    'carpet': 0, 'offwall': 2, 'ceiling': 1, 'snow': 1, 'tile': 1, 'brick': 0, 'plank': 1,
}


def raw_maps(asset: str) -> dict[str, Path]:
    d = RAW / asset
    if not d.is_dir():
        return {}
    out = {}
    for f in d.iterdir():
        if f.name.endswith('_Color.jpg'):
            out['color'] = f
        elif f.name.endswith('_NormalGL.jpg'):
            out['normal'] = f
        elif f.name.endswith('_Displacement.jpg'):
            out['disp'] = f
    return out


def build_sheet(family: str, cands: list[str], path: Path) -> bool:
    """Labeled side-by-side Color contact sheet (A | B | C)."""
    tiles = []
    for c in cands:
        m = raw_maps(c)
        if 'color' not in m:
            print(f'  !! {family}: {c} has no Color map — skipped')
            continue
        im = Image.open(m['color']).convert('RGB').resize((512, 512), Image.LANCZOS)
        tiles.append((c, im))
    if not tiles:
        return False
    sheet = Image.new('RGB', (512 * len(tiles), 560), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(tiles):
        sheet.paste(im, (512 * i, 40))
        d.text((12 + 512 * i, 12), f'{chr(65 + i)}  {name}', fill=(255, 255, 255))
    sheet.save(path, 'JPEG', quality=88)
    print(f'  sheet {path.name}: {len(tiles)} candidates')
    return True


def snow_postprocess(im: Image.Image) -> Image.Image:
    """Snow001/002 albedo is avg 228 / std 9 — reads as a blank white void in
    game (VLM t126). Overlay multi-scale mottle + wind striations + path wear
    so a large ground plane shows macro variation."""
    import math
    from PIL import ImageFilter
    W, H = im.size
    px = im.load()
    # deterministic value noise (3 octaves of bilinear-interp hash noise)
    def vnoise(seed: int, x: float, y: float) -> float:
        def h(ix: int, iy: int) -> float:
            n = ix * 374761393 + iy * 668265263 + seed * 1442695040
            n = (n ^ (n >> 13)) * 1274126177
            return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0
        xi, yi = int(x), int(y)
        fx, fy = x - xi, y - yi
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a, b = h(xi, yi), h(xi + 1, yi)
        c, d = h(xi, yi + 1), h(xi + 1, yi + 1)
        return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
    for y in range(H):
        for x in range(W):
            n1 = vnoise(1, x / 384, y / 384)        # macro drifts (~2.2 m at 6 m/canvas)
            n2 = vnoise(2, x / 72, y / 72)          # medium mottle (~0.4 m)
            n3 = vnoise(3, x / 5, y / 21)           # wind striations (anisotropic)
            v = n1 * 0.42 + n2 * 0.33 + n3 * 0.25
            r, g, b = px[x, y]
            # exposure ride ~-26..+26 with a cool shift in the troughs
            k = (v - 0.5) * 104
            px[x, y] = (
                max(0, min(255, int(r + k * 0.90))),
                max(0, min(255, int(g + k * 0.96))),
                max(0, min(255, int(b + k * 1.08))),
            )
    return im.filter(ImageFilter.GaussianBlur(0.6))


def bake_family(family: str, asset: str, manifest: dict) -> None:
    m = raw_maps(asset)
    need = ['color', 'disp', 'normal']
    missing = [k for k in need if k not in m]
    if missing:
        raise RuntimeError(f'{family}/{asset}: missing {missing} (have {list(m)})')

    # albedo 1024 q82
    im = Image.open(m['color']).convert('RGB')
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    if family == 'snow':
        im = snow_postprocess(im)   # t126: raw candidates are std-9 flat white
    im.save(OUT / f'{family}.jpg', 'JPEG', quality=82, optimize=True)

    # bump: displacement -> L 512 q80
    bm = Image.open(m['disp']).convert('L')
    if bm.size != (512, 512):
        bm = bm.resize((512, 512), Image.LANCZOS)
    bm.save(OUT / f'{family}_bump.jpg', 'JPEG', quality=80, optimize=True)

    # normal: NormalGL stays RGB 1024 q85
    nm = Image.open(m['normal']).convert('RGB')
    if nm.size != (1024, 1024):
        nm = nm.resize((1024, 1024), Image.LANCZOS)
    nm.save(OUT / f'{family}_normal.jpg', 'JPEG', quality=85, optimize=True)

    j = lambda p: (OUT / p).stat().st_size
    manifest[family] = {
        'asset': asset,
        'site': 'ambientcg.com',
        'license': 'CC0 1.0',
        'url': f'https://ambientcg.com/a?id={asset}',
        'task': '126 — cs_office BSP import; candidates VLM A/B (sheets in scripts/.tmp/ambientcg-raw/office/)',
        'files': {
            f'{family}.jpg': j(f'{family}.jpg'),
            f'{family}_bump.jpg': j(f'{family}_bump.jpg'),
            f'{family}_normal.jpg': j(f'{family}_normal.jpg'),
        },
    }
    print(f'  {family} <- {asset}: albedo {j(f"{family}.jpg")//1024}KB bump {j(f"{family}_bump.jpg")//1024}KB normal {j(f"{family}_normal.jpg")//1024}KB')


def main() -> int:
    args = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)

    if '--sheet' in args:
        # build contact sheets for VLM A/B
        n = 0
        for fam, (cands, _desc) in FAMILIES.items():
            if build_sheet(fam, cands, RAW / f'sheet-{fam}.jpg'):
                n += 1
        print(f'{n} sheets in {RAW}')
        return 0

    picks = json.loads(PICKS.read_text()) if PICKS.exists() else {}
    manifest: dict = {}
    total = 0
    for fam, (cands, _desc) in FAMILIES.items():
        asset = picks.get(fam) or cands[DEFAULT_PICK[fam]]
        if asset not in cands:
            raise RuntimeError(f'{fam}: pick {asset!r} not in candidates {cands}')
        print(f'== {fam} <- {asset}')
        bake_family(fam, asset, manifest)

    (OUT / 'sources.json').write_text(json.dumps(manifest, indent=1) + '\n')
    for v in manifest.values():
        total += sum(v['files'].values())
    print(f'\nstaged total: {total // 1024} KB in {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
