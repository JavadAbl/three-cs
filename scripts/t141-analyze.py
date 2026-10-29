#!/usr/bin/env python3
"""Task 141: office map — CT entrance walls look like scaffolding.
Analyze geom.json groups (tex usage + spatial position near CT spawn)
and cross-check texture files that mapview resolves."""
import json, re, os
from collections import Counter, defaultdict

ROOT = "/home/z/my-project"
GEOM = f"{ROOT}/public/assets/maps/office/geom.json"
MAPTS = f"{ROOT}/src/game/map-office.ts"

# --- 1. CT spawn coords from map-office.ts ---
src = open(MAPTS, encoding="utf-8").read()
m = re.search(r"spawns:\s*\{(.*?)\n  \}", src, re.S)
print("== spawns block ==")
print(m.group(0)[:800] if m else "NOT FOUND")

# --- 2. geom.json group texture usage ---
geom = json.load(open(GEOM, encoding="utf-8"))
groups = geom["groups"]
print(f"\n== geom.json: {len(groups)} groups ==")
tex_counter = Counter(g.get("tex", "?") for g in groups)
for tex, n in tex_counter.most_common():
    print(f"  {tex:24s} {n}")
print("top-level keys:", list(geom.keys()))
