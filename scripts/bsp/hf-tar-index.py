#!/usr/bin/env python3
"""Sequentially index every asset+file offset in one HF ambientcg dataset tar.
Resumable: writes .tmp/ambientcg-raw/index-{nn}.json after each window.
Usage: python3 index-tar.py 4
"""
import importlib.util
import json
import os
import sys
import time

spec = importlib.util.spec_from_file_location('mt', os.path.join(os.path.dirname(__file__), 'map-tar.py'))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)

INDEX_DIR = '/home/z/my-project/scripts/.tmp/ambientcg-raw'


def main():
    tar_no = int(sys.argv[1])
    url = mt.TAR_FMT.format(n=f'{tar_no:02d}')
    size = mt.S.head(url, timeout=60, allow_redirects=True).headers.get('Content-Length')
    size = int(size)
    out_path = os.path.join(INDEX_DIR, f'index-{tar_no:02d}.json')
    idx = {'size': size, 'pos': 0, 'files': {}}
    if os.path.exists(out_path):
        with open(out_path) as f:
            idx = json.load(f)
        print(f'resume from {idx["pos"]/1e6:.0f}MB ({len(idx["files"])} files indexed)')

    W = 3 << 20
    t0 = time.time()
    n = 0
    while idx['pos'] < size - 512:
        hdrs = mt.scan(url, idx['pos'], W)
        n += 1
        if not hdrs:
            idx['pos'] += W
        else:
            for off, name, sz in hdrs:
                idx['files'][name] = [off, sz]
            last_off, _ln, last_sz = hdrs[-1]
            nxt = last_off + 512 + ((last_sz + 511) // 512) * 512
            idx['pos'] = max(idx['pos'] + W, nxt)
        if n % 10 == 0:
            with open(out_path, 'w') as f:
                json.dump(idx, f)
            dt = time.time() - t0
            print(f'  {idx["pos"]/1e6:6.0f}/{size/1e6:.0f}MB  {len(idx["files"])} files  ({dt:.0f}s)', flush=True)
            t0 = time.time()
    with open(out_path, 'w') as f:
        json.dump(idx, f)
    assets = sorted({n.split('_1K-JPG_')[0] for n in idx['files'] if '_1K-JPG_' in n})
    print(f'DONE tar_{tar_no:02d}: {len(idx["files"])} files, {len(assets)} assets')


if __name__ == '__main__':
    main()
