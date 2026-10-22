#!/usr/bin/env python3
"""Check BSP geom face heights overlapping the aimhead bombsite decal footprints.

Goal: explain why the siteDecal plane (y = site.y + 0.08) is invisible on aimhead.
Approach: load public/assets/maps/aimhead/geom.json, rasterize every triangle's
2D (x,z) footprint, and report the min/max y of faces overlapping each site
circle. If any face sits above the decal plane inside the footprint, the decal
is occluded (buried under the visible BSP floor/ramp).
"""
import json, math

GEOM = '/home/z/my-project/public/assets/maps/aimhead/geom.json'
SITES = {
    'A': {'x': -25.28, 'z': -10.36, 'y': 2.45, 'r': 5},
    'B': {'x': 25.6, 'z': -1.84, 'y': 2.45, 'r': 5},
}
DECAL_HALF = 6.5   # PlaneGeometry(13,13)

def tri_overlap_circle(p0, p1, p2, cx, cz, r):
    """Coarse: does triangle's 2D bbox intersect the circle's bbox? Then do a
    finer point-in-triangle test for the circle center + edge sampling."""
    xs = [p0[0], p1[0], p2[0]]
    zs = [p0[2], p1[2], p2[2]]
    if min(xs) > cx + r or max(xs) < cx - r or min(zs) > cz + r or max(zs) < cz - r:
        return False
    # sample the circle boundary + center; any sample inside tri => overlap
    def inside(px, pz):
        d1 = (p1[0]-p0[0])*(pz-p0[2]) - (p1[2]-p0[2])*(px-p0[0])
        d2 = (p2[0]-p1[0])*(pz-p1[2]) - (p2[2]-p1[2])*(px-p1[0])
        d3 = (p0[0]-p2[0])*(pz-p2[2]) - (p0[2]-p2[2])*(px-p2[0])
        has_neg = d1 < 0 or d2 < 0 or d3 < 0
        has_pos = d1 > 0 or d2 > 0 or d3 > 0
        return not (has_neg and has_pos)
    if inside(cx, cz):
        return True
    for i in range(16):
        a = 2 * math.pi * i / 16
        if inside(cx + r * math.cos(a), cz + r * math.sin(a)):
            return True
    return False

data = json.load(open(GEOM))
print(f"groups: {len(data['groups'])}, total tris: {sum(len(g['idx'])//3 for g in data['groups'])}")

for name, s in SITES.items():
    cx, cz, r = s['x'], s['z'], s['r']
    decal_y = s['y'] + 0.08
    overlapping = []   # (min_y, max_y, tex, tri)
    for g in data['groups']:
        pos, idx, tex = g['pos'], g['idx'], g.get('tex', '?')
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t+1], idx[t+2]
            p0 = pos[a*3:a*3+3]; p1 = pos[b*3:b*3+3]; p2 = pos[c*3:c*3+3]
            if tri_overlap_circle(p0, p1, p2, cx, cz, DECAL_HALF):
                ys = [p0[1], p1[1], p2[1]]
                # flat-ish faces only matter for occlusion underfoot, keep all
                overlapping.append((min(ys), max(ys), tex))
    overlapping.sort(key=lambda e: e[0])
    near = [e for e in overlapping if e[0] < decal_y + 3]
    print(f"\nsite {name}: center=({cx},{cz}) r={r}  decal plane y={decal_y:.2f} (B at +0.13)")
    print(f"  faces overlapping decal footprint: {len(overlapping)}")
    for e in near[:14]:
        flag = 'OCCLUDES-DECAL' if e[1] > decal_y else 'below decal'
        print(f"   y {e[0]:7.2f}..{e[1]:7.2f}  tex={e[2]:10s} {flag}")
