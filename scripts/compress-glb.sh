#!/usr/bin/env bash
# ============================================================
# compress-glb.sh — shrink a GLB for the web, preserving the
# engine's named-part node graph (mag/slide/bolt/pump/...).
#
# Usage:
#   bash scripts/compress-glb.sh <input.glb> [output.glb]
#   (call with `bash`, not `bun` — bun's built-in shell can't run this script)
#   output defaults to <input>.draco.glb next to the input.
#
# Pipeline (each step is node-graph-safe; verified on a 12.8k-tri
# benchmark: 321KB → 14.4KB, all named nodes intact):
#   prune   — drop unused accessors/materials/animation channels
#   dedup   — merge identical accessors + materials
#   weld    — merge duplicated vertices (re-indexes meshes; helps Draco)
#   webp    — re-encode textures to WebP (~4-8x on albedo/normal maps);
#             no-op on textureless GLBs. Draco does NOT touch textures.
#   draco   — KHR_draco_mesh_compression on geometry (~20x)
#
# ⚠ NEVER use `gltf-transform optimize --compress draco` on game
#   models: its `join` step collapses named part nodes into one
#   merged mesh (measured: body/handguard/mag/bolt/... → single
#   'body'), which silently kills the engine's parts animations.
# ============================================================
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bun scripts/compress-glb.sh <input.glb> [output.glb]" >&2
  exit 1
fi

IN="$1"
OUT="${2:-${IN%.glb}.draco.glb}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/node_modules/.bin/gltf-transform"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ ! -x "$CLI" ]]; then
  echo "error: gltf-transform not installed — run: bun add -d @gltf-transform/cli" >&2
  exit 1
fi
if [[ ! -f "$IN" ]]; then
  echo "error: no such file: $IN" >&2
  exit 1
fi

"$CLI" prune   "$IN"        "$TMP/1.glb"
"$CLI" dedup   "$TMP/1.glb" "$TMP/2.glb"
"$CLI" weld    "$TMP/2.glb" "$TMP/3.glb"
"$CLI" webp    "$TMP/3.glb" "$TMP/4.glb"
"$CLI" draco   "$TMP/4.glb" "$OUT"

BEFORE=$(stat -c%s "$IN")
AFTER=$(stat -c%s "$OUT")
PCT=$(awk "BEGIN{printf \"%.1f\", $AFTER * 100 / $BEFORE}")
echo "compressed: $IN ($BEFORE bytes) -> $OUT ($AFTER bytes, ${PCT}% of original)"
