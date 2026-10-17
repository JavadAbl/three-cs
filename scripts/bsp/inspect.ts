// BSP v30 (GoldSrc / CS 1.6) inspector — validates structure, dumps entities/stats
// Usage: bun scripts/bsp/inspect.ts <file.bsp>
import { readFileSync } from 'fs'

const file = process.argv[2] ?? '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const buf = readFileSync(file)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

const LUMP_NAMES = ['entities', 'planes', 'miptex', 'vertices', 'visibility', 'nodes', 'texinfo',
  'faces', 'lighting', 'clipnodes', 'leaves', 'marksurfaces', 'edges', 'surfedges', 'models'] as const

const version = dv.getInt32(0, true)
console.log('BSP version:', version, version === 30 ? '(GoldSrc OK)' : 'UNKNOWN!')

const lumps: Array<{ off: number; len: number }> = []
for (let i = 0; i < 15; i++) {
  lumps.push({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
}
for (let i = 0; i < 15; i++) {
  const { off, len } = lumps[i]
  let note = ''
  if (i === 1) note = `→ ${len / 20} planes`
  if (i === 3) note = `→ ${len / 12} vertices`
  if (i === 6) note = `→ ${len / 40} texinfo`
  if (i === 7) note = `→ ${len / 20} faces`
  if (i === 9) note = `→ ${len / 8} clipnodes`
  if (i === 10) note = `→ ${len / 28} leaves`
  if (i === 11) note = `→ ${len / 2} marksurfaces`
  if (i === 12) note = `→ ${len / 4} edges`
  if (i === 13) note = `→ ${len / 4} surfedges`
  if (i === 14) note = `→ ${len / 64} models`
  if (i === 5) note = `→ ${len / 24} nodes`
  console.log(`lump ${String(i).padStart(2)} ${LUMP_NAMES[i].padEnd(14)} off=${off} len=${len} ${note}`)
}

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
const byClass: Record<string, number> = {}
for (const e of entities) byClass[e.classname ?? '?'] = (byClass[e.classname ?? '?'] ?? 0) + 1
console.log('\nentities total:', entities.length)
console.log('by classname:', JSON.stringify(byClass, null, 1))
const world = entities.find(e => e.classname === 'worldspawn')
if (world?.wad) console.log('\nWAD files referenced:\n' + world.wad)

// ---------- models ----------
const nModels = lumps[14].len / 64
console.log('\nmodels:')
for (let i = 0; i < Math.min(nModels, 6); i++) {
  const o = lumps[14].off + i * 64
  const mins = [0, 1, 2].map(k => dv.getFloat32(o + k * 4, true))
  const maxs = [0, 1, 2].map(k => dv.getFloat32(o + 12 + k * 4, true))
  const origin = [0, 1, 2].map(k => dv.getFloat32(o + 24 + k * 4, true))
  const headnode = [0, 1, 2, 3].map(k => dv.getInt32(o + 36 + k * 4, true))
  console.log(`  model${i}: mins=[${mins.map(v => v.toFixed(0))}] maxs=[${maxs.map(v => v.toFixed(0))}] headnode=[${headnode}] origin=[${origin.map(v => v.toFixed(0))}]`)
}

// ---------- miptex ----------
const miptexOff = lumps[2].off, miptexLen = lumps[2].len
if (miptexLen > 4) {
  const num = dv.getInt32(miptexOff, true)
  console.log(`\nmiptex count: ${num}`)
  let embedded = 0, external = 0
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(miptexOff + 4 + i * 4, true)
    if (rel === -1) { external++; continue }
    const p = miptexOff + rel
    const name = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '')
    const w = dv.getUint32(p + 16, true), h = dv.getUint32(p + 20, true)
    embedded++
    if (i < 24) console.log(`  tex[${i}] "${name}" ${w}x${h}`)
  }
  console.log(`  embedded=${embedded} external(wad)=${external}`)
}

// ---------- planes (first few) ----------
const nPlanes = lumps[1].len / 20
console.log(`\nplanes: ${nPlanes}`)
for (let i = 0; i < 4; i++) {
  const o = lumps[1].off + i * 20
  const n = [0, 1, 2].map(k => dv.getFloat32(o + k * 4, true))
  const d = dv.getFloat32(o + 12, true)
  console.log(`  plane${i}: n=[${n.map(v => v.toFixed(2))}] d=${d.toFixed(1)} type=${dv.getInt32(o + 16, true)}`)
}

// ---------- leaves ----------
const nLeaves = lumps[10].len / 28
console.log(`\nleaves=${nLeaves}`)
const leafContents: Record<number, number> = {}
for (let i = 0; i < nLeaves; i++) {
  const c = dv.getInt32(lumps[10].off + i * 28, true)
  leafContents[c] = (leafContents[c] ?? 0) + 1
}
console.log('leaf contents distribution:', JSON.stringify(leafContents))

// ---------- point-in-leaf walk (nodes tree = hull0 = true world geometry) ----------
// HL dnode_t (24B): planenum i32@0, children i16@4/@6, mins i16[3]@8, maxs i16[3]@14, firstface u16@20, numfaces u16@22
function leafAt(x: number, y: number, z: number): number {
  let n = dv.getInt32(lumps[14].off + 36, true) // model0 headnode[0]
  let guard = 0
  while (n >= 0 && guard++ < 300) {
    const o = lumps[5].off + n * 24
    const planenum = dv.getInt32(o, true)
    const po = lumps[1].off + planenum * 20
    const nx = dv.getFloat32(po, true), ny = dv.getFloat32(po + 4, true), nz = dv.getFloat32(po + 8, true), d = dv.getFloat32(po + 12, true)
    const side = (nx * x + ny * y + nz * z - d) >= 0 ? 0 : 1
    const child = dv.getInt16(o + 4 + side * 2, true)
    if (child >= 0) n = child
    else return ~child // leaf = -(child+1)
  }
  return -999
}
function contentsAt(x: number, y: number, z: number): number {
  const l = leafAt(x, y, z)
  if (l < 0 || l >= nLeaves) return 999999
  return dv.getInt32(lumps[10].off + l * 28, true)
}

// probe at spawn points
const starts = entities.filter(e => e.classname === 'info_player_start' || e.classname === 'info_player_deathmatch')
console.log(`\nspawn entities: ${starts.length}`)
for (const s of starts.slice(0, 12)) {
  const [x, y, z] = s.origin!.split(' ').map(Number)
  const c = contentsAt(x, y, z)
  const cb = contentsAt(x, y - 40, z)
  const ca = contentsAt(x, y + 40, z)
  console.log(`  ${s.classname} @(${x},${y},${z}) contents(at)=${c} (40 below)=${cb} (40 above)=${ca}`)
}

// world bounds
const m0 = lumps[14].off
const wmin = [0, 1, 2].map(k => dv.getFloat32(m0 + k * 4, true))
const wmax = [0, 1, 2].map(k => dv.getFloat32(m0 + 12 + k * 4, true))
console.log(`\nworld bounds (bsp units): min=[${wmin.map(v => v.toFixed(0))}] max=[${wmax.map(v => v.toFixed(0))}]`)
console.log(`world size (m @ 1u=0.025m): ${((wmax[0] - wmin[0]) * 0.025).toFixed(1)} x ${((wmax[1] - wmin[1]) * 0.025).toFixed(1)} x ${((wmax[2] - wmin[2]) * 0.025).toFixed(1)}`)

// vertical column scan at first spawn — find floor transition
if (starts.length) {
  const [x, y, z] = starts[0].origin!.split(' ').map(Number)
  console.log(`\nvertical scan at spawn (x=${x}, z=${z}):`)
  for (let yy = y + 64; yy >= y - 96; yy -= 16) {
    console.log(`  y=${yy}: contents=${contentsAt(x, yy, z)}`)
  }
}
