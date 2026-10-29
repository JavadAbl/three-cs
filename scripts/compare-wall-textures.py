#!/usr/bin/env python3
"""Task 74: compare PolyHaven wall-texture candidates for the Dust2-style 'wall' surface.

Downloads 1K diffuse JPGs for the shortlist into scripts/.tmp/acg/ (same raw dir
as fetch-map-textures.py, so the winner needs no re-download), builds a labeled
contact sheet at download/wall-candidates.jpg, and prints tone/detail stats
(mean RGB, luminance stddev, edge energy) to pre-rank detail richness.
"""
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageStat, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'scripts' / '.tmp' / 'acg'
BASE = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k'

# (asset_id, short label) — Dust2-appropriate warm/weathered plasters
CANDIDATES = [
    ('plastered_wall_02', 'plastered_wall_02'),
    ('plastered_wall_03', 'plastered_wall_03'),
    ('plastered_wall_04', 'plastered_wall_04'),
    ('worn_plaster_wall', 'worn_plaster'),
    ('worn_cracked_plaster', 'worn_cracked'),
    ('damaged_plaster', 'damaged'),
    ('yellow_plaster_02', 'yellow_plaster_02'),
    ('clay_plaster', 'clay_plaster'),
    ('wall_bricks_plaster', 'bricks_plaster'),
    ('rough_plaster_brick', 'rough_pl_brick'),
    ('red_brick_plaster_patch_02', 'rb_plaster_patch'),
    ('coral_fort_wall_01', 'coral_fort_01'),
    ('beige_wall_001', 'CURRENT-beige'),   # current, for reference
]


def curl(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 1000:
        return
    r = subprocess.run(['curl', '-sL', url, '-o', str(dest), '--max-time', '120'],
                       capture_output=True, text=True)
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 1000:
        raise RuntimeError(f'download failed: {url}')


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    thumbs = []
    stats = []
    for asset, label in CANDIDATES:
        f = RAW / f'{asset}_diff_1k.jpg'
        try:
            curl(f'{BASE}/{asset}/{asset}_diff_1k.jpg', f)
        except RuntimeError as e:
            print(f'SKIP {label}: {e}')
            continue
        im = Image.open(f).convert('RGB')
        st = ImageStat.Stat(im)
        lum = im.convert('L')
        edges = lum.filter(ImageFilter.FIND_EDGES)
        est = ImageStat.Stat(edges)
        thumb = im.resize((256, 256), Image.LANCZOS)
        thumbs.append((label, thumb))
        stats.append({
            'label': label, 'asset': asset,
            'rgb_mean': [round(v) for v in st.mean],
            'lum_std': round(ImageStat.Stat(lum).stddev[0], 1),
            'edge_energy': round(est.mean[0], 1),
            'kb': f.stat().st_size // 1024,
        })

    # contact sheet: 4 cols x N rows, 256px cells + label bar
    cols = 4
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 256, rows * (256 + 22)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, (label, t) in enumerate(thumbs):
        x, y = (i % cols) * 256, (i // cols) * (256 + 22)
        sheet.paste(t, (x, y + 22))
        d.text((x + 6, y + 4), label, fill=(255, 255, 255))
    out = ROOT / 'download' / 'wall-candidates.jpg'
    sheet.save(out, 'JPEG', quality=85)
    print(f'contact sheet: {out} ({len(thumbs)} candidates)')

    print(f"{'label':20s} {'rgb_mean':16s} {'lum_std':>8s} {'edge':>6s} {'kb':>6s}")
    for s in sorted(stats, key=lambda s: -s['lum_std']):
        r, g, b = s['rgb_mean']
        print(f"{s['label']:20s} {r:3d},{g:3d},{b:3d}      {s['lum_std']:8.1f} {s['edge_energy']:6.1f} {s['kb']:6d}")

    (ROOT / 'scripts' / '.tmp' / 'wall_candidates_stats.json').write_text(json.dumps(stats, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
