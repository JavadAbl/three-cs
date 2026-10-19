// ============================================================
// Diagnose aim_headshot "falling out of terrain" bug
// 1. Re-parse BSP, rebuild solidity oracle
// 2. Load generated collision boxes + spawns from map-aimhead.ts
// 3. Simulate client physics (gravity + swept-Y landing) at each spawn
// 4. Grid-coverage scan: oracle walkable floors vs collision-box floors
// ============================================================
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const SCALE = 0.025
const Z_REBASE = 192
const CELL = 16

const PLAYER_R = 0.4
const STAND_H = 1.8
const GRAVITY = 22

// ---------- BSP oracle ----------
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nLeaves = lumps[10].len / 28

function contentsAt(x: number, y: number, z: number): number {
  let n = 0, guard = 0
  while (n >= 0 && guard++ < 300) {
    const o = lumps[5].off + n * 24
    const planenum = dv.getInt32(o, true)
    const po = lumps[1].off + planenum * 20
    const nx = dv.getFloat32(po, true), ny = dv.getFloat32(po + 4, true), nz = dv.getFloat32(po + 8, true), d = dv.getFloat32(po + 12, true)
    const side = (nx * x + ny * y + nz * z - d) >= 0 ? 0 : 1
    const child = dv.getInt16(o + 4 + side * 2, true)
    if (child >= 0) { n = child; continue }
    if (child === -1) return 0
    const l = ~child
    return l < nLeaves ? dv.getInt32(lumps[10].off + l * 28, true) : 0
  }
  return 0
}
const solid = (x: number, y: number, z: number) => contentsAt(x, y, z) === -1
const solidOrSky = (x: number, y: number, z: number) => { const c = contentsAt(x, y, z); return c === -1 || c === -6 }

// ---------- map data (import the generated module directly) ----------
const { AIMHEAD } = await import('/home/z/my-project/src/game/map-aimhead.ts')
interface Box { x: number; y: number; z: number; w: number; h: number; d: number; tex: string }
const boxes = AIMHEAD.boxes as Box[]
const spCT = AIMHEAD.spawns.CT.map(s => [s.x, s.y, s.z])
const spT = AIMHEAD.spawns.T.map(s => [s.x, s.y, s.z])
const bounds = AIMHEAD.bounds
console.log(`boxes=${boxes.length} bounds=${JSON.stringify(bounds)}`)

// bsp-units inverse transform (our game coords → bsp)
const bx = (x: number) => x / SCALE
const bz = (y: number) => y / SCALE - Z_REBASE
const by = (z: number) => -z / SCALE

// ---------- collision floor under a point (client AABB, player radius) ----------
function collisionFloor(px: number, pz: number, belowY: number): number {
  let best = -999
  for (const b of boxes) {
    if (px + PLAYER_R > b.x - b.w / 2 && px - PLAYER_R < b.x + b.w / 2 &&
      pz + PLAYER_R > b.z - b.d / 2 && pz - PLAYER_R < b.z + b.d / 2) {
      const top = b.y + b.h / 2
      if (top <= belowY + 0.02 && top > best) best = top
    }
  }
  return best
}

// ---------- 1. spawn simulation (client physics, 60fps, 3 seconds) ----------
console.log('\n=== SPAWN SIMULATION (client physics) ===')
function simSpawn(s: number[], label: string) {
  const px = s[0], pz = s[2]
  let y = s[1], vy = 0
  const dt = 1 / 60
  let landed = false, fellBelow = -999
  for (let step = 0; step < 180; step++) {
    const prevFeet = y
    vy -= GRAVITY * dt
    if (vy < -35) vy = -35
    y += vy * dt
    let hit = false
    for (const b of boxes) {
      if (px + PLAYER_R > b.x - b.w / 2 && px - PLAYER_R < b.x + b.w / 2 &&
        pz + PLAYER_R > b.z - b.d / 2 && pz - PLAYER_R < b.z + b.d / 2) {
        const top = b.y + b.h / 2, bot = b.y - b.h / 2
        if (y + STAND_H > bot && y < top + Math.max(0, prevFeet - y) && vy <= 0.01 &&
          (y > top - 0.3 || prevFeet >= top - 0.001)) {
          y = top; vy = 0; hit = true
        }
      }
    }
    if (hit) { landed = true; break }
    if (y < -6) { fellBelow = y; break }
  }
  const cfloor = collisionFloor(px, pz, 12)
  console.log(`${label} (${px.toFixed(1)}, ${pz.toFixed(1)}) spawnY=${s[1].toFixed(2)} collisionFloor=${cfloor.toFixed(2)} → ${landed ? `LANDED at ${y.toFixed(2)}` : `FELL THROUGH (y=${fellBelow === -999 ? y.toFixed(2) : fellBelow.toFixed(2)})`}`)
  return landed
}
let nLanded = 0
spCT.forEach((s, i) => { if (simSpawn(s, `CT${i}`)) nLanded++ })
spT.forEach((s, i) => { if (simSpawn(s, `T${i}`)) nLanded++ })
console.log(`spawn sim: ${nLanded}/${spCT.length + spT.length} landed`)

// ---------- 2. coverage scan: oracle walkable vs collision boxes ----------
console.log('\n=== FLOOR COVERAGE SCAN (oracle walkable columns vs collision boxes) ===')
// walkable per oracle: free headroom 84u, solid below
function oracleFloor(x: number, y: number): number | null {
  for (let z = 460; z >= -190; z -= 8) {
    if (!solid(x, y, z + 4) && !solid(x, y, z + 42) && !solid(x, y, z + 80) && solid(x, y, z - 6)) return z
  }
  return null
}
const wmin = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + k * 4, true))
const wmax = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + 12 + k * 4, true))
const STEP = 32
let holes: Array<{ bx: number; by: number; floor: number; cfloor: number }> = []
let checked = 0, covered = 0
for (let y = wmin[1] + 24; y < wmax[1] - 24; y += STEP) {
  for (let x = wmin[0] + 24; x < wmax[0] - 24; x += STEP) {
    const f = oracleFloor(x, y)
    if (f === null || f > 260) continue // skip sky-high / none
    checked++
    // our coords
    const px = x * SCALE, pz = -y * SCALE, py = (f + Z_REBASE) * SCALE
    const cf = collisionFloor(px, pz, py + 1.5)
    if (cf > -99 && py - cf <= 0.55) covered++
    else holes.push({ bx: x, by: y, floor: f, cfloor: cf })
  }
}
console.log(`walkable columns: ${checked}, covered by collision: ${covered} (${(100 * covered / checked).toFixed(1)}%), HOLES: ${holes.length}`)
if (holes.length) {
  // cluster holes by z-level
  const byFloor = new Map<number, number>()
  for (const h of holes) byFloor.set(h.floor, (byFloor.get(h.floor) ?? 0) + 1)
  console.log('holes by oracle floor z (bsp units):', [...byFloor.entries()].sort((a, b) => b[0] - a[0]).map(([f, n]) => `z=${f}: ${n}`).join(', '))
  for (const h of holes.slice(0, 25)) {
    console.log(`  HOLE bsp(${h.bx}, ${h.by}) oracleFloor=${h.floor} (our y=${((h.floor + Z_REBASE) * SCALE).toFixed(2)}) collisionFloor=${h.cfloor === -999 ? 'NONE' : h.cfloor.toFixed(2)}  contents=-${''}`)
  }
}

// ---------- 3. check box tops vs oracle surface heights at box locations ----------
console.log('\n=== COLLISION-TOP vs RENDER-SURFACE offsets (sample) ===')
let diffs: number[] = []
for (const b of boxes) {
  // box top in our y → bsp z
  const topBsp = b.y + b.h / 2 - 0 // our
  const zTop = topBsp / SCALE - Z_REBASE
  const cx = bx(b.x), cy = by(b.z)
  // oracle: is (cx, cy, zTop - 6) solid? and zTop+8 free?
  const below = solid(cx, cy, zTop - 6)
  const above = solid(cx, cy, zTop + 8)
  if (below && !above) diffs.push(0) // box top exactly at surface
  else diffs.push(above ? 1 : (below ? 0.5 : -1))
}
const exact = diffs.filter(d => d === 0).length
const aboveS = diffs.filter(d => d === 1).length
const weird = diffs.filter(d => d === -1).length
console.log(`box-top/surface agreement: exact=${exact}, extends-above-surface=${aboveS}, no-solid-below=${weird}, total=${diffs.length}`)

// ---------- 4. oracle solidity of sky / outside shell ----------
console.log('\n=== SKY CONTENTS CHECK ===')
let skyCells = 0, solidCells = 0
for (let z = -190; z < 460; z += 32) {
  for (let y = wmin[1] + 16; y < wmax[1] - 16; y += 64) {
    for (let x = wmin[0] + 16; x < wmax[0] - 16; x += 64) {
      const c = contentsAt(x, y, z)
      if (c === -6) skyCells++
      if (c === -1) solidCells++
    }
  }
}
console.log(`sampled: sky=${skyCells}, solid=${solidCells} (sky is NOT included in collision — map shell may leak)`)
