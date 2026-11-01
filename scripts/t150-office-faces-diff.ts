// Task 150 audit v3: exact FACE list of what the BSP has but geom.json does
// not render — with areas, levels, and texture names — so the gap can be
// fixed surgically. A face is MISSING when no rendered geom vertex falls in
// any cell the face covers.
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
const CELL = 64
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
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) { const m = e.model?.match(/^\*(\d+)$/); if (m) modelEnt.set(+m[1], e) }
const SOLID = new Set(['func_wall', 'func_breakable', 'func_button'])
const RENDER = new Set([...SOLID, 'func_illusionary'])
function modelRole(mi: number): string {
  if (mi === 0) return 'world'
  const cls = modelEnt.get(mi)?.classname ?? ''
  if (RENDER.has(cls)) return SOLID.has(cls) ? 'solid' : 'render'
  return 'skip'
}
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
const OPEN_DOOR_FACES = new Set([1278, 1279, 2424, 2425])
function faceTex(fi: number): string {
  const o = lumps[7].off + fi * 20
  const ti = dv.getInt16(o + 10, true)
  if (ti < 0 || ti >= nTexinfo) return '?'
  return miptexs[dv.getInt32(lumps[6].off + ti * 40 + 32, true)] ?? '?'
}
function faceVerts(fi: number): number[][] {
  const o = lumps[7].off + fi * 20
  const firstedge = dv.getInt32(o + 4, true)
  const numedges = dv.getUint16(o + 8, true)
  const out: number[][] = []
  if (numedges < 3 || numedges > 32) return out
  if (firstedge < 0 || firstedge + numedges > nSurfedges) return out
  for (let k = 0; k < numedges; k++) {
    const se = dv.getInt32(lumps[13].off + (firstedge + k) * 4, true)
    if (Math.abs(se) >= nEdges) return out
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    if (v >= nVerts) return out
    out.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  return out.length >= 3 ? out : []
}
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

// geom cell set
const geom: any = JSON.parse(readFileSync('/home/z/my-project/public/assets/maps/office/geom.json', 'utf8'))
const geomCell = new Set<string>()
for (const g of geom.groups) {
  const pos: number[] = g.pos
  for (let i = 0; i + 2 < pos.length; i += 3) {
    geomCell.add(Math.floor(Math.round(pos[i] / 0.025) / CELL) + ',' + Math.floor(Math.round(-pos[i + 2] / 0.025) / CELL))
  }
}

// face-level diff
const nModels = lumps[14].len / 64
interface Miss { fi: number; tex: string; role: string; mi: number; areaU: number; cx: number; cy: number; zAvg: number; edges: number }
const missing: Miss[] = []
let total = 0
for (let mi = 0; mi < nModels; mi++) {
  const role = modelRole(mi)
  if (role === 'skip') continue
  for (const fi of collectFaces(dv.getInt32(lumps[14].off + mi * 64 + 36, true))) {
    const tex = faceTex(fi)
    if (tex === 'sky' || tex === 'aaatrigger' || OPEN_DOOR_FACES.has(fi)) continue
    const vs = faceVerts(fi)
    if (!vs.length) { continue }
    total++
    // face cell coverage
    let covered = false
    const cells = new Set<string>()
    for (const v of vs) cells.add(Math.floor(v[0] / CELL) + ',' + Math.floor(v[1] / CELL))
    for (const c of cells) if (geomCell.has(c)) { covered = true; break }
    if (covered) continue
    // area (bsp u²) via shoelace on the dominant plane
    let area = 0
    for (let i = 1; i < vs.length - 1; i++) {
      const ax = vs[i][0] - vs[0][0], ay = vs[i][1] - vs[0][1], az = vs[i][2] - vs[0][2]
      const bx = vs[i + 1][0] - vs[0][0], by = vs[i + 1][1] - vs[0][1], bz = vs[i + 1][2] - vs[0][2]
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
      area += Math.hypot(cx, cy, cz) / 2
    }
    const cx = vs.reduce((s, v) => s + v[0], 0) / vs.length
    const cy = vs.reduce((s, v) => s + v[1], 0) / vs.length
    const zAvg = vs.reduce((s, v) => s + v[2], 0) / vs.length
    missing.push({ fi, tex, role, mi, areaU: area, cx, cy, zAvg, edges: vs.length })
  }
}
missing.sort((a, b) => b.areaU - a.areaU)
const m2 = (u: number) => (u * 0.025 * 0.025).toFixed(1)
const gameX = (bx: number) => (bx * 0.025).toFixed(0)
const gameZ = (by: number) => (-by * 0.025).toFixed(0)
const gameY = (bz: number) => ((bz + 576) * 0.025).toFixed(1)
console.log(`faces considered: ${total}; MISSING faces: ${missing.length} (total area ${missing.reduce((s, f) => s + f.areaU, 0) * 0.000625} m²)`)
console.log(`\n=== TOP 40 MISSING FACES ===`)
for (const f of missing.slice(0, 40)) {
  console.log(`  fi=${f.fi} ${f.tex.padEnd(16)} ${f.role}/${f.mi} ${m2(f.areaU).padStart(6)} m² ${f.edges}ed · game(x${gameX(f.cx)}, z${gameZ(f.cy)}, y${gameY(f.zAvg)})`)
}
// group by texture
const byTex: Record<string, { n: number; area: number }> = {}
for (const f of missing) {
  byTex[f.tex] ??= { n: 0, area: 0 }
  byTex[f.tex].n++; byTex[f.tex].area += f.areaU * 0.000625
}
console.log(`\n=== BY TEXTURE ===`)
for (const [t, v] of Object.entries(byTex).sort((a, b) => b[1].area - a[1].area).slice(0, 25)) {
  console.log(`  ${t.padEnd(18)} ${String(v.n).padStart(3)} faces  ${v.area.toFixed(1).padStart(7)} m²`)
}
