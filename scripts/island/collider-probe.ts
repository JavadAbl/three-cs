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
// Run: bun scripts/island/collider-probe.ts
import { readFileSync } from 'fs'
import { height } from './gen'   // side effect: deterministic regen (byte-identical)
// NB: read the emitted JSONs at RUNTIME (readFileSync below), not via static
// imports — Bun parses the whole import graph BEFORE evaluating gen.ts's
// regen side effect, so static JSON imports would return LAST run's files.
const data = JSON.parse(readFileSync('src/game/map-island-data.json', 'utf8'))
const srvData = JSON.parse(readFileSync('mini-services/game-server/map-island-data.json', 'utf8'))

interface Bx { x: number; y: number; z: number; w: number; h: number; d: number }
const boxes = (data as { boxes: Bx[] }).boxes
const losBoxes = (data as { losBoxes: Bx[] }).losBoxes
const srvBoxes = (srvData as { boxes: Bx[] }).boxes
const srvLos = (srvData as { losBoxes: Bx[] }).losBoxes
const wps = (data as { waypoints: Array<{ id: string; x: number; z: number; y: number }> }).waypoints
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
    total++
    if (!nadeFloor(x, z)) no++
  }
  console.log(`  site ${name}: ${no}/${total} samples without a grenade floor`)
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
console.log(fails === 0 && wpVoid === 0 && wpPit === 0 && gVoid === 0 ? 'ALL COVERED' : `UNCOVERED POINTS: ${fails + wpVoid + wpPit + gVoid}`)
