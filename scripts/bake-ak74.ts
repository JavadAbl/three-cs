// ============================================================
// bake-ak74.ts — bakes the user's AK-74M upload (upload/ak-74m.glb) to
// the weapon GLB contract (grip anchor at origin, muzzle −Z, real-meter
// scale — public/assets/models/README.md). Mirrors scripts/bake-ak47.ts
// (Task 57 technique, Task 66 application), with the AK-74M differences:
//   - the model is ALREADY muzzle-−Z oriented (barrel parts at negative
//     z, stock at positive z) → NO rotation, M = T · S only
//   - real overall length 0.943 m (AK-74M spec) over the 9.381-unit
//     longest axis (z) → uniform scale ≈ 0.1005
//   - grip anchor = world bbox CENTER of the Grip_low_4 node subtree
//
// Expected result: 57 nodes / 16,860 tris survive; final bbox
// z ≈ [−0.660 (muzzle tip) .. +0.284 (stock butt)], y ≈ [−0.127 (mag) .. +0.134]
//
// Usage: npx tsx scripts/bake-ak74.ts
// Output: scripts/.tmp/ak74-fixed.glb (then compress-glb.sh → staging)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/ak-74m.glb'
const OUT = '/home/z/my-project/scripts/.tmp/ak74-fixed.glb'
const REAL_LEN = 0.943 // m — AK-74M overall length

mkdirSync('/home/z/my-project/scripts/.tmp', { recursive: true })

// ---------------------------------------------------------------- GLB container
interface ParsedGLB { json: any; bin: Buffer }
function parseGLB(path: string): ParsedGLB {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  if (buf.readUInt32LE(4) !== 2) throw new Error('glTF version != 2')
  let off = 12
  let json: any = null
  let bin: Buffer | null = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942) bin = Buffer.from(data)
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json) throw new Error('no JSON chunk')
  if (!bin) throw new Error('no BIN chunk')
  return { json, bin }
}
function writeGLB(path: string, json: any, bin: Buffer): void {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4
  const binPad = (4 - (bin.length % 4)) % 4
  const jsonLen = jsonBuf.length + jsonPad
  const binLen = bin.length + binPad
  const total = 12 + 8 + jsonLen + 8 + binLen
  const out = Buffer.alloc(total)
  let off = 0
  out.writeUInt32LE(0x46546c67, off); off += 4
  out.writeUInt32LE(2, off); off += 4
  out.writeUInt32LE(total, off); off += 4
  out.writeUInt32LE(jsonLen, off); off += 4
  out.writeUInt32LE(0x4e4f534a, off); off += 4
  jsonBuf.copy(out, off)
  if (jsonPad) out.fill(0x20, off + jsonBuf.length, off + jsonLen)
  off += jsonLen
  out.writeUInt32LE(binLen, off); off += 4
  out.writeUInt32LE(0x004e4942, off); off += 4
  bin.copy(out, off)
  writeFileSync(path, out)
}

// ---------------------------------------------------------------- math (column-major 4x4)
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
function nodeMatrix(n: any): number[] {
  if (n.matrix) return n.matrix
  const t = n.translation ?? [0, 0, 0]
  const s = n.scale ?? [1, 1, 1]
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1]
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]
}
function applyV(m: number[], v: number[]): [number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ]
}

// ---------------------------------------------------------------- scene graph
function walk(j: any, g: ParsedGLB, cb: (n: any, M: number[], tris: number) => void): void {
  const scene = j.scenes[j.scene ?? 0]
  let tris = 0
  const rec = (idx: number, Mparent: number[]) => {
    const n = j.nodes[idx]
    const M = mul(Mparent, nodeMatrix(n))
    let myTris = 0
    if (n.mesh !== undefined) {
      for (const p of (j.meshes[n.mesh].primitives ?? [])) {
        if (p.indices !== undefined) myTris += j.accessors[p.indices].count / 3
      }
      tris += myTris
    }
    cb(n, M, myTris)
    for (const c of n.children ?? []) rec(c, M)
  }
  for (const r of scene?.nodes ?? []) rec(r, I)
  ;(j as any).__triTotal = tris
}
/** world-space vertices of every mesh in the subtree rooted at node index `start` */
function subtreeVerts(g: ParsedGLB, j: any, start: number): number[][] {
  const accs = j.accessors ?? []
  const views = j.bufferViews ?? []
  const meshes = j.meshes ?? []
  const out: number[][] = []
  let collecting = false
  const rec = (idx: number, Mparent: number[]) => {
    const n = j.nodes[idx]
    const M = mul(Mparent, nodeMatrix(n))
    const was = collecting
    if (idx === start) collecting = true
    if (collecting && n.mesh !== undefined) {
      for (const p of meshes[n.mesh].primitives ?? []) {
        const ai = p.attributes?.POSITION
        if (ai === undefined) continue
        const a = accs[ai]
        if (a.type !== 'VEC3' || a.componentType !== 5126) continue
        const view = views[a.bufferView]
        const base = (view?.byteOffset ?? 0) + (a.byteOffset ?? 0)
        const stride = view?.byteStride ?? 12
        const dv = new DataView(g.bin.buffer, g.bin.byteOffset + base, a.count * stride)
        for (let i = 0; i < a.count; i++) {
          const o = i * stride
          out.push(applyV(M, [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]))
        }
      }
    }
    for (const c of n.children ?? []) rec(c, M)
    collecting = was
  }
  for (const r of (j.scenes[j.scene ?? 0]?.nodes ?? [])) rec(r, I)
  return out
}
function bboxOf(vs: number[][]): { mn: number[]; mx: number[] } {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const p of vs) for (let i = 0; i < 3; i++) { if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i] }
  return { mn, mx }
}

// ---------------------------------------------------------------- main
function main(): void {
  const g = parseGLB(SRC)
  const j = g.json
  console.log(`nodes=${(j.nodes ?? []).length} meshes=${(j.meshes ?? []).length}`)

  // -- overall world bbox + tri count
  const pts: number[][] = []
  walk(j, g, (n, M) => {
    if (n.mesh === undefined) return
    for (const p of (j.meshes[n.mesh].primitives ?? [])) {
      const ai = p.attributes?.POSITION
      if (ai === undefined) continue
      const a = j.accessors[ai]
      if (a.type !== 'VEC3' || a.componentType !== 5126) continue
      const view = j.bufferViews[a.bufferView]
      const base = (view?.byteOffset ?? 0) + (a.byteOffset ?? 0)
      const stride = view?.byteStride ?? 12
      const dv = new DataView(g.bin.buffer, g.bin.byteOffset + base, a.count * stride)
      for (let i = 0; i < a.count; i++) {
        const o = i * stride
        pts.push(applyV(M, [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]))
      }
    }
  })
  const triCount = (j as any).__triTotal
  const { mn, mx } = bboxOf(pts)
  const L = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])
  const k = REAL_LEN / L
  console.log(`tris=${triCount.toFixed(0)} bbox x=[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y=[${mn[1].toFixed(3)},${mx[1].toFixed(3)}] z=[${mn[2].toFixed(3)},${mx[2].toFixed(3)}]`)
  console.log(`longest=${L.toFixed(4)}u (z) scale k=${k.toFixed(4)}`)

  // -- muzzle end auto-detect along Z (barrel vs stock node centers)
  const findNode = (pred: (name: string) => boolean): number => {
    for (let i = 0; i < j.nodes.length; i++) if (pred(String(j.nodes[i].name ?? ''))) return i
    return -1
  }
  const center = (vs: number[][]): [number, number, number] | null => {
    if (!vs.length) return null
    const c: [number, number, number] = [0, 0, 0]
    for (const v of vs) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2] }
    return [c[0] / vs.length, c[1] / vs.length, c[2] / vs.length]
  }
  const barrelIdx = findNode(nm => /barrel/i.test(nm) && !/clean/i.test(nm))
  const stockIdx = findNode(nm => /stock/i.test(nm))
  const barrelC = center(subtreeVerts(g, j, barrelIdx))
  const stockC = center(subtreeVerts(g, j, stockIdx))
  console.log(`barrel "${j.nodes[barrelIdx]?.name}" cz=${barrelC?.[2].toFixed(2)}; stock "${j.nodes[stockIdx]?.name}" cz=${stockC?.[2].toFixed(2)}`)
  if (!barrelC || !stockC) throw new Error('barrel/stock node not found')
  if (barrelC[2] > stockC[2]) throw new Error('muzzle at +Z — need rotation; NOT the expected AK-74M layout, aborting (expected muzzle at −Z)')
  console.log('muzzle end: −Z (no rotation needed — matches the vm contract)')

  // -- grip anchor: Grip_low_4 subtree world bbox CENTER
  const gripIdx = findNode(nm => /grip/i.test(nm) && !/trigger/i.test(nm))
  if (gripIdx < 0) throw new Error('grip node not found')
  const gb = bboxOf(subtreeVerts(g, j, gripIdx))
  const cg: [number, number, number] = [(gb.mn[0] + gb.mx[0]) / 2, (gb.mn[1] + gb.mx[1]) / 2, (gb.mn[2] + gb.mx[2]) / 2]
  console.log(`grip "${j.nodes[gripIdx].name}" bbox center=[${cg[0].toFixed(3)}, ${cg[1].toFixed(3)}, ${cg[2].toFixed(3)}]`)

  // -- compose M = T · S into the ROOT node matrix (no rotation)
  const scene = j.scenes[j.scene ?? 0]
  const rootIdx = scene.nodes[0]
  const rootNode = j.nodes[rootIdx]
  const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]
  const gs = applyV(S, cg) // grip center after scale
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -gs[0], -gs[1], -gs[2], 1]
  const M = mul(mul(T, S), nodeMatrix(rootNode))
  delete rootNode.translation
  delete rootNode.rotation
  delete rootNode.scale
  rootNode.matrix = M.map(v => Number(v.toFixed(7)))

  writeGLB(OUT, j, g.bin)
  console.log(`written ${OUT} (${(readFileSync(OUT).length / 1024 / 1024).toFixed(2)} MB, pre-compression)`)

  // -- verify in final space
  const g2 = parseGLB(OUT)
  const j2 = g2.json
  const pts2: number[][] = []
  walk(j2, g2, () => {})
  walk(j2, g2, (n, M2) => {
    if (n.mesh === undefined) return
    for (const p of (j2.meshes[n.mesh].primitives ?? [])) {
      const ai = p.attributes?.POSITION
      if (ai === undefined) continue
      const a = j2.accessors[ai]
      if (a.type !== 'VEC3' || a.componentType !== 5126) continue
      const view = j2.bufferViews[a.bufferView]
      const base = (view?.byteOffset ?? 0) + (a.byteOffset ?? 0)
      const stride = view?.byteStride ?? 12
      const dv = new DataView(g2.bin.buffer, g2.bin.byteOffset + base, a.count * stride)
      for (let i = 0; i < a.count; i++) {
        const o = i * stride
        pts2.push(applyV(M2, [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]))
      }
    }
  })
  const { mn: mn2, mx: mx2 } = bboxOf(pts2)
  console.log(`\nVERIFY: nodes=${j2.nodes.length} (want 57) tris=${(j2 as any).__triTotal.toFixed(0)} (want 16860)`)
  console.log(`VERIFY: final bbox z=[${mn2[2].toFixed(3)}, ${mx2[2].toFixed(3)}] (want ≈[−0.660, +0.284]) y=[${mn2[1].toFixed(3)}, ${mx2[1].toFixed(3)}] (want ≈[−0.127, +0.134])`)
  // grip must sit at the origin (that's the anchor contract)
  const gripIdx2 = j2.nodes.findIndex((n: any) => /grip/i.test(String(n?.name ?? '')) && !/trigger/i.test(String(n?.name ?? '')))
  const gb2 = bboxOf(subtreeVerts(g2, j2, gripIdx2))
  const dev = Math.max(Math.abs((gb2.mn[0] + gb2.mx[0]) / 2), Math.abs((gb2.mn[1] + gb2.mx[1]) / 2), Math.abs((gb2.mn[2] + gb2.mx[2]) / 2))
  console.log(`VERIFY: grip center deviation from origin: ${(dev * 1000).toFixed(2)}mm ${dev < 0.005 ? '(PASS <5mm)' : '(FAIL)'}`)
}

main()
