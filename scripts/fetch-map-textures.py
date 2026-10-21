#!/usr/bin/env python3
"""Fetch CC0 PBR map textures from PolyHaven and stage them for the game.

Recovery tool for the staged map-texture set (Task 73). Mirrors the bake-*.ts
pattern: this script reproduces every file in public/staging/textures/maps/
exactly from public sources.

Sources are all CC0 (public domain, polyhaven.com) — safe for any use.
Downloads 1K albedo (diffuse) + displacement JPGs, re-encodes to:
  public/staging/textures/maps/<surface>.jpg        albedo, 1024x1024, q82
  public/staging/textures/maps/<surface>_bump.jpg   grayscale height, 512x512, q80 (bumpMap)

Re-run safe: skips downloads whose raw copies already exist in scripts/.tmp/acg/.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'scripts' / '.tmp' / 'acg'
OUT = ROOT / 'public' / 'staging' / 'textures' / 'maps'

# game surface -> PolyHaven asset id (all CC0)
MAPPING = {
    'sand':     'aerial_sand',           # tan compacted desert sand, tyre/foot ruts
    'wall':     'beige_wall_001',        # outdoor sand-plaster wall (Dust2 sandstone plaster)
    'brick':    'large_sandstone_blocks',# sandstone block wall
    'concrete': 'concrete',              # dirty outdoor concrete
    'crate':    'plywood',               # crate / plywood faces
    'plank':    'wood_planks_dirt',      # weathered outdoor planks
    'metal':    'worn_corrugated_iron',  # corrugated iron sheds
    'dark':     'asphalt_03',            # dirty asphalt road
    'door':     'painted_metal_shutter', # painted metal door/shutter
    'doorBlue': 'blue_painted_planks',   # blue painted wood (doorBlue variant)
}

BASE = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k'


def curl(url: str, dest: Path) -> None:
    print(f'  fetch {dest.name}')
    r = subprocess.run(['curl', '-sL', url, '-o', str(dest), '--max-time', '120'],
                       capture_output=True, text=True)
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 1000:
        raise RuntimeError(f'download failed: {url} (rc={r.returncode})')


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    from PIL import Image

    for surface, asset in MAPPING.items():
        print(f'== {surface} <- {asset}')
        diff = RAW / f'{asset}_diff_1k.jpg'
        disp = RAW / f'{asset}_disp_1k.jpg'
        if not diff.exists():
            curl(f'{BASE}/{asset}/{asset}_diff_1k.jpg', diff)
        if not disp.exists():
            curl(f'{BASE}/{asset}/{asset}_disp_1k.jpg', disp)

        # albedo: re-encode to q82 (1k sources are 300KB-1.5MB; targets ~150-300KB)
        albedo_out = OUT / f'{surface}.jpg'
        im = Image.open(diff).convert('RGB')
        if im.size != (1024, 1024):
            im = im.resize((1024, 1024), Image.LANCZOS)
        im.save(albedo_out, 'JPEG', quality=82, optimize=True)

        # bump: displacement -> grayscale 512
        bump_out = OUT / f'{surface}_bump.jpg'
        bm = Image.open(disp).convert('L')
        if bm.size != (512, 512):
            bm = bm.resize((512, 512), Image.LANCZOS)
        bm.save(bump_out, 'JPEG', quality=80, optimize=True)

        manifest[surface] = {
            'polyhaven_id': asset,
            'license': 'CC0 1.0 (polyhaven.com)',
            'albedo': f'https://polyhaven.com/a/{asset}',
            'bytes': {'albedo': albedo_out.stat().st_size, 'bump': bump_out.stat().st_size},
        }
        print(f'  staged {albedo_out.name} {albedo_out.stat().st_size//1024}KB, {bump_out.name} {bump_out.stat().st_size//1024}KB')

    (OUT / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    total = sum((OUT / f).stat().st_size for f in OUT.iterdir() if f.is_file() and f.name != 'sources.json')
    print(f'\nstaged total: {total//1024} KB in {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
