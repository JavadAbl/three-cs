// Task 139 — office "CT entrance scaffold walls": dump BSP faces near CT spawn
// with their ORIGINAL miptex names, owning entity, and converted family.
// Mirrors convert-office.ts lump indices exactly. Usage: bun scripts/bsp/office-ct-faces.ts
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const SCALE = 0.025, Z_REBASE = 576
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(i => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) }))

const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
const nFaces = lumps[7].len / 20
const nTexinfo = lumps[6].len / 40
const nLeaves = lumps[10].len / 28

// entities
const entRaw = buf.toString('latin1', lumps[0].off, lumps[0].off + lumps[0].len)
const entities: Record<string, string>[] = []
for (const m of entRaw.match(/\{[^{}]*\}/g) ?? []) {
  const e: Record<string, string> = {}
  for (const kv of m.match(/"([^"]+)"\s+"([^"]*)"/g) ?? []) {
    const mm = kv.match(/"([^"]+)"\s+"([^"]*)"/)!
    e[mm[1]] = mm[2]
  }
  entities.push(e)
}
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) {
  const m = e.model?.match(/^\*(\d+)$/)
  if (m) modelEnt.set(+m[1], e)
}

// miptex
const miptexs: { name: string; w: number; h: number }[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push({ name: `wad${i}`, w: 128, h: 128 }); continue }
    const p = base + rel
    miptexs.push({ name: buf.toString('latin1', p, p + 16).replace(/\0.*$/, ''), w: dv.getUint32(p + 16, true), h: dv.getUint32(p + 20, true) })
  }
}
// texinfo
const texinfos: { miptex: number }[] = []
for (let i = 0; i < nTexinfo; i++) texinfos.push({ miptex: dv.getInt32(lumps[6].off + i * 40 + 32, true) })
// faces
interface Face { planenum: number; side: number; firstedge: number; numedges: number; texinfo: number }
const faces: Face[] = []
for (let i = 0; i < nFaces; i++) {
  const o = lumps[7].off + i * 20
  faces.push({ planenum: dv.getUint16(o, true), side: dv.getUint8(o + 2), firstedge: dv.getInt32(o + 4, true), numedges: dv.getUint16(o + 8, true), texinfo: dv.getInt16(o + 10, true) })
}
// planes
function planeOf(p: number): number[] {
  const o = lumps[1].off + p * 20
  const n = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]
  return n
}
// face verts
function faceVerts(f: Face): number[][] {
  const out: number[][] = []
  for (let k = 0; k < f.numedges; k++) {
    const se = dv.getInt32(lumps[13].off + (f.firstedge + k) * 4, true)
    if (Math.abs(se) >= nEdges) return []
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    if (v >= nVerts) return []
    out.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  return out.length >= 3 ? out : []
}
// collectFaces per model
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

// ourTex family mapping (copied from convert-office.ts)
function ourTex(rawName: string): string {
  let n = rawName.toLowerCase()
  n = n.replace(/^\+[0-9a-b]~?/, '')
  const alpha = n.startsWith('{')
  n = n.replace(/^[{+]+/, '')
  if (alpha) return 'fence'
  if (n === 'sky' || n === 'aaatrigger') return 'SKIP'
  const has = (...p: string[]) => p.some(x => n.includes(x))
  if (has('snow')) return 'snow'
  if (has('carpet')) return 'carpet'
  if (has('couch')) return 'carpet'
  if (has('glass')) return 'glass'
  if (n === 'window_1') return 'glass'
  if (has('ceil', 'fifts_lght', 'fifties_lgt', 'light3c', 'c1a4i_c1a')) return 'ceiling'
  if (has('railing', 'rail1')) return 'fence'
  if (has('bricks_')) return 'brick'
  if (has('lab1_flr', 'tnnl_flr')) return 'tile'
  if (has('asphalt', 'comp_', 'lab1_comp', 'black', 'fade')) return 'dark'
  if (has('wood', 'desk', 'file1', 'file2_sp', 'door_2', 'door_3', 'dr1k', 'c1a1_dr2', 'bks1', 'sphinx_desk')) return 'plank'
  if (has('crate', 'cardboard', 'cardbox', 'ammo0')) return 'crate'
  if (has('wall_', 'hallway', 'trim', 'paper', 'painting', 'picture', 'poster', 'sign', 'generic', 'of_daddy', 'of_boy', 'of_got_milk',
    'fearferret', 'stripes', 'exit', 'clock', 'lab1_map', 'overhead', 'board_', 'garage_', 'sp_lock', 'step_')) return 'offwall'
  if (has('cement', 'crete', 'cinder', 'concrete', 'step_')) return 'concrete'
  if (has('metal', 'elev', 'apc_', 'vent', 'warehousedoor', 'babtech', 'trsh', 'freezer')) return 'metal'
  return 'offwall'
}

const tx = (x: number) => x * SCALE
const ty = (z: number) => (z + Z_REBASE) * SCALE
const tz = (y: number) => -y * SCALE

interface Row {
  mi: number; cls: string; raw: string; fam: string; area: number
  gx: [number, number]; gy: [number, number]; gz: [number, number]
  n: number[]; fi: number
}
const rows: Row[] = []
for (let mi = 0; mi < nModels; mi++) {
  const cls = modelEnt.get(mi)?.classname ?? (mi === 0 ? '*WORLD*' : `model${mi}(no-ent)`)
  for (const fi of collectFaces(modelRoots[mi])) {
    const f = faces[fi]
    if (f.texinfo < 0 || f.texinfo >= nTexinfo) continue
    const raw = miptexs[texinfos[f.texinfo].miptex]?.name ?? '?'
    const fam = ourTex(raw)
    if (fam === 'SKIP') continue
    const vs = faceVerts(f)
    if (!vs.length) continue
    let area = 0
    for (let k = 1; k < vs.length - 1; k++) {
      const u = [vs[k][0] - vs[0][0], vs[k][1] - vs[0][1], vs[k][2] - vs[0][2]]
      const v = [vs[k + 1][0] - vs[0][0], vs[k + 1][1] - vs[0][1], vs[k + 1][2] - vs[0][2]]
      area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
    }
    area *= SCALE * SCALE
    const gx = vs.map(v => tx(v[0])), gy = vs.map(v => ty(v[2])), gz = vs.map(v => tz(v[1]))
    // overlap with CT region (game x[-48,-5], z[26,58], y[3,14])?
    const cxAvg = gx.reduce((a, b) => a + b) / gx.length
    const czAvg = gz.reduce((a, b) => a + b) / gz.length
    const cyAvg = gy.reduce((a, b) => a + b) / gy.length
    if (cxAvg >= -50 && cxAvg <= -2 && czAvg >= 26 && czAvg <= 58 && cyAvg >= 2 && cyAvg <= 15 && area > 0.02) {
      let n = planeOf(f.planenum)
      if (f.side === 1) n = [-n[0], -n[1], -n[2]]
      rows.push({ mi, cls, raw, fam, area, gx: [Math.min(...gx), Math.max(...gx)], gy: [Math.min(...gy), Math.max(...gy)], gz: [Math.min(...gz), Math.max(...gz)], n, fi })
    }
  }
}

console.log(`faces in CT region: ${rows.length}`)
console.log('\n=== aggregate by model+entity+raw-texture ===')
const agg = new Map<string, { area: number; n: number; fam: string }>()
for (const r of rows) {
  const k = `m${r.mi} ${r.cls.padEnd(18)} ${r.raw.padEnd(20)} -> ${r.fam}`
  const a = agg.get(k) ?? { area: 0, n: 0, fam: r.fam }
  a.area += r.area; a.n++
  agg.set(k, a)
}
for (const [k, v] of [...agg.entries()].sort((a, b) => b[1].area - a[1].area))
  console.log(`${k}  faces=${String(v.n).padStart(3)} area=${v.area.toFixed(1).padStart(8)}m2`)

console.log('\n=== FENCE-family faces in CT region (the scaffold suspects) ===')
for (const r of rows.filter(r => r.fam === 'fence').sort((a, b) => b.area - a.area))
  console.log(`m${r.mi} ${r.cls.padEnd(18)} raw=${r.raw.padEnd(20)} area=${r.area.toFixed(1)} x[${r.gx[0].toFixed(1)},${r.gx[1].toFixed(1)}] y[${r.gy[0].toFixed(1)},${r.gy[1].toFixed(1)}] z[${r.gz[0].toFixed(1)},${r.gz[1].toFixed(1)}] n=(${r.n.map(v => v.toFixed(2)).join(',')})`)

console.log('\n=== vertical walls >2m2 in CT region, all families ===')
for (const r of rows.filter(r => Math.abs(r.n[1]) < 0.05 && r.area > 2).sort((a, b) => b.area - a.area).slice(0, 25))
  console.log(`${r.fam.padEnd(9)} raw=${r.raw.padEnd(20)} m${r.mi} ${r.cls.padEnd(16)} area=${r.area.toFixed(1)} x[${r.gx[0].toFixed(1)},${r.gx[1].toFixed(1)}] y[${r.gy[0].toFixed(1)},${r.gy[1].toFixed(1)}] z[${r.gz[0].toFixed(1)},${r.gz[1].toFixed(1)}]`)
