#!/usr/bin/env python3
"""Task 141: compare regenerated map-office.ts vs git HEAD (tex counts),
and same for mini-services copy (should be unchanged - collision-only def)."""
import json, re, subprocess

def tex_counts(path):
    src = open(path, encoding="utf-8").read()
    m = re.search(r"boxes: (\[.*?\]),\n", src, re.S)
    boxes = json.loads(m.group(1))
    from collections import Counter
    return Counter(b["tex"] for b in boxes)

def head_version(path):
    return subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, cwd="/home/z/my-project").stdout.decode("utf-8", "replace")

for path, label in [("src/game/map-office.ts", "CLIENT"), ("mini-services/game-server/map-office.ts", "SERVER")]:
    cur = tex_counts(f"/home/z/my-project/{path}")
    try:
        old = tex_counts_head = None
        head_src = head_version(path)
        m = re.search(r"boxes: (\[.*?\]),\n", head_src, re.S)
        from collections import Counter
        old = Counter(b["tex"] for b in json.loads(m.group(1)))
    except Exception as e:
        old = None
        print(f"{label}: HEAD parse issue: {e}")
    print(f"\n== {label} {path} ==")
    if old:
        for tex in sorted(set(old) | set(cur)):
            if old.get(tex, 0) != cur.get(tex, 0):
                print(f"  {tex:10s} {old.get(tex,0):5d} -> {cur.get(tex,0):5d}")
        print("  (all other families unchanged)")
    else:
        for tex, n in cur.most_common():
            print(f"  {tex:10s} {n}")
