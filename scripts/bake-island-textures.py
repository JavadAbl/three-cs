#!/usr/bin/env python3
"""Task 132 — bake the island ambientCG set into game staging jpgs.

Input : scripts/.tmp/ambientcg-raw/island/full/<Asset>/<Asset>_{Color,NormalGL,
        Displacement}.jpg  (extract-island-hf.py full, HF mirror of ambientcg)
Output: public/staging/textures/maps/island/<family>.jpg        albedo 1024 q82
                      <family>_bump.jpg   grayscale height 512 q80
                      <family>_normal.jpg tangent normal 1024 q85
        public/staging/maps/island/sky.jpg  equirect HDRI dome 2048x1024 q88
        + sources.json (CC0 provenance) + island-picks.json (winner record)

Winner picks (VLM A/B, sheets + verdicts in scripts/.tmp/ambientcg-raw/island/):
  isand  Gravel038      igrass Grass007     irock Rock049      bark Bark012
  leaf   ThatchedRoof002B  plank Planks006  metal Metal031     concrete Concrete034
  sky    DaySkyHDRI017B (1K-TONEMAPPED equirect, verified clean horizon/sun)
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'scripts' / '.tmp' / 'ambientcg-raw' / 'island'
FULL = RAW / 'full'
OUT = ROOT / 'public' / 'staging' / 'textures' / 'maps' / 'island'
SKYOUT = ROOT / 'public' / 'staging' / 'maps' / 'island'

PICKS = {
    'isand': 'Gravel038',
    'igrass': 'Grass007',
    'irock': 'Rock049',
    'bark': 'Bark012',
    'leaf': 'ThatchedRoof002B',
    'plank': 'Planks006',
    'metal': 'Metal031',
    'concrete': 'Concrete034',
}
SKY_ASSET = 'DaySkyHDRI017B'


def raw_maps(asset: str) -> dict:
    d = FULL / asset
    out = {}
    if not d.is_dir():
        return out
    for f in d.iterdir():
        if f.name.endswith('_Color.jpg'):
            out['color'] = f
        elif f.name.endswith('_NormalGL.jpg'):
            out['normal'] = f
        elif f.name.endswith('_Displacement.jpg'):
            out['disp'] = f
    return out


def bake_family(family: str, asset: str, manifest: dict) -> None:
    m = raw_maps(asset)
    need = ['color', 'disp', 'normal']
    missing = [k for k in need if k not in m]
    if missing:
        raise RuntimeError(f'{family}/{asset}: missing {missing} (have {list(m)})')

    im = Image.open(m['color']).convert('RGB')
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.LANCZOS)
    im.save(OUT / f'{family}.jpg', 'JPEG', quality=82, optimize=True)

    bm = Image.open(m['disp']).convert('L')
    if bm.size != (512, 512):
        bm = bm.resize((512, 512), Image.LANCZOS)
    bm.save(OUT / f'{family}_bump.jpg', 'JPEG', quality=80, optimize=True)

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
        'task': '132 — island PBR bake; VLM A/B (sheets in scripts/.tmp/ambientcg-raw/island/)',
        'files': {
            f'{family}.jpg': j(f'{family}.jpg'),
            f'{family}_bump.jpg': j(f'{family}_bump.jpg'),
            f'{family}_normal.jpg': j(f'{family}_normal.jpg'),
        },
    }
    print(f'  {family} <- {asset}: albedo {j(f"{family}.jpg") // 1024}KB bump {j(f"{family}_bump.jpg") // 1024}KB normal {j(f"{family}_normal.jpg") // 1024}KB')


def bake_sky(manifest: dict) -> None:
    src = RAW / 'hdri' / f'{SKY_ASSET}.jpg'
    im = Image.open(src).convert('RGB')
    if im.size != (2048, 1024):
        im = im.resize((2048, 1024), Image.LANCZOS)
    SKYOUT.mkdir(parents=True, exist_ok=True)
    dest = SKYOUT / 'sky.jpg'
    im.save(dest, 'JPEG', quality=88, optimize=True)
    manifest['sky'] = {
        'asset': SKY_ASSET,
        'site': 'ambientcg.com',
        'license': 'CC0 1.0',
        'url': f'https://ambientcg.com/a?id={SKY_ASSET}',
        'task': '132 — island equirect skydome (1K-TONEMAPPED jpg, no .hdr decode); sun lon 179.6 lat +38.4 (computed); engine sun azimuth aligned via dome rotation.y in textures.ts',
        'files': {'sky.jpg': dest.stat().st_size},
    }
    print(f'  sky <- {SKY_ASSET}: dome {dest.stat().st_size // 1024}KB (2048x1024)')


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict = {}
    for fam, asset in PICKS.items():
        print(f'== {fam} <- {asset}')
        bake_family(fam, asset, manifest)
    bake_sky(manifest)
    (OUT / 'sources.json').write_text(json.dumps(manifest, indent=1) + '\n')
    (RAW / 'island-picks.json').write_text(json.dumps(PICKS, indent=1) + '\n')
    total = sum(sum(v['files'].values()) for v in manifest.values())
    print(f'\nstaged total: {total // 1024} KB in {OUT} + {SKYOUT}/sky.jpg')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
