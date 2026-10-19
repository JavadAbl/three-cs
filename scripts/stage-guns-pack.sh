#!/usr/bin/env bash
# ============================================================
# stage-guns-pack.sh — full staging pipeline for the Quaternius
# "Ultimate Guns Pack" (CC0) weapon GLBs.
#
#   1. bun scripts/stage-guns-pack.ts
#      bake fixups (real-world scale, muzzle −Z, grip origin) into
#      each pack model's mesh-node matrix → scripts/.tmp/guns-fixed/
#   2. optional visual check: bun scripts/verify-guns-orientation.ts
#      (side-view contact sheet; every gun must point LEFT)
#   3. Draco-compress each fixed file with the safe chain
#      (scripts/compress-glb.sh: prune → dedup → weld → webp → draco)
#      → public/staging/models/weapons/<weaponId>.glb
#      (gitignored staging, web-served for live evaluation;
#       acceptance = mv to public/assets/models/weapons/ + git add,
#       see public/assets/models/README.md)
#
# Usage:
#   bash scripts/stage-guns-pack.sh
#   (call with `bash`, not `bun` — bun's built-in shell can't run this script)
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXED="$ROOT/scripts/.tmp/guns-fixed"
STAGE="$ROOT/public/staging/models/weapons"

bun "$ROOT/scripts/stage-guns-pack.ts"

mkdir -p "$STAGE"
total_before=0
total_after=0
count=0
for f in "$FIXED"/*.glb; do
  id="$(basename "$f" .glb)"
  out="$STAGE/$id.glb"
  bash "$ROOT/scripts/compress-glb.sh" "$f" "$out" >/dev/null 2>&1
  before=$(stat -c%s "$f")
  after=$(stat -c%s "$out")
  total_before=$((total_before + before))
  total_after=$((total_after + after))
  count=$((count + 1))
  printf '%-10s %8d -> %6d bytes\n' "$id" "$before" "$after"
done

echo "----"
echo "$count weapon GLBs staged in $STAGE"
awk "BEGIN {printf \"total %d -> %d bytes (%.1f%% of fixed, avg %.1f KB each)\n\", $total_before, $total_after, $total_after * 100 / $total_before, $total_after / $count / 1024}"
