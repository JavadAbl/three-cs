#!/usr/bin/env python3
"""Profile aimhead BSP geom: y-distribution of faces, extents, and where the
walkable floor actually renders vs the collision boxes (player y=2.4)."""
import json
from collections import Counter

data = json.load(open('/home/z/my-project/public/assets/maps/aimhead/geom.json'))
ys = Counter()
mins = [1e9, 1e9, 1e9]
maxs = [-1e9, -1e9, -1e9]
floor_like = Counter()
for g in data['groups']:
    pos, idx = g['pos'], g['idx']
    for t in range(0, len(idx), 3):
        a, b, c = idx[t], idx[t+1], idx[t+2]
        pts = [pos[a*3:a*3+3], pos[b*3:b*3+3], pos[c*3:c*3+3]]
        ymid = sum(p[1] for p in pts) / 3
        ys[round(ymid, 1)] += 1
        for p in pts:
            for i in range(3):
                mins[i] = min(mins[i], p[i]); maxs[i] = max(maxs[i], p[i])
        # flat faces (all same y) = floors/ceilings
        if abs(max(p[1] for p in pts) - min(p[1] for p in pts)) < 0.01:
            floor_like[round(pts[0][1], 1)] += 1

print('bbox min', [round(v, 2) for v in mins], 'max', [round(v, 2) for v in maxs])
print('\nflat-face heights (floors/ceilings):')
for y, n in sorted(floor_like.items()):
    print(f'  y={y:7.2f}  {n:4d} faces')
print('\ngroup tex keys:', [g.get('tex') for g in data['groups']])
print('group sizes:', [len(g['idx'])//3 for g in data['groups']])
