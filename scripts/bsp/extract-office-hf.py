#!/usr/bin/env python3
"""Extract the 17 office candidates via the exact-offset indexes (no search).
Saves Color/NormalGL/Displacement jpgs + provenance json per asset.
"""
import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location('mt', os.path.join(os.path.dirname(__file__), 'map-tar.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

RAW = '/home/z/my-project/scripts/.tmp/ambientcg-raw'
OUT = os.path.join(RAW, 'office')
WANT = ['Fabric005', 'Fabric011', 'Fabric013', 'PaintedPlaster002', 'PaintedPlaster004',
        'PaintedPlaster006', 'Plaster004', 'Plaster005', 'Snow001', 'Snow002', 'Tiles010',
        'Tiles012', 'Tiles089', 'Bricks085', 'Wood062', 'Wood050']
SUFFIXES = ('_Color.jpg', '_NormalGL.jpg', '_Displacement.jpg', '.json')


def main():
    only = set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None
    indexes = {}
    for n in range(8):
        p = os.path.join(RAW, f'index-{n:02d}.json')
        if os.path.exists(p):
            indexes[n] = json.load(open(p))['files']

    for asset in WANT:
        if only and asset not in only:
            continue
        hits = []   # (tar, name, off, size)
        for n, files in indexes.items():
            for fname, (off, sz) in files.items():
                if fname.startswith(f'{asset}_1K-JPG_') and any(fname.endswith(s) for s in SUFFIXES):
                    hits.append((n, fname, off, sz))
        if not hits:
            print(f'!! {asset}: not found in any index')
            continue
        adir = os.path.join(OUT, asset)
        os.makedirs(adir, exist_ok=True)
        for n, fname, off, sz in hits:
            dest = os.path.join(adir, fname)
            if os.path.exists(dest) and os.path.getsize(dest) == sz:
                continue
            url = mt.TAR_FMT.format(n=f'{n:02d}')
            data = mt.S.get(url, headers={'Range': f'bytes={off + 512}-{off + 512 + sz - 1}'}, timeout=90).content
            assert len(data) == sz, f'{fname}: got {len(data)} want {sz}'
            with open(dest, 'wb') as f:
                f.write(data)
            print(f'  + {asset} tar_{n:02d} {fname.split(asset + "_1K-JPG_" + asset + "_1K-JPG_")[-1] or fname} ({sz//1024}KB)')
    print('done')


if __name__ == '__main__':
    main()
