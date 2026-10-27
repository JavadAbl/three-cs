// scripts/island/collider-probe.ts — Task 131 hotfix probe.
// Question: does the player have GROUND under their feet everywhere the
// terrain looks walkable? The island terrain colliders are the staircase
// boxes emitted by gen.ts; gen.ts's `if (hMin <= 1.25) continue` skips
// whole cells (B dock pad y=1.2 is under that threshold!). This probe
// classifies, per walkable sample point:
//   OK    - a collider box top sits within 1.2 m below the visual surface
//   PIT   - box top more than 1.2 m under the surface (player sinks into a pit)
//   VOID  - NO box covers the XZ at all (player falls through the world,
//           failsafe y<-6 teleports them back to CT spawn)
// Task 131 hotfix #3 gates ("invisible walls"):
//   WALL  - the next terrain cell's collider rises above the engine's step
//           limit (stair ? 0.95 : 0.55) while the visible terrain rises less
//           than 0.7 slope (~35 deg) and the collider exceeds the visible
//           rise by > 0.2 m — the player is walled off by nothing they can see
//   EDGE  - a navgraph edge (bot route = player route) with a step above the
//           stair limit
//   LOS   - emitted losBoxes must stay the committed hotfix-2 tree
//           bit-for-bit (independent re-derivation; the server's hasLOS is
//           a brute-force loop over this array — vision must not drift)
// Run: bun scripts/island/collider-probe.ts
import { readFileSync } from 'fs'
import { height } from './gen'   // side effect: deterministic regen (byte-identical)
// NB: read the emitted JSONs at RUNTIME (readFileSync below), not via static
// imports — Bun parses the whole import graph BEFORE evaluating gen.ts's
// regen side effect, so static JSON imports would return LAST run's files.
const data = JSON.parse(readFileSync('src/game/map-island-data.json', 'utf8'))
const srvData = JSON.parse(readFileSync('mini-services/game-server/map-island-data.json', 'utf8'))

interface Bx { x: number; y: number; z: number; w: number; h: number; d: number; tex?: string; stair?: boolean }
const boxes = (data as { boxes: Bx[] }).boxes
const losBoxes = (data as { losBoxes: Bx[] }).losBoxes
const srvBoxes = (srvData as { boxes: Bx[] }).boxes
const srvLos = (srvData as { losBoxes: Bx[] }).losBoxes
const wps = (data as { waypoints: Array<{ id: string; x: number; z: number; y: number }> }).waypoints
const wpEdges = (data as { waypointEdges: Array<[string, string]> }).waypointEdges
const spawns = (data as { spawns: { CT: Array<{ x: number; y: number; z: number }>; T: Array<{ x: number; y: number; z: number }> } }).spawns

const BOUNDS = { minX: -95, maxX: 95, minZ: -85, maxZ: 85 }

function classify(x: number, z: number): 'OK' | 'PIT' | 'VOID' {
  const h = height(x, z)
  let bestTop = -Infinity
  for (const b of boxes) {
    if (Math.abs(x - b.x) >= b.w / 2 || Math.abs(z - b.z) >= b.d / 2) continue
    const top = b.y + b.h / 2
    if (top <= h + 0.3 && top > bestTop) bestTop = top
  }
  if (bestTop === -Infinity) return 'VOID'
  return bestTop >= h - 1.2 ? 'OK' : 'PIT'
}

// grenade floor: a losBox (server nade sim) with a top near the surface
function nadeFloor(x: number, z: number): boolean {
  const h = height(x, z)
  for (const b of losBoxes) {
    if (Math.abs(x - b.x) >= b.w / 2 || Math.abs(z - b.z) >= b.d / 2) continue
    const top = b.y + b.h / 2
    if (top <= h + 0.3 && top >= h - 1.6) return true
  }
  return false
}

// committed-tree leaf lookup: does this XZ sit inside a cell that IS a
// losBoxes member (final-cell hMin > 0.95)? Mirrors gen.ts's emitLosBox
// recursion exactly. Non-member cells (pad-edge seams whose min corner dips
// to the wet band) have no grenade floor BY THE SHIPPED RULE.
function committedMember(x: number, z: number): boolean {
  const walk = (bx: number, bz: number, size: number): boolean => {
    const h0 = height(bx, bz), h1 = height(bx + size, bz), h2 = height(bx, bz + size), h3 = height(bx + size, bz + size)
    const hMin = Math.min(h0, h1, h2, h3), hMax = Math.max(h0, h1, h2, h3)
    if (hMax < -5.8) return false
    if (hMax - hMin > 0.9 && size > 0.7) {
      const s2 = size / 2
      return walk(bx + (x >= bx + s2 ? s2 : 0), bz + (z >= bz + s2 ? s2 : 0), s2)
    }
    return hMin > 0.95
  }
  const px = Math.floor((x - BOUNDS.minX) / 2.5), pz = Math.floor((z - BOUNDS.minZ) / 2.5)
  return walk(BOUNDS.minX + px * 2.5, BOUNDS.minZ + pz * 2.5, 2.5)
}

let fails = 0
const report = (label: string, x: number, z: number, c: string) => {
  if (c === 'OK') return
  fails++
  console.log(`  ${c.padEnd(4)} ${label} @ (${x.toFixed(1)}, ${z.toFixed(1)}) terrainH=${height(x, z).toFixed(2)}`)
}

console.log('== grenade floors on site pads (losBoxes) ==')
for (const [name, cx, cz, r] of [['A', 14, 20, 10], ['B', -46, 6, 9]] as const) {
  let no = 0, total = 0
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, rr = (i % 5) / 5 * r
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr
    // A sample requires a grenade floor only if its own committed-tree leaf
    // cell IS a losBoxes member (hMin > 0.95). Pad-edge seam cells whose MIN
    // corner dips to the wet band are excluded wholesale by the shipped
    // hMin > 0.95 rule (bit-for-bit tree) — no floor there BY DESIGN.
    if (!committedMember(x, z)) continue
    total++
    if (!nadeFloor(x, z)) no++
  }
  console.log(`  site ${name}: ${no}/${total} member samples without a grenade floor`)
  if (no > 0) fails += no
}

console.log('== spawns ==')
for (const [team, arr] of Object.entries(spawns)) {
  for (const s of arr) report(`${team} spawn`, s.x, s.z, classify(s.x, s.z))
}

console.log('== site pads (spiral samples) ==')
for (const [name, cx, cz, r] of [['A', 14, 20, 10], ['B', -46, 6, 9]] as const) {
  let voids = 0, total = 0
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, rr = (i % 5) / 5 * r
    const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr
    total++
    const c = classify(x, z)
    if (c === 'VOID') { voids++; if (voids <= 3) report(`site ${name} pad`, x, z, c) }
    else report(`site ${name} pad`, x, z, c)
  }
  console.log(`  site ${name}: ${voids}/${total} VOID samples`)
}

console.log('== waypoints (bot-walkable = player-walkable) ==')
let wpVoid = 0, wpPit = 0
const voidSamples: Array<[number, number]> = []
for (const w of wps) {
  const c = classify(w.x, w.z)
  if (c === 'VOID') { wpVoid++; if (voidSamples.length < 400) voidSamples.push([w.x, w.z]) }
  if (c === 'PIT') wpPit++
}
console.log(`  waypoints: ${wps.length} total, ${wpVoid} VOID, ${wpPit} PIT`)
if (wpVoid) {
  // cluster the VOID waypoints into a handful of readable centers
  const seen = new Set<number>()
  const clusters: Array<{ n: number; sx: number; sz: number }> = []
  for (const [vx, vz] of voidSamples) {
    if (seen.has(voidSamples.findIndex(([a, b]) => a === vx && b === vz))) continue
    const cl = { n: 0, sx: 0, sz: 0 }
    voidSamples.forEach(([a, b], i) => {
      if (Math.hypot(a - vx, b - vz) < 12 && !seen.has(i)) { seen.add(i); cl.n++; cl.sx += a; cl.sz += b }
    })
    if (cl.n) clusters.push(cl)
  }
  for (const c of clusters) console.log(`  VOID cluster ~(${(c.sx / c.n).toFixed(0)}, ${(c.sz / c.n).toFixed(0)}) x${c.n}`)
}

console.log('== walkable grid (terrain h>0.95, cell 1.25m) ==')
let gVoid = 0, gTotal = 0
const gridVoid: Array<[number, number]> = []
for (let x = BOUNDS.minX + 1; x < BOUNDS.maxX; x += 1.25) {
  for (let z = BOUNDS.minZ + 1; z < BOUNDS.maxZ; z += 1.25) {
    if (height(x, z) < 0.95) continue
    gTotal++
    if (classify(x, z) === 'VOID') { gVoid++; if (gridVoid.length < 5000) gridVoid.push([x, z]) }
  }
}
console.log(`  walkable samples: ${gTotal}, VOID: ${gVoid} (${(100 * gVoid / gTotal).toFixed(1)}%)`)
if (gridVoid.length) {
  const seen = new Set<number>()
  const clusters: Array<{ n: number; sx: number; sz: number }> = []
  for (const [vx, vz] of gridVoid) {
    const idx = gridVoid.findIndex(([a, b]) => a === vx && b === vz)
    if (seen.has(idx)) continue
    const cl = { n: 0, sx: 0, sz: 0 }
    gridVoid.forEach(([a, b], i) => {
      if (Math.hypot(a - vx, b - vz) < 9 && !seen.has(i)) { seen.add(i); cl.n++; cl.sx += a; cl.sz += b }
    })
    if (cl.n) clusters.push(cl)
  }
  clusters.sort((a, b) => b.n - a.n)
  for (const c of clusters.slice(0, 12)) console.log(`  VOID cluster ~(${(c.sx / c.n).toFixed(0)}, ${(c.sz / c.n).toFixed(0)}) x${c.n}`)
}

console.log('== client/server data parity ==')
const parity = boxes.length === srvBoxes.length && JSON.stringify(boxes) === JSON.stringify(srvBoxes)
  && losBoxes.length === srvLos.length && JSON.stringify(losBoxes) === JSON.stringify(srvLos)
console.log(parity
  ? `  parity OK (${boxes.length} boxes, ${losBoxes.length} losBoxes)`
  : `  !! PARITY MISMATCH client=${boxes.length}/${losBoxes.length} server=${srvBoxes.length}/${srvLos.length}`)

console.log('== Task 131 hotfix #3: invisible-wall scan (stair step limits) ==')
// engine.ts: auto-step rises <= (box.stair ? STAIR_CLIMB 0.95 : STEP_UP 0.55).
// Terrain colliders are stair-flagged; props are not (and are visible
// obstacles), so the terrain step limit is STAIR_CLIMB.
const STAIR_CLIMB = 0.95
const stairs = boxes.filter(b => b.stair)
if (stairs.length === 0) { console.log('  !! NO stair-flagged boxes — engine fix missing'); process.exitCode = 1 }
// parent-cell hash — all terrain stairs are <= 2.55 m footprints
const SP = 2.5
const stairHash = new Map<string, Bx[]>()
for (const b of stairs) {
  const k0x = Math.floor((b.x - b.w / 2 - BOUNDS.minX) / SP), k1x = Math.floor((b.x + b.w / 2 - BOUNDS.minX) / SP)
  const k0z = Math.floor((b.z - b.d / 2 - BOUNDS.minZ) / SP), k1z = Math.floor((b.z + b.d / 2 - BOUNDS.minZ) / SP)
  for (let ix = k0x; ix <= k1x; ix++) for (let iz = k0z; iz <= k1z; iz++) {
    const k = `${ix},${iz}`
    if (!stairHash.has(k)) stairHash.set(k, [])
    stairHash.get(k)!.push(b)
  }
}
const topAt = (x: number, z: number): number | null => {
  const list = stairHash.get(`${Math.floor((x - BOUNDS.minX) / SP)},${Math.floor((z - BOUNDS.minZ) / SP)}`) ?? []
  const h = height(x, z)
  let best: number | null = null
  for (const b of list) {
    if (Math.abs(x - b.x) >= b.w / 2 || Math.abs(z - b.z) >= b.d / 2) continue
    const top = b.y + b.h / 2
    if (top <= h + 0.3 && (best === null || top > best)) best = top
  }
  return best
}
// walkable-grid step scan — mirrors the study that measured the shipped bug
// at 202 blocked navgraph edges. A sample pair whose tops differ by > the
// limit may AGGREGATE several fine cells (the player climbs each boundary
// separately), so blocked candidates are ray-walked at 0.3 m — finer than
// the 0.625 m minimum cell, so every boundary is crossed by exactly one
// pair and the measured per-cell rise is what the engine actually feels.
let wallSamples = 0, walls = 0, blockedAny = 0
const G = 1.25
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
for (let x = BOUNDS.minX + 1; x < BOUNDS.maxX; x += G) {
  for (let z = BOUNDS.minZ + 1; z < BOUNDS.maxZ; z += G) {
    if (height(x, z) < 0.95) continue
    const a = topAt(x, z); if (a === null) continue
    for (const [dx, dz] of DIRS) {
      const qx = x + dx * G, qz = z + dz * G
      if (height(qx, qz) < 0.95) continue
      const b = topAt(qx, qz); if (b === null) continue
      wallSamples++
      if (b - a <= STAIR_CLIMB) continue      // cannot hide a taller single step
      const len = Math.hypot(dx, dz) * G
      const steps = Math.max(2, Math.ceil(len / 0.3))
      let prevTop = a, maxRise = 0
      for (let s = 1; s <= steps; s++) {
        const k = s / steps
        const t = topAt(x + dx * G * k, z + dz * G * k)
        if (t === null) break
        maxRise = Math.max(maxRise, t - prevTop)
        prevTop = t
      }
      if (maxRise <= STAIR_CLIMB) continue    // aggregated fine steps — climbable
      blockedAny++
      const vis = height(qx, qz) - height(x, z)
      if (maxRise - vis > 0.2 && vis / len <= 0.7) {
        walls++
        if (walls <= 5) console.log(`  WALL rise ${maxRise.toFixed(2)} (visible ${vis.toFixed(2)} over ${len.toFixed(2)}m) @ (${x.toFixed(1)}, ${z.toFixed(1)})`)
      }
    }
  }
}
console.log(`  step scan: ${wallSamples} walkable steps, ${blockedAny} with a true single step > ${STAIR_CLIMB}m, INVISIBLE WALLS: ${walls} (must be 0; honest cliffs are allowed)`)
// navgraph routes — bots glide over these edges; players must be able to WALK them.
// 0.5 m granularity is already finer than the 0.625 m minimum cell, so each
// pair crosses <= 1 boundary and none is missed — no ray-walk needed here.
const wpById = new Map(wps.map(w => [w.id, w]))
let badEdges = 0
let worstEdge: { a: string; b: string; rise: number; x: number; z: number } | null = null
for (const [ia, ib] of wpEdges) {
  const A = wpById.get(ia), B = wpById.get(ib)
  if (!A || !B) continue
  const len = Math.hypot(B.x - A.x, B.z - A.z)
  let px = A.x, pz = A.z, bad = false
  for (let t = 0.5; t <= len; t += 0.5) {
    const k = Math.min(1, t / len)
    const cx = A.x + (B.x - A.x) * k, cz = A.z + (B.z - A.z) * k
    const ca = topAt(px, pz), cb = topAt(cx, cz)
    if (ca !== null && cb !== null && cb - ca > STAIR_CLIMB) {
      bad = true
      if (!worstEdge || cb - ca > worstEdge.rise) worstEdge = { a: ia, b: ib, rise: cb - ca, x: cx, z: cz }
    }
    px = cx; pz = cz
  }
  if (bad) badEdges++
}
console.log(`  navgraph: ${badEdges} edges with a step > ${STAIR_CLIMB}m of ${wpEdges.length}${worstEdge ? ` — worst ${worstEdge.rise.toFixed(2)}m ${worstEdge.a}->${worstEdge.b} @ (${worstEdge.x.toFixed(1)}, ${worstEdge.z.toFixed(1)})` : ''}`)

console.log('== losBoxes stay the committed hotfix-2 tree (bit-for-bit) ==')
// independent re-derivation: variance-0.9 staircase, hMin > 0.95 members,
// same traversal order, cm-rounded like the emitter. The emitted array's
// terrain prefix must match EXACTLY — server vision/grenades may not drift.
const R3v = (v: number) => Math.round(v * 100) / 100
const expect: Bx[] = []
const emit = (x: number, z: number, size: number): void => {
  const h0 = height(x, z), h1 = height(x + size, z), h2 = height(x, z + size), h3 = height(x + size, z + size)
  const hMin = Math.min(h0, h1, h2, h3), hMax = Math.max(h0, h1, h2, h3)
  if (hMax < -5.8) return
  if (hMax - hMin > 0.9 && size > 0.7) {
    const s2 = size / 2
    emit(x, z, s2); emit(x + s2, z, s2); emit(x, z + s2, s2); emit(x + s2, z + s2, s2)
    return
  }
  if (hMin <= 0.95) return
  const top = hMin - 0.22
  const bot = hMin > 1.25 ? Math.max(0.2, top - 7) : top - 9
  expect.push({ x: R3v(x + size / 2), y: R3v((top + bot) / 2), z: R3v(z + size / 2), w: R3v(size + 0.05), h: R3v(top - bot), d: R3v(size + 0.05), tex: 'irock' })
}
for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += 2.5)
  for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += 2.5) emit(x, z, 2.5)
const prefix = losBoxes.slice(0, expect.length)
const losOk = prefix.length === expect.length && JSON.stringify(prefix) === JSON.stringify(expect)
console.log(losOk
  ? `  losBoxes terrain prefix OK (${expect.length} members + ${losBoxes.length - expect.length} props)`
  : `  !! LOS TREE DRIFTED — prefix match ${prefix.length === expect.length ? 'values differ' : `length ${prefix.length} != ${expect.length}`}`)
if (!losOk) process.exitCode = 1

const allOk = fails === 0 && wpVoid === 0 && wpPit === 0 && gVoid === 0 && parity && walls === 0 && badEdges === 0 && losOk
console.log(allOk
  ? `ALL GATES PASS (${boxes.length} boxes [${stairs.length} stair], ${losBoxes.length} losBoxes, ${wallSamples} steps scanned, 0 walls)`
  : `GATE FAILURES: VOID=${fails + wpVoid + gVoid} PIT=${wpPit} WALLS=${walls} EDGES=${badEdges} LOS=${losOk ? 0 : 1} PARITY=${parity ? 0 : 1}`)
if (!allOk) process.exitCode = 1
