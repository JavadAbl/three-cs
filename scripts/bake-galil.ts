// ============================================================
// bake-galil.ts — bakes the user's Galil AR upload
// (upload/galil_ar_counter_strike_2.glb, a CS2 rip) to the weapon
// GLB contract (grip anchor at origin, muzzle −Z, real-meter scale
// — public/assets/models/README.md). Mirrors scripts/bake-ak74.ts
// technique, with the Galil-specific problems:
//   - SINGLE merged mesh (41,074 tris, 5 nodes, NO named parts)
//     → the AK-74 script's barrel-vs-stock node detection found
//     NOTHING here, and the lost first attempt (Task 69) guessed
//     "muzzle −Z, no rotation" — WRONG: the rip is muzzle +Z, so
//     the gun rendered REVERSED ("the weapon is reverse!! the gun
//     stock in front"). This bake derives the muzzle end from
//     cross-section thinness instead of node names.
//   - raw z span [-0.1597, +0.6229] m after the Sketchfab cm→m
//     parent chain (root rot + diag(0.01,...)): far +Z end is a
//     uniform ~2×2cm tube at y≈+0.08 (barrel), rear −Z end is tall
//     (h≈11.7cm, stock) → muzzle at +Z → rotY(180°) required.
//   - real overall length 0.97 m (IMI Galil AR, stock extended)
//     over the 0.7825 m world z span → uniform scale ≈ 1.2401
//     (the rip is authored short; scale makes it read true next
//     to the accepted AK-47 0.88 / AK-74M 0.94)
//   - grip anchor: no grip node → geometric detection. The grip is
//     the rear of the two downward feet on the z profile
//     (z≈+0.042..+0.115, hangs to y≈−0.060; the deeper foot at
//     z≈+0.20..+0.31, y to −0.129 is the mag). Anchor = bbox
//     center of vertices in band z∈[0.030,0.125] with y < −0.010
//     (below the receiver floor — excludes receiver/trigger-guard
//     verts, keeps the bump).
//
// Expected result: 5 nodes / 41,074 tris survive; final bbox
// z ≈ [−0.67 (muzzle tip) .. +0.30 (stock butt)], y ≈ [−0.12 (mag)
// .. +0.22 (rear sight)], grip bump centered on the origin.
//
// Usage: npx tsx scripts/bake-galil.ts
// Output: scripts/.tmp/galil-fixed.glb (then compress-glb.sh → staging)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/galil_ar_counter_strike_2.glb'
const OUT = '/home/z/my-project/scripts/.tmp/galil-fixed.glb'
const REAL_LEN = 0.97 // m — IMI Galil AR overall length, stock extended
// grip-bump detection band (world m) — derived from the z-slice profile,
// see header. Band chosen to bracket the rear foot (slices z 0.042..0.115)
const GRIP_Z0 = 0.030, GRIP_Z1 = 0.125, GRIP_YMAX = -0.010

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
/** all world-space mesh vertices reachable from the scene root(s) */
function worldVerts(g: ParsedGLB, j: any): number[][] {
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
  return pts
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
  const scene = j.scenes[j.scene ?? 0]
  if ((scene?.nodes ?? []).length !== 1) throw new Error(`expected exactly 1 scene root, got ${(scene?.nodes ?? []).length}`)
  console.log(`nodes=${(j.nodes ?? []).length} meshes=${(j.meshes ?? []).length} (single merged mesh expected)`)

  const pts = worldVerts(g, j)
  const triCount = (j as any).__triTotal
  const { mn, mx } = bboxOf(pts)
  const span = mx[2] - mn[2]
  const k = REAL_LEN / span
  console.log(`tris=${triCount.toFixed(0)} world bbox x=[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y=[${mn[1].toFixed(3)},${mx[1].toFixed(3)}] z=[${mn[2].toFixed(3)},${mx[2].toFixed(3)}]`)
  console.log(`z span ${span.toFixed(4)}m, scale k=${k.toFixed(4)} (target real length ${REAL_LEN}m)`)

  // -- muzzle end auto-detect by cross-section THINNESS (no named parts!)
  // The barrel is the thinnest section of any rifle; the stock/receiver is
  // the tallest/widest. Sample 12% of the z span at each end.
  const FRAC = 0.12
  const rear = pts.filter(p => p[2] <= mn[2] + span * FRAC)
  const front = pts.filter(p => p[2] >= mx[2] - span * FRAC)
  const extent = (vs: number[][]) => {
    const b = bboxOf(vs)
    return { w: b.mx[0] - b.mn[0], h: b.mx[1] - b.mn[1] }
  }
  const eRear = extent(rear), eFront = extent(front)
  console.log(`rear  12% slice: n=${String(rear.length).padStart(5)} w=${(eRear.w * 1000).toFixed(0)}mm h=${(eRear.h * 1000).toFixed(0)}mm`)
  console.log(`front 12% slice: n=${String(front.length).padStart(5)} w=${(eFront.w * 1000).toFixed(0)}mm h=${(eFront.h * 1000).toFixed(0)}mm`)
  const rearThin = Math.max(eRear.w, eRear.h), frontThin = Math.max(eFront.w, eFront.h)
  const muzzleAtFrontZ = frontThin < rearThin * 0.6 // barrel end must be decisively thinner
  const muzzleAtRearZ = rearThin < frontThin * 0.6
  if (!muzzleAtFrontZ && !muzzleAtRearZ) throw new Error(`ambiguous muzzle end (rear thinness ${rearThin.toFixed(3)} vs front ${frontThin.toFixed(3)}) — inspect manually`)
  console.log(`muzzle end: ${muzzleAtFrontZ ? '+Z (rear of z is the stock) -> rotY(180) REQUIRED' : '-Z (already contract-correct, no rotation)'}`)

  // -- rotation: rotY(θ). rotY(180°): x->-x, z->-z (muzzle +Z -> -Z)
  const R = muzzleAtFrontZ
    ? [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
    : I.slice()

  // -- grip anchor: bbox center of the rear downward foot (see header)
  const bump = pts.filter(p => p[2] >= GRIP_Z0 && p[2] <= GRIP_Z1 && p[1] < GRIP_YMAX)
  if (bump.length < 50) throw new Error(`grip bump detection found only ${bump.length} verts — band constants are stale`)
  const gb = bboxOf(bump)
  const cg: [number, number, number] = [(gb.mn[0] + gb.mx[0]) / 2, (gb.mn[1] + gb.mx[1]) / 2, (gb.mn[2] + gb.mx[2]) / 2]
  console.log(`grip bump: ${bump.length} verts, bbox y=[${gb.mn[1].toFixed(3)}, ${gb.mx[1].toFixed(3)}] z=[${gb.mn[2].toFixed(3)}, ${gb.mx[2].toFixed(3)}] -> center=[${cg[0].toFixed(3)}, ${cg[1].toFixed(3)}, ${cg[2].toFixed(3)}]`)

  // -- compose M = T · R · S into the single ROOT node matrix
  const rootNode = j.nodes[scene.nodes[0]]
  const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]
  const rs = applyV(mul(R, S), cg) // grip center after R · S
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -rs[0], -rs[1], -rs[2], 1]
  const M = mul(mul(T, R), S)
  rootNode.matrix = mul(M, nodeMatrix(rootNode)).map(v => Number(v.toFixed(7)))
  delete rootNode.translation
  delete rootNode.rotation
  delete rootNode.scale

  writeGLB(OUT, j, g.bin)
  console.log(`written ${OUT} (${(readFileSync(OUT).length / 1024 / 1024).toFixed(2)} MB, pre-compression)`)

  // ---------------------------------------------------------------- verify in final space
  const g2 = parseGLB(OUT)
  const j2 = g2.json
  const pts2 = worldVerts(g2, j2)
  const { mn: fmn, mx: fmx } = bboxOf(pts2)
  console.log(`\nVERIFY: nodes=${j2.nodes.length} (want 5) tris=${(j2 as any).__triTotal.toFixed(0)} (want 41074)`)
  console.log(`VERIFY: final bbox z=[${fmn[2].toFixed(3)}, ${fmx[2].toFixed(3)}] (want muzzle NEGATIVE / stock butt positive)`)
  console.log(`VERIFY: final bbox y=[${fmn[1].toFixed(3)}, ${fmx[1].toFixed(3)}] x=[${fmn[0].toFixed(3)}, ${fmx[0].toFixed(3)}]`)
  // orientation contract: the −Z end must now be the THIN barrel
  const vRear = pts2.filter(p => p[2] <= fmn[2] + (fmx[2] - fmn[2]) * FRAC)
  const vFront = pts2.filter(p => p[2] >= fmx[2] - (fmx[2] - fmn[2]) * FRAC)
  const tRear = Math.max(...((e => [e.w, e.h])(extent(vRear))))
  const tFront = Math.max(...((e => [e.w, e.h])(extent(vFront))))
  const orientPass = tRear < tFront * 0.6 && fmn[2] < -0.4
  console.log(`VERIFY: −Z end thinness ${tRear.toFixed(3)} vs +Z end ${tFront.toFixed(3)} -> ${orientPass ? 'muzzle −Z (PASS)' : 'WRONG (FAIL)'}`)
  // grip must sit at the origin (anchor contract): map the RAW bump verts
  // (world-space, root chain already applied) through the world-space bake
  // matrix M directly and bbox-center them
  const bumpMapped = bump.map(p => applyV(M, p))
  const gb2 = bboxOf(bumpMapped)
  const dev = Math.max(Math.abs((gb2.mn[0] + gb2.mx[0]) / 2), Math.abs((gb2.mn[1] + gb2.mx[1]) / 2), Math.abs((gb2.mn[2] + gb2.mx[2]) / 2))
  console.log(`VERIFY: grip bump center after bake: [${((gb2.mn[0] + gb2.mx[0]) / 2).toFixed(4)}, ${((gb2.mn[1] + gb2.mx[1]) / 2).toFixed(4)}, ${((gb2.mn[2] + gb2.mx[2]) / 2).toFixed(4)}] deviation ${(dev * 1000).toFixed(2)}mm ${dev < 0.005 ? '(PASS <5mm)' : '(FAIL)'}`)
  if (!orientPass) throw new Error('ORIENTATION VERIFY FAILED — do not stage')
  console.log('\nORIENTATION CONTRACT PASSED — safe to compress + stage')
}

main()
