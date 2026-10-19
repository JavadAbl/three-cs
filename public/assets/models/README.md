# Player model assets — staging & acceptance workflow

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

## How the game loads the model

Through the extensionless route **`/api/assets/human`**
(`src/app/api/assets/human/route.ts`, fetched via POST), never the static
`.glb` path — browser download-manager extensions (IDM etc.) must not
recognize it as a downloadable file:

- **If the file is missing** (fresh clone, nothing staged), the route returns
  404 and the game still works: players fall back to the built-in procedural
  soldier rig (players.ts) — nothing breaks.
- The model is preloaded while the lobby menu is open, so starting a match
  never triggers a fresh download.

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
