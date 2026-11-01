// Task 151 probe: "i can pass Door frames in office" — find door-frame geometry
// in upload/cs_office.bsp, determine its model role (world/solid/render/skip),
// and check whether the SHIPPED collision boxes (mini-services/game-server/
// map-office.ts, same bytes as src/game/map-office.ts) actually cover it.
//
// Output: per-miptex door/frame-ish inventory, per-entity model dump, and a
// player-capsule pass-through test for every door/frame-ish face in game space.
// Usage: bun scripts/t151-doorframe-probe.ts
import { readFileSync } from 'fs'
import { OFFICE } from '../mini-services/game-server/map-office'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
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
const nModels = lumps[14].len / 64
const SCALE = 0.025, Z_REBASE = 576
const tx = (x: number) => x * SCALE
const ty = (z: number) => (z + Z_REBASE) * SCALE
const tz = (y: number) => -y * SCALE

// ---------- entities ----------
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

// ---------- miptex / texinfo / planes / faces ----------
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
function planeOf(pn: number) {
  const o = lumps[1].off + pn * 20
  return { n: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)], d: dv.getFloat32(o + 12, true) }
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

// ---------- models ----------
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) {
  const m = e.model?.match(/^\*(\d+)$/)
  if (m) modelEnt.set(+m[1], e)
}
const SOLID_MODELS = new Set(['func_wall', 'func_breakable', 'func_button'])
const RENDER_MODELS = new Set([...SOLID_MODELS, 'func_illusionary'])
function modelRole(mi: number): 'world' | 'solid' | 'render' | 'skip' {
  if (mi === 0) return 'world'
  const cls = modelEnt.get(mi)?.classname ?? ''
  if (RENDER_MODELS.has(cls)) return SOLID_MODELS.has(cls) ? 'solid' : 'render'
  return 'skip'
}
const modelRoots: number[] = []
const modelBounds: number[][] = []
for (let i = 0; i < nModels; i++) {
  modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))
  const o = lumps[14].off + i * 64
  modelBounds.push([
    dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true),
    dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true),
  ])
}
// identical to convert-office.ts collectFaces (proven leaf walk)
const nLeaves = lumps[10].len / 28
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

// ---------- shipped boxes (MapDef Box: x/y/z CENTER, w/h/d FULL size — mapview.ts min=x-w/2) ----------
const SHIP = OFFICE.boxes.map(b => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, y0: b.y - b.h / 2, y1: b.y + b.h / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, tex: b.tex }))
console.log(`shipped office boxes: ${SHIP.length}`)
// spatial hash for speed
const CELL = 4
const grid = new Map<string, number[]>()
SHIP.forEach((b, i) => {
  const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL)
  const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL)
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const k = `${cx},${cz}`
    ;(grid.get(k) ?? grid.set(k, []).get(k)!).push(i)
  }
})
function boxesNear(x0: number, x1: number, z0: number, z1: number) {
  const out: number[] = []
  const seen = new Set<number>()
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++)
      for (const i of grid.get(`${cx},${cz}`) ?? []) {
        if (!seen.has(i)) { seen.add(i); out.push(i) }
      }
  return out
}
// player capsule (feet at y, STAND_H tall, r 0.4) overlap test vs shipped boxes — engine parity
const PLAYER_R = 0.4, STAND_H = 1.8
function capsuleBlocked(x: number, feet: number, z: number): boolean {
  for (const i of boxesNear(x - PLAYER_R, x + PLAYER_R, z - PLAYER_R, z + PLAYER_R)) {
    const b = SHIP[i]
    if (x + PLAYER_R > b.x0 && x - PLAYER_R < b.x1 &&
      feet + STAND_H > b.y0 && feet < b.y1 &&
      z + PLAYER_R > b.z0 && z - PLAYER_R < b.z1) return true
  }
  return false
}

// ---------- 1. entity model dump ----------
console.log(`\n=== ${nModels} models; non-world entities ===`)
for (let mi = 1; mi < nModels; mi++) {
  const e = modelEnt.get(mi)
  if (!e) continue
  const role = modelRole(mi)
  const b = modelBounds[mi]
  const g = { x0: tx(b[0]), x1: tx(b[3]), y0: ty(b[2]), y1: ty(b[5]), z0: tz(b[4]), z1: tz(b[1]) }
  const texs = new Set<string>()
  for (const fi of collectFaces(modelRoots[mi])) {
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
    texs.add(miptexs[texMip[f.texinfo]]?.name ?? '?')
  }
  const tag = role === 'render' ? ' **RENDER-ONLY (no collision)**' : role === 'skip' ? ' **SKIPPED (not even rendered)**' : role === 'solid' ? ' solid' : ''
  console.log(`m${mi} ${e.classname}${tag} bounds x[${g.x0.toFixed(1)},${g.x1.toFixed(1)}] y[${g.y0.toFixed(1)},${g.y1.toFixed(1)}] z[${g.z0.toFixed(1)},${g.z1.toFixed(1)}] tex=[${[...texs].slice(0, 6).join(' ')}]${e.targetname ? ' target=' + e.targetname : ''}`)
}

// ---------- 2. door/frame-ish miptex inventory over world+solid faces ----------
const DOORISH = /door|frame|trim|dr1k|sphinx_trim|jamb|arch/i
const OPEN = new Set([1278, 1279, 2424, 2425])
console.log(`\n=== door/frame-ish miptex usage (world+solid faces) ===`)
const perTex = new Map<string, { n: number; areaU: number; models: Set<number>; notCovered: number; faceList: number[] }>()
for (let mi = 0; mi < nModels; mi++) {
  const role = modelRole(mi)
  if (role === 'skip' || role === 'render') continue
  for (const fi of collectFaces(modelRoots[mi])) {
    if (OPEN.has(fi)) continue
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
    const name = miptexs[texMip[f.texinfo]]?.name ?? '?'
    if (!DOORISH.test(name)) continue
    const vs = faceVerts(f)
    if (!vs.length) continue
    const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), d = Math.max(...zs) - Math.min(...zs)
    const areaU = 2 * (w * h + h * d + w * d)
    // game-space aabb
    const g = { x0: tx(Math.min(...xs)), x1: tx(Math.max(...xs)), y0: ty(Math.min(...zs)), y1: ty(Math.max(...zs)), z0: tz(Math.max(...ys)), z1: tz(Math.min(...ys)) }
    // is the face's solid footprint covered? box area overlapping the face plane region
    let covered = false
    for (const i of boxesNear(g.x0, g.x1, g.z0, g.z1)) {
      const b = SHIP[i]
      if (b.x0 < g.x1 && b.x1 > g.x0 && b.y0 < g.y1 && b.y1 > g.y0 && b.z0 < g.z1 && b.z1 > g.z0) { covered = true; break }
    }
    const rec = perTex.get(name) ?? { n: 0, areaU: 0, models: new Set<number>(), notCovered: 0, faceList: [] }
    rec.n++; rec.areaU += areaU; rec.models.add(mi)
    if (!covered) { rec.notCovered++; if (rec.faceList.length < 8) rec.faceList.push(fi) }
    perTex.set(name, rec)
  }
}
for (const [name, r] of [...perTex].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${name}: faces=${r.n} notCoveredByShippedBoxes=${r.notCovered} models=[${[...r.models].join(',')}] sampleFaces=[${r.faceList.join(',')}]`)
}

// ---------- 3. PASSABLE-VISIBLE-FACE scan (world+solid only) ----------
// A vertical face (|nz|<0.4) with game y-span >= 1.0 m whose XZ center admits
// the player capsule (feet at face bottom) = the player can walk through it.
const planesArr: number[][] = []
for (let i = 0; i < nPlanes; i++) {
  const o = lumps[1].off + i * 20
  planesArr.push([dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)])
}
interface Hit { tex: string; fi: number; g: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } }
const passable: Hit[] = []
let nVert = 0
for (let mi = 0; mi < nModels; mi++) {
  const role = modelRole(mi)
  if (role !== 'world' && role !== 'solid') continue
  for (const fi of collectFaces(modelRoots[mi])) {
    if (OPEN.has(fi)) continue
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
    const name = miptexs[texMip[f.texinfo]]?.name ?? '?'
    if (name === 'sky' || name === 'aaatrigger') continue
    const vs = faceVerts(f)
    if (!vs.length) continue
    const pl = planesArr[f.planenum]
    let nrm = pl
    if (f.side === 1) nrm = [-pl[0], -pl[1], -pl[2]]
    if (Math.abs(nrm[2]) >= 0.4) continue // only near-vertical faces
    nVert++
    const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
    const g = {
      x0: tx(Math.min(...xs)), x1: tx(Math.max(...xs)),
      y0: ty(Math.min(...zs)), y1: ty(Math.max(...zs)),
      z0: tz(Math.max(...ys)), z1: tz(Math.min(...ys)),
    }
    if (g.y1 - g.y0 < 1.0) continue        // baseboards/low trim: cannot walk over anyway
    const cx = (g.x0 + g.x1) / 2, cz = (g.z0 + g.z1) / 2
    if (!capsuleBlocked(cx, g.y0 + 0.01, cz)) passable.push({ tex: name, fi, g })
  }
}
console.log(`\n=== PASSABLE visible vertical faces (y-span>=1m, capsule at centre unblocked): ${passable.length}/${nVert} tall vertical faces ===`)
const byTex = new Map<string, Hit[]>()
for (const h of passable) { (byTex.get(h.tex) ?? byTex.set(h.tex, []).get(h.tex)!).push(h) }
for (const [t, arr] of [...byTex].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n-- ${t}: ${arr.length} faces --`)
  for (const h of arr.slice(0, 12)) {
    console.log(`   f${h.fi} x[${h.g.x0.toFixed(1)},${h.g.x1.toFixed(1)}] y[${h.g.y0.toFixed(1)},${h.g.y1.toFixed(1)}] z[${h.g.z0.toFixed(1)},${h.g.z1.toFixed(1)}]`)
  }
  if (arr.length > 12) console.log(`   … +${arr.length - 12} more`)
}
