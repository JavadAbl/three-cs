// Task 151 FINAL gate: office collision-integrity — no passable visible walls.
//
// Regression for the emitWall axis-indexing bug (worklog 151): a[runAxis+1]-
// a[runAxis] read (y0-x1) for runAxis=1, so every ±x-facing wall face with
// y0 > x1 (the whole west+north half of cs_office — office-wing walls,
// doorway-B wall segments, door frames) fell into the grid-band fallback and
// emitted a single 0.01u sliver box: the wall RENDered but had ZERO
// collision ("i can pass Door frames in office"). 1165 boxes were missing.
//
// This gate scans every world+solid near-vertical BSP face (game y-span
// >= 1 m) and FAILS if the player capsule (r=0.4, h=1.8, engine-identical
// strict-inequality test) can stand at any face centre that is REACHABLE —
// i.e. has a walkable floor box top within STEP_UP of the face bottom.
// Unreachable floating faces (below-map cliffs) are allowed.
// Usage: bun scripts/t151-verify-frames.ts   (exit 0 = pass)
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
const nFaces = lumps[7].len / 20
const nTexinfo = lumps[6].len / 40
const nSurfedges = lumps[13].len / 4
const nModels = lumps[14].len / 64
const nLeaves = lumps[10].len / 28
const SCALE = 0.025, Z_REBASE = 576
const tx = (x: number) => x * SCALE
const ty = (z: number) => (z + Z_REBASE) * SCALE
const tz = (y: number) => -y * SCALE

const entRaw = buf.toString('latin1', lumps[0].off, lumps[0].off + lumps[0].len)
const entities: Array<Record<string, string>> = []
for (const m of entRaw.match(/\{[^{}]*\}/g) ?? []) {
  const e: Record<string, string> = {}
  for (const kv of m.match(/"([^"]+)"\s+"([^"]*)"/g) ?? []) {
    const mm = kv.match(/"([^"]+)"\s+"([^"]*)"/)!
    e[mm[1]] = mm[2]
  }
  entities.push(e)
}
const miptexs: Array<{ name: string }> = []
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
  return out
}
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) {
  const m = e.model?.match(/^\*(\d+)$/)
  if (m) modelEnt.set(+m[1], e)
}
const SOLID_MODELS = new Set(['func_wall', 'func_breakable', 'func_button'])
function modelRole(mi: number): 'world' | 'solid' | 'render' | 'skip' {
  if (mi === 0) return 'world'
  const cls = modelEnt.get(mi)?.classname ?? ''
  if (SOLID_MODELS.has(cls)) return 'solid'
  if (cls === 'func_illusionary') return 'render'
  return 'skip'
}
const modelRoots: number[] = []
for (let i = 0; i < nModels; i++) modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))
function collectFaces(root: number): number[] {
  const set = new Set<number>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n >= 0) {
      stack.push(dv.getInt16(lumps[5].off + n * 24 + 4, true), dv.getInt16(lumps[5].off + n * 24 + 6, true))
    } else if (n !== -1) {
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

// shipped boxes — MapDef Box: x/y/z CENTER, w/h/d FULL size (mapview.ts)
type Box = { x: number; y: number; z: number; w: number; h: number; d: number; tex?: string }
const SHIP = ((await import('../mini-services/game-server/map-office')) as { OFFICE: { boxes: Box[] } }).OFFICE.boxes.map(b => ({
  x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, tex: b.tex,
}))
console.log(`shipped office boxes: ${SHIP.length}`)
const R = 0.4, H = 1.8, STEP_UP = 0.55
const blocked = (x: number, feet: number, z: number) => SHIP.some(b =>
  x + R > b.x0 && x - R < b.x1 && feet + H > b.y0 && feet < b.y1 && z + R > b.z0 && z - R < b.z1)
const floorNear = (x: number, z: number, below: number) => {
  let best: number | null = null
  for (const b of SHIP) {
    if (x + R > b.x0 && x - R < b.x1 && z + R > b.z0 && z - R < b.z1 && b.y1 <= below && (best === null || b.y1 > best)) best = b.y1
  }
  return best
}

const OPEN = new Set([1278, 1279, 2424, 2425]) // Task 142: opened door leaves (by design)
let scanned = 0
const reachable: Array<{ fi: number; tex: string; g: number[] }> = []
const unreachable: Array<{ fi: number; tex: string }> = []
for (let mi = 0; mi < nModels; mi++) {
  const role = modelRole(mi)
  if (role !== 'world' && role !== 'solid') continue
  for (const fi of collectFaces(modelRoots[mi])) {
    if (OPEN.has(fi)) continue
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
    const name = miptexs[dv.getInt32(lumps[6].off + f.texinfo * 40 + 32, true)]?.name ?? '?'
    if (name === 'sky' || name === 'aaatrigger') continue
    const o = lumps[1].off + f.planenum * 20
    let nrm = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]
    if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
    if (Math.abs(nrm[2]) >= 0.4) continue // only near-vertical faces
    const vs = faceVerts(f)
    if (!vs.length) continue
    const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
    const y0 = ty(Math.min(...zs)), y1 = ty(Math.max(...zs))
    if (y1 - y0 < 1.0) continue
    scanned++
    const cx = tx((Math.min(...xs) + Math.max(...xs)) / 2)
    const cz = tz((Math.min(...ys) + Math.max(...ys)) / 2)
    if (blocked(cx, y0 + 0.01, cz)) continue
    // passable at face centre — reachable? walkable floor within STEP_UP of the face bottom
    const fl = floorNear(cx, cz, y0 + STEP_UP)
    if (fl !== null && fl >= y0 - STEP_UP) reachable.push({ fi, tex: name, g: [cx, y0, cz] })
    else unreachable.push({ fi, tex: name })
  }
}
console.log(`tall vertical faces scanned: ${scanned}; passable-at-centre: ${reachable.length + unreachable.length} (reachable ${reachable.length}, unreachable-float ${unreachable.length})`)
for (const h of reachable) console.log(`  REACHABLE HOLE ✗ f${h.fi} ${h.tex} game(x${h.g[0].toFixed(1)}, y${h.g[1].toFixed(1)}, z${h.g[2].toFixed(1)})`)
for (const h of unreachable) console.log(`  (unreachable float — allowed) f${h.fi} ${h.tex}`)
if (reachable.length > 0) { console.log('FAIL ✗ — visible walls the player can walk through'); process.exit(1) }
console.log('FINAL STATE CORRECT ✓ — every reachable visible office wall/door frame is solid')
