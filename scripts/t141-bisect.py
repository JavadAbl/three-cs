#!/usr/bin/env python3
import json

ROOT = "/home/z/my-project"
geom = json.load(open(f"{ROOT}/public/assets/maps/office/geom.json", encoding="utf-8"))
print("loaded", len(geom["groups"]), flush=True)
g = geom["groups"][0]
pos = g["pos"]
print("first group tex:", g["tex"], "pos len:", len(pos), flush=True)
xs = pos[0::3]
print("xs len:", len(xs), "min:", min(xs), "max:", max(xs), flush=True)
print("DONE", flush=True)
