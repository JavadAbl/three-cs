// ============================================================
// BSP v30 → game map converter (aim_headshot)
// Produces:
//   public/assets/maps/aimhead/textures/*.png   (extracted miptex)
//   public/assets/maps/aimhead/geom.json        (triangle groups per texture)
//   public/assets/maps/aimhead/faces-debug.png  (top-down texture map render)
//   src/game/map-aimhead.ts                     (MapDef: boxes/spawns/sites/waypoints)
//   bots GRAPHS config snippet (printed to stdout)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ppm2png } from './ppm2png'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const OUT_DIR = '/home/z/my-project/public/assets/maps/aimhead'
const SCALE = 0.025          // 1 bsp unit = 0.025 m (72u player = 1.8m)
const Z_REBASE = 192         // bsp z=-192 (skybox bottom) → our y 0
const CELL = 16              // voxel cell (bsp units)

mkdirSync(`${OUT_DIR}/textures`, { recursive: true })

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
const nNodes = lumps[5].len / 24
const nMarkSurf = lumps[11].len / 2

// ---------------- entities ----------------
const entRaw = buf.toString('latin1', lumps[0].off, lumps[0].off + lumps[0].len)
const entities: Array<Record<string, string>> = []
for (const m of entRaw.match(/\{[^{}]*\}/g) ?? []) {
  const e: Record<string, string> = {}
  for (const kv of m.match(/"([^"]+)"\s+"([^"]*)"/g) ?? []) {
    const [, k, v] = kv.match(/"([^"]+)"\s+"([^"]*)"/)!
    e[k] = v
  }
  entities.push(e)
}

// ---------------- solid oracle: nodes tree (hull0, true geometry) ----------------
// returns: -1 = solid, 0 = empty, -6 = sky, -2 = other-liquid
function contentsAt(x: number, y: number, z: number, root = 0): number {
  let n = root
  let guard = 0
  while (n >= 0 && guard++ < 300) {
    const o = lumps[5].off + n * 24
    const planenum = dv.getInt32(o, true)
    const po = lumps[1].off + planenum * 20
    const nx = dv.getFloat32(po, true), ny = dv.getFloat32(po + 4, true), nz = dv.getFloat32(po + 8, true), d = dv.getFloat32(po + 12, true)
    const side = (nx * x + ny * y + nz * z - d) >= 0 ? 0 : 1
    const child = dv.getInt16(o + 4 + side * 2, true)
    if (child >= 0) { n = child; continue }
    if (child === -1) return 0 // shared empty leaf 0
    const l = ~child
    return l < nLeaves ? dv.getInt32(lumps[10].off + l * 28, true) : 0
  }
  return 0
}
const solid = (x: number, y: number, z: number) => contentsAt(x, y, z) === -1

// ---------------- miptex ----------------
interface MipTex { name: string; w: number; h: number; dataOff: number; palOff: number }
const miptexs: MipTex[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push({ name: `wad${i}`, w: 128, h: 128, dataOff: -1, palOff: -1 }); continue }
    const p = base + rel
    let name = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '').replace(/[^A-Za-z0-9_-]/g, '')
    const w = dv.getUint32(p + 16, true), h = dv.getUint32(p + 20, true)
    const o0 = dv.getUint32(p + 24, true)
    const o3 = dv.getUint32(p + 36, true)
    const mip3Size = Math.max(1, (w >> 3)) * Math.max(1, (h >> 3))
    miptexs.push({ name: name || `tex${i}`, w, h, dataOff: p + o0, palOff: p + o3 + mip3Size + 2 })
  }
}

// ---------------- texinfo ----------------
interface TexInfo { s: number[]; ss: number; t: number[]; st: number; miptex: number }
const texinfos: TexInfo[] = []
for (let i = 0; i < nTexinfo; i++) {
  const o = lumps[6].off + i * 40
  texinfos.push({
    s: [0, 1, 2].map(k => dv.getFloat32(o + k * 4, true)),
    ss: dv.getFloat32(o + 12, true),
    t: [0, 1, 2].map(k => dv.getFloat32(o + 16 + k * 4, true)),
    st: dv.getFloat32(o + 28, true),
    miptex: dv.getInt32(o + 32, true),
  })
}

// BSP texture name → our surface material id
// (real pixels live in external WADs we don't have — use our texture library)
function ourTex(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('crate') || n.includes('wood')) return 'crate'
  if (n.includes('mltry') || n.includes('metal')) return 'metal'
  if (n.includes('stat')) return 'dark'
  if (n.includes('trim')) return 'plank'
  if (n.includes('wll') || n.includes('wall') || n.includes('brick')) return 'brick'
  if (n.includes('dirt') || n.includes('moss') || n.includes('grass') || n.includes('floor') || n.includes('ground')) return 'sand'
  return 'concrete'
}

// ---------------- faces ----------------
interface Face { planenum: number; side: number; firstedge: number; numedges: number; texinfo: number }
const faces: Face[] = []
for (let i = 0; i < nFaces; i++) {
  const o = lumps[7].off + i * 20
  faces.push({
    planenum: dv.getUint16(o, true),
    side: dv.getUint8(o + 2),
    firstedge: dv.getInt32(o + 4, true),
    numedges: dv.getUint16(o, 8, true),
    texinfo: dv.getInt16(o + 10, true),
  })
}
function faceVerts(f: Face): number[][] {
  const out: number[][] = []
  for (let k = 0; k < f.numedges; k++) {
    const se = dv.getInt32(lumps[13].off + (f.firstedge + k) * 4, true)
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    out.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  return out
}
function planeOf(planenum: number): { n: number[]; d: number } {
  const po = lumps[1].off + planenum * 20
  return { n: [dv.getFloat32(po, true), dv.getFloat32(po + 4, true), dv.getFloat32(po + 8, true)], d: dv.getFloat32(po + 12, true) }
}

// ---------------- collect world faces (leaf walk, both models) ----------------
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
const nModels = lumps[14].len / 64
const modelRoots: number[] = []
for (let i = 0; i < nModels; i++) modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))
const worldFaceIdx = collectFaces(modelRoots[0]).concat(collectFaces(modelRoots[1] ?? -1))
console.log(`faces: total=${nFaces}, world+submodels=${worldFaceIdx.length}`)

// coordinate transform bsp → our game (x, y up, z south)
const tx = (x: number) => +(x * SCALE).toFixed(4)
const ty = (z: number) => +((z + Z_REBASE) * SCALE).toFixed(4)
const tz = (y: number) => +(-y * SCALE).toFixed(4)

// ---------------- (texture extraction skipped: all pixels external in WADs) ----------------
const SKIP_TEX = new Set(['sky', 'invisible'])
console.log('miptex names (external WAD pixels):', miptexs.map(m => m.name).join(', '))

// ---------------- build render geometry groups ----------------
interface Group { tex: string; pos: number[]; norm: number[]; uv: number[]; idx: number[] }
const groups = new Map<string, Group>()
for (const fi of worldFaceIdx) {
  const f = faces[fi]
  const ti = texinfos[f.texinfo]
  if (!ti) continue
  const mt = miptexs[ti.miptex] ?? miptexs[0]
  let texName = mt?.name ?? 'concrete'
  // animated frame prefix: "-0AzDirt" → "AzDirt" (keep frame 0, drop later frames)
  const mAnim = texName.match(/^-([0-9])(.+)$/)
  if (mAnim && mAnim[1] !== '0') continue // skip frames 1..3
  if (mAnim) texName = mAnim[2]
  if (SKIP_TEX.has(texName) || texName.startsWith('{') || texName === 'invisible') continue
  texName = ourTex(texName) // map to our surface material
  const g = groups.get(texName) ?? { tex: texName, pos: [], norm: [], uv: [], idx: [] } as Group
  const pl = planeOf(f.planenum)
  let nrm = pl.n
  if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
  // our-space normal
  const nOur = [nrm[0], nrm[2], -nrm[1]]
  const tw = mt?.w ?? 128, th = mt?.h ?? 128
  const vs = faceVerts(f)
  const base = g.pos.length / 3
  for (const v of vs) {
    g.pos.push(tx(v[0]), ty(v[2]), tz(v[1]))
    g.norm.push(nOur[0], nOur[1], nOur[2])
    const u = (v[0] * ti.s[0] + v[1] * ti.s[1] + v[2] * ti.s[2] + ti.ss) / tw
    const vv = (v[0] * ti.t[0] + v[1] * ti.t[1] + v[2] * ti.t[2] + ti.st) / th
    g.uv.push(+u.toFixed(4), +(1 - vv).toFixed(4))
  }
  for (let k = 1; k < vs.length - 1; k++) {
    if (f.side === 1) g.idx.push(base, base + k + 1, base + k)
    else g.idx.push(base, base + k, base + k + 1)
  }
  groups.set(texName, g)
}
const geom = { groups: [...groups.values()] }
writeFileSync(`${OUT_DIR}/geom.json`, JSON.stringify(geom))
console.log('geom groups:', [...groups.keys()].map(k => `${k}(${groups.get(k)!.idx.length / 3}tris)`).join(' '))

// ---------------- voxelization → collision boxes ----------------
const wmin = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + k * 4, true))
const wmax = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + 12 + k * 4, true))
const NX = Math.ceil((wmax[0] - wmin[0]) / CELL)
const NY = Math.ceil((wmax[1] - wmin[1]) / CELL)
const NZ = Math.ceil((wmax[2] - wmin[2]) / CELL)
const vox = new Uint8Array(NX * NY * NZ)
let solidCount = 0
for (let iz = 0; iz < NZ; iz++) {
  const z = wmin[2] + (iz + 0.5) * CELL
  for (let iy = 0; iy < NY; iy++) {
    const y = wmin[1] + (iy + 0.5) * CELL
    for (let ix = 0; ix < NX; ix++) {
      const x = wmin[0] + (ix + 0.5) * CELL
      if (solid(x, y, z) || solid(x, y, z + 2)) {  // +2: floor cells whose top surface sits inside the upper cell
        vox[(iz * NY + iy) * NX + ix] = 1
        solidCount++
      }
    }
  }
}
console.log(`voxels: ${NX}x${NY}x${NZ} = ${NX * NY * NZ}, solid=${solidCount}`)

// greedy 3D merge: rectangles per z-layer, then stack in z
interface Rect { ix0: number; ix1: number; iy0: number; iy1: number; z0: number; z1: number }
const rects: Rect[] = []
{
  for (let iz = 0; iz < NZ; iz++) {
    const used = new Uint8Array(NX * NY)
    for (let iy = 0; iy < NY; iy++) {
      for (let ix = 0; ix < NX; ix++) {
        if (used[iy * NX + ix] || !vox[(iz * NY + iy) * NX + ix]) continue
        // expand x
        let ix1 = ix
        while (ix1 + 1 < NX && !used[iy * NX + ix1 + 1] && vox[(iz * NY + iy) * NX + ix1 + 1]) ix1++
        // expand y
        let iy1 = iy
        outer: while (iy1 + 1 < NY) {
          for (let k = ix; k <= ix1; k++) if (used[(iy1 + 1) * NX + k] || !vox[(iz * NY + iy1 + 1) * NX + k]) break outer
          iy1++
        }
        for (let yy = iy; yy <= iy1; yy++) for (let xx = ix; xx <= ix1; xx++) used[yy * NX + xx] = 1
        rects.push({ ix0: ix, ix1: ix + 1, iy0: iy, iy1: iy1 + 1, z0: iz, z1: iz + 1 })
      }
    }
  }
  // stack identical xy-rects across z
  rects.sort((a, b) => (a.ix0 - b.ix0) || (a.iy0 - b.iy0) || (a.z0 - b.z0))
  const merged: Rect[] = []
  const key = (r: Rect) => `${r.ix0}_${r.ix1}_${r.iy0}_${r.iy1}`
  const byKey = new Map<string, Rect[]>()
  for (const r of rects) {
    const k = key(r)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(r)
  }
  for (const rs of byKey.values()) {
    rs.sort((a, b) => a.z0 - b.z0)
    let cur = rs[0]
    for (let i = 1; i < rs.length; i++) {
      if (rs[i].z0 === cur.z1) { cur.z1 = rs[i].z1 }  // contiguous — extend
      else { merged.push(cur); cur = rs[i] }
    }
    merged.push(cur)
  }
  rects.length = 0
  rects.push(...merged)
}
console.log('collision boxes after merge:', rects.length)

// emit Box[] in our coords. tex heuristic: low boxes = ground(sand), tall = wall, mid = brick
interface BoxOut { x: number; y: number; z: number; w: number; h: number; d: number; tex: string }
const boxes: BoxOut[] = []
for (const r of rects) {
  const x0 = wmin[0] + r.ix0 * CELL, x1 = wmin[0] + r.ix1 * CELL
  const y0 = wmin[1] + r.iy0 * CELL, y1 = wmin[1] + r.iy1 * CELL
  const z0 = wmin[2] + r.z0 * CELL, z1 = wmin[2] + r.z1 * CELL
  const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2, cy = (z0 + z1) / 2
  const hM = (z1 - z0) * SCALE
  const tex = hM < 0.75 ? 'sand' : hM < 3 ? 'brick' : 'wall'
  boxes.push({
    x: +tx(cx).toFixed(3), y: +ty(cy).toFixed(3), z: +tz(cz).toFixed(3),
    w: +((x1 - x0) * SCALE).toFixed(3), h: +hM.toFixed(3), d: +((y1 - y0) * SCALE).toFixed(3),
    tex,
  })
}
// drop microscopic boxes (keep physics clean)
const boxesFinal = boxes.filter(b => b.w > 0.15 && b.d > 0.15 && b.h > 0.1)
console.log('boxes after micro-filter:', boxesFinal.length)

// ---------------- spawns ----------------
// entity origins are unreliable (this BSP has spawns embedded in geometry) —
// relocate to the nearest standable column (free band ≥ 76 units)
function standableFloor(x: number, y: number): number | null {
  let bestFloor: number | null = null
  let freeStart: number | null = null
  for (let z = 460; z >= -190; z -= 8) {
    const free = !solid(x, y, z)
    if (free && freeStart === null) freeStart = z
    if (!free && freeStart !== null) {
      const bandLo = z + 8, bandHi = freeStart
      if (bandHi - bandLo >= 76 && (bestFloor === null || bandLo > bestFloor)) bestFloor = bandLo
      freeStart = null
    }
  }
  return bestFloor
}
function findSpawn(x: number, y: number): { x: number; y: number; floor: number } | null {
  // spiral search around the entity origin for a standable column
  for (let r = 0; r <= 384; r += 32) {
    for (let dy = -r; dy <= r; dy += 32) {
      for (let dx = -r; dx <= r; dx += 32) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue // ring only
        const f = standableFloor(x + dx, y + dy)
        if (f !== null) return { x: x + dx, y: y + dy, floor: f }
      }
    }
  }
  return null
}
const spawnCT: number[][] = []
const spawnT: number[][] = []
for (const e of entities) {
  if (e.classname !== 'info_player_start' && e.classname !== 'info_player_deathmatch') continue
  const [x, y] = e.origin!.split(' ').map(Number)
  const s = findSpawn(x, y)
  if (!s) { console.log(`spawn ${e.classname} @(${x},${y}) — no standable spot within 384u!`); continue }
  const arr = e.classname === 'info_player_start' ? spawnCT : spawnT
  arr.push([tx(s.x), ty(s.floor), tz(s.y)])
}
console.log(`spawns: CT=${spawnCT.length} T=${spawnT.length}`)
// dedupe close spawns (same spot after snapping)
function dedupe(a: number[][]): number[][] {
  const out: number[][] = []
  for (const p of a) {
    if (!out.some(q => Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.9)) out.push(p)
  }
  return out
}
const sCT = dedupe(spawnCT).slice(0, 10)
const sT = dedupe(spawnT).slice(0, 10)

// face enemy side: CT west faces east (+x → yaw -π/2); T east faces west (+π/2)
const sCTf = sCT.map(p => [...p, -Math.PI / 2])
const sTf = sT.map(p => [...p, Math.PI / 2])
console.log('CT spawns (our coords):', sCTf.map(p => p.map(v => +v.toFixed(1))).slice(0, 5))
console.log('T spawns (our coords):', sTf.map(p => p.map(v => +v.toFixed(1))).slice(0, 5))

// ---------------- sites (synthesized) ----------------
const ctC = sCT.reduce((a, p) => [a[0] + p[0] / sCT.length, a[1] + p[1] / sCT.length, a[2] + p[2] / sCT.length], [0, 0, 0])
const tC = sT.reduce((a, p) => [a[0] + p[0] / sT.length, a[1] + p[1] / sT.length, a[2] + p[2] / sT.length], [0, 0, 0])
const sites = {
  A: { x: +ctC[0].toFixed(2), z: +ctC[2].toFixed(2), y: +ctC[1].toFixed(2), r: 5 },
  B: { x: +tC[0].toFixed(2), z: +tC[2].toFixed(2), y: +tC[1].toFixed(2), r: 5 },
}
console.log('sites:', JSON.stringify(sites))

// ---------------- waypoints from walkable floor grid ----------------
const WP_STEP = 64 // bsp units (1.6 m)
interface WP { id: string; x: number; y: number; z: number }
const wps: WP[] = []
const wpIdx = new Map<string, number>() // "ix_iy" → array of floors (z)
for (let iy = 0; iy < NY; iy += WP_STEP / CELL) {
  for (let ix = 0; ix < NX; ix += WP_STEP / CELL) {
    const x = wmin[0] + (ix + 0.5) * CELL
    const y = wmin[1] + (iy + 0.5) * CELL
    // find all floors in this column: free with solid below, headroom 84
    for (let z = 460; z >= -190; z -= 8) {
      const free = !solid(x, y, z + 4) && !solid(x, y, z + 42) && !solid(x, y, z + 80)
      if (free && solid(x, y, z - 6)) {
        wps.push({ id: `w${ix}_${iy}_${Math.round(z)}`, x: tx(x), y: ty(z), z: tz(y) })
      }
    }
  }
}
// dedupe floors that are too close vertically (terraces: keep one per ~0.5m)
const wpsClean: WP[] = []
const byCol = new Map<string, WP[]>()
for (const w of wps) {
  const k = w.id.split('_').slice(0, 2).join('_')
  if (!byCol.has(k)) byCol.set(k, [])
  byCol.get(k)!.push(w)
}
for (const ws of byCol.values()) {
  ws.sort((a, b) => a.y - b.y)
  let lastY = -99
  for (const w of ws) {
    if (w.y - lastY > 0.45) { wpsClean.push(w); lastY = w.y }
  }
}
console.log('waypoints:', wpsClean.length)

// edges: 8-neighbor columns, Δy ≤ 0.85
const edges: Array<[string, string]> = []
const colW = new Map<string, WP[]>()
for (const w of wpsClean) {
  const k = w.id.split('_').slice(0, 2).join('_')
  if (!colW.has(k)) colW.set(k, [])
  colW.get(k)!.push(w)
}
for (const [k, ws] of colW) {
  const [ix, iy] = k.replace(/^w/, '').split('_').map(Number)
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const nk = `w${ix + dx * (WP_STEP / CELL)}_${iy + dy * (WP_STEP / CELL)}`
    const nws = colW.get(nk)
    if (!nws) continue
    for (const a of ws) for (const b of nws) {
      if (Math.abs(a.y - b.y) <= 0.85 && Math.hypot(a.x - b.x, a.z - b.z) < 2.4) edges.push([a.id, b.id])
    }
  }
}
console.log('waypoint edges:', edges.length)

// ---------------- bounds ----------------
const bounds = {
  minX: +tx(wmin[0] + 32).toFixed(2), maxX: +tx(wmax[0] - 32).toFixed(2),
  minZ: +tz(wmax[1] - 32).toFixed(2), maxZ: +tz(wmin[1] + 32).toFixed(2),
}
console.log('bounds:', JSON.stringify(bounds))

// ---------------- generate MapDef TS module ----------------
const def = `// GENERATED from aim_headshot.bsp (BSP v30) by scripts/bsp/convert.ts — do not edit by hand
import type { MapDef, Box, WP } from './mapdata'

export const AIMHEAD: MapDef = {
  id: 'aimhead',
  name: 'Aim Headshot',
  version: 1,
  bsp: { geomUrl: '/assets/maps/aimhead/geom.json' },
  boxes: ${JSON.stringify(boxesFinal)},
  losBoxes: ${JSON.stringify(boxesFinal)},
  spawns: {
    CT: ${JSON.stringify(sCTf.map(p => ({ x: p[0], y: p[1], z: p[2] })))},
    T: ${JSON.stringify(sTf.map(p => ({ x: p[0], y: p[1], z: p[2] })))},
  },
  spawnYaw: { CT: ${(-Math.PI / 2).toFixed(4)}, T: ${(Math.PI / 2).toFixed(4)} },
  sites: ${JSON.stringify(sites)},
  waypoints: ${JSON.stringify(wpsClean)},
  waypointEdges: ${JSON.stringify(edges)},
  bounds: ${JSON.stringify(bounds)},
}
`
writeFileSync('/home/z/my-project/src/game/map-aimhead.ts', def)

// server copy (own package: no bsp render data, adds spawnYaw for team facing)
const defServer = `// GENERATED from aim_headshot.bsp (BSP v30) by scripts/bsp/convert.ts — do not edit by hand
import type { MapDef } from './mapdata'

export const AIMHEAD: MapDef = {
  id: 'aimhead',
  name: 'Aim Headshot',
  version: 1,
  boxes: ${JSON.stringify(boxesFinal)},
  losBoxes: ${JSON.stringify(boxesFinal)},
  spawns: {
    CT: ${JSON.stringify(sCTf.map(p => ({ x: p[0], y: p[1], z: p[2] })))},
    T: ${JSON.stringify(sTf.map(p => ({ x: p[0], y: p[1], z: p[2] })))},
  },
  spawnYaw: { CT: ${(-Math.PI / 2).toFixed(4)}, T: ${(Math.PI / 2).toFixed(4)} },
  sites: ${JSON.stringify(sites)},
  waypoints: ${JSON.stringify(wpsClean)},
  waypointEdges: ${JSON.stringify(edges)},
  bounds: ${JSON.stringify(bounds)},
}
`
writeFileSync('/home/z/my-project/mini-services/game-server/map-aimhead.ts', defServer)
console.log('wrote src/game/map-aimhead.ts + mini-services/game-server/map-aimhead.ts')

// ---------------- bots GRAPHS snippet ----------------
function nearWp(px: number, pz: number, n = 3): string[] {
  return [...wpsClean].sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz)).slice(0, n).map(w => w.id)
}
const midX = (ctC[0] + tC[0]) / 2, midZ = (ctC[2] + tC[2]) / 2
const aHold = nearWp(ctC[0] - 4, ctC[2], 4)
const bHold = nearWp(tC[0] + 4, tC[2], 4)
const midHold = nearWp(midX, midZ, 4)
const aNear = nearWp(ctC[0] - 10, ctC[2], 1)
const bNear = nearWp(tC[0] + 10, tC[2], 1)
console.log(`
---- bots.ts GRAPHS entry ----
  aimhead: buildGraph(MAPS.aimhead, {
    aHold: ${JSON.stringify(aHold)},
    bHold: ${JSON.stringify(bHold)},
    midHold: ${JSON.stringify(midHold)},
    aRoutes: [[${JSON.stringify(bNear[0])}, ${JSON.stringify(aHold[0])}]],
    bRoutes: [[${JSON.stringify(aNear[0])}, ${JSON.stringify(bHold[0])}]],
    tHoldA: ${JSON.stringify(bHold[0])},
    tHoldB: ${JSON.stringify(aHold[0])},
    plantA: ${JSON.stringify(aHold[0])},
    plantB: ${JSON.stringify(bHold[0])},
    watch: {
      ${aHold.map(w => `${w.id ?? w}: [${(-tC[0]).toFixed(1)}, ${(-tC[2]).toFixed(1)}]`).join(',\n      ')}
    },
  }),
`)

// ---------------- debug render: top-down texture+height map ----------------
{
  const W = NX, H = NY
  const px = Buffer.alloc(W * H * 3)
  for (let iy = 0; iy < H; iy++) {
    for (let ix = 0; ix < W; ix++) {
      const x = wmin[0] + (ix + 0.5) * CELL
      const y = wmin[1] + (iy + 0.5) * CELL
      // find floor height
      let floor = -9999
      for (let z = 460; z >= -190; z -= 8) {
        if (!solid(x, y, z + 4) && !solid(x, y, z + 42) && solid(x, y, z - 6)) { floor = z; break }
      }
      const k = (iy * W + ix) * 3
      if (floor < -900) { px[k] = 25; px[k + 1] = 25; px[k + 2] = 35 } // no floor (solid column/wall)
      else if (floor > 200) { px[k] = 240; px[k + 2] = 60 } // high ground
      else {
        const t = (floor + 190) / 300
        px[k] = 40 + t * 180; px[k + 1] = 90 + t * 110; px[k + 2] = 200 - t * 180
      }
    }
  }
  // draw spawns: CT red, T blue
  const mark = (arr: number[][], r: number, g: number, b: number) => {
    for (const p of arr) {
      const ix = Math.round((p[0] / SCALE - wmin[0]) / CELL)
      const iy = Math.round((-p[2] / SCALE - wmin[1]) / CELL)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = ((iy + dy) * W + ix + dx) * 3
        if (k >= 0 && k < px.length) { px[k] = r; px[k + 1] = g; px[k + 2] = b }
      }
    }
  }
  mark(spawnCT, 255, 60, 60)
  mark(spawnT, 60, 120, 255)
  writeFileSync(`${OUT_DIR}/debug-top.ppm`, `P6\n${W} ${H}\n255\n`)
  require('fs').appendFileSync(`${OUT_DIR}/debug-top.ppm`, px)
  ppm2png(`${OUT_DIR}/debug-top.ppm`, `${OUT_DIR}/debug-top.png`)
}
console.log('DONE')
