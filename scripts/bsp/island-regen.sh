#!/usr/bin/env bash
# Task 132 acceptance — full island asset regen after the 5th container wipe
# (public/staging/ + scripts/.tmp/ are gitignored caches; the committed provenance
# chain regenerates them byte-identically).
#
#   gen.ts (geom + data JSONs + wrapper .ts, geomUrl now /assets)  [local, ~10s]
#   -> hf-tar-index.py 0..7      (~6GB streamed, resumable index-0N.json)
#   -> extract-island-hf.py full  (8 PBR winners, exact-offset range GETs)
#   -> extract-island-sky.py       (DaySkyHDRI017B equirect only)
#   -> bake-island-textures.py    (staging jpgs + sources.json + island-picks.json)
#
# Run as a double-fork orphan (tool-call children are reaped; setsid survives).
set -u
cd /home/z/my-project
mkdir -p scripts/.tmp/ambientcg-raw
say() { echo "[$(date -Is)] $*" | tee -a scripts/.tmp/island-regen.status; }

say "1/5 gen.ts regen (geom + data JSONs + wrappers)"
bun scripts/island/gen.ts || { say "GEN FAILED"; exit 1; }
say "  gen.ts sha256:"; sha256sum public/staging/maps/island/geom.json

say "2/5 index tars 00-07 (~6GB, resumable)"
for n in 0 1 2 3 4 5 6 7; do
  say "  index tar $n starting"
  python3 scripts/bsp/hf-tar-index.py "$n" || { say "INDEX $n FAILED"; exit 1; }
  say "  index tar $n done"
done

say "3/5 extract 8 PBR winners"
python3 scripts/bsp/extract-island-hf.py full \
  Gravel038,Grass007,Rock049,Bark012,ThatchedRoof002B,Planks006,Metal031,Concrete034 \
  || { say "EXTRACT FAILED"; exit 1; }

say "4/5 extract picked HDRI"
python3 scripts/bsp/extract-island-sky.py || { say "SKY EXTRACT FAILED"; exit 1; }

say "5/5 bake staging jpgs"
python3 scripts/bake-island-textures.py || { say "BAKE FAILED"; exit 1; }

say "REGEN DONE"
say "staged sizes:"; du -sb public/staging/textures/maps/island public/staging/maps/island 2>/dev/null
