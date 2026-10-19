# WEAPONS_PLAN.md — full CS weapon roster + CS 1.6 category buy menu

Multi-phase roadmap, user-ordered. Target: the complete CS:GO weapon set (~34 new
items → ~41 total) and a **Counter-Strike 1.6-style category buy menu** (numbered
categories, keyboard navigation). Each phase is independently shippable and
verifiable; phases can be reordered or stopped at any boundary. Every phase ends
with a commit, a worklog entry, and the standard verification bar
(AGENTS.md: E2E 4/4 + 3/3, model/player checks where relevant, tsc clean,
browser + VLM check, remote push when a PAT is available).

## Current state (what exists today)

| System | State |
|---|---|
| Roster | 8 weapons: glock, usp, deagle, mp5, ak47, m4, awp, knife + c4 (+kevlar/helm gear) |
| Stats | `WeaponDef` in `src/game/weapons.ts` (client) **duplicated** in `mini-services/game-server/weapons.ts` (server) — manual sync |
| Buy menu | flat list in `hud.tsx` (`BUY_ITEMS`), team filter, B key — **no categories** |
| Viewmodels | procedural builders in `weaponmodels.ts` (one `buildX()` per weapon, PBR texture sets) + remote-gun variants |
| Audio | `audio.ts` per-weapon name tables; 85/85 authentic samples committed; raw pack (~1,100 files, all weapons) in gitignored `assets/packs/` |
| Bots | hardcoded buy ladder in `mini-services/game-server/bots.ts` (deagle → mp5 → team rifle → awp) |
| Server | authoritative damage/economy/rounds, LOS hit validation — single-ray per shot, no projectile entities |
| Assets | policy v3: `public/staging/` (gitignored, web-served) → accepted into `public/assets/` only on explicit user OK |

## Target roster (CS:GO full set)

- **Pistols (10):** glock ✓, usp ✓, p250, five-seven, tec-9, cz75, dual berettas, p2000, r8 revolver, zeus — deagle ✓
- **SMGs (7):** mp5 ✓ + mp9, mac-10, mp7, ump-45, p90, bizon
- **Rifles (11):** ak47 ✓, m4 (M4A4) ✓ + galil, famas, sg 553, aug, ssg 08, scar-20, g3sg1, **m4a1-s** (CT silenced variant)
- **Snipers folded into rifles:** awp ✓, ssg 08, scar-20, g3sg1 (auto-snipers)
- **Shotguns (4):** nova, xm1014, mag-7, sawed-off
- **Machine guns (2):** m249, negev
- **Grenades/equipment (6):** flashbang, smoke, he, molotov (T) / incendiary (CT), decoy (optional), defuse kit (CT) + kevlar/helm ✓
- **Not separate weapons:** knife skins (butterfly/bowie/falchion/navaja/stiletto/ursus/widow) — skip.

Weapon count: 8 existing + 33 new ≈ **41** (full CS:GO).

---

# PHASE 0 — CS 1.6 category buy menu (foundation, do FIRST)

Every later phase drops weapons into categories, so the menu must be
category-native before the roster grows.

### 0.1 Data model
- Add `category: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'heavy' | 'grenade' | 'gear'` to `WeaponDef` (both stat tables — unified in Phase 1, this is the bridge).
- Backfill categories for the existing 8 weapons + kevlar/helm + c4.
- `BUY_ITEMS` list dissolves — derived from `WEAPONS` grouped by category.

### 0.2 UI (hud.tsx) — the 1.6 layout
```
  BUY                  $ 4750
  1. PISTOLS           6. EQUIPMENT
  2. SHOTGUNS          7. (ammo — see decision below)
  3. SMGs
  4. RIFLES
  5. MACHINE GUNS
```
- Two-level navigation exactly like 1.6: **B** opens, **digit keys 1–6** select
  category, digits again select weapon, **0/BACK** one level up, **B/ESC** closes.
- Team-aware: T/CT-only weapons shown filtered (greyed-out with team tag when
  wrong team, like 1.6 grey entries — decide: show-grey vs hide; default grey).
- Affordability states: normal / can't-afford (dim + red price) / already-owned
  (checkmark) / slot-conflict hint (buying primary drops old primary).
- Quick-buy memory (CS "rebuy" equivalent): optional stretch.
- Mouse still works (clicks), but the flow must be fully keyboard-drivable.

### 0.3 Decisions baked in
- No ammo purchases (modern CS model — reserve refills on buy); 1.6's `7/8 ammo`
  entries intentionally omitted.
- Numbering matches 1.6 exactly for muscle memory.

### Acceptance
- Buy any current weapon using only number keys; wrong-team items greyed; buy
  error toast still works; E2E round-buy flow green; VLM screenshot of both
  levels; no regression in freeze-time buy window logic.

**Effort: M. Risk: low. Depends on: nothing.**

---

# PHASE 1 — single source of truth for weapon stats

The client/server table duplication is a 2× maintenance hazard at 8 weapons; at
41 it is guaranteed drift and desync bugs (server thinks AK does 36, client 33).

### 1.1 Unify
- Extract the canonical table to a shared module (e.g. `shared/weapons.ts` at
  repo root, imported by both `src/game` and `mini-services/game-server` via
  tsconfig paths; server keeps its own `node_modules`, so verify the import
  strategy against the mini-service build — fallback: a generator script
  `scripts/gen-server-weapons.ts` that emits the server copy from the source of
  truth and runs in CI/pre-commit).
- Delete the hand-written server table; keep the exported types.

### 1.2 Schema extensions (all optional/defaulted, added now so later phases don't churn the shared file)
- `fireMode: 'semi' | 'auto' | 'burst'` + `burstRounds` (famas, optional glock burst)
- `pellets?: number` + `pelletSpread` (shotguns)
- `scopeLevels?: 1 | 2` (aug/sg553 = 1, snipers = 2)
- `suppressed?: boolean` (m4a1-s, usp already is)
- `throwable?: { kind: 'flash'|'smoke'|'he'|'molotov'|'decoy' }`
- `zoomFov`, `recoilPattern` (seed), `killRewardClass`

### Acceptance
- Parity diff: generated/shared table byte-identical semantics vs old pair (spot
  values for all 8 weapons); tsc + both E2E suites green; zero gameplay change.

**Effort: M. Risk: medium (import/build wiring). Depends on: Phase 0.**

---

# PHASE 2 — audio pipeline for the expanded roster

### 2.1 Data-driven sound map
- Replace `audio.ts` hardcoded FIRE/DISTANT/RELOAD/DRAW tables with a
  per-weapon record in the shared weapons module (or adjacent
  `weapons.audio.ts`): `{ fire, distant, out, in, rack, draw, suppressed? }`.
- `FILES` list derives from the map — no manual name list to forget.

### 2.2 Stage all new-weapon samples
- For every new weapon, select the right raw files from `assets/packs/csgo/`
  (+ zips), convert/copy to `public/staging/sounds/<name>.ogg` (asset policy v3:
  staged & web-served, loader already falls back /assets → /staging).
- Suppressed variants for m4a1-s.
- **Nothing commits yet** — sounds stay staged; user accepts per-batch at the
  end of each phase or in Phase 9 (acceptance = `mv` + `git add`, per AGENTS.md).

### Acceptance
- Every weapon id in the map has staged samples (script check: `curl` 200 on
  each staged name); existing 85/85 still committed and serving; E2E green.

**Effort: S–M. Risk: low. Depends on: Phase 1.**

---

# PHASE 3 — pistols (8 new)

p250, five-seven, tec-9, cz75, dual berettas, p2000, r8 revolver, zeus.

### 3.1 Stats (CS:GO-accurate, both sides via shared table)
- Prices: p250 $300, five-seven $500 (CT), tec-9 $500 (T), cz75 $500,
  elites $500, p2000 $200 (CT), R8 $600, zeus $200.
- Damage/hsMult/armorPen/falloff per CS:GO wiki values; killReward $300 (pistols).

### 3.2 Viewmodels
- Extend the `buildPistol` family: frame/slide proportions + finish colors per
  model; **dual berettas** = two viewmodels alternating hands (fire left/right);
  R8 = revolver cylinder; zeus = one-shot taser body.
- Remote-gun variants for other players.

### 3.3 Mechanics
- cz75: auto pistol (fireMode auto, 800 RPM cap).
- R8: slow trigger, high accuracy, ~1s between shots.
- zeus: single shot, $0 kill reward... actually CS:GO zeus: kill reward $0, one
  use, drops on kill — simplified: one use per buy, must rebuy.
- p2000/five-seven: team-restricted CT starters vs glock/usp (loadout defaults
  stay as-is; new pistols are buys).

### 3.4 Bots
- Pistol-round buy table: team-flavored (T: tec-9/p250, CT: p250/five-seven/cz75),
  replaces the `Math.random() < 0.5 → deagle` hack for sub-$700 rounds.

**Effort: M. Risk: low (well-trodden patterns). Depends on: Phases 0–2.**

---

# PHASE 4 — SMGs (6 new)

mp9, mac-10, mp7, ump-45, p90, bizon.

- Stats: mp9/mac10 $1250, mp7/ump $1500, p90 $2350, bizon $1400 (64-round mag);
  killReward $600 class; high moveSpeed (0.93–0.96 AK-relative).
- Viewmodels: `buildMP5` family derivatives (stock/mag/handguard shapes).
- Bots: mid-economy branch replaces the single `mp5` fallback; team flavor
  (mac10 T / mp9 CT).
- ump-45: armorPen high (CS quirk).

**Effort: M. Risk: low. Depends on: Phase 3 (pipeline warm).**

---

# PHASE 5 — rifles (8 new, incl. two mechanics)

galil, famas, sg 553, aug, ssg 08, scar-20, g3sg1, m4a1-s.

### 5.1 Standard rifles
- galil $1800 (T) / famas $1700 (CT): budget-rifle bot ladder step between SMG
  and full rifle.
- sg 553 $3000 (T, scope 1 level) / aug $3300 (CT, scope 1 level): zoom = FOV
  lerp + sensitivity scale (existing awp scope code, parameterized).

### 5.2 Burst fire (new mechanic)
- famas 3-round burst: `fireMode: 'burst'`, burst queue client-side, server
  validates the burst cadence window (anti-cheat: burst delay enforced
  server-side, not client).

### 5.3 Snipers
- ssg 08 $1700: light, 2-level scope, killReward $300 (scout class), high
  moveSpeed (0.9 AK-relative).
- scar-20 $5000 (CT) / g3sg1 $5000 (T): auto-snipers, fireMode auto + 2-level
  scope, killReward $100.

### 5.4 M4A1-S (CT alternative to M4A4)
- Buy-menu pairing (CT rifle slot offers both; owning one excludes the other).
- `suppressed: true` → quieter fire sample (staged), no distant crack, no
  tracer, smaller muzzle flash; 20/80 mag.
- Skin/variant selection persistence optional.

### 5.5 Viewmodels
- Rifle family builder (receiver/mag/barrel/stock parametric — ak/m4 builders
  generalize); sniper scopes reuse AWP glass pattern.

**Effort: L. Risk: medium (burst validation, scope levels). Depends on: Phase 4.**

---

# PHASE 6 — shotguns (4 new, first server hit-reg change)

nova, xm1014, mag-7, sawed-off.

### 6.1 Multi-pellet ballistics (server)
- Server shot validation becomes N-ray: `pellets` (9, 8, 8, 8), per-pellet
  spread cone sampled server-side from a seeded pattern (client seed for
  predicted tracers, server authoritative for damage), damage aggregation
  per-target with falloff per-pellet distance.
- Armored target math per-pellet (armor durability drain — simplified: flat
  armorPen per pellet).

### 6.2 Mechanics
- Pump (nova/sawed-off/mag-7): shot → cock delay (bolt sound slot already
  exists), xm1014: auto with 7-shell tube.
- mag-7 $1300 (CT) / sawed-off $1100 (T) / nova $1050 / xm1014 $2000.
- killReward $900 class.
- Range: hard damage falloff (falloff10m aggressive — shotguns must feel
  close-range only).

### 6.3 Viewmodels + animation
- Shotgun family builder; pump animation on the existing reload-stage timeline.

**Effort: L. Risk: medium-high (server ray fan × rate; watch 20 Hz tick budget).
Depends on: Phase 5.**

---

# PHASE 7 — machine guns (2 new)

m249 $5200, negev $1700 (post-rebalance price).

- fireDelay ~66–75ms auto, mag 100/150 — server rate validation must handle
  sustained 15 rps without tick pressure (batch validation or per-ray skip like
  awp's single-ray path).
- Negev: CS:GO accuracy ramp (first bullets wild, settles while firing) —
  `accuracy` animated by consecutive-shot counter; simplified acceptable.
- killReward $300; heavy moveSpeed penalty.
- Viewmodels: belt/mag box on the rifle family.
- Bots: never buy MGs (CS-realistic) except "rich bot fun mode" — optional.

**Effort: S–M. Risk: low (single mechanic) but tick-budget check. Depends: Phase 6.**

---

# PHASE 8 — grenades & equipment (the systems phase, biggest of all)

flashbang, smoke, HE, molotov (T) / incendiary (CT), decoy (optional), defuse kit.

### 8.1 Projectile entities (server, new subsystem)
- Server-side grenade entity: spawn on throw with velocity (view angle + charge),
  per-tick physics: gravity, drag, world-box collision with bounce (restitution
  per surface), rest detection.
- Snapshot grenades to clients (new message class in the 20 Hz stream).
- Client renders flying grenade mesh + trail.

### 8.2 Per-grenade effects
- **HE ($300):** server radial damage (falloff + LOS check so walls block),
  killReward $300, max 1.
- **Flashbang ($200, max 2):** server computes per-player blind intensity from
  distance + facing angle + LOS; client screen fade + audio duck; **bots get a
  blinded timer (no vision) — real bot counterplay.**
- **Smoke ($300):** volumetric cloud (client: layered billboard sphere),
  18 s; **server LOS checks treat smoke volume as opaque for hit-validation
  and bot vision** — this is the critical interplay with the existing LOS
  validation.
- **Molotov/Inc ($400/$600):** ground fire zone, DoT ticks, burn-out timer;
  smoke extinguishes fire (stretch, mark optional).
- **Decoy ($50):** plays weapon-fire sounds on a loop at landing spot, fake
  radar blip (stretch — do last, cut if time).
- **Defuse kit (CT, $400):** halves defuse time; pure server constant change +
  equipment slot in menu.

### 8.3 Throw mechanics + inventory
- Slots 5 (grenade) per CS:GO (knife 3, c4 4, grenades 5); max 1 HE / 2 flash /
  1 smoke / 1 molly.
- LMB throw (full), RMB underhand lob; Q last-weapon; grenade viewmodels with
  pin-pull (sound staged: `pinpull`, `fire_`).
- Buy in **EQUIPMENT (6)** category — 1.6-style: grenades live in equipment,
  not a weapon category.

### 8.4 Bot grenade AI (light)
- Simple policy: flash before push on bomb-site waypoints (p<0.3), smoke on
  choke retreat; HE on spotted clustered enemies. Keep statistical, not
  tactical — enough for feel.

**Effort: XL (largest single phase; candidate to split 8a entities+HE, 8b
flash+smoke, 8b fire/kit, 8c decoy). Risk: high (physics, tick budget, LOS
interplay). Depends: Phases 1–7 (menu + shared table + staged audio).**

---

# PHASE 9 — balance, polish, acceptance sweep

### 9.1 Balance pass
- Kill rewards per class (pistol/rifle $300, SMG $600, shotgun $900, AWP $100,
  auto-sniper $100, MG $300, grenades $300); economy curve check with bots
  across 20-round sims (scripted, no browser).
- Movement speeds, recoil/accuracy feel pass (playtest loop with VLM + self).
- Buy menu polish: 1.6-style weapon silhouettes (procedural icons from
  viewmodels rendered to offscreen canvas → PNG → staged → accepted), price
  column, money header.

### 9.2 Full verification hardening
- E2E suite extension: per-category buy test, per-new-weapon fire/reload smoke
  test (data-driven loop, not hand-written per weapon), grenade entity tests
  (HE damage, smoke LOS toggle, flash bot-blind), shotgun pellet aggregation
  test, burst-fire cadence anti-cheat test.
- Load sanity: 10 players all firing MGs — tick budget measurement.
- Documentation: DEPLOY.md roster section, AGENTS.md new invariants (shared
  table is the only place to edit stats), READMEs.

### 9.3 Asset acceptance (the v3 moment)
- All staged sound batches + any icons: presented to user by list;
  on OK → `mv public/staging/<x> public/assets/<x> && git add` (per policy),
  single acceptance commit; repo now carries the full authentic sound set.

**Effort: M. Risk: low. Depends: all.**

---

## Cross-cutting rules (apply to every phase)

1. **Asset policy v3** — new binaries only ever land in `public/staging/`;
   acceptance at phase end (or Phase 9) on explicit user OK only.
2. **One stat source** — after Phase 1, all stat edits go in the shared table;
   the server copy is generated/derived, never hand-edited.
3. **Server authority** — every new mechanic (burst cadence, pellet fan,
   grenade physics/effects) validated server-side; client only predicts/renders.
4. **Verification bar** (AGENTS.md) before any phase is called done: E2E
   4/4 + 3/3 + new phase tests, tsc clean (src + mini-services), browser check
   through :81, VLM for visual states, worklog entry, commit + push.
5. **Bots learn each weapon** the same phase it lands (buy ladder + any special
   behavior), so no roster exists that bots ignore.
6. **Phase commits** stay source-only; binaries ride the staging policy.

## Suggested order & sizing

| Phase | Content | Size |
|---|---|---|
| 0 | 1.6 category buy menu | M |
| 1 | shared stat table + schema | M |
| 2 | audio pipeline + staging | S–M |
| 3 | pistols ×8 | M |
| 4 | SMGs ×6 | M |
| 5 | rifles ×8 (burst, scopes, M4A1-S) | L |
| 6 | shotguns ×4 (pellet ballistics) | L |
| 7 | machine guns ×2 | S–M |
| 8 | grenades + equipment (entities) | XL — splittable 8a/8b/8c |
| 9 | balance + polish + acceptance | M |

Total ≈ 33 new weapons + full category menu. Grenade phase 8 is the natural
place to pause/branch if the roster phases feel more urgent — it is independent
of 3–7 once 0/1/2 are done.
