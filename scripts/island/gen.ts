// scripts/island/gen.ts — island map generator (Task 131).
// Emits: public/staging/maps/island/geom.json  (terrain + prop triangle soup,
//        per-vertex baked sun/AO light — same schema office consumes)
//        src/game/map-island.ts + mini-services/game-server/map-island.ts
//        (MapDef: staircase LOS boxes + prop collision boxes + waypoint
//        graph + sites/spawns/bounds; bsp.geomUrl -> staging per policy v3)
// Deterministic: fixed seeds, byte-identical output across runs.
import { writeFileSync, mkdirSync } from 'fs'
import { mulberry32, setTerrain, SUN, terrainShadowed } from './light'
import type { Group, Groups, PropBox } from './types'
import { groupOf, palm, rock, hut, pier, radar, rowboat, type PropOut } from './props'

// ---------------------------------------------------------------- constants
const SEED = 20261027
const OUT_DIR = 'public/staging/maps/island'
// island ellipse: rx=76, rz=60, sea level y=0
const RX = 76, RZ = 60
const HILL = { x: 14, z: 20, amp: 9.5, sig: 24 }        // A-site hill (radar on top)
const COVE = { x: -50, z: -2, amp: -5.5, sig: 13 }      // B-site cove carve
const VIL  = { x: 34, z: 34, y: 4.2, rx: 13, rz: 10 }    // T village pad — INLAND (v1 sat near the
// shoreline: the pad ring blended onto collapsing shore terrain and the
// 3-4 m step failed the WP slope rule on every side -> bots/players had
// no graph path in or out; moved inward onto solid dunes, pad 4.2 m)
const CTP  = { x: -4, z: -50, y: 1.7, rx: 14, rz: 11 }   // CT beach pad
const APAD = { x: 14, z: 20, y: 12.4, r: 10 }           // A radar pad (hill top)
const BPAD = { x: -46, z: 6, y: 1.2, r: 12 }            // B dock pad (cove shoulder — head of the cove, dry)
const PIER = { x: -50, z: 4, dirX: -0.28, dirZ: -0.96, len: 15, deckY: 1.15 }
const BOUNDS = { minX: -95, maxX: 95, minZ: -85, maxZ: 85 }
const RES = 2.0                                          // terrain render grid (m)
const RES_LOS = 2.5                                      // staircase LOS grid (m)

// ---------------------------------------------------------------- noise
function hash2(ix: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1)
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}
function fbm(x: number, z: number): number {
  return vnoise(x * 0.06, z * 0.06) * 1.0 + vnoise(x * 0.13 + 40, z * 0.13 + 40) * 0.5 + vnoise(x * 0.27 + 80, z * 0.27 + 80) * 0.25
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const gauss = (x: number, z: number, cx: number, cz: number, sig: number) =>
  Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * sig * sig))

// ---------------------------------------------------------------- heightfield
export function height(x: number, z: number): number {
  const e = Math.hypot(x / RX, z / RZ)                    // 0 center .. 1 island edge
  const shore = smoothstep(1.30, 0.90, e)                 // 1 inland, 0 open sea
  let h = -7.0 * (1 - shore)                               // sea floor rising to the coast
  const inland = smoothstep(0.95, 0.84, e)                 // 0 waterline .. 1 inland
  // gameplay pads stay SMOOTH: dune noise VARIATION is attenuated to zero
  // near each pad (buffer included) — around the fbm MEAN (0.875), not
  // around zero: v1 zeroed the whole noise term and SANK the cove shoreline
  // ~1.5 m below the walkable line, severing CT->B. Only the spikes die;
  // the average dune elevation stays.
  let noiseK = 1
  const padNoise = (cx: number, cz: number, rx: number, rz: number, buf: number) => {
    const r = Math.hypot((x - cx) / (rx + buf), (z - cz) / (rz + buf))
    noiseK = Math.min(noiseK, Math.max(0, Math.min(1, (r - 0.7) / 0.6)))
  }
  padNoise(APAD.x, APAD.z, APAD.r, APAD.r * 0.8, 8)
  padNoise(BPAD.x, BPAD.z, BPAD.r, BPAD.r, 8)
  padNoise(VIL.x, VIL.z, VIL.rx, VIL.rz, 8)
  padNoise(CTP.x, CTP.z, CTP.rx, CTP.rz, 8)
  const FBM_MEAN = 0.875
  h += inland * (1.15 + (FBM_MEAN + (fbm(x, z) - FBM_MEAN) * noiseK) * 2.35)   // dunes 1.1-3.5 m
  h += inland * HILL.amp * gauss(x, z, HILL.x, HILL.z, HILL.sig)
  h += inland * COVE.amp * gauss(x, z, COVE.x, COVE.z, COVE.sig)
  // pads: blend toward target heights (flatten for gameplay)
  const pad = (cx: number, cz: number, rx: number, rz: number, y: number, k: number) => {
    const w = smoothstep(1.0, 0.45, Math.hypot((x - cx) / rx, (z - cz) / rz))
    h = h + (y - h) * w * k
  }
  pad(APAD.x, APAD.z, APAD.r, APAD.r * 0.8, APAD.y, 0.9)
  pad(BPAD.x, BPAD.z, BPAD.r, BPAD.r, BPAD.y, 0.95)
  pad(VIL.x, VIL.z, VIL.rx, VIL.rz, VIL.y, 0.8)
  pad(CTP.x, CTP.z, CTP.rx, CTP.rz, CTP.y, 0.8)
  return h
}
setTerrain(height)

// ---------------------------------------------------------------- terrain build
const groups: Groups = new Map()
const propOut: PropOut = { boxes: [] }
const rnd = mulberry32(SEED)

// precompute node grid + baked light
const NX = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / RES) + 1
const NZ = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / RES) + 1
const nodeY = new Float64Array(NX * NZ)
const nodeL = new Float64Array(NX * NZ)
const ny = (ix: number, iz: number) => nodeY[ix * NZ + iz]

for (let ix = 0; ix < NX; ix++) {
  for (let iz = 0; iz < NZ; iz++) {
    const x = BOUNDS.minX + ix * RES, z = BOUNDS.minZ + iz * RES
    const h = height(x, z)
    nodeY[ix * NZ + iz] = h
    // bake: lambert from the terrain normal + horizon AO + sun shadow
    const hx = ny(Math.min(NX - 1, ix + 1), iz) - ny(Math.max(0, ix - 1), iz)
    const hz2 = ny(ix, Math.min(NZ - 1, iz + 1)) - ny(ix, Math.max(0, iz - 1))
    let nx2 = -hx / (2 * RES), nz2 = -hz2 / (2 * RES)
    const nl = Math.hypot(nx2, 1, nz2); nx2 /= nl; nz2 /= nl
    const lam = Math.max(0, nx2 * SUN[0] + (1 / nl) * SUN[1] + nz2 * SUN[2])
    let ao = 0
    for (let d = 0; d < 8; d++) {
      const a = (d / 8) * Math.PI * 2
      const dx = Math.cos(a), dz = Math.sin(a)
      for (let s = 1; s <= 9; s++) {
        const q = height(x + dx * s * 2.3, z + dz * s * 2.3)
        if (q > h + s * 2.3 * 0.42) { ao++; break }
      }
    }
    const aoF = 1 - ao / 8 * 0.55
    let l = (0.34 + 0.72 * lam) * aoF
    if (terrainShadowed([x, h, z])) l *= 0.48
    if (h < 0.35) l *= Math.max(0.30, (h + 4.2) / 4.55)     // wet/underwater gradient
    nodeL[ix * NZ + iz] = l
  }
}

// emit terrain quads — triangles (a,c,b)/(a,d,c) give +Y normals on flat
// ground (CCW seen from above); per-vertex baked light interpolates the
// 4 corner node lights, so AO gradients stay smooth across cell seams.
let tris = 0
const terrainLight = (ix: number, iz: number) => nodeL[Math.min(NX - 1, Math.max(0, ix)) * NZ + Math.min(NZ - 1, Math.max(0, iz))]
const corner = (ix: number, iz: number): number[] => [BOUNDS.minX + ix * RES, ny(ix, iz), BOUNDS.minZ + iz * RES]

function terrainQuad(ix: number, iz: number) {
  const c00 = corner(ix, iz), c10 = corner(ix + 1, iz), c11 = corner(ix + 1, iz + 1), c01 = corner(ix, iz + 1)
  if (Math.max(c00[1], c10[1], c11[1], c01[1]) < -5.8) return            // far deep sea — skip
  const slope = Math.max(
    Math.abs(ny(ix, iz) - ny(ix + 1, iz)), Math.abs(ny(ix, iz) - ny(ix, iz + 1)),
    Math.abs(ny(ix + 1, iz) - ny(ix + 1, iz + 1)), Math.abs(ny(ix, iz + 1) - ny(ix + 1, iz + 1))) / RES
  const hMid = (ny(ix, iz) + ny(ix + 1, iz + 1)) / 2
  let tex: string
  if (hMid < 3.4 && slope < 0.62) tex = 'isand'
  else if (slope < 0.58) tex = 'igrass'
  else tex = 'irock'
  const g = groupOf(groups, tex)
  const emitTri = (p0: number[], p1: number[], p2: number[], l0: number, l1: number, l2: number) => {
    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2]
    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2]
    let nx = e1y * e2z - e1z * e2y
    let nyy = e1z * e2x - e1x * e2z
    let nzz = e1x * e2y - e1y * e2x
    const L = Math.hypot(nx, nyy, nzz) || 1
    nx /= L; nyy /= L; nzz /= L
    const base = g.pos.length / 3
    for (const [p, l] of [[p0, l0], [p1, l1], [p2, l2]] as [number[], number][]) {
      g.pos.push(p[0], p[1], p[2]); g.norm.push(nx, nyy, nzz)
      g.uv.push(p[0] / 3, p[2] / 3); g.color.push(l, l, l)
    }
    g.idx.push(base, base + 1, base + 2)
    tris++
  }
  const la = terrainLight(ix, iz), lb = terrainLight(ix + 1, iz), lc = terrainLight(ix + 1, iz + 1), ld = terrainLight(ix, iz + 1)
  emitTri(c00, c11, c10, la, lc, lb)
  emitTri(c00, c01, c11, la, ld, lc)
}
for (let ix = 0; ix < NX - 1; ix++)
  for (let iz = 0; iz < NZ - 1; iz++)
    terrainQuad(ix, iz)

// ---------------------------------------------------------------- props
// palms: beach ring + village clusters (avoid pads' centers + slope>0.5)
const palmSpots: Array<[number, number]> = []
let guard = 0
while (palmSpots.length < 34 && guard++ < 3000) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd())
  const x = Math.cos(a) * rr * RX * 0.95, z = Math.sin(a) * rr * RZ * 0.95
  const h = height(x, z)
  if (h < 1.0 || h > 9.5) continue
  const s = Math.abs(height(x + 2, z) - h) + Math.abs(height(x, z + 2) - h)
  if (s > 1.6) continue
  if (Math.hypot(x - APAD.x, z - APAD.z) < APAD.r + 4) continue           // radar pad clear
  if (Math.hypot(x - BPAD.x, z - BPAD.z) < 7) continue                     // dock clear
  if (Math.hypot((x - VIL.x) / (VIL.rx + 4), (z - VIL.z) / (VIL.rz + 4)) < 0.55) continue   // village center clear (ring ok)
  if (Math.hypot(x - CTP.x, z - CTP.z) < 9) continue                       // CT spawn clear
  if (palmSpots.some(([px, pz]) => Math.hypot(px - x, pz - z) < 4.2)) continue
  palmSpots.push([x, z])
}
for (const [x, z] of palmSpots) palm(groups, propOut, x, z, height(x, z), rnd)

// rocks: cliff-line clusters + B-site breakwater
let rg = 0
let rockN = 0
while (rockN < 26 && rg++ < 2000) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd())
  const x = Math.cos(a) * rr * RX, z = Math.sin(a) * rr * RZ
  const h = height(x, z)
  if (h < -0.6 || h > 12) continue
  const s = Math.abs(height(x + 2, z) - h) + Math.abs(height(x, z + 2) - h)
  if (s < 1.7) continue                      // cliffs/steep only
  if (Math.hypot(x - APAD.x, z - APAD.z) < APAD.r + 3) continue
  if (Math.hypot(x - CTP.x, z - CTP.z) < 8) continue
  const r = 0.7 + rnd() * 1.6
  rock(groups, propOut, x, z, h, r, SEED + rockN * 7, r > 1.1)
  rockN++
}
// B cove breakwater — a fixed rock line sheltering the dock
for (let i = 0; i < 5; i++) {
  const bx = -62 + i * 2.1, bz = -8 - i * 1.3
  const h = height(bx, bz)
  if (h < -2.5) continue
  rock(groups, propOut, bx, bz, h, 1.3 + (i % 2) * 0.5, SEED + 900 + i * 13, true)
  rockN++
}

// huts: village (T side) x3 + one near B dock
hut(groups, propOut, VIL.x - 7, VIL.z - 4, height(VIL.x - 7, VIL.z - 4), 4.6, 3.8, SEED + 51)
hut(groups, propOut, VIL.x + 6.5, VIL.z + 3, height(VIL.x + 6.5, VIL.z + 3), 4.2, 3.6, SEED + 52)
hut(groups, propOut, VIL.x - 2, VIL.z + 11, height(VIL.x - 2, VIL.z + 11), 5.0, 4.4, SEED + 53)
hut(groups, propOut, BPAD.x + 5, BPAD.z + 12, height(BPAD.x + 5, BPAD.z + 12), 3.8, 3.4, SEED + 54)

// pier at the cove + rowboats (CT beach + one at the pier)
pier(groups, propOut, PIER.x, PIER.z, PIER.dirX, PIER.dirZ, PIER.len, PIER.deckY, SEED + 61)
rowboat(groups, propOut, CTP.x + 4.5, CTP.z - 3.5, height(CTP.x + 4.5, CTP.z - 3.5), 0.7, SEED + 71)
rowboat(groups, propOut, CTP.x - 5.5, CTP.z - 2.5, height(CTP.x - 5.5, CTP.z - 2.5), 2.4, SEED + 72)
rowboat(groups, propOut, PIER.x + PIER.dirX * 4, PIER.z + PIER.dirZ * 4 - 3.2, 0.35, 4.2, SEED + 73)

// radar station on the A pad
radar(groups, propOut, APAD.x, APAD.z, height(APAD.x, APAD.z), SEED + 81)

// ---------------------------------------------------------------- terrain boxes
// Task 131 hotfix #2 ("i fall to the ground in some places"): v1 shipped ONLY
// the hMin > 1.25 stairs as colliders/LOS — the B dock pad (BPAD.y=1.2), the
// whole beach ring and the CT->B shoreline corridor had NO boxes, so the
// client player fell through the world there (failsafe y<-6 yanked them
// back to CT spawn) and server-sim grenades sank into the void at B.
// Split the two consumers:
//   colBoxes (client player colliders) — EVERY rendered cell; the skip is
//     terrainQuad's own deep-sea rule (all 4 corners < -5.8 = no ground
//     drawn = no ground to stand on). No collision where there is no floor.
//   losBoxes (server LOS + grenade floors) — gains the 0.95-1.25 walkable
//     band so nades get floors on B/beach. Vision-safe: band tops are
//     <= 1.03 < crouch eye 1.08, and every hasLOS endpoint (hit validation,
//     bot vision, HE/flash/defuse) sits at eye height or higher, so no
//     standing/crouching eye-to-eye ray can be blocked by the new members.
// hMin > 1.25 cells keep the EXACT v1 formula (byte-identical stairs);
// new cells use bot = top - 9 — the Y-sweep landing test reads
// feet+h > c.min.y at END of frame, so slabs must be thicker than the
// worst-frame fall span (vel cap 35 * dt cap 0.1 = 3.5m) minus player
// height (1.8m) => >= 1.7m; 9m leaves margin and the deep bottoms are
// invisible (BSP maps render geom.json, boxes are collision-only).
//
// Task 131 hotfix #3 ("an invisible object blocks me — I have to jump to
// bypass it, but there is nothing in my way"): colliders are STAIRCASES.
// A slope is a ladder of flat-top boxes, so walking uphill walks into the
// VERTICAL FACE of the next-higher cell; the client auto-steps rises <=
// STEP_UP 0.55 (engine.ts), anything taller is a wall. With subdivision
// stopping at corner variance 0.9, moderate slopes (12-36 deg — the A-hill
// flanks ~13.5 deg, cove walls ~14.4 deg, pad shoulders, the wading ring)
// kept their 2.5/1.25 m cells and left 0.55-0.9 m steps = invisible walls
// on smooth-looking ground (step-study.ts measured 3914 blocked walkable
// steps incl 1700 invisible ones and 202 BLOCKED NAVGRAPH EDGES — bots
// path fine but players had to bunny-jump the routes). FIX, two parts:
//   colBoxes: above chest depth the adaptive subdivision tightens from
//     variance > 0.9 to > 0.5 — a variance-stopped cell's planar step is
//     <= 0.5 < STEP_UP, so every slope <= ~41 deg walks smooth (navgraph
//     terrain is <= 34 deg by the WP slope rule). Top-level cells whose
//     min corner is <= -2.5 m (chest-deep sea; the failsafe yanks at feet
//     -6 and nobody fights out there) FREEZE to the hotfix-2 variance-0.9
//     tree — the `fine` flag is decided once at the 2.5 m parent so the
//     deep band stays byte-identical to the verified state. Every terrain
//     collider carries stair:true.
//   engine.ts: the step-up limit is PER BOX — stair:true boxes climb up to
//     STAIR_CLIMB 0.95 (variance-stopped cells cannot produce taller planar
//     steps; the > 0.95 residue is the 60 deg SE-shore cliff band, which
//     SHOULD block). Props and BSP maps carry no flag and keep the CS 0.55
//     step — office crates still require a jump.
// losBoxes STAY the hotfix-2 set BIT-FOR-BIT (same variance-0.9 tree, same
// hMin > 0.95 membership, same order — collider-probe.ts re-derives the
// tree and asserts this). The server's hasLOS is a brute-force ray loop
// over the array (game-server/index.ts) and the committed set is
// live-verified; finer members would only double server vision cost and
// add new crouch-eye blockers (children of low parents can have tops > 1.03
// = above crouch eye 1.08).
const losBoxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; tex: string }> = []
const colBoxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; tex: string; stair?: true }> = []
const step = RES_LOS
const corners = (x: number, z: number, size: number): [number, number, number, number, number, number] => {
  const h0 = height(x, z), h1 = height(x + size, z), h2 = height(x, z + size), h3 = height(x + size, z + size)
  return [h0, h1, h2, h3, Math.min(h0, h1, h2, h3), Math.max(h0, h1, h2, h3)]
}
// player-collider staircase — fine (variance > 0.5) above chest depth,
// hotfix-2 tree (variance > 0.9) below; every box flagged stair:true so
// engine.ts may auto-step up to 0.95 (see header). bot depth: the Y-sweep
// landing test needs slabs thicker than the worst-frame fall span
// (35 m/s * 0.1 dt = 3.5 m) minus player height => 9 m slabs below 1.25,
// v1's top-7 above (byte-identical flat high cells).
const emitColBox = (x: number, z: number, size: number, fine: boolean): void => {
  const [h0, h1, h2, h3, hMin, hMax] = corners(x, z, size)
  if (hMax < -5.8) return                    // == terrainQuad deep-sea skip
  if (hMax - hMin > (fine ? 0.5 : 0.9) && size > 0.7) {
    const s2 = size / 2
    emitColBox(x, z, s2, fine); emitColBox(x + s2, z, s2, fine); emitColBox(x, z + s2, s2, fine); emitColBox(x + s2, z + s2, s2, fine)
    return
  }
  const top = hMin - 0.22
  const bot = hMin > 1.25 ? Math.max(0.2, top - 7) : top - 9
  colBoxes.push({ x: x + size / 2, y: (top + bot) / 2, z: z + size / 2, w: size + 0.05, h: top - bot, d: size + 0.05, tex: 'irock', stair: true })
}
for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += step) {
  for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += step) {
    const [h0, h1, h2, h3, , hMax] = corners(x, z, step)
    if (hMax < -5.8) continue                // deep sea: no floor drawn, none to stand on
    emitColBox(x, z, step, Math.min(h0, h1, h2, h3) > -2.5)
  }
}
// server LOS + grenade-floor staircase — EXACT hotfix-2 emission (variance
// 0.9 tree, hMin > 0.95 membership, traversal order preserved so the array
// is byte-identical; collider-probe.ts asserts this after every regen).
const emitLosBox = (x: number, z: number, size: number): void => {
  const [, , , , hMin, hMax] = corners(x, z, size)
  if (hMax < -5.8) return
  if (hMax - hMin > 0.9 && size > 0.7) {
    const s2 = size / 2
    emitLosBox(x, z, s2); emitLosBox(x + s2, z, s2); emitLosBox(x, z + s2, s2); emitLosBox(x + s2, z + s2, s2)
    return
  }
  if (hMin <= 0.95) return                  // committed walkable-band rule
  const top = hMin - 0.22
  const bot = hMin > 1.25 ? Math.max(0.2, top - 7) : top - 9
  losBoxes.push({ x: x + size / 2, y: (top + bot) / 2, z: z + size / 2, w: size + 0.05, h: top - bot, d: size + 0.05, tex: 'irock' })
}
for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += step) {
  for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += step) {
    emitLosBox(x, z, step)
  }
}

// ---------------------------------------------------------------- waypoints
const WP_RES = 2.2
interface WP { id: string; x: number; z: number; y: number }
const wps: WP[] = []
const propBlocked = (x: number, z: number) => {
  for (const b of propOut.boxes) {
    if (Math.abs(x - b.x) < b.w / 2 + 0.55 && Math.abs(z - b.z) < b.d / 2 + 0.55 && b.h > 1.6) return true
  }
  return false
}
for (let x = BOUNDS.minX + 2; x < BOUNDS.maxX; x += WP_RES) {
  for (let z = BOUNDS.minZ + 2; z < BOUNDS.maxZ; z += WP_RES) {
    const h = height(x, z)
    if (h < 0.95) continue
    const s = Math.abs(height(x + WP_RES, z) - h) + Math.abs(height(x, z + WP_RES) - h)
    if (s > 1.5) continue
    if (propBlocked(x, z)) continue
    wps.push({ id: `w${wps.length}`, x, z, y: h })
  }
}
// pier deck waypoints (y = deck height)
for (let i = 0; i <= 5; i++) {
  const t = (i / 5) * PIER.len
  wps.push({ id: `w${wps.length}`, x: PIER.x + PIER.dirX * t, z: PIER.z + PIER.dirZ * t, y: PIER.deckY })
}
// edges: 8-neighborhood
const edges: Array<[string, string]> = []
const linked = new Set<string>()
for (let i = 0; i < wps.length; i++) {
  for (let j = i + 1; j < wps.length; j++) {
    const dx = wps[i].x - wps[j].x, dz = wps[i].z - wps[j].z
    const d2 = dx * dx + dz * dz
    if (d2 > (WP_RES * 1.35) ** 2) continue
    if (Math.abs(wps[i].y - wps[j].y) > 1.1) continue
    const k = `${i}-${j}`
    if (linked.has(k)) continue
    linked.add(k)
    edges.push([wps[i].id, wps[j].id])
  }
}
// chain the pier waypoints explicitly (3 m spacing exceeds the auto-link radius)
for (let i = wps.length - 6; i < wps.length - 1; i++) edges.push([wps[i].id, wps[i + 1].id])
// purge isolated waypoints (0 edges): pockets wedged between hut walls trap
// nearest-WP picks for spawns/bots — a WP nobody can walk to is a bug
const degree = new Map<string, number>()
for (const w of wps) degree.set(w.id, 0)
for (const [a, b] of edges) { degree.set(a, degree.get(a)! + 1); degree.set(b, degree.get(b)! + 1) }
const keep = new Set(wps.filter(w => (degree.get(w.id) ?? 0) > 0).map(w => w.id))
const wpFinal = wps.filter(w => keep.has(w.id))
const edgeFinal = edges.filter(([a, b]) => keep.has(a) && keep.has(b))
console.log(`waypoint purge: ${wps.length - wpFinal.length} isolated dropped (0 edges)`)

// ---------------------------------------------------------------- assemble + emit
const propBoxes = propOut.boxes.map((b: PropBox) => ({ ...b, tex: 'plank' as string }))
const allBoxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; tex: string; stair?: true }> = [
  ...colBoxes,   // player colliders (every rendered cell, stair:true — engine may step 0.95)
  ...propBoxes,
]
const allLos: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; tex: string }> = [
  ...losBoxes,   // server LOS + grenade floors (hotfix-2 tree, hMin > 0.95 + props)
  ...propBoxes,
]
const padH = (cx: number, cz: number) => height(cx, cz)
const siteA = { x: APAD.x, z: APAD.z, r: 9, y: padH(APAD.x, APAD.z) }
const siteB = { x: BPAD.x, z: BPAD.z, r: 9, y: padH(BPAD.x, BPAD.z) }
// spawn placement with CLEARANCE: the hand-placed T spots landed inside hut
// wall footprints (village pads host the huts) — spawn points must come out
// ≥ 1.6 m clear of every tall prop box and ≥ 2.2 m apart. Spiral search.
const tallProps = propOut.boxes.filter(b => b.h > 1.6)
const isClear = (x: number, z: number, margin: number) =>
  tallProps.every(b => Math.abs(x - b.x) >= b.w / 2 + margin || Math.abs(z - b.z) >= b.d / 2 + margin)
const findSpots = (cx: number, cz: number, count: number): Array<{ x: number; y: number; z: number }> => {
  const out: Array<{ x: number; y: number; z: number }> = []
  for (let ring = 0; ring < 40 && out.length < count; ring++) {
    const r = 1.5 + ring * 1.1
    const steps = Math.max(1, Math.round(r * 2.6))
    for (let s = 0; s < steps && out.length < count; s++) {
      const a = (s / steps) * Math.PI * 2 + ring * 0.61
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      const h = height(x, z)
      if (h < 0.95) continue                                  // must be dry land
      if (Math.abs(height(x + 1.5, z) - h) + Math.abs(height(x, z + 1.5) - h) > 1.0) continue  // flat enough
      if (!isClear(x, z, 1.6)) continue
      if (out.some(p => Math.hypot(p.x - x, p.z - z) < 2.2)) continue
      out.push({ x, y: h, z })
    }
  }
  if (out.length < count) throw new Error(`spawn placement failed at ${cx},${cz}: ${out.length}/${count}`)
  return out
}
const spawns = {
  CT: findSpots(CTP.x, CTP.z, 5),
  T: findSpots(VIL.x, VIL.z, 5),
}
mkdirSync(OUT_DIR, { recursive: true })
// round emitted floats — full double precision stringifies ~17 digits and
// blew geom.json up to 30 MB (office ships 2.45 MB at the same scale).
// pos: cm, uv/color: cm-grade too (light steps of 0.01 are invisible);
// norm intentionally OMITTED — mapview computes flat vertex normals for
// norm-less groups (our tris share no vertices => identical flat shading)
const R3 = (v: number) => Math.round(v * 100) / 100
const R1 = (v: number) => Math.round(v * 10) / 10
const geom = { groups: [...groups.values()].map(g => ({ tex: g.tex, pos: g.pos.map(R1), uv: g.uv.map(R3), color: g.color.map(R3), idx: g.idx })) }
writeFileSync(`${OUT_DIR}/geom.json`, JSON.stringify(geom))
// client copy — same JSON-module trick as the server copy: inline object
// literals make tsc explode with TS2590 (union too complex; office's 9.6k
// box literals pass and this 1.7k fails — checker budget is order-dependent,
// not worth fighting). resolveJsonModule is on; Next bundles JSON natively.
const boxOut = (bs: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; tex: string; stair?: true }>) =>
  bs.map(b => ({ ...b, x: R3(b.x), y: R3(b.y), z: R3(b.z), w: R3(b.w), h: R3(b.h), d: R3(b.d) }))
writeFileSync('src/game/map-island-data.json', JSON.stringify({
  boxes: boxOut(allBoxes),
  losBoxes: boxOut(allLos),
  spawns: { CT: spawns.CT.map(s => ({ x: R3(s.x), y: R3(s.y), z: R3(s.z) })), T: spawns.T.map(s => ({ x: R3(s.x), y: R3(s.y), z: R3(s.z) })) },
  sites: { A: { x: R3(siteA.x), z: R3(siteA.z), r: siteA.r, y: R3(siteA.y) }, B: { x: R3(siteB.x), z: R3(siteB.z), r: siteB.r, y: R3(siteB.y) } },
  waypoints: wpFinal.map(w => ({ id: w.id, x: R3(w.x), z: R3(w.z), y: R3(w.y) })),
  waypointEdges: edgeFinal,
}))
writeFileSync('src/game/map-island.ts', `// GENERATED by scripts/island/gen.ts (Task 131) — do not edit
// Client copy: big arrays live in map-island-data.json (TS2590 — see gen.ts).
import type { MapDef, Box, WP, Vec3, SiteDef } from './mapdata'
import data from './map-island-data.json'

const boxes = data.boxes as unknown as Box[]
const losBoxes = data.losBoxes as unknown as Box[]
const waypoints = data.waypoints as unknown as WP[]
const spawns = data.spawns as unknown as { CT: Vec3[]; T: Vec3[] }
const sites = data.sites as unknown as { A: SiteDef; B: SiteDef }
const edges = data.waypointEdges as unknown as Array<[string, string]>

export const ISLAND: MapDef = {
  id: 'island',
  name: 'Island',
  version: 1,
  bsp: { geomUrl: '/assets/maps/island/geom.json' },   // ACCEPTED (Task 132): island promoted staging->assets, same as office in Task 130
  boxes,
  losBoxes,
  spawns,
  spawnYaw: { CT: ${Math.PI}, T: 0 },
  sites,
  bomb: true,
  waypoints,
  waypointEdges: edges,
  bounds: ${JSON.stringify(BOUNDS)},
}
`)
// server copy — NO bsp (the headless server never fetches render geometry,
// same as the office server copy). The big arrays ship as a JSON module
// instead of TS object literals: tsc builds a literal-type union from
// inline literals and chokes with TS2590 on this one (the identical client
// file passes, the identical-shaped office file passes — checker budget
// quirk not worth fighting; JSON imports widen to number/string and never
// build the union). Bun loads JSON natively; resolveJsonModule is on.
const srvData = {
  boxes: boxOut(allBoxes),
  losBoxes: boxOut(allLos),
  spawns: { CT: spawns.CT.map(s => ({ x: R3(s.x), y: R3(s.y), z: R3(s.z) })), T: spawns.T.map(s => ({ x: R3(s.x), y: R3(s.y), z: R3(s.z) })) },
  sites: { A: { x: R3(siteA.x), z: R3(siteA.z), r: siteA.r, y: R3(siteA.y) }, B: { x: R3(siteB.x), z: R3(siteB.z), r: siteB.r, y: R3(siteB.y) } },
  waypoints: wpFinal.map(w => ({ id: w.id, x: R3(w.x), z: R3(w.z), y: R3(w.y) })),
  waypointEdges: edgeFinal,
}
writeFileSync('mini-services/game-server/map-island-data.json', JSON.stringify(srvData))
writeFileSync('mini-services/game-server/map-island.ts', `// GENERATED by scripts/island/gen.ts (Task 131) — do not edit
// Server copy: no bsp (headless server never fetches render geometry); big
// arrays live in map-island-data.json (see gen.ts for the TS2590 rationale).
import type { MapDef, Box, WP, Vec3, SiteDef } from './mapdata'
import data from './map-island-data.json'

const boxes = data.boxes as unknown as Box[]
const losBoxes = data.losBoxes as unknown as Box[]
const waypoints = data.waypoints as unknown as WP[]
const spawns = data.spawns as unknown as { CT: Vec3[]; T: Vec3[] }
const sites = data.sites as unknown as { A: SiteDef; B: SiteDef }
const edges = data.waypointEdges as unknown as Array<[string, string]>

export const ISLAND: MapDef = {
  id: 'island',
  name: 'Island',
  version: 1,
  boxes,
  losBoxes,
  spawns,
  spawnYaw: { CT: ${Math.PI}, T: 0 },
  sites,
  bomb: true,
  waypoints,
  waypointEdges: edges,
  bounds: ${JSON.stringify(BOUNDS)},
}
`)

// ---------------------------------------------------------------- stats
const grpStats = [...groups.values()].map(g => `${g.tex}(${(g.idx.length / 3).toFixed(0)})`).join(' ')
console.log(`terrain+prop tris: ${tris + [...groups.values()].reduce((a, g) => a + g.idx.length / 3, 0) - tris}`)
console.log(`groups: ${grpStats}`)
const fineN = colBoxes.filter(b => b.stair).length
const sizeN = (s: number) => colBoxes.filter(b => Math.abs(b.w - (s + 0.05)) < 0.001).length
console.log(`terrain collider boxes: ${colBoxes.length} (all stair-flagged: 2.5m ${sizeN(2.5)}, 1.25m ${sizeN(1.25)}, 0.625m ${sizeN(0.625)}), losBoxes members: ${losBoxes.length} (hotfix-2 tree, unchanged), prop boxes: ${propOut.boxes.length}, total boxes: ${allBoxes.length}, losBoxes: ${allLos.length}`)
console.log(`waypoints: ${wpFinal.length} (purged ${wps.length - wpFinal.length}), edges: ${edgeFinal.length}`)
console.log(`palms: ${palmSpots.length}, rocks: ${rockN}`)
console.log(`A site: ${JSON.stringify(siteA)}  B site: ${JSON.stringify(siteB)}`)
console.log(`CT spawn[0]: ${JSON.stringify(spawns.CT[0])}  T spawn[0]: ${JSON.stringify(spawns.T[0])}`)
console.log(`geom.json: ${(JSON.stringify(geom).length / 1e6).toFixed(2)} MB`)
// sanity: no NaN anywhere
const bad = [...groups.values()].some(g => g.pos.some(v => !Number.isFinite(v))) || wps.some(w => !Number.isFinite(w.y))
console.log(bad ? '!! NaN DETECTED !!' : 'sanity: all finite OK')
// sanity: every emitted collider box must be finite + have sane extent
const badBox = allBoxes.some(b => ![b.x, b.y, b.z, b.w, b.h, b.d].every(Number.isFinite) || b.w <= 0 || b.h <= 0 || b.d <= 0)
console.log(badBox ? '!! BAD BOX DETECTED !!' : 'sanity: all boxes finite/positive OK')
