#!/usr/bin/env python3
"""Task 132 — island ambientCG candidate extraction via exact-offset indexes.

Two rounds, same provenance pattern as the office bake (extract-office-hf.py):
  triage          extract _Color.jpg thumbnails + HDRI 1K-TONEMAPPED equirects
                  for the shortlist, build 2 labeled contact sheets for VLM A/B
  full A,B,...    extract every PBR map (Color/NormalGL/Displacement/Opacity)
                  for the picked winner assets, ready for bake-island-textures

No local tar files: every member is one HTTP range GET against the HF mirror
(offsets from scripts/.tmp/ambientcg-raw/index-0*.json — wiped-container safe).
Resolution policy: prefer 1K members; fall back to 4K if a candidate only
ships 4K in this mirror (bake downscales anyway).
"""
import importlib.util
import json
import os
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location('mt', os.path.join(os.path.dirname(__file__), 'map-tar.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

from PIL import Image, ImageDraw  # noqa: E402

RAW = Path('/home/z/my-project/scripts/.tmp/ambientcg-raw')
OUT = RAW / 'island'

# island surface family -> (candidates in sheet order, identity for VLM prompt)
FAMILIES = {
    'isand':    (['Gravel002', 'Gravel012', 'Gravel025', 'Gravel038'],
                 'tropical beach sand: fine, warm, light golden-quartz grains, gentle wave ripples'),
    'igrass':   (['Grass001', 'Grass003', 'Grass005', 'Grass007'],
                 'sunlit dune/meadow grass, lush green, sparse blade clumps on sand'),
    'irock':    (['Rock001', 'Rock017', 'Rock034', 'Rock049'],
                 'coastal cliff / boulder rock: grey-brown weathered, volcanic, sea-spray stains'),
    'bark':     (['Bark012', 'Bark010', 'Bark007', 'Bark005'],
                 'palm trunk bark: fibrous, ringed, grey-brown, not a temperate hardwood'),
    'leaf':     (['LeafSet001', 'LeafSet008', 'LeafSet015', 'LeafSet022'],
                 'palm fronds / tropical thatch: overlapping long green leaves, sun-dried tips ok'),
    'plank':    (['Planks002', 'Planks006', 'Planks012', 'Planks018'],
                 'weathered dock wood: salt-washed planks, grey-brown, gaps + bolt holes, not clean oak'),
    'metal':    (['PaintedMetal002', 'PaintedMetal009', 'Metal031', 'Metal058'],
                 'painted industrial metal: radar-dish panels, slightly chalky sun-bleached paint'),
    'concrete': (['Concrete007', 'Concrete018', 'Concrete034', 'Concrete036'],
                 'sun-bleached concrete: foundation slab, hairline cracks, tropical humidity stains'),
}

# HDRI triage — spread across both pack families; ids carry A/B suffix on DaySky
HDRI_CANDIDATES = [
    'DayEnvironmentHDRI003', 'DayEnvironmentHDRI010', 'DayEnvironmentHDRI018', 'DayEnvironmentHDRI026',
    'DayEnvironmentHDRI034', 'DayEnvironmentHDRI045', 'DayEnvironmentHDRI055', 'DayEnvironmentHDRI068',
    'DaySkyHDRI001A', 'DaySkyHDRI005B', 'DaySkyHDRI009A', 'DaySkyHDRI012B',
    'DaySkyHDRI015A', 'DaySkyHDRI017B', 'DaySkyHDRI019A', 'DaySkyHDRI020B',
]

MAP_SUFFIXES = ('_Color.jpg', '_NormalGL.jpg', '_Displacement.jpg', '_Opacity.jpg')


def load_indexes():
    idx = {}
    for n in range(8):
        p = RAW / f'index-{n:02d}.json'
        if p.exists():
            idx[n] = json.load(open(p))['files']
    return idx


def find_members(indexes, asset: str, suffix: str):
    """All index hits for asset+suffix, 1K preferred."""
    hits = []
    for n, files in indexes.items():
        for fname, (off, sz) in files.items():
            if fname.startswith(f'{asset}_') and fname.endswith(suffix):
                res = '1K' if '_1K-' in fname else ('4K' if '_4K-' in fname else '2K')
                hits.append((res, n, fname, off, sz))
    hits.sort(key=lambda h: (h[0] != '1K', h[0] != '4K'))  # 1K first, then 4K, then 2K
    return hits


def fetch_member(hit):
    _, n, fname, off, sz = hit
    url = mt.TAR_FMT.format(n=f'{n:02d}')
    data = mt.fetch_range(url, off + 512, off + 512 + sz - 1)
    assert len(data) == sz, f'{fname}: got {len(data)} want {sz}'
    return data


def extract(indexes, asset: str, suffix: str, dest: Path) -> bool:
    hits = find_members(indexes, asset, suffix)
    if not hits:
        print(f'  !! {asset}{suffix}: not found')
        return False
    res, n, fname, off, sz = hits[0]
    if dest.exists() and dest.stat().st_size == sz:
        return True
    dest.write_bytes(fetch_member(hits[0]))
    print(f'  + {asset} tar_{n:02d} [{res}] {dest.name} ({sz // 1024}KB)')
    return True


def cmd_triage():
    indexes = load_indexes()
    (OUT / 'color').mkdir(parents=True, exist_ok=True)
    got = {}
    for fam, (cands, _ident) in FAMILIES.items():
        for c in cands:
            p = OUT / 'color' / f'{c}_Color.jpg'
            if extract(indexes, c, '_Color.jpg', p):
                got[c] = p
    # HDRI equirects
    (OUT / 'hdri').mkdir(parents=True, exist_ok=True)
    hdri_got = {}
    for h in HDRI_CANDIDATES:
        p = OUT / 'hdri' / f'{h}.jpg'
        hits = find_members(indexes, h, '_1K-TONEMAPPED.jpg')
        if not hits:
            print(f'  !! {h}: no 1K-TONEMAPPED.jpg')
            continue
        _, n, fname, off, sz = hits[0]
        if not (p.exists() and p.stat().st_size == sz):
            p.write_bytes(fetch_member(hits[0]))
            print(f'  + {h} tar_{n:02d} {p.name} ({sz // 1024}KB)')
        hdri_got[h] = p

    # ---- sheet 1: textures, 8 family rows x 4 cols, labeled ----
    CW, LBL = 320, 34
    fams = list(FAMILIES.items())
    sheet = Image.new('RGB', (CW * 4, (CW + LBL) * len(fams)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for r, (fam, (cands, _)) in enumerate(fams):
        y = r * (CW + LBL)
        d.rectangle([0, y, CW * 4, y + LBL], fill=(40, 40, 40))
        d.text((8, y + 10), f'{fam.upper()}', fill=(120, 255, 160))
        for c_i, c in enumerate(cands):
            x = c_i * CW
            d.text((x + 8, y + 10), f'{chr(65 + c_i)} {c}', fill=(255, 255, 120))
            if c in got:
                im = Image.open(got[c]).convert('RGB').resize((CW, CW), Image.LANCZOS)
                sheet.paste(im, (x, y + LBL))
    s1 = OUT / 'sheet-textures.jpg'
    sheet.save(s1, 'JPEG', quality=88)
    print(f'sheet -> {s1} ({sheet.size[0]}x{sheet.size[1]})')

    # ---- sheet 2: HDRIs, 4x4 equirect thumbs ----
    TW, TH, LBL2 = 320, 160, 30
    items = [(h, hdri_got[h]) for h in HDRI_CANDIDATES if h in hdri_got]
    sheet2 = Image.new('RGB', (TW * 4, (TH + LBL2) * 4), (24, 24, 24))
    d2 = ImageDraw.Draw(sheet2)
    for i, (h, p) in enumerate(items[:16]):
        r, c = divmod(i, 4)
        x, y = c * TW, r * (TH + LBL2)
        d2.rectangle([x, y, x + TW, y + LBL2], fill=(40, 40, 40))
        d2.text((x + 8, y + 8), f'{chr(65 + i)} {h}', fill=(255, 255, 120))
        im = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
        sheet2.paste(im, (x, y + LBL2))
    s2 = OUT / 'sheet-hdri.jpg'
    sheet2.save(s2, 'JPEG', quality=88)
    print(f'sheet -> {s2} ({sheet2.size[0]}x{sheet2.size[1]})')
    print(f'textures {len(got)}/{sum(len(c) for c, _ in FAMILIES.values())}  hdri {len(hdri_got)}/{len(HDRI_CANDIDATES)}')


ROUND2 = [
    'ThatchedRoof001A', 'ThatchedRoof001B', 'ThatchedRoof002A', 'ThatchedRoof002B',
    'Foliage002', 'Foliage005', 'Grass002', 'Grass004', 'Grass006', 'Grass008',
    'ScatteredLeaves002', 'ScatteredLeaves005',
]


def cmd_triage2():
    """Round 2: thatch / foliage / remaining grasses after LeafSet proved atlas."""
    indexes = load_indexes()
    (OUT / 'color').mkdir(parents=True, exist_ok=True)
    got = {}
    for c in ROUND2:
        p = OUT / 'color' / f'{c}_Color.jpg'
        if extract(indexes, c, '_Color.jpg', p):
            got[c] = p
    CW, LBL = 320, 34
    n = len(got)
    cols = 4
    rows = (n + cols - 1) // cols
    sheet = Image.new('RGB', (CW * cols, (CW + LBL) * rows), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    for i, (c, p) in enumerate(got.items()):
        r, ci = divmod(i, cols)
        x, y = ci * CW, r * (CW + LBL)
        d.rectangle([x, y, x + CW, y + LBL], fill=(40, 40, 40))
        d.text((x + 8, y + 10), f'{chr(65 + i)} {c}', fill=(255, 255, 120))
        im = Image.open(p).convert('RGB').resize((CW, CW), Image.LANCZOS)
        sheet.paste(im, (x, y + LBL))
    s = OUT / 'sheet-round2.jpg'
    sheet.save(s, 'JPEG', quality=88)
    print(f'sheet -> {s} ({n} tiles)')


def cmd_full(assets):
    indexes = load_indexes()
    for asset in assets:
        adir = OUT / 'full' / asset
        adir.mkdir(parents=True, exist_ok=True)
        any_hit = False
        for suf in MAP_SUFFIXES:
            p = adir / f'{asset}{suf}'
            if extract(indexes, asset, suf, p):
                any_hit = True
        if not any_hit:
            print(f'  !! {asset}: nothing extracted')
    print('done')


if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in ('triage', 'triage2', 'full'):
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == 'triage':
        cmd_triage()
    elif sys.argv[1] == 'triage2':
        cmd_triage2()
    else:
        cmd_full(sys.argv[2].split(','))
