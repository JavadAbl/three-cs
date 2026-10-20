# Player & weapon model assets — staging & acceptance workflow

**Player model status (2026-10-19): NO accepted player model.** The previously
evaluated `human.glb` was **rejected by the user** ("remove human.glb. i dont
want it. i find better one later") — every copy was deleted (mirror included)
and it must NOT be restored from anywhere. The game runs the procedural
soldier rig for all players until a NEW model is dropped into staging; the
user will supply a better one later.

**Weapon model status (2026-10-20): THREE accepted weapon models — ak47,
ak74, galil.**
The CC0 Quaternius "Ultimate Guns Pack" (33 GLBs staged 2026-10-19 for
live evaluation) was **rejected by the user** ("wipe all weapon models.
they are not good, il find new models") — every staged GLB and raw-pack
copy was deleted (mirror included) and it must NOT be restored from
anywhere. The user's Sketchfab AK-47 (Lokeig, CC-BY-NC) was evaluated,
tuned in-game and **accepted on 2026-10-20 for dev-only use** — committed
at `public/assets/models/weapons/ak47.glb` (see the license ledger
below). The user's own AK-74M upload (`upload/ak-74m.glb`) was integrated
2026-10-20 (Task 66: model + the user's own fire sound) and **accepted
the same day** ("accept ak74") — committed at
`public/assets/models/weapons/ak74.glb`. The user's Galil AR upload
(`upload/galil_ar_counter_strike_2.glb`, a Counter-Strike 2 game rip) was
integrated 2026-10-20 (Task 70, orientation fixed via cross-section muzzle
detect + rotY 180°) and **accepted 2026-10-21** ("Galil accepted.") —
committed at `public/assets/models/weapons/galil.glb`. Every other weapon
id runs **procedural** (parts-animated viewmodels + remote stubs); the
drop-in pipeline below stays live and waiting for more models.

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

## Weapon GLBs (pipeline LIVE — three accepted models: ak47, ak74, galil)

Drop a GLB at **`public/staging/models/weapons/<weaponId>.glb`** (gitignored,
evaluative) or `public/assets/models/weapons/<weaponId>.glb` (accepted,
committed) and the game uses it immediately for **remote guns + the
first-person viewmodel + the knife** — zero code changes. With no file an
id simply stays procedural (current state: all of them except ak47,
ak74 and galil).

**Wired ids** (33, see `ROUTES` in `src/game/weapongltf.ts`): knife,
glock, usp, p250, cz75, fiveseven, tec9, hkp2000, deagle, elites (dual),
revolver, mp5, mp9, mac10, mp7, ump45, p90, bizon, nova, xm1014, mag7,
sawedoff, ak47, m4, m4a1s, galil, sg553, famas, aug, awp, ssg08, scar20,
g3sg1. Everything else (m249, negev, taser, c4, all grenades) is
procedural-only and not wired.

**The weapon GLB contract** — files must be baked before staging, or they
will sit wrong in the hand / point the wrong way / be the wrong size:

- **grip anchor at the origin** — the group attaches to the hand anchor at
  (0,0,0); a raw model centered on its own bbox floats mid-air
- **muzzle pointing −Z** — the engine gun-stub contract; raw exports often
  point +X or +Y
- **real-meter scale** — pistol ~0.22 m … sniper ~1.23 m along the barrel
- **upright** — top of the weapon toward +Y, sights up
- optional: named part nodes keep the engine's parts animations alive;
  files without them silently skip those (whole-vm
  bob/sway/recoil/reload dip/draw always run). Name contracts
  (Tasks 62/64/66): `/magaz/i` nodes (minus reference hardware —
  `/relese|release|catch|latch/i` stays fixed on the receiver) → vm.mag
  (reload swap); `/bolt|charging|carrier/i` → vm.slide (real bolt
  reciprocation — AK-74M `Bolt_low_9` incl. charging handle), with
  `/dust[_.]?cover/i` as fallback (cover-as-carrier proxy — AK-47's
  `u_dustcover*` cluster, 34mm blowback per shot); pump has no contract
  yet

The one-off fixup baker that did this for the (now rejected) Quaternius
pack lives in git history (commit `544f32e`, `scripts/stage-guns-pack.ts`)
as the reference pattern for the next pack.

Compress before staging (see the Draco section below):

```bash
bash scripts/compress-glb.sh <input.glb> public/staging/models/weapons/<weaponId>.glb
```

**Serving**: extensionless POST route **`/api/assets/weapon/[id]`** (same
download-manager evasion as the human model; staging wins over accepted;
404 → procedural fallback, so a fresh clone runs fully procedural). The
route caches the file buffer in module memory — touch the route file (or
restart dev) after replacing a file to re-read it.

**Accept** (per weapon, after the user approves the look):

```bash
mv public/staging/models/weapons/ak47.glb public/assets/models/weapons/ak47.glb
git add public/assets/models/weapons/ak47.glb && git commit
```

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

## Staged-model license ledger (2026-10-20)

| weapon | file | author | license | source |
|--------|--------------------------|--------|---------|--------|
| ak47 | `public/assets/models/weapons/ak47.glb` (committed; baked from `upload/ak-47.glb` via `scripts/bake-ak47.ts` + `compress-glb.sh`) | Lokeig | **CC Attribution-NonCommercial** (attribution required, commercial use forbidden) | https://sketchfab.com/3d-models/ak-47-384565b1779c450b90397232163e4e6d |
| ak74 | `public/assets/models/weapons/ak74.glb` (committed; baked from the user's `upload/ak-74m.glb` via `scripts/bake-ak74.ts` + `compress-glb.sh`) | the user's own upload | **not verified** (no source URL supplied; dev-only waiver applies) | uploaded directly to `upload/ak-74m.glb` |
| galil | `public/assets/models/weapons/galil.glb` (committed; baked from the user's `upload/galil_ar_counter_strike_2.glb` via `scripts/bake-galil.ts` + `compress-glb.sh`) | the user's own upload (Counter-Strike 2 game rip, internal name `GalilAr_CS2_weapon_rif_galilar`) | **not verified** (game-rip asset, no license; dev-only waiver applies) | uploaded directly to `upload/galil_ar_counter_strike_2.glb` |

**Acceptance verdict for ak47: ACCEPTED — DEV-ONLY (2026-10-20).** The
user explicitly waived the license concern: "forgot about licence at
all. i dont want publish this game. i want it for dev porpuses only."
The model is committed at `public/assets/models/weapons/ak47.glb`
(516,568 bytes, sha1 `605665b4…`) and is now durable against staging
wipes. One standing condition, recorded so it is not forgotten: **if
this project is ever published, distributed, or sold, the NC term
applies again** — replace this model (and purge it from history) or
re-clear it with the author before any public release. The attribution
row above stays for reference.

Re-tuning / recovery path (tracked script, reproduces the committed
file exactly — scale 0.4591, bbox z −0.602..+0.278, 17,392 tris,
516,568 bytes after Draco): `npx tsx scripts/bake-ak47.ts && bash
scripts/compress-glb.sh scripts/.tmp/ak47-fixed.glb <target>.glb`
(stage for evaluation, or overwrite the accepted copy), then touch
`src/app/api/assets/weapon/[id]/route.ts` to drop the route's buffer
cache.

**Acceptance verdict for ak74: ACCEPTED — DEV-ONLY (2026-10-20).** The
user supplied the file directly ("add ak74 for terror. i upload both glb
and mp3 sound", later: "accept ak74") and approved it after live
evaluation; no external source URL or license was given, so the row above
records **not verified**. The same dev-only waiver as ak47 applies
(no publish / no distribution); if this project is ever released, this
model needs re-clearing or replacing exactly like ak47. The committed
file: 422,676 bytes, sha1 `19c43448…`, baked parameters in
`scripts/bake-ak74.ts` (no rotation — native −Z muzzle, scale 0.1007,
grip anchor = `Grip_low_4` subtree). Re-tuning / recovery path:
`npx tsx scripts/bake-ak74.ts && bash scripts/compress-glb.sh
scripts/.tmp/ak74-fixed.glb <target>.glb`, then touch the weapon route
to drop its buffer cache.

**Acceptance verdict for galil: ACCEPTED — DEV-ONLY (2026-10-21).** The
user supplied the file directly ("i upload galil glb"; later: "Galil
accepted.") and approved it after live evaluation of the orientation
fix (Task 70). It is a **Counter-Strike 2 game rip** (single merged mesh,
41,074 tris, no named part nodes — parts animations silently skipped,
whole-vm bob/sway/recoil/reload dip/draw still run). No external source
or license exists — the row above records **not verified** under the
same dev-only waiver as ak47/ak74 (no publish / no distribution; game
assets from a commercial title must be re-clear or replaced before any
release). The committed file: 621,508 bytes, sha1 `90de74470958…`,
baked parameters in `scripts/bake-galil.ts` (rotY 180° — rip muzzle is
+Z, engine contract is −Z; uniform scale 1.2396 to the 0.97 m IMI Galil
AR length; grip anchor = bbox center of the geometrically-detected rear
grip bump). Re-tuning / recovery path: `npx tsx scripts/bake-galil.ts
&& bash scripts/compress-glb.sh scripts/.tmp/galil-fixed.glb
<target>.glb`, then touch the weapon route to drop its buffer cache.
