// ============================================================
// CS2-clone weapon definitions — THE single source of truth
// ============================================================
// Phase 1 (WEAPONS_PLAN.md): this shared module is canonical for weapon
// stats, gear, the buy-menu derivation, economy and round constants on
// BOTH sides. The old hand-maintained pair (src/game/weapons.ts client +
// mini-services/game-server/weapons.ts server) dissolved into thin
// re-export shims so existing relative imports keep working unchanged.
//
// RULE: every stat edit lands HERE and nowhere else — the server
// (validation, economy, bots), the client (prediction, viewmodels, HUD)
// and the buy menu all read this one table. test-buymenu.ts guards that
// both shims resolve to THIS module (object identity), so a re-duplicated
// table fails the build.

export type TeamId = 'CT' | 'T'
export type HitPart = 'head' | 'body' | 'legs'
export type WeaponId =
  | 'knife' | 'glock' | 'usp' | 'deagle' | 'mp5'
  | 'ak47' | 'm4' | 'awp' | 'c4'
  // Task 66: user's custom add — AK-74M (their own GLB + fire sound),
  // T-side rifle alongside the AK-47
  | 'ak74'
  // Phase 3 pistols — ids match the staged audio map (shared/weapons-audio.ts)
  | 'p250' | 'fiveseven' | 'tec9' | 'cz75' | 'elites'
  | 'hkp2000' | 'revolver' | 'taser'
  // Phase 4 SMGs — ids match the staged audio map (shared/weapons-audio.ts)
  | 'mp9' | 'mac10' | 'mp7' | 'ump45' | 'p90' | 'bizon'
  // Phase 5 rifles + snipers — ids match the staged audio map
  | 'm4a1s' | 'galil' | 'famas' | 'sg553' | 'aug' | 'ssg08'
  | 'scar20' | 'g3sg1'
  // Phase 6 shotguns — ids match the staged audio map (shared/weapons-audio.ts)
  | 'nova' | 'xm1014' | 'mag7' | 'sawedoff'
  // Phase 7 machine guns — ids match the staged audio map (shared/weapons-audio.ts)
  | 'm249' | 'negev'
  // Phase 8 grenades — ids DOUBLE as grenade kinds (throwable.kind) and keys
  // into GRENADE_AUDIO (shared/weapons-audio.ts); molotov is T, incendiary CT
  | 'flash' | 'he' | 'smoke' | 'molotov' | 'inc' | 'decoy'

// Menu category. Weapons keep their own class for stats/logic; the buy menu
// groups them under fixed CS 1.6 numbering. 'grenade' and 'gear' weapons land
// in the EQUIPMENT (6) menu category, matching 1.6.
export type WeaponCategory = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'heavy' | 'grenade' | 'gear'

// --- Phase 1 schema extensions -------------------------------------------
// All optional and defaulted; later phases (3-8) add weapons carrying these
// fields without churning this file's consumers. Existing code paths must
// resolve defaults through the helpers below, never hand-branch on absence.

// Trigger behavior. Default (absent): w.auto ? 'auto' : 'semi' — see fireModeOf().
export type FireMode = 'semi' | 'auto' | 'burst'

// Class-based kill rewards (Phase 9 balance pass derives from these).
export type KillRewardClass =
  | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'heavy'
  | 'awp' | 'auto-sniper' | 'scout' | 'knife' | 'grenade'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: 1 | 2 | 3 | 4 | 5   // 1 primary, 2 pistol, 3 knife, 4 c4
  category: WeaponCategory
  price: number
  team?: TeamId              // restricted
  damage: number             // base body damage
  hsMult: number             // headshot multiplier
  legMult: number
  fireDelay: number          // ms between shots
  mag: number
  reserve: number
  reloadMs: number
  moveSpeed: number          // meters/sec while holding
  armorPen: number           // 0..1 damage multiplier vs armor
  falloff10m: number         // damage multiplier per 10m distance
  auto: boolean
  scope?: boolean
  killReward: number
  accurate: number           // base spread degrees standing still

  // --- Phase 1+ extensions (optional; defaults via helpers) ---
  fireMode?: FireMode        // default: auto ? 'auto' : 'semi' (fireModeOf)
  burstRounds?: number       // rounds per trigger pull when fireMode 'burst' (DORMANT — no current gun is burst; kept for future burst weapons)
  burstDelayMs?: number      // cadence inside a burst — server validates (Phase 5)
  pellets?: number           // >1 = multi-pellet shotgun ballistics (Phase 6)
  pelletSpread?: number      // pellet cone half-angle, degrees (Phase 6)
  scopeLevels?: 1 | 2        // zoom steps: awp 2, aug/sg553 1 (Phase 5)
  zoomFov?: number           // scoped camera FOV; 16 = current AWP feel
  suppressed?: boolean       // quieter fire, no distant crack/tracer (m4a1-s)
  recoilPattern?: number     // deterministic recoil seed (Phase 9 parameterization)
  killRewardClass?: KillRewardClass // class-based rewards for new weapons
  throwable?: { kind: 'flash' | 'smoke' | 'he' | 'molotov' | 'inc' | 'decoy' } // Phase 8 — id == kind for every grenade
  maxCarry?: number           // Phase 8: grenades stack in slot 5 up to this count (flash 2, rest 1)
  accuracyRamp?: { startSpread: number; shots: number } // Phase 7 spool: consecutive shots settle spread from startSpread to accurate (negev)
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', name: 'Knife', slot: 3, category: 'gear', price: 0, damage: 40, hsMult: 1, legMult: 1,
    fireDelay: 400, mag: Infinity, reserve: Infinity, reloadMs: 0, moveSpeed: 5.0,
    armorPen: 0.85, falloff10m: 1, auto: true, killReward: 1500, accurate: 0,
    fireMode: 'auto', killRewardClass: 'knife',
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 2, category: 'pistol', price: 0, team: 'T', damage: 30, hsMult: 4, legMult: 0.75,
    fireDelay: 150, mag: 20, reserve: 120, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.47, falloff10m: 0.89, auto: false, killReward: 300, accurate: 0.45,
    fireMode: 'semi', killRewardClass: 'pistol',
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 2, category: 'pistol', price: 0, team: 'CT', damage: 35, hsMult: 4, legMult: 0.75,
    fireDelay: 170, mag: 12, reserve: 24, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.505, falloff10m: 0.91, auto: false, killReward: 300, accurate: 0.38,
    fireMode: 'semi', suppressed: true, killRewardClass: 'pistol',
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, category: 'pistol', price: 700, damage: 53, hsMult: 4, legMult: 0.75,
    fireDelay: 350, mag: 7, reserve: 35, reloadMs: 2200, moveSpeed: 4.8,
    armorPen: 0.925, falloff10m: 0.81, auto: false, killReward: 300, accurate: 0.55,
    fireMode: 'semi', killRewardClass: 'pistol',
  },
  // ---------------------------------------------- Phase 3 pistols (CS:GO values)
  // Prices per plan 3.1; damage/armorPen/falloff/mags per CS:GO wiki, scaled
  // to our schema (falloff per 10m, armorPen as the 0..1 multiplier).
  p250: {
    id: 'p250', name: 'P250', slot: 2, category: 'pistol', price: 300, damage: 38, hsMult: 4, legMult: 0.75,
    fireDelay: 150, mag: 13, reserve: 26, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.645, falloff10m: 0.85, auto: false, killReward: 300, accurate: 0.45,
    fireMode: 'semi', killRewardClass: 'pistol',
  },
  fiveseven: {
    id: 'fiveseven', name: 'Five-SeveN', slot: 2, category: 'pistol', price: 500, team: 'CT', damage: 32, hsMult: 4, legMult: 0.75,
    fireDelay: 150, mag: 20, reserve: 100, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.9075, falloff10m: 0.87, auto: false, killReward: 300, accurate: 0.40,
    fireMode: 'semi', killRewardClass: 'pistol', // SS190s: famous armor punch
  },
  tec9: {
    id: 'tec9', name: 'Tec-9', slot: 2, category: 'pistol', price: 500, team: 'T', damage: 33, hsMult: 4, legMult: 0.75,
    fireDelay: 120, mag: 18, reserve: 90, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.9075, falloff10m: 0.87, auto: false, killReward: 300, accurate: 0.62,
    fireMode: 'semi', killRewardClass: 'pistol', // fast + wild spray
  },
  cz75: {
    id: 'cz75', name: 'CZ75-Auto', slot: 2, category: 'pistol', price: 500, damage: 31, hsMult: 4, legMult: 0.75,
    fireDelay: 75, mag: 12, reserve: 24, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.775, falloff10m: 0.85, auto: true, killReward: 300, accurate: 0.58,
    fireMode: 'auto', killRewardClass: 'pistol', // full-auto machine pistol, 800 RPM
  },
  elites: {
    id: 'elites', name: 'Dual Berettas', slot: 2, category: 'pistol', price: 500, damage: 38, hsMult: 4, legMult: 0.75,
    fireDelay: 120, mag: 30, reserve: 120, reloadMs: 2600, moveSpeed: 4.9,
    armorPen: 0.5225, falloff10m: 0.85, auto: false, killReward: 300, accurate: 0.50,
    fireMode: 'semi', killRewardClass: 'pistol', // alternating hands, 15+15
  },
  hkp2000: {
    id: 'hkp2000', name: 'P2000', slot: 2, category: 'pistol', price: 200, team: 'CT', damage: 35, hsMult: 4, legMult: 0.75,
    fireDelay: 170, mag: 13, reserve: 52, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.505, falloff10m: 0.91, auto: false, killReward: 300, accurate: 0.38,
    fireMode: 'semi', killRewardClass: 'pistol', // CT budget buy
  },
  revolver: {
    id: 'revolver', name: 'R8 Revolver', slot: 2, category: 'pistol', price: 600, damage: 86, hsMult: 4, legMult: 0.75,
    fireDelay: 1000, mag: 8, reserve: 8, reloadMs: 3600, moveSpeed: 4.8,
    armorPen: 0.9314, falloff10m: 0.98, auto: false, killReward: 300, accurate: 0.15,
    fireMode: 'semi', killRewardClass: 'pistol', // slow trigger, hits like a truck
  },
  taser: {
    id: 'taser', name: 'Zeus x27', slot: 2, category: 'pistol', price: 200, damage: 500, hsMult: 1, legMult: 1,
    fireDelay: 400, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 0, accurate: 0.9,
    fireMode: 'semi', // one use per buy, melee-range arc, no kill reward
  },
  mp5: {
    id: 'mp5', name: 'MP5-SD', slot: 1, category: 'smg', price: 1500, damage: 27, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 30, reserve: 120, reloadMs: 2600, moveSpeed: 4.7,
    armorPen: 0.55, falloff10m: 0.84, auto: true, killReward: 600, accurate: 0.55,
    fireMode: 'auto', suppressed: true, killRewardClass: 'smg',
  },
  // ---------------------------------------------- Phase 4 SMGs (CS:GO values)
  // Prices per plan 4.4; damage/armorPen/falloff/mags per CS:GO wiki. All
  // $600 kill-reward class; movement 4.6-4.8 = the CS 0.92-0.96 weapon-speed
  // scale (240/250, UMP 230). mp7 900 RPM ≈ 67ms, p90 857 RPM ≈ 70ms,
  // bizon 64-round helical mag is the anti-eco spray identity.
  mp9: {
    id: 'mp9', name: 'MP9', slot: 1, category: 'smg', price: 1250, team: 'CT', damage: 26, hsMult: 4, legMult: 0.75,
    fireDelay: 75, mag: 30, reserve: 120, reloadMs: 2100, moveSpeed: 4.8,
    armorPen: 0.60, falloff10m: 0.84, auto: true, killReward: 600, accurate: 0.45,
    fireMode: 'auto', killRewardClass: 'smg', // CT compact, mag-in-grip, 800 RPM
  },
  mac10: {
    id: 'mac10', name: 'MAC-10', slot: 1, category: 'smg', price: 1250, team: 'T', damage: 29, hsMult: 4, legMult: 0.75,
    fireDelay: 75, mag: 30, reserve: 100, reloadMs: 2300, moveSpeed: 4.8,
    armorPen: 0.575, falloff10m: 0.80, auto: true, killReward: 600, accurate: 0.70,
    fireMode: 'auto', killRewardClass: 'smg', // T boxy room-sweeper, wild spray
  },
  mp7: {
    id: 'mp7', name: 'MP7', slot: 1, category: 'smg', price: 1500, damage: 29, hsMult: 4, legMult: 0.75,
    fireDelay: 67, mag: 30, reserve: 120, reloadMs: 3000, moveSpeed: 4.8,
    armorPen: 0.625, falloff10m: 0.84, auto: true, killReward: 600, accurate: 0.45,
    fireMode: 'auto', killRewardClass: 'smg', // fastest SMG (900 RPM), PDW-accurate
  },
  ump45: {
    id: 'ump45', name: 'UMP-45', slot: 1, category: 'smg', price: 1500, damage: 35, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 25, reserve: 100, reloadMs: 3500, moveSpeed: 4.6,
    armorPen: 0.65, falloff10m: 0.75, auto: true, killReward: 600, accurate: 0.40,
    fireMode: 'auto', killRewardClass: 'smg', // heaviest SMG round: armor punch, short reach
  },
  p90: {
    id: 'p90', name: 'P90', slot: 1, category: 'smg', price: 2350, damage: 26, hsMult: 4, legMult: 0.75,
    fireDelay: 70, mag: 50, reserve: 100, reloadMs: 3400, moveSpeed: 4.8,
    armorPen: 0.69, falloff10m: 0.84, auto: true, killReward: 600, accurate: 0.55,
    fireMode: 'auto', killRewardClass: 'smg', // bullpup, 50-rd top mag, rich-SMG
  },
  bizon: {
    id: 'bizon', name: 'PP-Bizon', slot: 1, category: 'smg', price: 1400, damage: 27, hsMult: 4, legMult: 0.75,
    fireDelay: 80, mag: 64, reserve: 120, reloadMs: 3400, moveSpeed: 4.8,
    armorPen: 0.575, falloff10m: 0.82, auto: true, killReward: 600, accurate: 0.50,
    fireMode: 'auto', killRewardClass: 'smg', // 64-round helical drum: anti-eco spray
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, category: 'rifle', price: 2700, team: 'T', damage: 36, hsMult: 4, legMult: 0.75,
    fireDelay: 100, mag: 30, reserve: 90, reloadMs: 2400, moveSpeed: 4.35,
    armorPen: 0.775, falloff10m: 0.98, auto: true, killReward: 300, accurate: 0.35,
    fireMode: 'auto', killRewardClass: 'rifle',
  },
  // Task 66: user's AK-74M — T-side alternative rifle. 5.45×39 vs the
  // AK-47's 7.62×39: slightly less damage/pen, better controllability,
  // $200 cheaper. Fire/draw/reload sounds reuse the AK-47 family samples
  // (plus the user's own ak74_fire recording, staged); GLB model staged
  // from upload/ak-74m.glb via scripts/bake-ak74.ts.
  ak74: {
    id: 'ak74', name: 'AK-74M', slot: 1, category: 'rifle', price: 2500, team: 'T', damage: 34, hsMult: 4, legMult: 0.75,
    fireDelay: 100, mag: 30, reserve: 90, reloadMs: 2400, moveSpeed: 4.4,
    armorPen: 0.74, falloff10m: 0.97, auto: true, killReward: 300, accurate: 0.30,
    fireMode: 'auto', killRewardClass: 'rifle',
  },
  m4: {
    id: 'm4', name: 'M4A4', slot: 1, category: 'rifle', price: 3100, team: 'CT', damage: 33, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 30, reserve: 90, reloadMs: 3000, moveSpeed: 4.45,
    armorPen: 0.70, falloff10m: 0.97, auto: true, killReward: 300, accurate: 0.32,
    fireMode: 'auto', killRewardClass: 'rifle',
  },
  // ---------------------------------------------- Phase 5 rifles + snipers (CS:GO values)
  // Prices per plan 5.1-5.4; damage/armorPen/RPM/mags per CS:GO wiki
  // (fandom stats tables). Task 105: the famas burst was retired by user
  // request (burst → auto at the real 666 RPM cyclic rate) — the burst
  // machinery (engine queue + server anti-cheat) stays wired but dormant;
  // scopeLevels per plan; snipers keep 2-level scopes, scoped rifles 1 level.
  m4a1s: {
    id: 'm4a1s', name: 'M4A1-S', slot: 1, category: 'rifle', price: 2900, team: 'CT', damage: 38, hsMult: 4, legMult: 0.75,
    fireDelay: 100, mag: 20, reserve: 80, reloadMs: 3100, moveSpeed: 4.5,
    armorPen: 0.70, falloff10m: 0.97, auto: true, killReward: 300, accurate: 0.28,
    fireMode: 'auto', suppressed: true, killRewardClass: 'rifle', // CT silenced alternative to M4A4
  },
  galil: {
    id: 'galil', name: 'Galil AR', slot: 1, category: 'rifle', price: 1800, team: 'T', damage: 30, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 35, reserve: 90, reloadMs: 3000, moveSpeed: 4.8,
    armorPen: 0.775, falloff10m: 0.98, auto: true, killReward: 300, accurate: 0.55,
    fireMode: 'auto', killRewardClass: 'rifle', // T budget rifle, 35-rd mag
  },
  famas: {
    id: 'famas', name: 'FAMAS', slot: 1, category: 'rifle', price: 1700, team: 'CT', damage: 30, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 25, reserve: 90, reloadMs: 3300, moveSpeed: 4.8,
    armorPen: 0.70, falloff10m: 0.97, auto: true, killReward: 300, accurate: 0.45,
    fireMode: 'auto', killRewardClass: 'rifle', // Task 105: user retired the 3-rd burst — full-auto, 666 RPM cyclic
  },
  sg553: {
    id: 'sg553', name: 'SG 553', slot: 1, category: 'rifle', price: 3000, team: 'T', damage: 30, hsMult: 4, legMult: 0.75,
    fireDelay: 110, mag: 30, reserve: 90, reloadMs: 2800, moveSpeed: 4.2,
    armorPen: 1.0, falloff10m: 0.98, auto: true, killReward: 300, accurate: 0.30,
    fireMode: 'auto', scopeLevels: 1, zoomFov: 25, killRewardClass: 'rifle', // 100% pen: helmet one-taps
  },
  aug: {
    id: 'aug', name: 'AUG', slot: 1, category: 'rifle', price: 3300, team: 'CT', damage: 28, hsMult: 4, legMult: 0.75,
    fireDelay: 100, mag: 30, reserve: 90, reloadMs: 3200, moveSpeed: 4.4,
    armorPen: 0.90, falloff10m: 0.97, auto: true, killReward: 300, accurate: 0.28,
    fireMode: 'auto', scopeLevels: 1, zoomFov: 25, killRewardClass: 'rifle', // bullpup + integrated optic
  },
  ssg08: {
    id: 'ssg08', name: 'SSG 08', slot: 1, category: 'rifle', price: 1700, damage: 88, hsMult: 4, legMult: 0.75,
    fireDelay: 1250, mag: 10, reserve: 90, reloadMs: 3700, moveSpeed: 4.6,
    armorPen: 0.85, falloff10m: 0.98, auto: false, killReward: 300, accurate: 0.05,
    fireMode: 'semi', scope: true, scopeLevels: 2, zoomFov: 16, killRewardClass: 'scout', // light bolt scout, 230 speed
  },
  scar20: {
    id: 'scar20', name: 'SCAR-20', slot: 1, category: 'rifle', price: 5000, team: 'CT', damage: 80, hsMult: 4, legMult: 0.75,
    fireDelay: 250, mag: 20, reserve: 90, reloadMs: 3100, moveSpeed: 4.3,
    armorPen: 0.825, falloff10m: 0.98, auto: true, killReward: 100, accurate: 0.12,
    fireMode: 'auto', scope: true, scopeLevels: 2, zoomFov: 16, killRewardClass: 'auto-sniper', // CT auto-sniper
  },
  g3sg1: {
    id: 'g3sg1', name: 'G3SG1', slot: 1, category: 'rifle', price: 5000, team: 'T', damage: 80, hsMult: 4, legMult: 0.75,
    fireDelay: 250, mag: 20, reserve: 90, reloadMs: 4700, moveSpeed: 4.3,
    armorPen: 0.825, falloff10m: 0.98, auto: true, killReward: 100, accurate: 0.12,
    fireMode: 'auto', scope: true, scopeLevels: 2, zoomFov: 16, killRewardClass: 'auto-sniper', // T auto-sniper
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, category: 'rifle', price: 4750, damage: 115, hsMult: 4, legMult: 0.75,
    fireDelay: 1450, mag: 10, reserve: 30, reloadMs: 3600, moveSpeed: 4.0,
    armorPen: 0.975, falloff10m: 1.0, auto: false, scope: true, killReward: 100, accurate: 0.05,
    fireMode: 'semi', scopeLevels: 2, zoomFov: 16, killRewardClass: 'awp',
  },
  c4: {
    id: 'c4', name: 'C4 Explosive', slot: 4, category: 'gear', price: 0, team: 'T', damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 1000, mag: Infinity, reserve: Infinity, reloadMs: 0, moveSpeed: 5.0,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi',
  },
  // ---------------------------------------------- Phase 6 shotguns (CS:GO values)
  // Stats per CS:GO wiki (fandom infoboxes, fetched 2026-10): damage/pellets/
  // armorPen/RPM/mags/speeds, prices + $900 kill-reward class per plan 6.2
  // (CS:GO lists the XM1014's competitive reward at $600 — the plan pins the
  // class at $900; Phase 9 balance can revisit). Pellet count per plan 6.1:
  // (9, 8, 8, 8). falloff10m is deliberately brutal on mag7/sawedoff
  // (range modifier 0.45) — "shotguns must feel close-range only" (plan 6.2).
  // Pump guns: fireMode semi + ~68 RPM cycle; the post-shot cock (pump) is the
  // audio map's bolt slot. XM1014: auto per plan ("auto with 7-shell tube",
  // 171 RPM ≈ 350ms).
  nova: {
    id: 'nova', name: 'Nova', slot: 1, category: 'shotgun', price: 1050, damage: 26, hsMult: 4, legMult: 0.75,
    fireDelay: 880, mag: 8, reserve: 32, reloadMs: 4200, moveSpeed: 4.4,
    armorPen: 0.50, falloff10m: 0.70, auto: false, killReward: 900, accurate: 0.70,
    fireMode: 'semi', pellets: 9, pelletSpread: 4.2, killRewardClass: 'shotgun', // pump, 9-pellet classic
  },
  xm1014: {
    id: 'xm1014', name: 'XM1014', slot: 1, category: 'shotgun', price: 2000, damage: 20, hsMult: 4, legMult: 0.75,
    fireDelay: 350, mag: 7, reserve: 32, reloadMs: 2800, moveSpeed: 4.8,
    armorPen: 0.80, falloff10m: 0.70, auto: true, killReward: 900, accurate: 0.85,
    fireMode: 'auto', pellets: 8, pelletSpread: 4.8, killRewardClass: 'shotgun', // auto shotgun, 7-shell tube
  },
  mag7: {
    id: 'mag7', name: 'MAG-7', slot: 1, category: 'shotgun', price: 1300, team: 'CT', damage: 30, hsMult: 4, legMult: 0.75,
    fireDelay: 845, mag: 5, reserve: 32, reloadMs: 2700, moveSpeed: 4.8,
    armorPen: 0.75, falloff10m: 0.45, auto: false, killReward: 900, accurate: 0.60,
    fireMode: 'semi', pellets: 8, pelletSpread: 3.6, killRewardClass: 'shotgun', // CT pump, 5-rd BOX mag, tight cone
  },
  sawedoff: {
    id: 'sawedoff', name: 'Sawed-Off', slot: 1, category: 'shotgun', price: 1100, team: 'T', damage: 32, hsMult: 4, legMult: 0.75,
    fireDelay: 845, mag: 7, reserve: 32, reloadMs: 3700, moveSpeed: 4.2,
    armorPen: 0.75, falloff10m: 0.45, auto: false, killReward: 900, accurate: 1.0,
    fireMode: 'semi', pellets: 8, pelletSpread: 5.2, killRewardClass: 'shotgun', // T cut-down: hardest falloff, wildest cone
  },
  // ---------------------------------------------- Phase 7 machine guns (CS:GO values)
  // Stats per CS:GO wiki (fandom infoboxes, fetched 2026-10): m249 31 dmg /
  // 80% pen / 750 RPM (80ms) / 100+200 / 195 speed (3.9 m/s) / $5200;
  // negev 35 dmg / 71% pen / 800 RPM (75ms) / 150+300 / 150 speed (3.0 m/s —
  // the slowest weapon in the game, slower than the AWP) / $1700
  // post-rebalance price per plan 7. Both: $300 'heavy' kill-reward class,
  // 5.7s box reload, auto. The negev carries the Phase 7 accuracy ramp
  // (plan 7: "first bullets wild, settles while firing"): the first ~15
  // consecutive shots spray off a 4.4-degree cone, then the spread settles
  // to laser accuracy — the spool IS the weapon identity, and holding the
  // trigger is the skill. m249 trades rate for a steadier base spread.
  // Bots never buy MGs (CS-realistic, plan 7.4) — the ladder in bots.ts
  // never references these ids.
  negev: {
    id: 'negev', name: 'Negev', slot: 1, category: 'heavy', price: 1700, damage: 35, hsMult: 4, legMult: 0.75,
    fireDelay: 75, mag: 150, reserve: 300, reloadMs: 5700, moveSpeed: 3.0,
    armorPen: 0.71, falloff10m: 0.98, auto: true, killReward: 300, accurate: 0.10,
    fireMode: 'auto', accuracyRamp: { startSpread: 4.4, shots: 15 }, killRewardClass: 'heavy', // 150-rd belt box, accuracy-ramp spool
  },
  m249: {
    id: 'm249', name: 'M249', slot: 1, category: 'heavy', price: 5200, damage: 31, hsMult: 4, legMult: 0.75,
    fireDelay: 80, mag: 100, reserve: 200, reloadMs: 5700, moveSpeed: 3.9,
    armorPen: 0.80, falloff10m: 0.98, auto: true, killReward: 300, accurate: 0.55,
    fireMode: 'auto', killRewardClass: 'heavy', // belt-fed SAW, 100-rd box mag
  },
  // ---------------------------------------------- Phase 8 grenades + equipment (CS:GO values)
  // Grenades live in slot 5 and land in the EQUIPMENT (6) buy category,
  // 1.6-style. Each inventory entry IS one grenade (mag 1, reserve 0);
  // throwing removes the entry — ammo maps are never used. Gun-oriented
  // fields (hsMult/legMult/falloff) are inert for throwables; `damage` +
  // `armorPen` carry the HE numbers (98 base / 50% vs armor) so the shared
  // heDamage() math in shared/grenades.ts reads them off the table like
  // every other weapon stat. Carry limits per plan 8.3: max 1 HE / 2 flash /
  // 1 smoke / 1 molotov / 1 inc / 1 decoy. The defuse kit is GEAR (below).
  flash: {
    id: 'flash', name: 'Flashbang', slot: 5, category: 'grenade', price: 200, damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 900, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi', throwable: { kind: 'flash' }, maxCarry: 2, killRewardClass: 'grenade', // blind everyone incl. the thrower
  },
  he: {
    id: 'he', name: 'HE Grenade', slot: 5, category: 'grenade', price: 300, damage: 98, hsMult: 1, legMult: 1,
    fireDelay: 900, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 0.5, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi', throwable: { kind: 'he' }, maxCarry: 1, killRewardClass: 'grenade', // radial 98 → 0 over 9m, walls block
  },
  smoke: {
    id: 'smoke', name: 'Smoke Grenade', slot: 5, category: 'grenade', price: 300, damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 900, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi', throwable: { kind: 'smoke' }, maxCarry: 1, killRewardClass: 'grenade', // 18s cloud, opaque to LOS + bots
  },
  molotov: {
    id: 'molotov', name: 'Molotov', slot: 5, category: 'grenade', price: 400, team: 'T', damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 900, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi', throwable: { kind: 'molotov' }, maxCarry: 1, killRewardClass: 'grenade', // ground fire 7s, ignites on impact
  },
  inc: {
    id: 'inc', name: 'Incendiary Grenade', slot: 5, category: 'grenade', price: 600, team: 'CT', damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 900, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi', throwable: { kind: 'inc' }, maxCarry: 1, killRewardClass: 'grenade', // CT fire grenade, same zone
  },
  decoy: {
    id: 'decoy', name: 'Decoy Grenade', slot: 5, category: 'grenade', price: 50, damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 900, mag: 1, reserve: 0, reloadMs: 0, moveSpeed: 4.95,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
    fireMode: 'semi', throwable: { kind: 'decoy' }, maxCarry: 1, killRewardClass: 'grenade', // fake gunfire loop at rest, 30s
  },
}

// ------------------------------------------------------------ buy menu
// Non-weapon buyables (armor today; defuse kit and grenades later) live in
// the EQUIPMENT category, exactly like CS 1.6.
export interface GearDef {
  id: string
  name: string
  price: number
  team?: TeamId
  desc: string
}

export const GEAR: GearDef[] = [
  { id: 'kevlar', name: 'Kevlar Vest', price: 650, desc: 'Armor 100' },
  { id: 'kevlarhelm', name: 'Kevlar + Helmet', price: 1000, desc: 'Armor 100 + helmet' },
  { id: 'defusekit', name: 'Defuse Kit', price: 400, team: 'CT', desc: 'Defuse 10s → 5s' },
]

// The six fixed CS 1.6 menu slots. Numbering is 1:1 with 1.6 for muscle memory:
// 1 pistols · 2 shotguns · 3 SMGs · 4 rifles · 5 machine guns · 6 equipment.
// Ammo categories (1.6's 7/8) intentionally omitted — modern CS refills on buy.
export type BuyMenuKey = 'pistol' | 'shotgun' | 'smg' | 'rifle' | 'heavy' | 'equipment'

export const BUY_MENU: ReadonlyArray<{ key: BuyMenuKey; label: string }> = [
  { key: 'pistol', label: 'PISTOLS' },
  { key: 'shotgun', label: 'SHOTGUNS' },
  { key: 'smg', label: 'SMGs' },
  { key: 'rifle', label: 'RIFLES' },
  { key: 'heavy', label: 'MACHINE GUNS' },
  { key: 'equipment', label: 'EQUIPMENT' },
]

const MENU_KEY: Record<WeaponCategory, BuyMenuKey> = {
  pistol: 'pistol', shotgun: 'shotgun', smg: 'smg', rifle: 'rifle',
  heavy: 'heavy', grenade: 'equipment', gear: 'equipment',
}

export interface BuyEntry {
  id: string
  kind: 'weapon' | 'gear'
  name: string
  price: number
  team?: TeamId
  menuKey: BuyMenuKey
}

// Derived single source for the buy menu: every priced weapon + all gear.
// Starters (glock/usp), knife and C4 are price 0 and never appear — later
// phases just add priced weapons and they slot in automatically.
// EQUIPMENT ordering is 1.6-style: armor gear first, then the grenades
// (weapons whose category routes to the equipment menu) in table order.
export const BUY_ENTRIES: BuyEntry[] = [
  ...Object.values(WEAPONS)
    .filter(w => w.price > 0 && MENU_KEY[w.category] !== 'equipment')
    .map(w => ({
      id: w.id, kind: 'weapon' as const, name: w.name, price: w.price,
      team: w.team, menuKey: MENU_KEY[w.category],
    })),
  ...GEAR.map(g => ({
    id: g.id, kind: 'gear' as const, name: g.name, price: g.price,
    team: g.team, menuKey: 'equipment' as const,
  })),
  ...Object.values(WEAPONS)
    .filter(w => w.price > 0 && MENU_KEY[w.category] === 'equipment')
    .map(w => ({
      id: w.id, kind: 'weapon' as const, name: w.name, price: w.price,
      team: w.team, menuKey: MENU_KEY[w.category],
    })),
]

export function buyEntriesFor(key: BuyMenuKey): BuyEntry[] {
  return BUY_ENTRIES.filter(e => e.menuKey === key)
}

export const PART_MULT: Record<HitPart, number> = { head: 4, body: 1, legs: 0.75 }

export const ECONOMY = {
  startMoney: 16000,
  maxMoney: 16000,
  winReward: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantBonus: 300,
  plantLossBonus: 800,
}

export const ROUND = {
  freezeMs: 8000,
  liveMs: 115000,
  bombMs: 40000,
  postMs: 6000,
  plantMs: 3200,
  defuseMs: 10000,
  buyWindowMs: 20000,
}

// ----------------------------------------------------- extension helpers
// Single place where Phase-1 optional-field defaults are resolved. Consumers
// call these instead of branching on field presence.

/** Trigger behavior; absent field falls back to the legacy auto boolean. */
export function fireModeOf(w: WeaponDef): FireMode {
  return w.fireMode ?? (w.auto ? 'auto' : 'semi')
}

/** Zoom steps; absent field falls back to the legacy scope boolean (1 level). */
export function scopeLevelsOf(w: WeaponDef): 0 | 1 | 2 {
  if (w.scopeLevels) return w.scopeLevels
  return w.scope ? 1 : 0
}

/** Pellets per trigger pull; 1 = single-ray ballistics (everything pre-Phase-6). */
export function pelletsOf(w: WeaponDef): number {
  return w.pellets && w.pellets > 1 ? w.pellets : 1
}

/** Shotgun pellet cone half-angle in degrees (0 = single ray). */
export function pelletSpreadOf(w: WeaponDef): number {
  return w.pelletSpread ?? 0
}

/** Scoped camera FOV; 16 preserves the engine's current AWP feel. */
export function zoomFovOf(w: WeaponDef): number {
  return w.zoomFov ?? 16
}

/** Negev-style spool (Phase 7): null = no ramp — spread is just `accurate`. */
export function accuracyRampOf(w: WeaponDef): { startSpread: number; shots: number } | null {
  return w.accuracyRamp ?? null
}

/** Phase 8: how many of this grenade one player may carry (plan 8.3 limits). */
export function grenadeLimitOf(w: WeaponDef): number {
  return w.throwable ? (w.maxCarry ?? 1) : 0
}

/** Class-based kill reward lookup (Phase 9 derives new weapons from class). */
export const KILL_REWARD_BY_CLASS: Record<KillRewardClass, number> = {
  pistol: 300, smg: 600, rifle: 300, shotgun: 900, heavy: 300,
  awp: 100, 'auto-sniper': 100, scout: 300, knife: 1500, grenade: 300,
}

export function computeDamage(
  w: WeaponDef, part: HitPart, dist: number, victimArmor: number, victimHelmet: boolean
): { dmg: number; armorDmg: number } {
  let dmg = w.damage * (part === 'head' ? w.hsMult : part === 'legs' ? w.legMult : 1)
  // helmet helps only vs head
  const hasArmor = part === 'head' ? victimArmor > 0 && victimHelmet : victimArmor > 0
  if (hasArmor) dmg *= w.armorPen
  // range falloff
  const steps = dist / 10
  dmg *= Math.pow(w.falloff10m, Math.floor(steps))
  if (part === 'head' && !hasArmor) dmg = Math.max(dmg, 100) // unarmored headshot with any gun is deadly-ish
  const armorDmg = hasArmor ? Math.min(victimArmor, dmg * 0.5) : 0
  return { dmg: Math.round(dmg), armorDmg: Math.round(armorDmg) }
}
