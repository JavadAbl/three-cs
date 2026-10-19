// ============================================================
// Grenade systems module — Phase 8 (WEAPONS_PLAN 8.1-8.2)
// ============================================================
// ONE module, THREE consumers, all reading the SAME numbers:
//  * SERVER (mini-services/game-server/index.ts) — spawns entities, runs
//    the authoritative 20 Hz physics tick (stepNade), detonates effects
//    (HE radial damage, flash blind, smoke volumes, fire zones, decoys).
//  * CLIENT (src/game/engine.ts) — renders projectiles with the identical
//    dead-reckoning math (gravity/drag) so world grenades fly smooth
//    between 20 Hz snapshots, and drives the flash overlay timing.
//  * TESTS (scripts/test-phase8*.ts) — every formula asserted exactly.
//
// Physics determinism: stepNade uses plain float arithmetic only (no
// PRNG, no Date), so browser V8 and bun/jsc step the same entity to the
// same place from the same inputs — the same contract shared/pellets.ts
// established for the pellet fan.

import type { WeaponDef } from './weapons'

export type GrenadeKind = 'he' | 'flash' | 'smoke' | 'molotov' | 'inc' | 'decoy'

/** Every tunable the grenade subsystem reads. CS:GO-flavoured values. */
export const NADE = {
  // --- projectile physics (plan 8.1: gravity, drag, bounce, rest) ---
  gravity: 18,          // m/s² (floatier than the player's 22 — CS grenades arc)
  drag: 0.2,            // linear velocity damping per second
  restitution: 0.45,    // bounce energy keep per axis
  radius: 0.09,         // collision sphere radius (m)
  throwV: 22,           // LMB full throw muzzle speed (m/s)
  lobV: 11,             // RMB underhand lob speed (m/s)
  throwCooldownMs: 900, // server + client throw gate
  // --- fuses ---
  heFuseMs: 1600,       // HE/flash detonate mid-air on this timer
  flashFuseMs: 1600,
  smokePopAfterRestMs: 400, // smoke pops shortly after coming to rest
  mollyFuseMs: 2500,    // molotov hard fuse; ground contact ignites earlier
  lifetimeMs: 12000,    // failsafe despawn for a pathologically stuck nade
  restSpeed: 0.55,      // below this speed while supported → rest
  bounceSfxMinV: 2,     // server only broadcasts bounces harder than this
  // --- HE (plan 8.2: $300, radial falloff + LOS, killReward $300) ---
  heRadius: 9,          // damage falls to zero here
  heExp: 1.35,          // falloff exponent (gentle near center, steep at edge)
  // --- flash (plan 8.2: $200, max 2, distance + facing + LOS) ---
  flashRadius: 28,      // no blind beyond this
  flashMaxMs: 5200,     // point-blank, staring at it
  flashSideMul: 0.35,   // looking fully away still catches peripheral blind
  // --- smoke (plan 8.2: 18 s, opaque to hit-validation LOS + bot vision) ---
  smokeMs: 18000,
  smokeRadius: 3.6,     // visual cloud radius
  smokeCoreR: 2.7,      // the opaque core LOS segments must not enter
  smokePopInMs: 300,    // blind window before the cloud blocks (pop-in)
  smokeFadeMs: 1000,    // tail where the cloud stops blocking (visual fades)
  smokeExtinguishR: 2.8,// a popping smoke kills fires within this (plan 8.2 stretch)
  // --- molotov / incendiary (plan 8.2: ground fire zone, DoT, burn-out) ---
  fireMs: 7000,
  fireRadius: 2.7,
  fireTickMs: 500,
  fireTickDmg: 8,       // ≈40 dps, armor does not help (CS fire ignores armor)
  fireHeight: 1.6,      // victims must be this close vertically
  // --- decoy (plan 8.2: fire-sound loop at landing spot) ---
  decoyMs: 30000,       // shortened from CS:GO's 90 s for pace; plan marks decoy optional
  decoyShotMinMs: 1100,
  decoyShotMaxMs: 1900,
} as const

// ---------------------------------------------------------------- HE math

/**
 * HE damage at `dist` meters from the blast (armor = vest or helmet — the
 * blast hits the body; CS:GO armor eats roughly half). Walls are handled
 * by the SERVER LOS gate, not here (binary full-block per plan 8.2).
 */
export function heDamage(dist: number, hasArmor: boolean, w?: WeaponDef): number {
  const maxDmg = w?.damage ?? 98
  const armorMul = w ? (hasArmor ? w.armorPen : 1) : (hasArmor ? 0.5 : 1)
  const t = Math.max(0, 1 - dist / NADE.heRadius)
  if (t <= 0) return 0
  return Math.round(maxDmg * Math.pow(t, NADE.heExp) * armorMul)
}

// ---------------------------------------------------------------- flash math

/** View direction from server yaw/pitch — matches the client camera exactly. */
export function viewDirFromYawPitch(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cy = Math.cos(pitch)
  return { x: -Math.sin(yaw) * cy, y: Math.sin(pitch), z: -Math.cos(yaw) * cy }
}

/**
 * Flash blind duration (ms). `facingDot` = dot(victim view dir, dir victim→flash):
 * +1 staring straight at it, 0 sideways, -1 looking directly away.
 * LOS is the server's job (walls fully block per plan 8.2).
 */
export function flashBlindMs(dist: number, facingDot: number): number {
  const t = Math.max(0, 1 - dist / NADE.flashRadius)
  if (t <= 0) return 0
  const distFactor = Math.pow(t, 1.1)
  // facing: full blind when dot > 0.4; ramps down to the peripheral floor
  // between 0.4 and -0.2; fully turned away keeps ~35% (CS:GO peripheral)
  let facingMul: number
  if (facingDot >= 0.4) facingMul = 1
  else if (facingDot <= -0.2) facingMul = NADE.flashSideMul
  else facingMul = NADE.flashSideMul + (1 - NADE.flashSideMul) * (facingDot + 0.2) / 0.6
  return Math.round(NADE.flashMaxMs * distFactor * facingMul)
}

// ---------------------------------------------------------------- smoke LOS

/** Distance from point p to the segment a→b (3D). */
export function segDist(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  px: number, py: number, pz: number
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const len2 = abx * abx + aby * aby + abz * abz
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz
  return Math.hypot(cx, cy, cz)
}

/** Is this LOS segment blocked by one smoke's opaque core? */
export function smokeBlocksSeg(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  smoke: { x: number; y: number; z: number }
): boolean {
  return segDist(ax, ay, az, bx, by, bz, smoke.x, smoke.y, smoke.z) < NADE.smokeCoreR
}

// ---------------------------------------------------------------- physics

/**
 * Map-agnostic AABB source. Server passes losBoxes ({x,y,z,w,h,d} centers);
 * the min/max conversion happens here once.
 */
export interface NadeBox { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }

export function toNadeBoxes(boxes: ReadonlyArray<{ x: number; y: number; z: number; w: number; h: number; d: number }>): NadeBox[] {
  return boxes.map(b => ({
    min: { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
    max: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 },
  }))
}

export interface NadeEnt {
  id: number
  kind: GrenadeKind
  weapon: string          // WeaponId of the thrown item (kill credit)
  owner: string           // playerId
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  bornAt: number          // ms, server clock
  restAt: number | null   // ms when it came to rest (null while flying)
  bounces: number
  lastBounceSfxAt?: number // server-side sfx throttle (not part of determinism)
}

/** Events one physics step can emit — the server turns these into sfx/fuse logic. */
export type NadeStepEvent =
  | { kind: 'bounce'; axis: 'x' | 'y' | 'z'; speed: number } // speed = impact speed on that axis
  | { kind: 'ground' }    // touched a floor/box-top (molotovs ignite on this)
  | { kind: 'rest' }      // speed dropped below restSpeed while supported

/**
 * Advance one grenade by dt seconds against the pre-converted AABB list.
 * Mutates the entity (position + velocity); returns the events. Pure float
 * math — deterministic across runtimes. Ground plane at y=0 is a failsafe
 * (maps carry real floor boxes; the plane catches out-of-map drops).
 */
export function stepNade(n: NadeEnt, dt: number, boxes: readonly NadeBox[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): NadeStepEvent[] {
  const events: NadeStepEvent[] = []
  const r = NADE.radius

  // speed ENTERING the step (post-gravity would read ~g*dt even at rest)
  const speedBefore = Math.hypot(n.vx, n.vy, n.vz)

  // gravity + linear drag
  n.vy -= NADE.gravity * dt
  const damp = Math.max(0, 1 - NADE.drag * dt)
  n.vx *= damp; n.vy *= damp; n.vz *= damp

  const overlaps = (b: NadeBox) =>
    n.x + r > b.min.x && n.x - r < b.max.x &&
    n.y + r > b.min.y && n.y - r < b.max.y &&
    n.z + r > b.min.z && n.z - r < b.max.z

  // ---- axis-separated integrate + resolve (mirrors the player's mover) ----
  n.x += n.vx * dt
  for (const b of boxes) {
    if (!overlaps(b)) continue
    const impact = Math.abs(n.vx)
    // push out toward the side we came from (velocity direction; if
    // resting with v=0 the nearer face wins, which is all it needs)
    if (n.vx > 0 || (n.vx === 0 && n.x < (b.min.x + b.max.x) / 2)) n.x = b.min.x - r - 0.001
    else n.x = b.max.x + r + 0.001
    n.vx = -n.vx * NADE.restitution
    if (impact >= 0.01) { n.bounces++; events.push({ kind: 'bounce', axis: 'x', speed: impact }) }
  }

  n.z += n.vz * dt
  for (const b of boxes) {
    if (!overlaps(b)) continue
    const impact = Math.abs(n.vz)
    if (n.vz > 0 || (n.vz === 0 && n.z < (b.min.z + b.max.z) / 2)) n.z = b.min.z - r - 0.001
    else n.z = b.max.z + r + 0.001
    n.vz = -n.vz * NADE.restitution
    if (impact >= 0.01) { n.bounces++; events.push({ kind: 'bounce', axis: 'z', speed: impact }) }
  }

  n.y += n.vy * dt
  // world floor failsafe
  if (n.y < r) {
    n.y = r
    if (n.vy < 0) {
      events.push({ kind: 'ground' })
      const impact = Math.abs(n.vy)
      n.vy = impact < 1.2 ? 0 : impact * NADE.restitution
      n.vx *= 0.75; n.vz *= 0.75
      if (impact >= 0.01) events.push({ kind: 'bounce', axis: 'y', speed: impact })
    }
  }
  for (const b of boxes) {
    if (!overlaps(b)) continue
    const impact = Math.abs(n.vy)
    if (n.vy <= 0) {
      // falling onto a box top. Slow impacts SETTLE (vy = 0) instead of
      // bouncing — discrete gravity (g·dt = 0.9 m/s) would otherwise keep
      // a resting nade micro-bouncing above restSpeed forever.
      n.y = b.max.y + r + 0.001
      n.vy = impact < 1.2 ? 0 : -n.vy * NADE.restitution
      // surface friction: ground contact bleeds horizontal speed (bounces
      // and slides), so throws don't roll across the whole map
      n.vx *= 0.75; n.vz *= 0.75
      events.push({ kind: 'ground' })
    } else {
      // rising into a ceiling
      n.y = b.min.y - r - 0.001
      n.vy = -n.vy * NADE.restitution
    }
    if (impact >= 0.01) { n.bounces++; events.push({ kind: 'bounce', axis: 'y', speed: impact }) }
  }
  // map bounds reflect
  if (n.x < bounds.minX + r) { n.x = bounds.minX + r; n.vx = Math.abs(n.vx) * NADE.restitution; events.push({ kind: 'bounce', axis: 'x', speed: Math.abs(n.vx) }) }
  else if (n.x > bounds.maxX - r) { n.x = bounds.maxX - r; n.vx = -Math.abs(n.vx) * NADE.restitution; events.push({ kind: 'bounce', axis: 'x', speed: Math.abs(n.vx) }) }
  if (n.z < bounds.minZ + r) { n.z = bounds.minZ + r; n.vz = Math.abs(n.vz) * NADE.restitution; events.push({ kind: 'bounce', axis: 'z', speed: Math.abs(n.vz) }) }
  else if (n.z > bounds.maxZ - r) { n.z = bounds.maxZ - r; n.vz = -Math.abs(n.vz) * NADE.restitution; events.push({ kind: 'bounce', axis: 'z', speed: Math.abs(n.vz) }) }

  // rest detection: supported (touching a top or the floor plane) + slow
  const supported =
    n.y <= r + 0.02 ||
    boxes.some(b => n.x + r > b.min.x && n.x - r < b.max.x &&
      Math.abs(n.y - (b.max.y + r)) < 0.03 &&
      n.z + r > b.min.z && n.z - r < b.max.z)
  if (supported && speedBefore < NADE.restSpeed && n.restAt === null) {
    events.push({ kind: 'rest' })
  }
  return events
}
