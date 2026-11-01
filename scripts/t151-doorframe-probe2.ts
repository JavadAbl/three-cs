// Task 151 probe v2: region dumps + capsule walk-through tests at office doorways.
// For a set of regions: list BSP faces (tex, role, game AABB) and shipped boxes;
// then simulate the engine's movePlayer crossing test (PLAYER_R 0.4, STAND_H 1.8)
// along lines crossing the doorway plane — inside the opening, and through the
// frame posts either side. Prints PASSABLE points (no box blocks the capsule).
// Usage: bun scripts/t151-doorframe-probe2.ts
import { readFileSync } from 'fs'
import { OFFICE } from '../mini-services/game-server/map-office'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nFaces = lumps[7].len / 20
const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
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
const texMip: number[] = []
for (let i = 0; i < nTexinfo; i++) texMip.push(dv.getInt32(lumps[6].off + i * 40 + 32, true))
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
// all faces of included models (world+solid+render), game-space
interface GF { fi: number; tex: string; role: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; nx: number; ny: number; nz: number }
const gf: GF[] = []
{
  const OPEN = new Set([1278, 1279, 2424, 2425])
  for (let mi = 0; mi < nModels; mi++) {
    const role = modelRole(mi)
    if (role === 'skip') continue
    for (const fi of collectFaces(modelRoots[mi])) {
      if (OPEN.has(fi)) continue
      const f = faces[fi]
      if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
      const name = miptexs[texMip[f.texinfo]]?.name ?? '?'
      if (name === 'sky' || name === 'aaatrigger') continue
      const vs = faceVerts(f)
      if (!vs.length) continue
      const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
      let nrm = [0, 0, 0]
      const o = lumps[1].off + f.planenum * 20
      nrm = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]
      if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
      gf.push({
        fi, tex: name, role,
        x0: tx(Math.min(...xs)), x1: tx(Math.max(...xs)),
        y0: ty(Math.min(...zs)), y1: ty(Math.max(...zs)),
        z0: tz(Math.max(...ys)), z1: tz(Math.min(...ys)),
        nx: nrm[0], ny: nrm[1], nz: nrm[2],
      })
    }
  }
}

// shipped boxes (MapDef Box: x/y/z CENTER, w/h/d FULL size)
const SHIP = OFFICE.boxes.map(b => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, tex: b.tex }))
const CELL = 4
const grid = new Map<string, number[]>()
SHIP.forEach((b, i) => {
  for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++)
    for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
      const k = `${cx},${cz}`
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k)!.push(i)
    }
})
const PLAYER_R = 0.4, STAND_H = 1.8
function blockingBoxesAt(x: number, feet: number, z: number) {
  const out: number[] = []
  for (let cx = Math.floor((x - PLAYER_R) / CELL); cx <= Math.floor((x + PLAYER_R) / CELL); cx++)
    for (let cz = Math.floor((z - PLAYER_R) / CELL); cz <= Math.floor((z + PLAYER_R) / CELL); cz++)
      for (const i of grid.get(`${cx},${cz}`) ?? []) {
        const b = SHIP[i]
        if (x + PLAYER_R > b.x0 && x - PLAYER_R < b.x1 &&
          feet + STAND_H > b.y0 && feet < b.y1 &&
          z + PLAYER_R > b.z0 && z - PLAYER_R < b.z1) out.push(i)
      }
  return out
}
function blockedAt(x: number, feet: number, z: number) { return blockingBoxesAt(x, feet, z).length > 0 }

// ground level under a point (highest box top below feet+0.6, within 3.5m)
function groundAt(x: number, z: number, below: number): number | null {
  let best: number | null = null
  for (let cx = Math.floor((x - PLAYER_R) / CELL); cx <= Math.floor((x + PLAYER_R) / CELL); cx++)
    for (let cz = Math.floor((z - PLAYER_R) / CELL); cz <= Math.floor((z + PLAYER_R) / CELL); cz++)
      for (const i of grid.get(`${cx},${cz}`) ?? []) {
        const b = SHIP[i]
        if (!(x + PLAYER_R > b.x0 && x - PLAYER_R < b.x1 && z + PLAYER_R > b.z0 && z - PLAYER_R < b.z1)) continue
        if (b.y1 <= below + 0.01 && (best === null || b.y1 > best)) best = b.y1
      }
  return best
}

// ---------- region dumps ----------
function dumpRegion(name: string, R: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }) {
  console.log(`\n=== region ${name} x[${R.x0},${R.x1}] y[${R.y0},${R.y1}] z[${R.z0},${R.z1}] ===`)
  const inR = (g: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }) =>
    g.x0 < R.x1 && g.x1 > R.x0 && g.y0 < R.y1 && g.y1 > R.y0 && g.z0 < R.z1 && g.z1 > R.z0
  console.log('-- BSP faces (door/trim/doorway-relevant tex only) --')
  for (const g of gf) {
    if (!inR(g)) continue
    if (!/door|trim|dr1k|frame|glass|window/i.test(g.tex)) continue
    console.log(`  f${g.fi} ${g.tex} [${g.role}] x[${g.x0.toFixed(2)},${g.x1.toFixed(2)}] y[${g.y0.toFixed(2)},${g.y1.toFixed(2)}] z[${g.z0.toFixed(2)},${g.z1.toFixed(2)}] n=(${g.nx.toFixed(2)},${g.nz.toFixed(2)})`)
  }
  console.log('-- shipped boxes --')
  for (let i = 0; i < SHIP.length; i++) {
    const b = SHIP[i]
    if (!inR(b)) continue
    console.log(`  b${i} ${b.tex} x[${b.x0.toFixed(2)},${b.x1.toFixed(2)}] y[${b.y0.toFixed(2)},${b.y1.toFixed(2)}] z[${b.z0.toFixed(2)},${b.z1.toFixed(2)}]`)
  }
}

// ---------- walk-through line test ----------
function walkLine(name: string, axis: 'x' | 'z', from: number, to: number, at: number, feet: number, step = 0.05) {
  // walk along `axis` from `from` to `to`, other coord fixed at `at`
  const segs: string[] = []
  let openStart: number | null = null
  for (let t = from; t <= to; t += step) {
    const x = axis === 'x' ? t : at
    const z = axis === 'x' ? at : t
    const bl = blockedAt(x, feet, z)
    if (!bl && openStart === null) openStart = t
    if (bl && openStart !== null) { segs.push(`PASSABLE ${axis}[${openStart.toFixed(2)},${t.toFixed(2)}]`); openStart = null }
  }
  if (openStart !== null) segs.push(`PASSABLE ${axis}[${openStart.toFixed(2)},${to.toFixed(2)}]`)
  console.log(`  walk ${name}: feet=${feet.toFixed(2)} ${axis} from ${from} to ${to} at ${axis === 'x' ? 'z' : 'x'}=${at} -> ${segs.length ? segs.join(' | ') : 'FULLY BLOCKED'}`)
}

// doorway B: wall along z at x≈12.8 (leaf 1278/1279 at bsp x=512), opening game z -25.5..-22.5, floor y 10.45
// (Box is CENTER+w/h/d full size per mapview.ts; feet exactly ON the floor top like t142-verify-doors)
dumpRegion('doorway B (office wing S door, opened)', { x0: 9.5, x1: 15.5, y0: 9.5, y1: 13.0, z0: -27, z1: -20 })
walkLine('B crossing wall x, through z=-23.9 (opening centre)', 'x', 10.5, 14.5, -23.9, 10.45)
walkLine('B crossing wall x, through z=-22.0 (wall S of opening)', 'x', 10.5, 14.5, -22.0, 10.45)
walkLine('B crossing wall x, through z=-21.2 (hallway_10 wall)', 'x', 10.5, 14.5, -21.2, 10.45)
walkLine('B crossing wall x, through z=-26.0 (wall N of opening)', 'x', 10.5, 14.5, -26.0, 10.45)

// doorway C: wall along z at x≈30.8 (leaf 2424/2425 at bsp x=1232), opening game z 20.9..23.9
dumpRegion('doorway C (paper room door, opened)', { x0: 28.5, x1: 34, y0: 9.5, y1: 13.0, z0: 20, z1: 25 })
walkLine('C crossing wall x, z=22.4 (opening)', 'x', 28.5, 33, 22.4, 10.45)
walkLine('C crossing wall x, z=20.2 (wall N of opening)', 'x', 28.5, 33, 20.2, 10.45)
walkLine('C crossing wall x, z=24.6 (wall S of opening)', 'x', 28.5, 33, 24.6, 10.45)
