#!/usr/bin/env python3
"""Task 141: find the exact 1-line change in regenerated map-office.ts."""
import subprocess, difflib

head = subprocess.run(["git", "show", "HEAD:src/game/map-office.ts"],
                      capture_output=True, cwd="/home/z/my-project").stdout.decode("utf-8", "replace")
cur = open("/home/z/my-project/src/game/map-office.ts", encoding="utf-8").read()
hl, cl = head.splitlines(), cur.splitlines()
print(f"head lines: {len(hl)}, cur lines: {len(cl)}")
for line in difflib.unified_diff(hl, cl, lineterm="", n=0):
    if line.startswith(("---", "+++", "@@")):
        print(line)
        continue
    if len(line) > 200:
        # long line: show a window around the first difference
        op = line[0]
        body = line[1:]
        if op in "+-":
            # find diff position vs the counterpart
            other = None
            print(f"{op}[LONG LINE {len(body)} chars] first 160: {body[:160]}")
    else:
        print(line)
