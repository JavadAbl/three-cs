// ============================================================
// Diagnose: (1) ramp left-side face missing from render,
// (2) invisible blocker at ramp base.
// Dumps EVERY face (all models) near the big ramps with
// model / tex / normal / aabb / gface-skip-reason, plus the
// collision boxes that would block the base approach.
// ============================================================
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
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

interface MipTex { name: string; w: number; h: number }
const miptexs: MipTex[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push({ name: `wad${i}`, w: 128, h: 128 }); continue }
    const p = base + rel
    const name = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '').replace(/[^A-Za-z0-9_-]/g, '')
    miptexs.push({ name: name || `tex${i}`, w: dv.getUint32(p + 16, true), h: dv.getUint32(p + 20, true) })
  }
}
interface TexInfo { miptex: number }
const texinfos: TexInfo[] = []
for (let i = 0; i < nTexinfo; i++) texinfos.push({ miptex: dv.getInt32(lumps[6].off + i * 40 + 32, true) })

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
const modelBounds: number[][] = []
for (let i = 0; i < nModels; i++) {
  modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))
  modelBounds.push([0, 1, 2].map(k => dv.getFloat32(lumps[14].off + i * 64 + k * 4, true)).concat([0, 1, 2].map(k => dv.getFloat32(lumps[14].off + i * 64 + 12 + k * 4, true))))
}
const modelFaceIdx: number[][] = []
for (let i = 0; i < nModels; i++) modelFaceIdx.push(collectFaces(modelRoots[i]))
console.log(`models: ${nModels}; faces per model: ${modelFaceIdx.map((a, i) => `m${i}:${a.length}`).join(' ')}`)
for (let i = 1; i < nModels; i++) {
  const bb = modelBounds[i]
  console.log(`model ${i} bounds: x ${bb[0]}..${bb[3]}, y ${bb[1]}..${bb[4]}, z ${bb[2]}..${bb[5]}`)
}

// gface skip reason (replicates convert2.ts logic)
function gfaceSkip(fi: number): string | null {
  const f = faces[fi]
  if (f.texinfo < 0 || f.texinfo >= nTexinfo) return 'texinfo-range'
  const texName = miptexs[texinfos[f.texinfo].miptex]?.name ?? ''
  if (texName.toLowerCase() === 'sky' || texName.startsWith('{')) return 'sky-or-curly'
  const vs = faceVerts(f)
  if (!vs.length) return `verts(${f.numedges}e)`
  return null
}

// --- find the big ramp slopes in world model ---
interface Ramp { fi: number; tex: string; n: number[]; aabb: number[]; vs: number[][] }
const ramps: Ramp[] = []
for (const fi of modelFaceIdx[0]) {
  const f = faces[fi]
  if (gfaceSkip(fi)) continue
  const vs = faceVerts(f)
  const pl = planeOf(f.planenum)
  let nrm = pl.n
  if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
  const [nx, ny, nz] = nrm
  if (nz <= 0.4 || nz >= 0.995) continue // any non-flat upward slope incl. 31° (nz=0.857)
  const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
  const aabb = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)]
  const area = (aabb[1] - aabb[0]) * (aabb[3] - aabb[2])
  if (area < 60 * 60) continue // big faces only
  const texName = miptexs[texinfos[f.texinfo].miptex]?.name ?? ''
  ramps.push({ fi, tex: texName, n: nrm, aabb, vs })
}
console.log(`\n== BIG RAMP SLOPES (${ramps.length}) ==`)
for (const r of ramps) {
  const [nx, ny, nz] = r.n
  console.log(`face ${r.fi} tex=${r.tex} n=(${nx.toFixed(2)},${ny.toFixed(2)},${nz.toFixed(2)}) aabb=[x ${r.aabb[0]}..${r.aabb[1]} y ${r.aabb[2]}..${r.aabb[3]} z ${r.aabb[4]}..${r.aabb[5]}]`)
  console.log(`   verts: ${r.vs.map(v => `(${v[0]},${v[1]},${v[2]})`).join(' ')}`)
}

// --- neighborhood dump: all faces of all models near each ramp ---
console.log(`\n== NEIGHBORHOOD FACES (within 64u xy, full z of ramp) ==`)
const seen = new Set<string>()
for (const r of ramps) {
  const ex0 = r.aabb[0] - 64, ex1 = r.aabb[1] + 64, ey0 = r.aabb[2] - 64, ey1 = r.aabb[3] + 64
  console.log(`\n--- around ramp face ${r.fi} (x ${ex0}..${ex1}, y ${ey0}..${ey1}) ---`)
  for (let m = 0; m < nModels; m++) {
    for (const fi of modelFaceIdx[m]) {
      if (seen.has(`${m}:${fi}`)) continue
      const f = faces[fi]
      const vs = faceVerts(f)
      if (!vs.length) continue
      const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
      const a = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)]
      // overlap test in xy
      if (a[1] < ex0 || a[0] > ex1 || a[3] < ey0 || a[2] > ey1) continue
      const skip = gfaceSkip(fi)
      const texName = (miptexs[texinfos[f.texinfo]?.miptex ?? -1]?.name ?? f.texinfo < 0 ? '??' : '??')
      const pl = planeOf(f.planenum)
      let nrm = pl.n
      if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
      const tex = f.texinfo >= 0 && f.texinfo < nTexinfo ? (miptexs[texinfos[f.texinfo].miptex]?.name ?? `ti${f.texinfo}`) : `ti${f.texinfo}`
      const tag = m === 0 ? (skip ? `SKIP(${skip})` : 'world') : `MODEL${m}`
      console.log(`  ${tag} f${fi} tex=${tex} n=(${nrm[0].toFixed(2)},${nrm[1].toFixed(2)},${nrm[2].toFixed(2)}) ne=${f.numedges} aabb=[x ${a[0]}..${a[1]} y ${a[2]}..${a[3]} z ${a[4]}..${a[5]}]`)
      seen.add(`${m}:${fi}`)
    }
  }
}
console.log('\nDONE')
