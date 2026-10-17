// ============================================================
// Diagnose aim_headshot "fall into the ramp when climbing" bug
// 1. Find sloped walkable faces (ramps) in the BSP
// 2. Count strips the OLD emitStaircase vertex-filter actually emits
// 3. Check collision-box coverage over each ramp surface
// 4. Client-physics walk-up simulation (exact engine movePlayer copy)
// ============================================================
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const SCALE = 0.025
const Z_REBASE = 192
const THICK = 32
const STRIP = 16

// ---------- engine constants (src/game/engine.ts) ----------
const PLAYER_R = 0.4
const STAND_H = 1.8
const STEP_UP = 0.55
const GRAVITY = 22
const WALK_SPEED = 4.6

// ---------- BSP parse (same as convert2) ----------
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nPlanes = lumps[1].len / 20
const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
const nFaces = lumps[7].len / 20
const nTexinfo = lumps[6].len / 40
const nSurfedges = lumps[13].len / 4
const nLeaves = lumps[10].len / 28

interface Face { planenum: number; side: number; firstedge: number; numedges: number; texinfo: number }
const faces: Face[] = []
for (let i = 0; i < nFaces; i++) {
  const o = lumps[7].off + i * 20
  faces.push({ planenum: dv.getUint16(o, true), side: dv.getUint8(o + 2), firstedge: dv.getInt32(o + 4, true), numedges: dv.getUint16(o + 8, true), texinfo: dv.getInt16(o + 10, true) })
}
function faceVerts(f: Face): number[][] {
  const out: number[][] = []
  if (f.numedges < 3 || f.numedges > 32) return out
  if (f.firstedge < 0 || f.firstedge + f.numedges > nSurfedges) return out
  for (let k = 0; k < f.numedges; k++) {
    const se = dv.getInt32(lumps[13].off + (f.firstedge + k) * 4, true)
    if (Math.abs(se) >= nEdges) return out
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    if (v >= nVerts) return out
    out.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  return out.length >= 3 ? out : []
}
function planeOf(planenum: number): { n: number[]; d: number } {
  const po = lumps[1].off + planenum * 20
  return { n: [dv.getFloat32(po, true), dv.getFloat32(po + 4, true), dv.getFloat32(po + 8, true)], d: dv.getFloat32(po + 12, true) }
}
function collectFaces(root: number): number[] {
  const set = new Set<number>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n >= 0) stack.push(dv.getInt16(lumps[5].off + n * 24 + 4, true), dv.getInt16(lumps[5].off + n * 24 + 6, true))
    else if (n !== -1) {
      const l = ~n
      if (l < 0 || l >= nLeaves) continue
      const firstms = dv.getUint16(lumps[10].off + l * 28 + 20, true)
      const nms = dv.getUint16(lumps[10].off + l * 28 + 22, true)
      for (let k = 0; k < nms; k++) {
        const fi = dv.getUint16(lumps[11].off + (firstms + k) * 2, true)
        if (fi < nFaces) set.add(fi)
      }
    }
  }
  return [...set]
}
const nModels = lumps[14].len / 64
const modelRoots: number[] = []
for (let i = 0; i < nModels; i++) modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))
const worldFaceIdx = collectFaces(modelRoots[0])

interface MipTex { name: string }
const miptexs: MipTex[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push({ name: `wad${i}` }); continue }
    const p = base + rel
    miptexs.push({ name: buf.toString('latin1', p, p + 16).replace(/\0.*$/, '') })
  }
}

interface GFace { n: number[]; d: number; vs: number[][]; aabb: number[]; tex: string }
const gfaces: GFace[] = []
for (const fi of worldFaceIdx) {
  const f = faces[fi]
  if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
  const texName = (miptexs[dv.getInt32(lumps[6].off + f.texinfo * 40 + 32, true)]?.name ?? '')
  if (texName.toLowerCase() === 'sky' || texName.startsWith('{')) continue
  const vs = faceVerts(f)
  if (!vs.length) continue
  const pl = planeOf(f.planenum)
  let nrm = pl.n
  if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
  const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
  gfaces.push({ n: nrm, d: pl.d, vs, aabb: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)], tex: texName })
}

function inPoly(px: number, py: number, vs: number[][]): boolean {
  let sign = 0
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    const cr = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
    if (Math.abs(cr) < 1e-9) continue
    const s = Math.sign(cr)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

// ---------- 1. sloped walkable faces + OLD strip emission ----------
interface Ramp { gf: GFace; ax: number; sign: number; oldStrips: number; totalStrips: number }
const ramps: Ramp[] = []
const flatZ = (vs: number[][]) => Math.max(...vs.map(v => v[2])) - Math.min(...vs.map(v => v[2])) <= 1.5
console.log('=== SLOPED WALKABLE FACES (ramps) ===')
for (const gf of gfaces) {
  const [nx, ny, nz] = gf.n
  if (nz <= 0.3) continue                    // walls / steep / ceilings
  if (flatZ(gf.vs)) continue                 // flat floor — exact box path
  const ax = Math.abs(nx) >= Math.abs(ny) ? 0 : 1
  const sign = (ax === 0 ? nx : ny) > 0 ? 1 : -1
  const axisVal = (v: number[]) => v[ax]
  const lo = gf.aabb[ax], hi = gf.aabb[ax + 1]
  const gentle = nz >= 0.55
  const step = gentle ? STRIP : (hi - lo)
  let oldStrips = 0, totalStrips = 0
  for (let s = lo; s < hi; s += step) {
    const e = Math.min(s + step, hi)
    totalStrips++
    const strip = gf.vs.filter(v => axisVal(v) >= s - 0.01 && axisVal(v) < e + 0.01)
    if (strip.length >= 3) oldStrips++
  }
  const area = (gf.aabb[1] - gf.aabb[0]) * (gf.aabb[3] - gf.aabb[2])
  const slopeDeg = Math.round(Math.acos(Math.min(1, nz)) * 180 / Math.PI)
  console.log(`  face tex=${gf.tex} verts=${gf.vs.length} slope=${slopeDeg}deg run=${Math.round(hi - lo)}u area=${Math.round(area)}u2 → OLD strips ${oldStrips}/${totalStrips}`)
  if (hi - lo >= 48 && area > 16 * 64) ramps.push({ gf, ax, sign, oldStrips, totalStrips })
}
const sumOld = ramps.reduce((a, r) => a + r.oldStrips, 0)
const sumTotal = ramps.reduce((a, r) => a + r.totalStrips, 0)
console.log(`RAMP FACES (significant): ${ramps.length} — old logic emitted ${sumOld}/${sumTotal} strips ${sumOld === 0 ? '← ZERO COLLISION ON RAMPS (the bug)' : ''}`)

// ---------- load generated map ----------
const { AIMHEAD } = await import('/home/z/my-project/src/game/map-aimhead.ts')
interface Box { x: number; y: number; z: number; w: number; h: number; d: number }
const boxes = AIMHEAD.boxes as Box[]
console.log(`\ngenerated map boxes: ${boxes.length}`)
interface Col { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
const cols: Col[] = boxes.map(b => ({
  min: { x: b.x - b.w / 2, y: b.y - b.h / 2, z: b.z - b.d / 2 },
  max: { x: b.x + b.w / 2, y: b.y + b.h / 2, z: b.z + b.d / 2 },
}))
function collisionFloor(px: number, pz: number, belowY: number): number {
  let best = -999
  for (const c of cols) {
    if (px + PLAYER_R > c.min.x && px - PLAYER_R < c.max.x && pz + PLAYER_R > c.min.z && pz - PLAYER_R < c.max.z) {
      if (c.max.y <= belowY && c.max.y > best) best = c.max.y
    }
  }
  return best
}

// ---------- 2. coverage over each ramp surface ----------
console.log('\n=== RAMP SURFACE COLLISION COVERAGE (client player radius) ===')
let allCovered = true
for (const r of ramps) {
  const { gf, ax } = r
  const [nx, ny, nz] = gf.n
  const cross = ax === 0 ? 1 : 0
  const samples: Array<[number, number, number]> = [] // game px, pz, surface py
  for (let t = 0.05; t <= 0.96; t += 0.1) {
    for (let u = 0.1; u <= 0.91; u += 0.2) {
      const gx = gf.aabb[ax * 2 + 0] + (gf.aabb[ax * 2 + 1] - gf.aabb[ax * 2 + 0]) * t
      const gy = gf.aabb[cross * 2 + 0] + (gf.aabb[cross * 2 + 1] - gf.aabb[cross * 2 + 0]) * u
      const vx = ax === 0 ? gx : gy
      const vy = ax === 0 ? gy : gx
      if (!inPoly(vx, vy, gf.vs)) continue
      const z = (gf.d - nx * vx - ny * vy) / nz
      samples.push([vx * SCALE, -vy * SCALE, (z + Z_REBASE) * SCALE])
    }
  }
  let covered = 0
  for (const [px, pz, py] of samples) {
    const cf = collisionFloor(px, pz, py + 0.35)
    if (cf > -99 && cf > py - 0.06) covered++
  }
  const pct = samples.length ? Math.round(100 * covered / samples.length) : 100
  if (pct < 100) allCovered = false
  console.log(`  ramp slope=${Math.round(Math.acos(Math.min(1, nz)) * 180 / Math.PI)}deg samples=${samples.length} covered=${pct}%`)
}
console.log(allCovered ? 'ALL RAMPS COVERED' : 'HOLES IN RAMP COLLISION ← players fall through')

// ---------- 3. client-physics walk-up sim (exact engine copy) ----------
console.log('\n=== WALK-UP SIMULATION (client movePlayer, 60fps) ===')
interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean }
function overlapsAt(p: P, x: number, y: number, z: number): boolean {
  for (const c of cols) {
    if (x + PLAYER_R > c.min.x && x - PLAYER_R < c.max.x && y + STAND_H > c.min.y && y < c.max.y && z + PLAYER_R > c.min.z && z - PLAYER_R < c.max.z) return true
  }
  return false
}
function resolveHorizontal(p: P, axis: 'x' | 'z') {
  for (const c of cols) {
    if (p.x + PLAYER_R > c.min.x && p.x - PLAYER_R < c.max.x &&
      p.y + STAND_H > c.min.y && p.y < c.max.y &&
      p.z + PLAYER_R > c.min.z && p.z - PLAYER_R < c.max.z) {
      const rise = c.max.y - p.y
      if (rise <= 0.01) continue // engine v2: feet level with box top — not a blocker
      if (rise <= STEP_UP && p.vy <= 0.1) {
        if (!overlapsAt(p, p.x, c.max.y + 0.02, p.z)) {
          p.y = c.max.y + 0.02
          p.onGround = true
          continue
        }
      }
      if (axis === 'x') { p.x = p.x > (c.min.x + c.max.x) / 2 ? c.max.x + PLAYER_R + 0.001 : c.min.x - PLAYER_R - 0.001; p.vx = 0 }
      else { p.z = p.z > (c.min.z + c.max.z) / 2 ? c.max.z + PLAYER_R + 0.001 : c.min.z - PLAYER_R - 0.001; p.vz = 0 }
    }
  }
}
let anyFail = false
for (const r of ramps.slice(0, 6)) {
  const { gf, ax, sign } = r
  const [nx, ny, nz] = gf.n
  // path through centroid along slope axis, extended 1m beyond the low edge
  const lo = gf.aabb[ax * 2 + 0], hi = gf.aabb[ax * 2 + 1]
  const run = (hi - lo) * SCALE
  const cx = (gf.aabb[0] + gf.aabb[1]) / 2, cy = (gf.aabb[2] + gf.aabb[3]) / 2
  const dirGame = ax === 0 ? [-sign, 0, 0] : [0, 0, sign]   // uphill: dz/dv = -n_ax/nz
  const lowV = -sign > 0 ? lo : hi                          // bottom end of the ramp
  const highV = -sign > 0 ? hi : lo
  const startAxis = lowV + sign * (1.0 / SCALE)          // bsp units, 1m downhill of low edge
  const startB: [number, number] = ax === 0 ? [startAxis, cy] : [cx, startAxis]
  const sx = startB[0] * SCALE, sz = -startB[1] * SCALE
  // surface y at the ramp's low/high edges (game coords)
  const zLow = (gf.d - nx * (ax === 0 ? lowV : cx) - ny * (ax === 0 ? cy : lowV)) / nz
  const zHigh = (gf.d - nx * (ax === 0 ? highV : cx) - ny * (ax === 0 ? cy : highV)) / nz
  const pyLow = (zLow + Z_REBASE) * SCALE, pyHigh = (zHigh + Z_REBASE) * SCALE
  // start on the floor just before the ramp
  let feet = collisionFloor(sx, sz, pyLow + 1.0)
  if (feet < -99) feet = pyLow
  const p: P = { x: sx, y: feet + 0.05, z: sz, vx: 0, vy: 0, vz: 0, onGround: true }
  const dt = 1 / 60
  const travel = run + 2.5
  const frames = Math.ceil((travel / WALK_SPEED) / dt) + 60
  let fellInto = -999, maxPen = 0, reached = false
  const surfAt = (x: number, z: number): number | null => {
    const vx = x / SCALE, vy = -z / SCALE
    if (!inPoly(vx, vy, gf.vs)) return null
    return ((gf.d - nx * vx - ny * vy) / nz + Z_REBASE) * SCALE
  }
  for (let f = 0; f < frames; f++) {
    // wish forward at walk speed, ground accel
    p.vx += (dirGame[0] * WALK_SPEED - p.vx) * Math.min(1, 12 * dt)
    p.vz += (dirGame[2] * WALK_SPEED - p.vz) * Math.min(1, 12 * dt)
    p.vy -= GRAVITY * dt
    if (p.vy < -35) p.vy = -35
    p.x += p.vx * dt
    resolveHorizontal(p, 'x')
    p.z += p.vz * dt
    resolveHorizontal(p, 'z')
    const prevFeet = p.y
    p.y += p.vy * dt
    p.onGround = false
    let landY: number | null = null
    for (const c of cols) {
      const feetNow = p.y
      if (p.x + PLAYER_R > c.min.x && p.x - PLAYER_R < c.max.x &&
        feetNow + STAND_H > c.min.y && feetNow < c.max.y + Math.max(0, prevFeet - feetNow) &&
        p.z + PLAYER_R > c.min.z && p.z - PLAYER_R < c.max.z) {
        if (p.vy <= 0.01 && (feetNow > c.max.y - 0.3 || prevFeet >= c.max.y - 0.001)) {
          landY = landY === null ? c.max.y : Math.max(landY, c.max.y) // engine v2: highest top
        }
      }
    }
    if (landY !== null) { p.y = landY; p.vy = 0; p.onGround = true }
    const s = surfAt(p.x, p.z)
    if (s !== null) {
      const pen = s - p.y
      if (pen > maxPen) maxPen = pen
      if (p.y < s - 0.45) { fellInto = p.y; break }
    }
    if (p.y < -6) { fellInto = p.y; break }
    if (p.y >= pyHigh - 0.25 && Math.hypot(p.x - sx, p.z - sz) > run - 0.3) { reached = true; break }
  }
  const distWalked = Math.hypot(p.x - sx, p.z - sz)
  const ok = reached && fellInto === -999
  if (!ok) anyFail = true
  console.log(`  ramp(run ${run.toFixed(1)}m, climb ${(pyHigh - pyLow).toFixed(1)}m): ${ok ? 'CLIMBED OK' : fellInto !== -999 ? 'FELL INTO RAMP at y=' + fellInto.toFixed(2) : 'STUCK/failed'} — walked ${distWalked.toFixed(1)}m, feet ${p.y.toFixed(2)} (target ${pyHigh.toFixed(2)}), max sink-into-ramp ${maxPen.toFixed(2)}m`)
}
console.log(anyFail ? '\nWALK-UP FAILURES PRESENT' : '\nALL WALK-UP SIMS PASS')
