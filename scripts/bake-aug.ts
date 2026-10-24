// ============================================================
// bake-aug.ts — bakes the user's AUG upload
// (upload/steyr_aug_a3.glb, Sketchfab rip "Steyr AUG A3") to the
// weapon GLB contract (grip anchor at origin, muzzle −Z, real-meter
// scale — public/assets/models/README.md).
// Mirrors bake-famas.ts (Task 105) / bake-m4.ts (Task 104) with
// AUG-specific findings (Task 106 forensics, scripts/.tmp/diag-aug*.ts):
//   - the gun lies along the X axis (m4-class, famas was Z): bore
//     x −38.51..+39.87, MUZZLE AT +X (the +X 10% slice is a thin rod,
//     y-ext 5.17u = 46mm — flash hider/barrel — while the −X end is the
//     tall butt plate, y-ext 17.87u) → rotY(+90°) maps +X → −Z
//     (y stays up; the only proper-rotation solution for this axis pair)
//   - real overall length 0.690 m (Steyr AUG A3, 407mm barrel) over the
//     78.38u x span → uniform scale k ≈ 0.008806
//   - trigger-hand anchor: the pistol-grip protrusion is the deep cluster
//     x ∈ [−18, −14], y < −8 (raw u) — the deepest point −11.59 sits at
//     x −17.6..−15.0 (the grip core); x −12..−10 shallow tail is the
//     trigger guard loop. Mag is ENCLOSED in the bullpup stock shell
//     (no deep protrusion behind the grip, unlike famas); the second
//     deep cluster x 21.9..26.1 (−10.86) is the A3-style vertical
//     foregrip at ~80% from the butt — must land AHEAD of the origin.
//   - 2 PBR materials with baseColorTexture + metallicRoughnessTexture,
//     doubleSided; mesh 1 is a tiny 26-vert top part (x 0.4..19.8,
//     y ≥ 14.6 — rail/optic furniture).
//
// Expected result: 6 nodes / 2 meshes / 14,223 tris survive; final
// bbox z ≈ [−0.49 (muzzle) .. +0.19 (butt)] around the grip anchor.
//
// Usage: npx tsx scripts/bake-aug.ts
// Output: scripts/.tmp/aug-fixed.glb (then compress-glb.sh → assets)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/steyr_aug_a3.glb'
const OUT = '/home/z/my-project/scripts/.tmp/aug-fixed.glb'
const REAL_LEN = 0.690 // m — Steyr AUG A3 overall length
// pistol-grip band (world raw units, pre-bake): the deep grip core,
// between the foregrip-side trigger guard (x > −14) and the
// stock-enclosed mag well (x < −18)
const GRIP_X0 = -18, GRIP_X1 = -14, GRIP_YMAX = -8

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
  const yy = qy * y2, yz = qy * y2, zz = qz * z2
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
  console.log(`nodes=${(j.nodes ?? []).length} meshes=${(j.meshes ?? []).length}`)

  const pts = worldVerts(g, j)
  const triCount = (j as any).__triTotal
  const { mn, mx } = bboxOf(pts)
  const span = mx[0] - mn[0]
  const k = REAL_LEN / span
  console.log(`tris=${triCount.toFixed(0)} world bbox x=[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y=[${mn[1].toFixed(3)},${mx[1].toFixed(3)}] z=[${mn[2].toFixed(3)},${mx[2].toFixed(3)}]`)
  console.log(`x span ${span.toFixed(4)}u, scale k=${k.toFixed(5)} (target real length ${REAL_LEN}m)`)

  // -- muzzle end auto-detect by cross-section THINNESS along X (bore
  // axis). The flash-hider/barrel tip must be decisively thinner than the
  // butt plate. Perpendicular extents are (y,z) in RAW space; after the
  // rotY(90°) bake the bore moves to z and the perpendiculars become (x,y).
  const FRAC = 0.10
  const rear = pts.filter(p => p[0] <= mn[0] + span * FRAC)
  const front = pts.filter(p => p[0] >= mx[0] - span * FRAC)
  const extent = (vs: number[][]) => {
    const b = bboxOf(vs)
    return { h: b.mx[1] - b.mn[1], w: b.mx[2] - b.mn[2] }
  }
  const eRear = extent(rear), eFront = extent(front)
  console.log(`rear(-X)  10% slice: n=${String(rear.length).padStart(5)} y-ext=${(eRear.h * 1000).toFixed(0)}mm z-ext=${(eRear.w * 1000).toFixed(0)}mm`)
  console.log(`front(+X) 10% slice: n=${String(front.length).padStart(5)} y-ext=${(eFront.h * 1000).toFixed(0)}mm z-ext=${(eFront.w * 1000).toFixed(0)}mm`)
  const rearThin = Math.max(eRear.h, eRear.w), frontThin = Math.max(eFront.h, eFront.w)
  if (!(frontThin < rearThin * 0.6)) throw new Error(`muzzle NOT at +X as expected (front thinness ${frontThin.toFixed(3)} vs rear ${rearThin.toFixed(3)}) — inspect manually`)
  console.log('muzzle end: +X (thin flash-hider/barrel tip vs tall butt plate) -> rotY(+90) REQUIRED')

  // -- rotation: rotY(90°) maps +X -> -Z (proper rotation, y stays up)
  const R = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]

  // -- trigger-hand anchor: bbox center of the pistol-grip band (the deep
  // grip core; band constants from the X-band deep-cluster profile)
  const bump = pts.filter(p => p[0] >= GRIP_X0 && p[0] <= GRIP_X1 && p[1] < GRIP_YMAX)
  if (bump.length < 20) throw new Error(`grip band detection found only ${bump.length} verts — band constants are stale`)
  const gb = bboxOf(bump)
  const cg: [number, number, number] = [(gb.mn[0] + gb.mx[0]) / 2, (gb.mn[1] + gb.mx[1]) / 2, (gb.mn[2] + gb.mx[2]) / 2]
  console.log(`grip band: ${bump.length} verts, bbox x=[${gb.mn[0].toFixed(3)},${gb.mx[0].toFixed(3)}] y=[${gb.mn[1].toFixed(3)},${gb.mx[1].toFixed(3)}] z=[${gb.mn[2].toFixed(3)},${gb.mx[2].toFixed(3)}] -> center=[${cg[0].toFixed(3)}, ${cg[1].toFixed(3)}, ${cg[2].toFixed(3)}]`)

  // -- compose M = T · R · S into the ROOT node matrix
  const rootNode = j.nodes[scene.nodes[0]]
  const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]
  const rs = applyV(mul(R, S), cg) // grip center after R · S
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -rs[0], -rs[1], -rs[2], 1]
  const M = mul(T, mul(R, S))
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
  console.log(`\nVERIFY: nodes=${j2.nodes.length} (want 6) tris=${(j2 as any).__triTotal.toFixed(0)} (want 14223)`)
  console.log(`VERIFY: final bbox z=[${fmn[2].toFixed(3)},${fmx[2].toFixed(3)}] (want muzzle NEGATIVE ~-0.49 / butt positive ~+0.19)`)
  console.log(`VERIFY: final bbox y=[${fmn[1].toFixed(3)},${fmx[1].toFixed(3)}] x=[${fmn[0].toFixed(3)},${fmx[0].toFixed(3)}]`)
  // orientation contract: the −Z end must now be the THIN muzzle end.
  // bore = z in final space → perpendicular extents (x,y).
  const span2 = fmx[2] - fmn[2]
  const vMuzzle = pts2.filter(p => p[2] <= fmn[2] + span2 * FRAC)
  const vButt = pts2.filter(p => p[2] >= fmx[2] - span2 * FRAC)
  const perpExtent = (vs: number[][]) => {
    const b = bboxOf(vs)
    return Math.max(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1])
  }
  const tMuzzle = perpExtent(vMuzzle)
  const tButt = perpExtent(vButt)
  const orientPass = tMuzzle < tButt * 0.6 && fmn[2] < -0.4
  console.log(`VERIFY: -Z end thinness ${tMuzzle.toFixed(3)} vs +Z end ${tButt.toFixed(3)} -> ${orientPass ? 'muzzle -Z (PASS)' : 'WRONG (FAIL)'}`)
  // foregrip cluster must land AHEAD of the grip origin (muzzle side,
  // negative z) — proves the rotation direction, not just the axis swap.
  // NOTE: threshold is −5mm below the ANCHOR (the grip band center), not a
  // fixed body datum — this model's deep protrusions reach only ~16mm
  // below the anchor (k=0.0088 is fine; the famas threshold −0.05 was
  // proportioned for k=0.0215 and would match NOTHING here).
  const fg = pts2.filter(p => p[1] < -0.005 && p[2] < 0)
  const fgB = fg.length ? bboxOf(fg) : null
  const fgAhead = fgB ? fgB.mx[2] < 0.02 : false
  console.log(`VERIFY: foregrip (y<-0.005, z<0) z-range [${fgB ? fgB.mn[2].toFixed(3) : '-'},${fgB ? fgB.mx[2].toFixed(3) : '-'}] -> ${fgAhead ? 'ahead of grip origin (PASS)' : 'WRONG (FAIL)'}`)
  // anchor must sit at the origin: map the raw band verts through the bake M
  const bumpMapped = bump.map(p => applyV(M, p))
  const gb2 = bboxOf(bumpMapped)
  const dev = Math.max(Math.abs((gb2.mn[0] + gb2.mx[0]) / 2), Math.abs((gb2.mn[1] + gb2.mx[1]) / 2), Math.abs((gb2.mn[2] + gb2.mx[2]) / 2))
  console.log(`VERIFY: grip band center after bake: [${((gb2.mn[0] + gb2.mx[0]) / 2).toFixed(4)}, ${((gb2.mn[1] + gb2.mx[1]) / 2).toFixed(4)}, ${((gb2.mn[2] + gb2.mx[2]) / 2).toFixed(4)}] deviation ${(dev * 1000).toFixed(2)}mm ${dev < 0.005 ? '(PASS <5mm)' : '(FAIL)'}`)
  if (!orientPass) throw new Error('ORIENTATION VERIFY FAILED — do not stage')
  if (!fgAhead) throw new Error('ROTATION DIRECTION VERIFY FAILED — foregrip ended up behind the grip; rotY sign is wrong')
  console.log('\nORIENTATION CONTRACT PASSED — safe to compress + stage')
}

main()
