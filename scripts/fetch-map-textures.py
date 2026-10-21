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

# Task 77 — per-map texture identities. Keyed by map id, written to
# public/staging/textures/maps/<mapId>/ (own sources.json). Maps without an
# entry use the shared desert set above. aimhead = the ORIGINAL map's palette:
# its BSP references de_aztec.wad (AzGrass/AzWll/AzStat... = aztec), so the
# set is aztec greens: grass lawn, mossy temple sandstone, mossy statue rock,
# olive military metal, mossy trim wood. crate stays shared (universal CS
# wooden crates).
# bake-time HSV shift (PIL 0-255 hue scale): PolyHaven has NO saturated green
# lawn (all grass/forest floors are dry brown, G-R < 0), so the aztec greens
# are hue-shifted from the best-detail candidates. CC0 permits modification;
# params recorded here keep every staged byte reproducible. Tuned + VLM-picked
# (scripts/tune-aimhead-shift.py): grass hue36 s1.3 = vivid-but-natural lawn;
# wall hue22 s1.15 = grey stone structure, moss patches go green.
# Usage: fetch-map-textures.py --map aimhead   (builds ONLY that map set)
MAP_SETS = {
    'aimhead': {
        'sand':  {'id': 'grass_path_2', 'hue': 32, 'sat': 0.85, 'val': 0.85},  # aztec lawn (AzGrass) — FINAL: matched to REAL de_aztec screenshot sampling ((84,87,69) muted olive, G-R +3..+15 band; vivid greens read neon in-game)
        'brick': {'id': 'mossy_cobblestone'},  # temple walls (AzWll) — NATIVE: grey stone with real green moss patches; the hue22/s1.15 shift read 'slime-filtered' (VLM), uniform tinting is wrong for stone
        'dark':  {'id': 'mossy_rock'},        # center statues (AzStat) — natively olive-grey
        'metal': {'id': 'green_metal_rust'},  # military crates (MltryCrte) — natively olive
        'plank': {'id': 'moss_wood'},         # trim (AzTrim) — natively green moss wood
    },
}

CDN = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg'


def curl(url: str, dest: Path) -> None:
    print(f'  fetch {dest.name}')
    r = subprocess.run(['curl', '-sL', url, '-o', str(dest), '--max-time', '120'],
                       capture_output=True, text=True)
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 1000:
        raise RuntimeError(f'download failed: {url} (rc={r.returncode})')


def build_set(mapping: dict, out_dir: Path) -> int:
    """Download raws (cached) + encode albedo/bump jpgs + write sources.json."""
    from PIL import Image
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    total = 0
    for surface, spec in mapping.items():
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
        albedo_out = out_dir / f'{surface}.jpg'
        im = Image.open(diff).convert('RGB')
        if im.size != (apx, apx):
            im = im.resize((apx, apx), Image.LANCZOS)
        if 'hue' in spec or 'sat' in spec or 'val' in spec:  # aztec green bake (Task 77)
            hsv = im.convert('HSV')
            h, s, v = hsv.split()
            if 'hue' in spec:
                hue = spec['hue']
                h = h.point(lambda x, hu=hue: (x + hu) % 256)
            if 'sat' in spec:
                sat = spec['sat']
                s = s.point(lambda x, sa=sat: min(255, int(x * sa)))
            if 'val' in spec:
                val = spec['val']
                v = v.point(lambda x, va=val: min(255, int(x * va)))
            im = Image.merge('HSV', (h, s, v)).convert('RGB')
        im.save(albedo_out, 'JPEG', quality=aq, optimize=True)

        # bump: displacement -> grayscale, target px
        bump_out = out_dir / f'{surface}_bump.jpg'
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
        total += albedo_out.stat().st_size + bump_out.stat().st_size
        print(f'  staged {albedo_out.name} {albedo_out.stat().st_size//1024}KB, {bump_out.name} {bump_out.stat().st_size//1024}KB')

    (out_dir / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'\nstaged total: {total//1024} KB in {out_dir}')
    return 0


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    args = sys.argv[1:]
    if '--map' in args:
        map_id = args[args.index('--map') + 1]
        if map_id not in MAP_SETS:
            print(f'no map set for {map_id!r} (have: {", ".join(MAP_SETS)})')
            return 1
        return build_set(MAP_SETS[map_id], OUT / map_id)
    return build_set(MAPPING, OUT)


if __name__ == '__main__':
    sys.exit(main())
