#!/usr/bin/env python3
"""Down-raycast the aimhead BSP at exact points: what rendered face is directly
under the site centers (and under the player spawn)? Also list every triangle
overlapping each site's decal footprint with exact y values."""
import json

data = json.load(open('/home/z/my-project/public/assets/maps/aimhead/geom.json'))

def tri_y_at(tri, x, z):
    """Given 3 pts, return interpolated y at (x,z) if (x,z) inside the 2D triangle."""
    (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
    d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz) + (bx - cx) * (az - cz)
    # barycentric
    l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz))
    l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz))
    d = ((by - cy) * (ax - cx) - (bx - cx) * (ay - cy)) * 0  # placeholder
    # robust: solve via cross products in 2D
    v0 = (cx - ax, cz - az)
    v1 = (bx - ax, bz - az)
    v2 = (x - ax, z - az)
    dot00 = v0[0]*v0[0] + v0[1]*v0[1]
    dot01 = v0[0]*v1[0] + v0[1]*v1[1]
    dot02 = v0[0]*v2[0] + v0[1]*v2[1]
    dot11 = v1[0]*v1[0] + v1[1]*v1[1]
    dot12 = v1[0]*v2[0] + v1[1]*v2[1]
    denom = dot00 * dot11 - dot01 * dot01
    if abs(denom) < 1e-12:
        return None
    u = (dot11 * dot02 - dot01 * dot12) / denom
    v = (dot00 * dot12 - dot01 * dot02) / denom
    if u < -1e-9 or v < -1e-9 or u + v > 1 + 1e-9:
        return None
    return ay + u * (by - ay) + v * (cy - ay)

def probe(x, z, label):
    hits = []
    for g in data['groups']:
        pos, idx = g['pos'], g['idx']
        for t in range(0, len(idx), 3):
            a, b, c = idx[t], idx[t+1], idx[t+2]
            tri = (pos[a*3:a*3+3], pos[b*3:b*3+3], pos[c*3:c*3+3])
            y = tri_y_at(tri, x, z)
            if y is not None:
                hits.append((y, g.get('tex')))
    hits.sort(reverse=True)
    print(f"{label} @ (x={x}, z={z}): {len(hits)} faces stacked, top-down:")
    for y, tex in hits[:8]:
        print(f"   y={y:7.2f}  tex={tex}")

probe(-25.28, -10.36, 'SITE A center')
probe(25.6, -1.84, 'SITE B center')
probe(-25.6, -12.8, 'CT spawn')
probe(26, 3.2, 'T spawn')
probe(0, -5, 'arena mid')
