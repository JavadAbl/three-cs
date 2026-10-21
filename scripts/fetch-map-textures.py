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

# game surface -> { id: PolyHaven asset (all CC0), src: 1k|2k download,
#                   a: albedo px, b: bump px, aq/bq: jpeg quality }
# Defaults (1k -> 1024 albedo q82 / 512 bump q80) keep every other surface
# byte-identical to the Task-73 staged set.
# Task 74: wall swapped beige_wall_001 (detail std 0.7 — read as a flat fill)
#          -> worn_cracked_plaster at 2K: the wall is the map's dominant
#          surface, so it gets the resolution budget (A/B-verified winner:
#          warm ochre plaster, hairline cracks, grime in recesses).
MAPPING = {
    'sand':     {'id': 'aerial_sand'},            # tan compacted desert sand, tyre/foot ruts
    'wall':     {'id': 'worn_cracked_plaster', 'src': '2k', 'a': 2048, 'b': 1024, 'aq': 80},  # weathered sand plaster, cracks (Dust2)
    'brick':    {'id': 'large_sandstone_blocks'}, # sandstone block wall
    'concrete': {'id': 'concrete'},               # dirty outdoor concrete
    'crate':    {'id': 'plywood'},                # crate / plywood faces
    'plank':    {'id': 'wood_planks_dirt'},       # weathered outdoor planks
    'metal':    {'id': 'worn_corrugated_iron'},   # corrugated iron sheds
    'dark':     {'id': 'asphalt_03'},             # dirty asphalt road
    'door':     {'id': 'painted_metal_shutter'},  # painted metal door/shutter
    'doorBlue': {'id': 'blue_painted_planks'},    # blue painted wood (doorBlue variant)
}

CDN = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg'


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

    for surface, spec in MAPPING.items():
        asset = spec['id']
        src = spec.get('src', '1k')
        apx = spec.get('a', 1024)
        bpx = spec.get('b', 512)
        aq = spec.get('aq', 82)
        bq = spec.get('bq', 80)
        print(f'== {surface} <- {asset} ({src})')
        diff = RAW / f'{asset}_diff_{src}.jpg'
        disp = RAW / f'{asset}_disp_{src}.jpg'
        if not diff.exists():
            curl(f'{CDN}/{src}/{asset}/{asset}_diff_{src}.jpg', diff)
        if not disp.exists():
            curl(f'{CDN}/{src}/{asset}/{asset}_disp_{src}.jpg', disp)

        # albedo: re-encode to target px (1k sources are 300KB-1.5MB; targets ~150-300KB)
        albedo_out = OUT / f'{surface}.jpg'
        im = Image.open(diff).convert('RGB')
        if im.size != (apx, apx):
            im = im.resize((apx, apx), Image.LANCZOS)
        im.save(albedo_out, 'JPEG', quality=aq, optimize=True)

        # bump: displacement -> grayscale, target px
        bump_out = OUT / f'{surface}_bump.jpg'
        bm = Image.open(disp).convert('L')
        if bm.size != (bpx, bpx):
            bm = bm.resize((bpx, bpx), Image.LANCZOS)
        bm.save(bump_out, 'JPEG', quality=bq, optimize=True)

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
