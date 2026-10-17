// ============================================================
// Probe the two big AzGrass ramps on aim_headshot:
// 1. Inventory ALL faces near each ramp — render-skip status + collision class
// 2. Dump collision boxes overlapping the approach corridor
// 3. Walk sims across the full ramp width (lateral offsets) to find blockers
// ============================================================
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const SCALE = 0.025
const Z_REBASE = 192

const PLAYER_R = 0.4
const STAND_H = 1.8
const STEP_UP = 0.55
const GRAVITY = 22
const WALK_SPEED = 4.6

// ---------- BSP parse ----------
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
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

const miptexs: string[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push(`wad${i}`); continue }
    const p = base + rel
    miptexs.push(buf.toString('latin1', p, p + 16).replace(/\0.*$/, ''))
  }
}

interface GFace { n: number[]; d: number; vs: number[][]; aabb: number[]; tex: string }
const gfaces: GFace[] = []
for (const fi of worldFaceIdx) {
  const f = faces[fi]
  if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
  const texName = (miptexs[dv.getInt32(lumps[6].off + f.texinfo * 40 + 32, true)] ?? '')
  if (texName.toLowerCase() === 'sky' || texName.startsWith('{')) continue
  const vs = faceVerts(f)
  if (!vs.length) continue
  const pl = planeOf(f.planenum)
  let nrm = pl.n
  if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
  const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
  gfaces.push({ n: nrm, d: pl.d, vs, aabb: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)], tex: texName })
}

// ---------- find the two big ramps (31°, run > 100u) ----------
const flatZ = (vs: number[][]) => Math.max(...vs.map(v => v[2])) - Math.min(...vs.map(v => v[2])) <= 1.5
const bigRamps: GFace[] = []
for (const gf of gfaces) {
  const [nx, ny, nz] = gf.n
  if (nz <= 0.55 || flatZ(gf.vs)) continue
  const ax = Math.abs(nx) >= Math.abs(ny) ? 0 : 1
  if (gf.aabb[ax * 2 + 1] - gf.aabb[ax * 2 + 0] < 100) continue
  bigRamps.push(gf)
}
console.log(`big ramps: ${bigRamps.length}`)

// ---------- 1. face inventory near each ramp ----------
for (const ramp of bigRamps) {
  const M = 80   // bsp units margin around ramp bbox
  const [rx0, rx1, ry0, ry1] = [ramp.aabb[0] - M, ramp.aabb[1] + M, ramp.aabb[2] - M, ramp.aabb[3] + M]
  const zr = [ramp.aabb[4] - M, ramp.aabb[5] + M]
  console.log(`\n=== RAMP @bsp x[${ramp.aabb[0].toFixed(0)}..${ramp.aabb[1].toFixed(0)}] y[${ramp.aabb[2].toFixed(0)}..${ramp.aabb[3].toFixed(0)}] z[${ramp.aabb[4].toFixed(0)}..${ramp.aabb[5].toFixed(0)}] n=[${ramp.n.map(v => v.toFixed(2))}] ===`)
  console.log('nearby faces (tex | slope | aabb | anim-frame | render):')
  for (const gf of gfaces) {
    const a = gf.aabb
    if (a[1] < rx0 || a[0] > rx1 || a[3] < ry0 || a[2] > ry1) continue
    if (a[5] < zr[0] || a[4] > zr[1]) continue
    const [nx, ny, nz] = gf.n
    const mAnim = gf.tex.match(/^-([0-9])(.+)$/)
    const frame = mAnim ? mAnim[1] : '-'
    const rendered = mAnim ? mAnim[1] === '0' : true
    const slope = Math.round(Math.acos(Math.min(1, Math.abs(nz))) * 180 / Math.PI)
    let cls = ''
    if (nz > 0.7) cls = flatZ(gf.vs) ? 'FLOOR-flat' : 'FLOOR-stair'
    else if (nz < -0.7) cls = 'CEIL'
    else if (Math.abs(nx) >= 0.94 && Math.abs(ny) < 0.34) cls = `WALL±x${nx > 0 ? '(extr -x)' : '(extr +x)'}`
    else if (Math.abs(ny) >= 0.94 && Math.abs(nx) < 0.34) cls = `WALL±y${ny > 0 ? '(extr -y)' : '(extr +y)'}`
    else if (Math.abs(nz) >= 0.3) cls = 'SLOPE-steep→fullAABB'
    else cls = 'DIAGONAL→fullAABB'
    console.log(`  ${gf.tex.padEnd(9)} slope=${String(slope).padStart(3)}deg frame=${frame} render=${rendered ? 'YES' : 'NO '} ${cls} aabb=[${a.map(v => v.toFixed(0)).join(' ')}]`)
  }
}

// ---------- 2. collision boxes near each ramp + 3. walk sims across width ----------
const { AIMHEAD } = await import('/home/z/my-project/src/game/map-aimhead.ts')
interface Box { x: number; y: number; z: number; w: number; h: number; d: number }
const boxes = AIMHEAD.boxes as Box[]
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
function overlapsAt(x: number, y: number, z: number): boolean {
  for (const c of cols) {
    if (x + PLAYER_R > c.min.x && x - PLAYER_R < c.max.x && y + STAND_H > c.min.y && y < c.max.y && z + PLAYER_R > c.min.z && z - PLAYER_R < c.max.z) return true
  }
  return false
}
function resolveHorizontal(p: { x: number; y: number; z: number; vx: number; vy: number; vz: number }, axis: 'x' | 'z') {
  for (const c of cols) {
    if (p.x + PLAYER_R > c.min.x && p.x - PLAYER_R < c.max.x &&
      p.y + STAND_H > c.min.y && p.y < c.max.y &&
      p.z + PLAYER_R > c.min.z && p.z - PLAYER_R < c.max.z) {
      const rise = c.max.y - p.y
      if (rise <= 0.01) continue // engine v2: feet level with box top — not a blocker
      if (rise <= STEP_UP && p.vy <= 0.1) {
        if (!overlapsAt(p.x, c.max.y + 0.02, p.z)) { p.y = c.max.y + 0.02; continue }
      }
      if (axis === 'x') { p.x = p.x > (c.min.x + c.max.x) / 2 ? c.max.x + PLAYER_R + 0.001 : c.min.x - PLAYER_R - 0.001; p.vx = 0 }
      else { p.z = p.z > (c.min.z + c.max.z) / 2 ? c.max.z + PLAYER_R + 0.001 : c.min.z - PLAYER_R - 0.001; p.vz = 0 }
    }
  }
}

for (const ramp of bigRamps) {
  const [nx, ny, nz] = ramp.n
  const ax = Math.abs(nx) >= Math.abs(ny) ? 0 : 1
  const sign = (ax === 0 ? nx : ny) > 0 ? 1 : -1
  const lo = ramp.aabb[ax * 2 + 0], hi = ramp.aabb[ax * 2 + 1]
  const run = (hi - lo) * SCALE
  const cx = (ramp.aabb[0] + ramp.aabb[1]) / 2, cy = (ramp.aabb[2] + ramp.aabb[3]) / 2
  const width = (ax === 0 ? ramp.aabb[3] - ramp.aabb[2] : ramp.aabb[1] - ramp.aabb[0]) * SCALE
  const lowV = -sign > 0 ? lo : hi
  const zLow = (ramp.d - nx * (ax === 0 ? lowV : cx) - ny * (ax === 0 ? cy : lowV)) / nz
  const pyLow = (zLow + Z_REBASE) * SCALE
  // walk sims across the width
  console.log(`\n=== WALK SIMS across ramp width ${width.toFixed(1)}m (offsets -w/2+r .. +w/2-r) ===`)
  const halfW = width / 2 - PLAYER_R - 0.05
  for (let off = -halfW; off <= halfW + 0.001; off += Math.max(0.25, width / 9)) {
    const startB: [number, number] = ax === 0 ? [lowV + sign * (1.0 / SCALE), cy + off / SCALE * -1 * 0 + off / SCALE] : [cx + off / SCALE, lowV + sign * (1.0 / SCALE)]
    // lateral offset is along the CROSS axis
    const latB: [number, number] = ax === 0 ? [lowV + sign * (1.0 / SCALE), cy + off / SCALE] : [cx + off / SCALE, lowV + sign * (1.0 / SCALE)]
    const sx = latB[0] * SCALE, sz = -latB[1] * SCALE
    const dir = ax === 0 ? [-sign, 0, 0] : [0, 0, sign]
    let feet = collisionFloor(sx, sz, pyLow + 1.0)
    if (feet < -99) feet = pyLow
    const p = { x: sx, y: feet + 0.05, z: sz, vx: 0, vy: 0, vz: 0 }
    const dt = 1 / 60
    const frames = Math.ceil(((run + 2.0) / WALK_SPEED) / dt) + 90
    let fell = false, topY = p.y
    const surfAt = (x: number, z: number): number | null => {
      const vx = x / SCALE, vy = -z / SCALE
      // inside ramp poly?
      const inR = (() => {
        let s = 0
        for (let i = 0; i < ramp.vs.length; i++) {
          const a = ramp.vs[i], b = ramp.vs[(i + 1) % ramp.vs.length]
          const cr = (b[0] - a[0]) * (vy - a[1]) - (b[1] - a[1]) * (vx - a[0])
          if (Math.abs(cr) < 1e-9) continue
          const sg = Math.sign(cr)
          if (s === 0) s = sg; else if (sg !== s) return false
        }
        return true
      })()
      if (!inR) return null
      return ((ramp.d - nx * vx - ny * vy) / nz + Z_REBASE) * SCALE
    }
    let progress = 0, startFeet = p.y
    for (let f = 0; f < frames; f++) {
      p.vx += (dir[0] * WALK_SPEED - p.vx) * Math.min(1, 12 * dt)
      p.vz += (dir[2] * WALK_SPEED - p.vz) * Math.min(1, 12 * dt)
      p.vy -= GRAVITY * dt
      if (p.vy < -35) p.vy = -35
      p.x += p.vx * dt
      resolveHorizontal(p, 'x')
      p.z += p.vz * dt
      resolveHorizontal(p, 'z')
      const prevFeet = p.y
      p.y += p.vy * dt
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
      if (landY !== null) { p.y = landY; p.vy = 0 }
      if (p.y < -6) { fell = true; break }
      if (p.y > topY) topY = p.y
      const s = surfAt(p.x, p.z)
      if (s !== null && p.y < s - 0.45) { fell = true; break }
    }
    progress = Math.hypot(p.x - sx, p.z - sz)
    const climb = topY - startFeet // max height reached (final y can be a far-edge fall artifact)
    console.log(`  offset ${off >= 0 ? '+' : ''}${off.toFixed(2)}m: walked ${progress.toFixed(1)}m/${(run + 1).toFixed(1)}m climb ${climb.toFixed(2)}m/${(2.2).toFixed(2)}m ${fell ? 'FELL INTO' : progress < run * 0.8 ? 'BLOCKED' : climb < 1.8 ? 'STUCK-LOW' : 'OK'}`)
  }
  // dump boxes overlapping the approach corridor (bsp-coord report)
  console.log('--- boxes in corridor (game coords, first 25):')
  const corrMinX = (ax === 0 ? (lowV + sign * 60) : cx - 120) * SCALE
  const corrMaxX = (ax === 0 ? (lowV - sign * 60 * 1 * (sign > 0 ? -1 : 1) + sign * 0 + hi) : cx + 120) * SCALE
  let shown = 0
  for (const c of cols) {
    const inCorr = ax === 0
      ? (Math.min(c.min.x, c.max.x) < Math.max(ramp.aabb[0], ramp.aabb[1]) * SCALE + 3 && Math.max(c.min.x, c.max.x) > Math.min(ramp.aabb[0], ramp.aabb[1]) * SCALE - 3)
      : true
    if (!inCorr) continue
    const nearZ = ax === 0
      ? (c.min.z < -Math.min(ramp.aabb[2], ramp.aabb[3]) * SCALE + 2 && c.max.z > -Math.max(ramp.aabb[2], ramp.aabb[3]) * SCALE - 2)
      : (c.min.x < Math.min(ramp.aabb[0], ramp.aabb[1]) * SCALE + 2 && c.max.x > Math.max(ramp.aabb[0], ramp.aabb[1]) * SCALE - 2)
    if (!nearZ) continue
    if (c.min.y > ramp.aabb[5] * SCALE + 2 || c.max.y < (ramp.aabb[4] - 60) * SCALE) continue
    if (shown++ < 25) console.log(`    box x[${c.min.x.toFixed(1)},${c.max.x.toFixed(1)}] y[${c.min.y.toFixed(1)},${c.max.y.toFixed(1)}] z[${c.min.z.toFixed(1)},${c.max.z.toFixed(1)}]`)
  }
  console.log(`    (${shown} total)`)
}
