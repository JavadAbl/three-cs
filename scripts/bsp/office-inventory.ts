// cs_office.bsp inventory — decides the converter's texture families, model
// inclusion, Z_REBASE, and lightmap feasibility BEFORE convert-office.ts.
// Usage: bun scripts/bsp/office-inventory.ts
import { readFileSync } from 'fs'

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
const nLeaves = lumps[10].len / 28
const nModels = lumps[14].len / 64

// ---------- entities ----------
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
// model index -> entity
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) {
  const m = e.model?.match(/^\*(\d+)$/)
  if (m) modelEnt.set(+m[1], e)
}

// ---------- miptex ----------
interface MipTex { name: string; w: number; h: number }
const miptexs: MipTex[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push({ name: `wad${i}`, w: 128, h: 128 }); continue }
    const p = base + rel
    const name = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '')
    miptexs.push({ name, w: dv.getUint32(p + 16, true), h: dv.getUint32(p + 20, true) })
  }
}
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

// ---------- faces ----------
interface Face { planenum: number; side: number; firstedge: number; numedges: number; texinfo: number; styles: number[]; lightofs: number }
const faces: Face[] = []
for (let i = 0; i < nFaces; i++) {
  const o = lumps[7].off + i * 20
  faces.push({
    planenum: dv.getUint16(o, true),
    side: dv.getUint8(o + 2),
    firstedge: dv.getInt32(o + 4, true),
    numedges: dv.getUint16(o + 8, true),
    texinfo: dv.getInt16(o + 10, true),
    styles: [0, 1, 2, 3].map(k => dv.getUint8(o + 12 + k)),
    lightofs: dv.getInt32(o + 16, true),
  })
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
function planeOf(planenum: number): number[] {
  const po = lumps[1].off + planenum * 20
  return [dv.getFloat32(po, true), dv.getFloat32(po + 4, true), dv.getFloat32(po + 8, true)]
}
function faceArea(vs: number[][]): number {
  // shoelace in the dominant plane
  const [x0, y0, z0] = vs[0]
  let ax = 0, ay = 0, az = 0
  for (let i = 1; i < vs.length - 1; i++) {
    const [x1, y1, z1] = vs[i], [x2, y2, z2] = vs[i + 1]
    ax += (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0)
    ay += (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0)
    az += (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
  }
  return Math.hypot(ax, ay, az) / 2
}

// ---------- collect faces per model (hull 0) ----------
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
const modelRoots: number[] = []
for (let i = 0; i < nModels; i++) modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))

// ---------- per-miptex usage: faces, area, world vs submodel ----------
interface Usage { name: string; w: number; h: number; worldFaces: number; worldArea: number; subFaces: number; subArea: number; lightFaces: number }
const usage = new Map<number, Usage>()
const bump = (mt: number, world: boolean, area: number, hasLight: boolean) => {
  const m = miptexs[mt] ?? { name: '?', w: 0, h: 0 }
  let u = usage.get(mt)
  if (!u) { u = { name: m.name, w: m.w, h: m.h, worldFaces: 0, worldArea: 0, subFaces: 0, subArea: 0, lightFaces: 0 }; usage.set(mt, u) }
  if (world) { u.worldFaces++; u.worldArea += area } else { u.subFaces++; u.subArea += area }
  if (hasLight) u.lightFaces++
}
let noLightFaces = 0, lightFaces = 0, badFaces = 0
for (let mi = 0; mi < nModels; mi++) {
  const fis = collectFaces(modelRoots[mi])
  const isWorld = mi === 0
  for (const fi of fis) {
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) { badFaces++; continue }
    const vs = faceVerts(f)
    if (!vs.length) { badFaces++; continue }
    const area = faceArea(vs)
    const mt = texinfos[f.texinfo].miptex
    const hasLight = f.lightofs >= 0
    if (hasLight) lightFaces++; else noLightFaces++
    bump(mt, isWorld, area, hasLight)
  }
}
console.log(`faces parsed: lit=${lightFaces} unlit=${noLightFaces} bad=${badFaces}`)
console.log(`\n=== miptex usage (sorted by total area, u2 → m2 @0.025) ===`)
const rows = [...usage.values()].map(u => ({ ...u, total: u.worldArea + u.subArea })).sort((a, b) => b.total - a.total)
for (const r of rows) {
  console.log(`${r.name.padEnd(24)} ${String(r.w).padStart(3)}x${String(r.h).padEnd(3)} wF=${String(r.worldFaces).padStart(4)} wA=${(r.worldArea * 0.000625).toFixed(1).padStart(7)}m2  sF=${String(r.subFaces).padStart(4)} sA=${(r.subArea * 0.000625).toFixed(1).padStart(7)}m2  lit=${r.lightFaces}`)
}

// ---------- floor z histogram (world, nz>0.7) ----------
const floorZ = new Map<number, number>()
for (const fi of collectFaces(modelRoots[0])) {
  const f = faces[fi]
  if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
  const mt = texinfos[f.texinfo].miptex
  const name = (miptexs[mt]?.name ?? '').toLowerCase()
  if (name === 'sky') continue
  const vs = faceVerts(f)
  if (!vs.length) continue
  const n = planeOf(f.planenum)
  const nz = f.side === 1 ? -n[2] : n[2]
  if (nz > 0.7) {
    const area = faceArea(vs)
    const z = Math.round(Math.min(...vs.map(v => v[2])) / 16) * 16
    floorZ.set(z, (floorZ.get(z) ?? 0) + area)
  }
}
console.log(`\n=== floor z histogram (world, 16u buckets, m2) ===`)
for (const [z, a] of [...floorZ.entries()].sort((x, y) => y[1] - x[1]).slice(0, 18)) {
  console.log(`  z=${String(z).padStart(5)}  ${(a * 0.000625).toFixed(1)} m2`)
}

// ---------- sub-model entity classes + their texture sets ----------
console.log(`\n=== sub-models by entity class ===`)
const byClass = new Map<string, { count: number; faces: number; area: number; texs: Set<string>; zRange: [number, number] }>()
for (let mi = 1; mi < nModels; mi++) {
  const e = modelEnt.get(mi)
  const cls = e?.classname ?? `unassigned(${mi})`
  const fis = collectFaces(modelRoots[mi])
  let area = 0, zmin = 1e9, zmax = -1e9
  const texs = new Set<string>()
  for (const fi of fis) {
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
    const vs = faceVerts(f)
    if (!vs.length) continue
    area += faceArea(vs)
    zmin = Math.min(zmin, ...vs.map(v => v[2]))
    zmax = Math.max(zmax, ...vs.map(v => v[2]))
    const nm = miptexs[texinfos[f.texinfo].miptex]?.name ?? '?'
    if (nm !== 'aaatrigger' && !nm.startsWith('{')) texs.add(nm)
  }
  let b = byClass.get(cls)
  if (!b) { b = { count: 0, faces: 0, area: 0, texs: new Set(), zRange: [1e9, -1e9] }; byClass.set(cls, b) }
  b.count++; b.faces += fis.length; b.area += area
  b.zRange[0] = Math.min(b.zRange[0], zmin); b.zRange[1] = Math.max(b.zRange[1], zmax)
  for (const t of texs) b.texs.add(t)
}
for (const [cls, b] of byClass) {
  console.log(`${cls.padEnd(20)} n=${String(b.count).padStart(3)} faces=${String(b.faces).padStart(4)} area=${(b.area * 0.000625).toFixed(1)}m2 z=[${b.zRange[0].toFixed(0)},${b.zRange[1].toFixed(0)}] tex=${[...b.texs].slice(0, 8).join(',')}${b.texs.size > 8 ? '…' : ''}`)
}

// ---------- func_door / func_button / func_breakable detail ----------
for (const cls of ['func_door', 'func_button', 'func_breakable', 'func_ladder', 'func_illusionary', 'func_hostage_rescue', 'func_buyzone']) {
  const ents = entities.filter(e => e.classname === cls)
  console.log(`\n${cls} (${ents.length}):`)
  for (const e of ents.slice(0, 6)) console.log(`  model=${e.model} origin=${e.origin} targetname=${e.targetname} ${cls === 'func_breakable' ? `material=${e.material} health=${e.health}` : ''}`)
  if (ents.length > 6) console.log(`  … +${ents.length - 6} more`)
}

// ---------- lightmap sanity: styles + lightofs distribution ----------
const styleCount = new Map<string, number>()
let lmMin = 1e9, lmMax = -1
let lmBytes = 0
for (let i = 0; i < nFaces; i++) {
  const f = faces[i]
  const ns = f.styles.filter(s => s !== 255).length
  styleCount.set(String(ns), (styleCount.get(String(ns)) ?? 0) + 1)
  if (f.lightofs >= 0) { lmMin = Math.min(lmMin, f.lightofs); lmMax = Math.max(lmMax, f.lightofs) }
}
console.log(`\n=== lightmap ===\nstyles-per-face histogram: ${JSON.stringify([...styleCount.entries()])}`)
console.log(`lightofs range: ${lmMin}..${lmMax} (lump len ${lumps[8].len})`)
// sample the first lit face's bytes
{
  const lit = faces.find(f => f.lightofs >= 0)!
  const vs = faceVerts(lit)
  const ti = texinfos[lit.texinfo]
  console.log(`sample face: tex=${miptexs[ti.miptex]?.name} verts=${vs.length} styles=${lit.styles} lightofs=${lit.lightofs}`)
  const o = lumps[8].off + lit.lightofs
  const bytes = Array.from({ length: 16 }, (_, i) => dv.getUint8(o + i))
  console.log(`first 16 bytes at lighting+${lit.lightofs}: ${bytes.join(' ')}`)
}

// ---------- spawn areas ----------
const ctSpawn = entities.filter(e => e.classname === 'info_player_start').map(e => e.origin!.split(' ').map(Number))
const tSpawn = entities.filter(e => e.classname === 'info_player_deathmatch').map(e => e.origin!.split(' ').map(Number))
const c = (a: number[][]) => a.reduce((x, p) => [x[0] + p[0] / a.length, x[1] + p[1] / a.length, x[2] + p[2] / a.length], [0, 0, 0])
console.log(`\nCT centroid: ${c(ctSpawn).map(v => v.toFixed(0)).join(',')}  T centroid: ${c(tSpawn).map(v => v.toFixed(0)).join(',')}`)
console.log(`world bounds: min=[-2720,-2344,-768] max=[2592,1824,328]`)
