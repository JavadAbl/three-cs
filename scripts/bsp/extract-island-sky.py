#!/usr/bin/env python3
"""Task 132 acceptance regen — extract ONLY the picked island HDRI.

bake-island-textures.py reads RAW/island/hdri/DaySkyHDRI017B.jpg (the triage
output path), but full re-extraction after a container wipe only needs this
one equirect — triage's 32 candidates + sheets are already VLM-decided and
recorded in the committed pick headers. This pulls the single 1K-TONEMAPPED
member via the same exact-offset range-GET protocol as extract-island-hf.py.
"""
import importlib.util
import os

_here = os.path.dirname(__file__)
_spec = importlib.util.spec_from_file_location('ex', os.path.join(_here, 'extract-island-hf.py'))
ex = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ex)

SKY_ASSET = 'DaySkyHDRI017B'   # pick record: bake-island-textures.py SKY_ASSET


def main():
    indexes = ex.load_indexes()
    if not indexes:
        raise SystemExit('no index-0*.json found — run scripts/bsp/hf-tar-index.py first')
    hits = ex.find_members(indexes, SKY_ASSET, '_1K-TONEMAPPED.jpg')
    if not hits:
        raise SystemExit(f'{SKY_ASSET}: no 1K-TONEMAPPED.jpg member in any indexed tar')
    _, n, fname, off, sz = hits[0]
    out = ex.OUT / 'hdri'
    out.mkdir(parents=True, exist_ok=True)
    p = out / f'{SKY_ASSET}.jpg'
    if p.exists() and p.stat().st_size == sz:
        print(f'  = {SKY_ASSET} already present ({sz // 1024}KB)')
    else:
        p.write_bytes(ex.fetch_member(hits[0]))
        print(f'  + {SKY_ASSET} tar_{n:02d} {fname} -> {p} ({sz // 1024}KB)')


if __name__ == '__main__':
    main()
