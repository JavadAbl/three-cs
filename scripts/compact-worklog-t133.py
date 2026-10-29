#!/usr/bin/env python3
"""Task 133: compact worklog.md — fold Task 123..132 narratives into ledger lines."""
from pathlib import Path

p = Path('/home/z/my-project/worklog.md')
lines = p.read_text().split('\n')

# locate ledger rows: from the row after the table header separator to the last
# numbered row (tasks 1..121 live at lines index 80..197 in 1-based terms)
start = end = None
for i, l in enumerate(lines):
    if l.startswith('1 | Build a full-stack CS2 clone'):
        start = i
    if l.startswith('121 | user supplied a fresh PAT'):
        end = i
assert start is not None and end is not None, (start, end)
ledger = lines[start:end + 1]
# drop the stray duplicate trailing blank if any
while ledger and ledger[-1] == '':
    ledger.pop()

new_rows = [
    '123 | user: "when characters moves seems they run like Taking toddling steps" — ground-matched gait: speed-scaled stride (0.85 rad cap, blend-band safe), speed-scaled cadence law, knee drive + run bob; VLM + numeric verified',
    '124 | user: "can make procedural models and textures better?" — procedural-weapons quality pass: 3 PBR material families + 43 regenerated buy icons staged in public/staging',
    '125 | user: "accept" — accept the Task-124 procedural-weapons quality pass into /assets per policy (ASSET_CACHE_VERSION bump sweep)',
    '126 | user supplied a fresh PAT — push the two unpushed local commits (b031dbc Task-124 pass, 501b8b6 Task-125 acceptance)',
    '127 | user uploaded cs_office.bsp ("add office map... no hostages... ambientcg textures, high quality procedural") — import CS 1.6 cs_office as 5th map: BSP->geom conversion, ambientCG PBR bake (7 winner assets, VLM A/B), live on :81 pending acceptance',
    '128 | push the Task-127 office commit with the session PAT (remote synced)',
    '129 | "status" exposed the 3rd container rollback — full recovery: reset to origin/main, regenerate the office staging payload (geom.json 2.4MB + 21 jpgs), re-index all 8 HF tars, commit map-tar.py (pipeline gap), office 11/11 regression + live re-verified',
    '130 | user ACCEPTED cs_office as v1 ("later we should improve it well") — staging->assets promotion, ASSET_CACHE_VERSION v10->v11, regressions green, pushed',
    '131 | user "go" on the island plan ("add a map on an Island in day...") — 6th map "island" (tropical day, bomb defusal): 6-phase plan, HF catalog grep + winner picks (Sand007/Bark012/Leaves003/Grass001/Rock + DaySkyHDRI017B), generator + engine wiring, LIVE on :81 pending textures/acceptance',
    '132 | island ship + 3 hotfixes + ACCEPTANCE: hotfixes = bot sinking (nav mesh), player fall-through (collider count fix), invisible walls (fine-0.5 staircase + per-box STAIR_CLIMB 0.95, losBoxes bit-for-bit); user "island accepted (forgot about token concerns)" — v12 cutover: staging->assets, ASSET_CACHE_VERSION v11->v12, island-regen.sh wipe-resilience proof (5th-wipe regen chain, geom sha cbea66a6 byte-identical), collider-probe/graph/office 11/11 gates ALL green, VLM live accept, pushed; PAT rotation waived by user',
    '133 | user: "compact worklog and scripts and unused files" — worklog 501->~170 lines (123-132 folded to ledger), scripts 22M->1.1M (deleted t123/t124/t125/t126 one-off pngs+VLM dumps, island/shots/), purged tool-results/ + scripts/.tmp/; cross-checked every candidate with rg before deletion',
]

header = '''# three-cs — project worklog (compacted)

> **Compacted in Task 133** (user: "compact worklog and scripts and unused
> files"; previously compacted in Task 122). This file keeps only: the live
> state snapshot, the standing rules/protocols, and a one-line ledger of
> every task. Full narratives are recoverable from git:
> Task-122-era history `git show 67e81f6:worklog.md`;
> Task 123–132 narratives `git show 2fca833:worklog.md`.

## Current state snapshot (as of Task 133)

- **Game**: CS-style web FPS. 6 maps (dust, dust2, aim_headshot + cs_office CS 1.6
  BSP imports, aimdepot night, island tropical day). cs_office accepted as v1 in
  Task 130 (user: many issues to improve later — see Task-127 known-limitations
  list). island accepted as v1 in Task 132 (user: "island accepted" — PBR+HDRI
  look; polish backlog queued: floating dock piece near B, palm frond polys,
  grass macro variation, ocean shader pass Task 134). Full 42-entry weapon roster (CS 1.6 category buy menu,
  team-filtered), 6 grenades, C4 defusal, 5v5 bot fill (easy/normal/hard),
  economy + kill rewards, CS-style recoil, quick-switch/reload-cancel, directional
  damage indicators, outline crosshair.
- **Player models**: CT = `human.glb` (soldier, accepted Task 117, sha `cdd14b1d…`),
  T = `rebel.glb` (accepted Task 116, sha `8f06fbf5…`); weapons held in hands
  (gripGap 0.022 m), human-scale. User models for 6 weapons (ak47/ak74/aug/
  famas/galil/m4) + night sky GLBs accepted. All committed in `public/assets/`.
- **Sounds**: 256-file authentic CS:GO pack (`public/assets/sounds/`, 44.1 kHz
  Vorbis q3) incl. the 4 announcer lines now using the REAL CS radio announcer
  from sourcesounds/csgo (Task 120). User's own fire recordings kept for
  ak74_fire + m4_fire. Raw sourcesounds clone (10,223 CS:GO sounds, gitignored)
  at `assets/packs/sourcesounds-csgo/` for future grabs.
- **Island regen chain (wipe-resilient, Task 132 proof)**: `scripts/bsp/island-regen.sh`
  = `bun scripts/island/gen.ts` (deterministic, geom sha256 cbea66a6) ->
  `hf-tar-index.py` 0..7 -> `extract-island-hf.py` -> `extract-island-sky.py` ->
  `bake-island-textures.py`. Proven end-to-end after the 5th container wipe
  (39 min, byte-identical geom). Committed assets = the durable line.
- **PAT status**: rotation concerns WAIVED by the user ("forgot about token
  concerns") — reminders dropped permanently.
- **Servers**: web `bun run dev` :3000, game server `mini-services/game-server`
  (bun --hot) :3003, platform proxy :81 (**live multiplayer/verification must
  enter via http://localhost:81/ — the socket uses the XTransformPort=3003
  convention; :3000 direct never connects the game socket**).
- **Regression suites** (`bun scripts/test-*.ts`, all green): audio-map 336,
  buymenu 235, rebel-t115 37, gunhold-t114 24, bots 26, cache-t111 28, phases
  3–9 + bots/e2e suites, dust/dust2/aimdepot/aimhead, money, game-server,
  serverlist, feel-t109, reload, tint, user-glb/rig, office 11/11 (Task 130),
  island live harness (Task 132). `npx tsc --noEmit`:
  src+shared clean (31 pre-existing lines in examples//scripts/bsp are
  unchanged noise).

## Standing rules & protocols

1. **Asset-acceptance policy v3** (user rule, Tasks 22–26): `public/assets/`
   holds ONLY accepted, committed running assets. New binaries land in
   `public/staging/` (gitignored but web-served; loaders try /assets/ first,
   /staging/ fallback). Acceptance = explicit user approval, then
   `mv public/staging/<x> public/assets/<x> && git add`. Never drop new
   binaries directly into /assets/. Re-shipping an accepted body needs an
   `ASSET_CACHE_VERSION` bump (BUMP RULE, Task 104) so browsers refetch.
2. **Push protocol**: PATs are used inline in the push URL ONLY — never stored
   in git config, env files or logs; echoed output scrubbed. Every PAT is
   chat-exposed → user revokes after use; next push gets a fresh token.
   Repo: github.com/JavadAbl/three-cs (main). The remote is the only durable
   line — commit before the container can roll back.
   (Task 132: user waived PAT-rotation concerns — no further reminders.)
3. **Session health probe** (Task 119 lesson, run on every session start):
   `git log --oneline -1` (HEAD at latest pushed task?) ·
   `ls public/assets/models/` (player models present?) ·
   `grep ASSET_CACHE_VERSION src/game/preloader.ts` (version current? —
   now **v12**). A rolled-back container is silent — it "works" while serving
   month-old state. Container restarts may flip +x bits on tracked files
   (mode-only noise; verify with `git diff --summary`, reset with chmod,
   never content-restore).
4. **Live verification**: enter via :81 (see above). Debug surface `__eng.*`
   (state/teleport/players/glbTeams/sfx/skinBBox/vmProbe…) in src/game/engine.ts.
   Audio debug: `__eng.sfx()` → { loaded, errors, announceLog }.
5. **Announcer sounds**: the 4 `announce_*.ogg` are the genuine CS radio
   announcer (Task 120). Do NOT run `make-announcer-sounds-t98.sh` unless
   deliberately rolling back to TTS. TTS originals recoverable from commit 7ef919b.
6. **User-kept recordings**: ak74_fire.ogg + m4_fire.ogg are the user's own —
   never overwrite with pack samples.
7. **Scripts hygiene** (Tasks 122 + 133): scripts/ = tools, pipelines, and
   regression suites ONLY. One-off diagnostics (screenshots, VLM dumps,
   probe JSONs, per-task browser scripts, shot dirs) are deleted on sight —
   recoverable from git (`git show 2fca833` era) if ever needed. Before
   deleting anything, cross-check with rg against src/, shared/,
   mini-services/, package.json and kept scripts.

## Task ledger (one line each; full detail in git history)

ID | Task
--- | ---'''

out = header.split('\n') + ledger + new_rows + ['']
out = '\n'.join(out)
p.write_text(out)
print(f'compacted: {len(lines)} -> {len(out.split(chr(10)))} lines, {len(out)} bytes')
