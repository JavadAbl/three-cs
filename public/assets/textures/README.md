# Map surface textures — staging & acceptance workflow

**Status (2026-10-21): ACCEPTED — 10 photo-PBR map surfaces (PolyHaven, CC0).**
Accepted by the user ("accept textures") on 2026-10-21 after the Task-74 wall
A/B verdict; moved from `public/staging/textures/maps/` to
`public/assets/textures/maps/` per the asset-acceptance policy (AGENTS.md)
and committed. The loader in `src/game/textures.ts` hot-swaps these onto the
procedural canvas materials at runtime — `/assets/...` first, `/staging/...`
fallback while a replacement is under evaluation, procedural look guaranteed
if both 404 (fresh clone / offline).

## License ledger

All ten textures are **CC0 1.0 (public domain)** from polyhaven.com — no
attribution required, no restrictions, safe for any distribution (unlike the
CC-BY-NC weapon models, which need the waiver documented in
`public/assets/models/README.md`). Byte-level provenance lives in
`public/assets/textures/maps/sources.json` (polyhaven id, license, source URL,
exact byte counts served — the audio-map HTTP suite asserts every file).

| surface | polyhaven id | notes |
|---|---|---|
| sand | aerial_sand | ground, 1K, tile 15 m |
| wall | worn_cracked_plaster | **2K** (dominant surface), tile 3.0 m, aniso 8 — Task-74 A/B winner |
| brick | large_sandstone_blocks | 1K |
| concrete | concrete | 1K |
| crate | plywood | 1K |
| plank | wood_planks_dirt | 1K |
| metal | worn_corrugated_iron | 1K |
| dark | asphalt_03 | 1K |
| door | painted_metal_shutter | 1K |
| doorBlue | blue_painted_planks | 1K |

Each surface ships as `<surface>.jpg` (albedo, sRGB) + `<surface>_bump.jpg`
(grayscale height → `bumpMap`). The wall gets the 2K source because it is the
map's dominant surface (~126 references); everything else stays 1K — total
committed weight 3.2 MB.

## Pipeline

- `scripts/fetch-map-textures.py` — downloads PolyHaven raws
  (dl.polyhaven.org), re-encodes via PIL per-surface spec
  (`{id, src 1k|2k, albedo px, bump px, quality}`), writes this directory +
  `sources.json`. Re-run safe (skips existing raws). ambientcg.com was the
  original request but unreachable from the container; PolyHaven is the same
  CC0 licensing.
- Replacements under evaluation land in `public/staging/textures/maps/`
  (gitignored, still web-served) — the loader picks them up on reload with
  zero code changes. The in-game A/B recipe is `scripts/ab-wall.sh`
  (position-verified screenshots at the dust2 T-back-strip vantage).
- Revocation, if ever needed: `git rm -r --cached public/assets/textures/maps`
  and move the files back to staging.
