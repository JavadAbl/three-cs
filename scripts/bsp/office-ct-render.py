#!/usr/bin/env python3
"""Task 139 — offline 3D verification render of the office CT parking structure.
Renders geom.json faces near CT spawn from a first-person-ish perspective,
colored per texture family. Expect: solid concrete parapet walls (gray),
asphalt floor (dark), concrete roof — NO red (fence/lattice) faces in view.
"""
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

GEOM = '/home/z/my-project/public/assets/maps/office/geom.json'
OUT = '/home/z/my-project/scripts/.tmp/t139-ct-structure.png'

COL = {
    'concrete': '#9c978c', 'dark': '#3f3f46', 'offwall': '#d8d3c4', 'brick': '#a0522d',
    'tile': '#cfd4d8', 'plank': '#8b6f47', 'snow': '#eef4f8', 'ceiling': '#e8e8e0',
    'carpet': '#7a4b52', 'metal': '#7d8a99', 'crate': '#b98d5a', 'glass': '#9fd4e8',
    'fence': '#ff2222',   # red = the scaffold bug — should be ABSENT here
}

g = json.load(open(GEOM))

# camera at a CT spawn looking at the entrance wall z=43 / parapet x=-33.6
CAM = np.array([-26.6, 7.0, 40.0])
LOOK = np.array([-30.0, 8.0, 50.5])

fig = plt.figure(figsize=(14, 9), constrained_layout=True)
ax = fig.add_subplot(111, projection='3d')

n_fenced = 0
n_faces = {'total': 0}
for grp in g['groups']:
    tex = grp['tex']
    pos, idx = grp['pos'], grp['idx']
    verts = [tuple(pos[i:i + 3]) for i in range(0, len(pos), 3)]
    tris = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
    polys = []
    for t in tris:
        a, b, c = (verts[i] for i in t)
        # near-CT filter: bounding box around CT structure
        if not (-45 <= a[0] <= -5 and -45 <= b[0] <= -5 and -45 <= c[0] <= -5):
            continue
        if not (24 <= a[2] <= 58 and 24 <= b[2] <= 58 and 24 <= c[2] <= 58):
            continue
        if not (4 <= a[1] <= 14 and 4 <= b[1] <= 14 and 4 <= c[1] <= 14):
            continue
        polys.append([list(a), list(b), list(c)])
        n_faces['total'] += 1
        if tex == 'fence':
            n_fenced += 1
    if polys:
        pc = Poly3DCollection(polys, facecolors=COL.get(tex, '#ff00ff'), edgecolors='none', alpha=0.95)
        ax.add_collection3d(pc)

print(f"faces rendered: {n_faces['total']}, fence faces in CT view: {n_fenced}")

ax.set_xlim(-45, -5)
ax.set_ylim(4, 14)
ax.set_zlim(24, 58)
ax.set_box_aspect((40, 10, 34))
ax.set_xlabel('x')
ax.set_ylabel('y (up)')
ax.set_zlabel('z')
ax.view_init(elev=28, azim=218)
ax.set_title(f"Office CT parking structure — Task 139 render-only check\n"
             f"faces={n_faces['total']}  fence(lattice) faces={n_fenced} (expect 0)  |  red would be scaffold-bug texture")
fig.savefig(OUT, dpi=110)
print('saved', OUT)
