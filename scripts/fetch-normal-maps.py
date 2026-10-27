#!/usr/bin/env python3
"""Task 90 — fetch the MATCHING PolyHaven NormalGL maps for the dust2 + aimhead
surface sets and process them into the game's <surface>_normal.jpg convention
(Task 88), extending the real-normal PBR upgrade beyond aimdepot.

Why this is the geometrically correct upgrade: the shipped albedo/height sets
ARE PolyHaven CC0 assets (Task 73/75 shared desert set, Task 77 aztec set —
scripts/fetch-map-textures.py records their ids), so each asset's own
nor_gl (OpenGL Y+ = three.js convention) normal map matches the existing
albedo pixel-for-pixel geometrically. No re-skin, no look change — pure
surface-relief upgrade. (aimhead's sand is hue-baked, but a hue shift moves
color, not geometry, so the native normal still matches.)

Outputs (per the process-aimdepot-textures.py conventions):
  public/assets/textures/maps/dust2/<s>_normal.jpg    10 shared-desert surfaces
      — dust2 is the first map whose IDENTITY DIRECTORY holds only normals;
        albedo/bump still resolve through the 4-step loader chain to the
        shared set, so the map look is untouched while scoped keys gain relief
  public/assets/textures/maps/aimhead/<s>_normal.jpg  5 aztec surfaces
      — appended next to the existing albedo/bump identity files
  + sources.json provenance in both dirs

Convention: native resolution, NO resize (resampling normals without proper
filtering bends gradients — Task 88 lesson); JPEG q85, linear data. The wall
keeps its Task-74 2K resolution budget (its albedo is 2K); everything else 1K.

Re-run safe: raw downloads cached in scripts/.tmp/ph/, outputs deterministic.
All sources CC0 (polyhaven.com). Direct-to-assets per the Task-88 map-identity
precedent (user-requested upgrade, live-VLM-verified before commit).
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'scripts' / '.tmp' / 'ph'
MAPS_DIR = ROOT / 'public' / 'assets' / 'textures' / 'maps'
CDN = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg'

# map id -> { game surface: { id: polyhaven asset, src: 1k|2k } }
# dust2 surface ids = the shared desert set (Task 73/75); aimhead = the aztec
# identity set (Task 77). Tiles/bumps live in src/game/textures.ts PBR_BY_MAP.
NORMALS = {
    'dust2': {
        'sand':     {'id': 'aerial_sand'},            # tan desert sand, ruts
        'wall':     {'id': 'worn_cracked_plaster', 'src': '2k'},  # dominant surface, 2K budget (Task 74)
        'brick':    {'id': 'large_sandstone_blocks'}, # sandstone block walls
        'concrete': {'id': 'concrete'},               # dirty outdoor concrete
        'crate':    {'id': 'plywood'},                # crate faces
        'plank':    {'id': 'wood_planks_dirt'},       # weathered planks
        'metal':    {'id': 'worn_corrugated_iron'},   # corrugated sheds
        'dark':     {'id': 'asphalt_03'},             # dirty road
        'door':     {'id': 'painted_metal_shutter'},  # painted shutters
        'doorBlue': {'id': 'blue_painted_planks'},     # blue painted doors
    },
    'aimhead': {
        'sand':  {'id': 'grass_path_2'},      # hue-baked aztec lawn (AzGrass)
        'brick': {'id': 'mossy_cobblestone'}, # temple walls (AzWll)
        'dark':  {'id': 'mossy_rock'},        # center statues (AzStat)
        'metal': {'id': 'green_metal_rust'},  # military crates (MltryCrte)
        'plank': {'id': 'moss_wood'},         # trim (AzTrim)
    },
}


def curl(url: str, dest: Path) -> None:
    print(f'  fetch {dest.name}')
    r = subprocess.run(['curl', '-sL', url, '-o', str(dest), '--max-time', '180'],
                       capture_output=True, text=True)
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 1000:
        raise RuntimeError(f'download failed: {url} (rc={r.returncode})')


def build_map(map_id: str, spec: dict) -> int:
    from PIL import Image
    out_dir = MAPS_DIR / map_id
    out_dir.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    total = 0
    for surface, s in spec.items():
        asset, src = s['id'], s.get('src', '1k')
        raw = RAW / f'{asset}_nor_gl_{src}.jpg'
        if not raw.exists():
            curl(f'{CDN}/{src}/{asset}/{asset}_nor_gl_{src}.jpg', raw)
        im = Image.open(raw)
        if im.mode != 'RGB':
            im = im.convert('RGB')
        # native resolution, NO resize (Task 88: resampling bends gradients)
        out = out_dir / f'{surface}_normal.jpg'
        im.save(out, 'JPEG', quality=85)
        total += out.stat().st_size
        print(f'  {map_id}/{surface}_normal.jpg  {im.size[0]}x{im.size[1]}  {out.stat().st_size // 1024}KB  <- {asset} ({src})')

    # provenance
    src_path = out_dir / 'sources.json'
    if src_path.exists():
        manifest = json.loads(src_path.read_text())
    else:
        manifest = {}
    for surface, s in spec.items():
        asset, srcc = s['id'], s.get('src', '1k')
        entry = manifest.setdefault(surface, {
            'polyhaven_id': asset,
            'license': 'CC0 1.0 (polyhaven.com)',
            'albedo': f'https://polyhaven.com/a/{asset}',
            'bytes': {},
        })
        entry['normal'] = f'https://polyhaven.com/a/{asset} ({srcc} nor_gl — OpenGL Y+)'
        entry.setdefault('bytes', {})['normal'] = (out_dir / f'{surface}_normal.jpg').stat().st_size
    if map_id == 'dust2':
        manifest['_pipeline'] = {
            'fetch': 'scripts/fetch-normal-maps.py — polyhaven.com CC0 NormalGL jpgs, '
                     'native resolution (wall 2K per the Task-74 budget, rest 1K), q85 linear',
            'scope': 'dust2 ships ONLY <s>_normal.jpg here; albedo/bump resolve through '
                     'the loader chain to the shared desert set (public/assets/textures/maps/) '
                     'so the accepted map look is untouched — this dir adds surface relief only',
        }
    src_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'  sources.json updated: {src_path}')
    return total


def main() -> int:
    grand = 0
    for map_id, spec in NORMALS.items():
        print(f'== {map_id}')
        grand += build_map(map_id, spec)
    print(f'\nnormal set total: {grand // 1024} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
