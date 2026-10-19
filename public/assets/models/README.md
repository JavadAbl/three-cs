# Player & weapon model assets — staging & acceptance workflow

**Player model status (2026-10-19): NO accepted player model.** The previously
evaluated `human.glb` was **rejected by the user** ("remove human.glb. i dont
want it. i find better one later") — every copy was deleted (mirror included)
and it must NOT be restored from anywhere. The game runs the procedural
soldier rig for all players until a NEW model is dropped into staging; the
user will supply a better one later.

**Weapon model status (2026-10-19): 33 Draco GLBs STAGED for evaluation**
(`public/staging/models/weapons/`, gitignored) — the CC0 Quaternius
"Ultimate Guns Pack", fix-baked to the weapon GLB spec and wired into the
game for **remote guns** + the **knife viewmodel**. See "Weapon GLBs" below.

`public/assets/` holds **accepted, committed** running assets. New or pending
binaries live in **`public/staging/`** (gitignored, still web-served so the
game can run them for live evaluation).

## Lifecycle of a model binary

1. **Pending** — drop the file into `public/staging/models/human.glb`.
   It is gitignored (never committed, invisible to `git status` and to
   auto-commits), but the game runs it immediately.
2. **Accept** — when the user explicitly approves it:
   ```bash
   mv public/staging/models/human.glb public/assets/models/human.glb
   git add public/assets/models/human.glb && git commit
   ```
   Plain `git add` — no `-f` flag, no ignore rules in `public/assets/`.
3. **Revoke** — `git rm --cached public/assets/models/<file>` moves it back
   out of git (keep it on disk, or move it to staging again).

While a staged copy exists it **overrides** the accepted copy (evaluation
always tests the newest drop). The route caches the parsed buffer in module
memory — touch `src/app/api/assets/human/route.ts` (or restart dev) after
replacing a file to re-read it.

## How the game loads the player model

Through the extensionless route **`/api/assets/human`**
(`src/app/api/assets/human/route.ts`, fetched via POST), never the static
`.glb` path — browser download-manager extensions (IDM etc.) must not
recognize it as a downloadable file:

- **If the file is missing** (fresh clone, nothing staged), the route returns
  404 and the game still works: players fall back to the built-in procedural
  soldier rig (players.ts) — nothing breaks.
- The model is preloaded while the lobby menu is open, so starting a match
  never triggers a fresh download.

## Weapon GLBs (staged 2026-10-19)

`public/staging/models/weapons/<weaponId>.glb` — 33 of the 43 roster weapons,
sourced from the **Quaternius "Ultimate Guns Pack" (poly.pizza GLB bundle,
License: CC0 public domain**, commercial use OK, no attribution required —
committable under our art-authorization rule). Originals were FBX2glTF
conversions with arbitrary scale, +X barrels and no part nodes; the staging
pipeline **bakes a fixup into each file's mesh-node transform** so they meet
the Task 46 weapon GLB spec:

- **real-world scale** — longest dimension normalized to each weapon's true
  length (pistol 0.22 m … sniper 1.23 m)
- **muzzle −Z, grip at origin** — engine gun-stub contract, drops straight
  into the same hand anchors the procedural stubs use
- per-class grip anchors (fz/fy fractions of the rotated bbox) in
  `scripts/stage-guns-pack.ts` — tweak + re-run to re-tune
- then Draco-compressed via the safe chain (avg **9.5 KB per gun, 320 KB
  total**)

**Pipeline** (re-runnable end to end):

```bash
bash scripts/stage-guns-pack.sh        # fixup-bake + draco-compress all 33
bun scripts/verify-guns-orientation.ts # side-view contact sheet (muzzle LEFT check)
```

The raw pack zip must NOT enter git — extract it to `staging/` (gitignored)
at the repo root; only the spec-compliant staged outputs are web-served.

**Serving**: extensionless POST route **`/api/assets/weapon/[id]`** (same
download-manager evasion as the human model; staging wins over accepted;
404 → procedural fallback, so a fresh clone runs fully procedural).

**What uses them** (`src/game/weapongltf.ts`, preloaded in the lobby):

- **remote guns** — what other players hold (players.ts builds GLB-first,
  procedural stub stays the fallback per id)
- **the knife viewmodel** — bayonet, no moving parts (engine.rebuildViewmodel
  picks the GLB knife; procedural blade is the fallback)

**What deliberately does NOT**: all other first-person viewmodels. The pack
has **no named mag/slide/bolt/pump part nodes**, and the procedural vms carry
the engine's parts animations (reload mag-drop / slide blowback / AWP bolt
cycle / shotgun pump) that GLB swaps would silently lose. They also stay for
accuracy: the pack is generic archetypes, not CS-accurate silhouettes.

**Not covered by the pack** (stay procedural): m249, negev, taser, c4, all
grenades, and the dual-elites second gun is a mirrored clone of the same
pistol GLB.

**Accept** (per weapon, after the user approves the look):

```bash
mv public/staging/models/weapons/ak47.glb public/assets/models/weapons/ak47.glb
git add public/assets/models/weapons/ak47.glb && git commit
```

(the route already prefers the accepted copy once staged is gone).

## Why binaries are staged at all

Large binaries bloat git history permanently (every version ever committed
stays in the pack forever). Staging keeps evaluation cheap: swap files as
often as you like, only accepted copies enter history.

## Compressing GLBs for the web (Draco)

The game's GLB loader (`src/game/gltf.ts`, shared by the human model and the
future weapon models) decodes **KHR_draco_mesh_compression** with a
**self-hosted** decoder copied from three.js into `public/draco/gltf/`
(192KB wasm + 58KB wrapper, fetched once per page session, only when a
Draco GLB is actually parsed — no CDN, game stays self-contained).
Uncompressed GLBs load unchanged; the procedural fallbacks don't touch it.

Before dropping a GLB into `public/staging/models/`, compress it:

```bash
bash scripts/compress-glb.sh <input.glb> [output.glb]
```

Pipeline (all node-graph-safe): `prune → dedup → weld → webp → draco`.

- **Draco compresses geometry only** (~20x on meshes). Textures need
  `webp` (included in the script, ~4-8x on typical PBR maps).
- **Named part nodes survive** — Draco compresses mesh data, not the node
  graph, so the engine's parts animations (mag drop / slide blowback /
  bolt cycle / pump rack) keep working. `webp` only re-encodes images.
- Benchmark (scripts/make-draco-demo-glb.ts, reproducible): a 12.8k-tri
  budget-sized rifle with named parts — **321KB raw → 14.4KB (4.5%)**.
- ⚠ **Never run `gltf-transform optimize --compress draco` on game models**
  (i.e. don't replace the script with it): its `join` step merges named part
  nodes into one mesh (measured: `body/handguard/mag/bolt/... → body`),
  silently killing the parts animations. The safe steps are the ones the
  script uses.
- Decode cost is one-time per file at lobby preload — a ~15k-tri viewmodel
  decodes in a few ms, never mid-round.
