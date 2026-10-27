// ============================================================
// bake-ak47.ts — rebuild of the Task 57 bake script (the original
// scripts/.tmp/bake-ak47.ts was wiped 2026-10-20 by a gitignored-
// paths cleanup along with public/staging; this rewrite reproduces
// it from the Task 57 worklog record + the raw-container technique
// recovered from git 7052ea9:scripts/stage-guns-pack.ts).
//
// Bakes the user's Sketchfab upload (upload/ak-47.glb) to the weapon
// GLB contract: grip anchor at origin, muzzle −Z, real-meter scale
// (public/assets/models/README.md). Unlike the old pack script
// (single mesh node, fz/fy grip fractions), the AK is a 134-node
// graph with NAMED PART nodes — so:
//   - fixup composes into the ROOT node matrix
//   - grip anchor = world bbox CENTER of the bl_grip_low node
//     (precise, no fraction heuristic)
//   - muzzle end auto-detected: barrel node bbox center vs stock
//     node bbox center along X (recorded: barrel 5.60 > stock 4.21
//     → muzzle at +X → rotY +90° maps +X → −Z)
//
// Expected result (Task 57 record): 134 nodes / 17,392 tris survive,
// bbox z −0.602 (muzzle tip) .. +0.278 (stock rear), y −0.115..+0.137,
// uniform scale ≈ 0.4591 (0.88 m / 1.9168 u longest-X).
//
// Usage: npx tsx scripts/.tmp/bake-ak47.ts
// Output: scripts/.tmp/ak47-fixed.glb (then compress-glb.sh → staging)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/ak-47.glb'
const OUT = '/home/z/my-project/scripts/.tmp/ak47-fixed.glb'
const REAL_LEN = 0.88 // m — real AK-47 overall length

// OUT dir is the volatile scratch dir; create it so the script works from a fresh clone
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
/** walk the node graph; cb(node, Mworld) for every node with a mesh */
function walk(j: any, cb: (n: any, M: number[]) => void): void {
  const scene = j.scenes[j.scene ?? 0]
  const roots: number[] = scene?.nodes ?? []
  if (roots.length !== 1) throw new Error(`expected 1 scene root, got ${roots.length}`)
  const rec = (idx: number, Mparent: number[]) => {
    const n = j.nodes[idx]
    const M = mul(Mparent, nodeMatrix(n))
    if (n.mesh !== undefined) cb(n, M)
    for (const c of n.children ?? []) rec(c, M)
  }
  for (const r of roots) rec(r, I)
}

/** every world-space vertex of the subtree rooted at node index `start` */
function subtreeVerts(g: ParsedGLB, j: any, start: number): number[][] {
  const accs = j.accessors ?? []
  const views = j.bufferViews ?? []
  const meshes = j.meshes ?? []
  const out: number[][] = []
  const rec = (idx: number, Mparent: number[]) => {
    const n = j.nodes[idx]
    const M = mul(Mparent, nodeMatrix(n))
    if (n.mesh !== undefined) {
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
  }
  // chain from scene root down to `start` is handled by rec below starting
  // at start with the ROOT-chain matrix — but simplest: rec from start with
  // the matrix of start's ancestors. We re-walk from the scene root and only
  // START COLLECTING at `start`.
  const scene = j.scenes[j.scene ?? 0]
  let collecting = false
  const rec2 = (idx: number, Mparent: number[]) => {
    const n = j.nodes[idx]
    const M = mul(Mparent, nodeMatrix(n))
    const wasCollecting = collecting
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
    for (const c of n.children ?? []) rec2(c, M)
    collecting = wasCollecting
  }
  for (const r of scene?.nodes ?? []) rec2(r, I)
  return out
}

// ---------------------------------------------------------------- main
function main(): void {
  const g = parseGLB(SRC)
  const j = g.json
  console.log(`nodes=${(j.nodes ?? []).length} meshes=${(j.meshes ?? []).length}`)

  // -- overall world bbox
  const pts: number[][] = []
  let triCount = 0
  walk(j, (n, _M) => {
    for (const p of (j.meshes[n.mesh].primitives ?? [])) {
      if (p.indices !== undefined) {
        const ia = j.accessors[p.indices]
        triCount += ia.count / 3
      }
    }
  })
  walk(j, (n, M) => {
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
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const p of pts) for (let i = 0; i < 3; i++) { if (p[i] < mn[i]) mn[i] = p[i]; if (p[i] > mx[i]) mx[i] = p[i] }
  const L = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])
  const k = REAL_LEN / L
  console.log(`world tris=${triCount.toFixed(0)} bbox x=[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y=[${mn[1].toFixed(3)},${mx[1].toFixed(3)}] z=[${mn[2].toFixed(3)},${mx[2].toFixed(3)}]`)
  console.log(`longest=${L.toFixed(4)}u scale k=${k.toFixed(4)} (recorded 0.4591)`)

  // -- muzzle end auto-detect: barrel node vs stock node bbox centers along X
  const findNode = (pred: (name: string) => boolean): number => {
    for (let i = 0; i < j.nodes.length; i++) {
      const nm = String(j.nodes[i].name ?? '')
      if (pred(nm)) return i
    }
    return -1
  }
  const center = (vs: number[][]): [number, number, number] | null => {
    if (!vs.length) return null
    const c: [number, number, number] = [0, 0, 0]
    for (const v of vs) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2] }
    return [c[0] / vs.length, c[1] / vs.length, c[2] / vs.length]
  }
  const barrelIdx = findNode(nm => /barrel/i.test(nm))
  const stockIdx = findNode(nm => /stock/i.test(nm))
  const barrelC = barrelIdx >= 0 ? center(subtreeVerts(g, j, barrelIdx)) : null
  const stockC = stockIdx >= 0 ? center(subtreeVerts(g, j, stockIdx)) : null
  console.log(`barrel node "${j.nodes[barrelIdx]?.name}" cx=${barrelC?.[0].toFixed(2) ?? 'n/a'}; stock node "${j.nodes[stockIdx]?.name}" cx=${stockC?.[0].toFixed(2) ?? 'n/a'}`)
  if (!barrelC || !stockC) throw new Error('barrel/stock node not found — cannot auto-detect muzzle end')
  const sign = barrelC[0] > stockC[0] ? 1 : -1
  console.log(`muzzle end: ${sign > 0 ? '+X' : '-X'} (recorded: +X, barrel 5.60 > stock 4.21)`)
  const ry = sign > 0 ? Math.PI / 2 : -Math.PI / 2
  const c = Math.cos(ry), s = Math.sin(ry)
  const R = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]

  // -- grip anchor: bl_grip_low node subtree world bbox CENTER
  const gripIdx = findNode(nm => /bl_grip_low/i.test(nm))
  if (gripIdx < 0) throw new Error('bl_grip_low node not found')
  const gv = subtreeVerts(g, j, gripIdx)
  let gmn = [Infinity, Infinity, Infinity], gmx = [-Infinity, -Infinity, -Infinity]
  for (const v of gv) for (let i = 0; i < 3; i++) { if (v[i] < gmn[i]) gmn[i] = v[i]; if (v[i] > gmx[i]) gmx[i] = v[i] }
  const cg: [number, number, number] = [(gmn[0] + gmx[0]) / 2, (gmn[1] + gmx[1]) / 2, (gmn[2] + gmx[2]) / 2]
  console.log(`grip "${j.nodes[gripIdx].name}" verts=${gv.length} bbox center=[${cg[0].toFixed(3)}, ${cg[1].toFixed(3)}, ${cg[2].toFixed(3)}]`)

  // -- compose M = T · R · S into the ROOT node matrix
  const scene = j.scenes[j.scene ?? 0]
  const rootIdx = scene.nodes[0]
  const rootNode = j.nodes[rootIdx]
  const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]
  const RS = mul(R, S)
  const gr = applyV(RS, cg) // grip center after rotate+scale
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -gr[0], -gr[1], -gr[2], 1]
  const M = mul(mul(T, RS), nodeMatrix(rootNode))
  delete rootNode.translation
  delete rootNode.rotation
  delete rootNode.scale
  rootNode.matrix = M.map(v => Number(v.toFixed(7)))

  writeGLB(OUT, j, g.bin)
  console.log(`written ${OUT} (${(readFileSync(OUT).length / 1024 / 1024).toFixed(2)} MB, pre-compression)`)

  // -- verify: reparse, count, re-measure in final space
  const g2 = parseGLB(OUT)
  const j2 = g2.json
  const pts2: number[][] = []
  let tri2 = 0
  walk(j2, (n, _M) => {
    for (const p of (j2.meshes[n.mesh].primitives ?? [])) {
      if (p.indices !== undefined) tri2 += j2.accessors[p.indices].count / 3
    }
  })
  walk(j2, (n, M) => {
    for (const p of (j2.meshes[n.mesh].primitives ?? [])) {
      const ai = p.attributes?.POSITION
      if (ai === undefined) continue
      const a = j2.accessors[ai]
      const view = j2.bufferViews[a.bufferView]
      const base = (view?.byteOffset ?? 0) + (a.byteOffset ?? 0)
      const stride = view?.byteStride ?? 12
      const dv = new DataView(g2.bin.buffer, g2.bin.byteOffset + base, a.count * stride)
      for (let i = 0; i < a.count; i++) {
        const o = i * stride
        pts2.push(applyV(M, [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]))
      }
    }
  })
  let mn2 = [Infinity, Infinity, Infinity], mx2 = [-Infinity, -Infinity, -Infinity]
  for (const p of pts2) for (let i = 0; i < 3; i++) { if (p[i] < mn2[i]) mn2[i] = p[i]; if (p[i] > mx2[i]) mx2[i] = p[i] }
  console.log(`\nVERIFY: nodes=${j2.nodes.length} (want 134) tris=${tri2.toFixed(0)} (want 17392)`)
  console.log(`VERIFY: final bbox z=[${mn2[2].toFixed(3)}, ${mx2[2].toFixed(3)}] (want [-0.602, +0.278]) y=[${mn2[1].toFixed(3)}, ${mx2[1].toFixed(3)}] (want [-0.115, +0.137])`)
  const dz = Math.max(Math.abs(mn2[2] + 0.602), Math.abs(mx2[2] - 0.278), Math.abs(mn2[1] + 0.115), Math.abs(mx2[1] - 0.137))
  console.log(dz < 0.02 ? 'VERIFY PASS (bbox within 2cm of Task 57 record)' : `VERIFY FAIL: max bbox deviation ${dz.toFixed(3)}m`)
}

main()
