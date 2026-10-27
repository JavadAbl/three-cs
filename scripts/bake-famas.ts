// ============================================================
// bake-famas.ts — bakes the user's FAMAS upload
// (upload/famas_-_csgo__plasmas.glb, Sketchfab rip, "Plasmas" CS:GO skin)
// to the weapon GLB contract (grip anchor at origin, muzzle −Z,
// real-meter scale — public/assets/models/README.md).
// Mirrors bake-m4.ts (Task 104) with FAMAS-specific findings
// (Task 105 forensics, scripts/.tmp/diag-famas.ts):
//   - the gun lies along the Z axis (m4 was X): z −11.73..+23.44,
//     y = height (carry handle +7.16 top, mag −6.28 bottom)
//   - MUZZLE AT +Z: the +Z 12% slice is a thin rod (x/y ext 0.87u =
//     19mm — flash hider/barrel tip) while the −Z end is the tall
//     full-height butt plate (y-ext 6.04u = 130mm). Corroboration:
//     the tall folded-bipod geometry (y up to 6.8) sits near the +Z
//     end (FAMAS bipod folds up around the barrel) and the deep mag
//     (−6.28) is at z −4.2..2.1 BEHIND the grip (bullpup signature).
//     → rotY(180°) maps +Z → −Z (x mirrors, y stays up)
//   - real overall length 0.757 m (FAMAS) over the 35.174u z span →
//     uniform scale k ≈ 0.02152
//   - trigger-hand anchor: the model HAS a pistol grip (unlike m4) —
//     bbox center of the grip band z ∈ [3.3, 7.1], y < −1.2 (raw u),
//     the deep narrow protrusion to −3.40 between trigger guard
//     (z 8.4..9.6, −2.66) and the mag well behind it.
//   - single PBR material, PNG baseColor (the plasma skin), metal 0,
//     roughness 0.6, doubleSided — compress-glb.sh webp-encodes it.
//
// Expected result: 5 nodes / 3 meshes / 10,384 tris survive; final
// bbox z ≈ [−0.394 (muzzle) .. +0.363 (butt)] around the grip anchor
// (grip→muzzle 0.394m, grip→butt 0.363m, mag bottom 0.085m below it).
//
// Usage: npx tsx scripts/bake-famas.ts
// Output: scripts/.tmp/famas-fixed.glb (then compress-glb.sh → staging)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/famas_-_csgo__plasmas.glb'
const OUT = '/home/z/my-project/scripts/.tmp/famas-fixed.glb'
const REAL_LEN = 0.757 // m — FAMAS overall length
// trigger-hand anchor band (world raw units, pre-bake): the pistol grip,
// between the trigger guard (z 8.4..9.6) and the mag well (z < 2.1)
const GRIP_Z0 = 3.3, GRIP_Z1 = 7.1, GRIP_YMAX = -1.2

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
  const span = mx[2] - mn[2]
  const k = REAL_LEN / span
  console.log(`tris=${triCount.toFixed(0)} world bbox x=[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y=[${mn[1].toFixed(3)},${mx[1].toFixed(3)}] z=[${mn[2].toFixed(3)},${mx[2].toFixed(3)}]`)
  console.log(`z span ${span.toFixed(4)}u, scale k=${k.toFixed(5)} (target real length ${REAL_LEN}m)`)

  // -- muzzle end auto-detect by cross-section THINNESS along Z. The
  // flash-hider/barrel tip must be decisively thinner than the butt plate.
  // (bore = z → perpendicular extents are (x,y) — in BOTH raw and final
  // space here, since the bake rotation is about Y and keeps the bore on z;
  // the m4 trap (bore axis switching spaces) does not apply.)
  const FRAC = 0.12
  const rear = pts.filter(p => p[2] <= mn[2] + span * FRAC)
  const front = pts.filter(p => p[2] >= mx[2] - span * FRAC)
  const extent = (vs: number[][]) => {
    const b = bboxOf(vs)
    return { w: b.mx[0] - b.mn[0], h: b.mx[1] - b.mn[1] } // x/y extents (z is the bore axis)
  }
  const eRear = extent(rear), eFront = extent(front)
  console.log(`rear(-Z)  12% slice: n=${String(rear.length).padStart(5)} x-ext=${(eRear.w * 1000).toFixed(0)}mm y-ext=${(eRear.h * 1000).toFixed(0)}mm`)
  console.log(`front(+Z) 12% slice: n=${String(front.length).padStart(5)} x-ext=${(eFront.w * 1000).toFixed(0)}mm y-ext=${(eFront.h * 1000).toFixed(0)}mm`)
  const rearThin = Math.max(eRear.w, eRear.h), frontThin = Math.max(eFront.w, eFront.h)
  if (!(frontThin < rearThin * 0.6)) throw new Error(`muzzle NOT at +Z as expected (front thinness ${frontThin.toFixed(3)} vs rear ${rearThin.toFixed(3)}) — inspect manually`)
  console.log('muzzle end: +Z (thin flash-hider tip vs tall butt plate) -> rotY(180) REQUIRED')

  // -- rotation: rotY(180°) maps +Z -> -Z (x mirrors, y stays up)
  const R = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]

  // -- trigger-hand anchor: bbox center of the pistol-grip band (the model
  // HAS a real grip — see header; band constants from the Z-band profile)
  const bump = pts.filter(p => p[2] >= GRIP_Z0 && p[2] <= GRIP_Z1 && p[1] < GRIP_YMAX)
  if (bump.length < 20) throw new Error(`grip band detection found only ${bump.length} verts — band constants are stale`)
  const gb = bboxOf(bump)
  const cg: [number, number, number] = [(gb.mn[0] + gb.mx[0]) / 2, (gb.mn[1] + gb.mx[1]) / 2, (gb.mn[2] + gb.mx[2]) / 2]
  console.log(`grip band: ${bump.length} verts, bbox y=[${gb.mn[1].toFixed(3)},${gb.mx[1].toFixed(3)}] z=[${gb.mn[2].toFixed(3)},${gb.mx[2].toFixed(3)}] -> center=[${cg[0].toFixed(3)}, ${cg[1].toFixed(3)}, ${cg[2].toFixed(3)}]`)

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
  console.log(`\nVERIFY: nodes=${j2.nodes.length} (want 5) tris=${(j2 as any).__triTotal.toFixed(0)} (want 10384)`)
  console.log(`VERIFY: final bbox z=[${fmn[2].toFixed(3)},${fmx[2].toFixed(3)}] (want muzzle NEGATIVE ~-0.394 / butt positive ~+0.363)`)
  console.log(`VERIFY: final bbox y=[${fmn[1].toFixed(3)},${fmx[1].toFixed(3)}] x=[${fmn[0].toFixed(3)},${fmx[0].toFixed(3)}]`)
  // orientation contract: the −Z end must now be the THIN muzzle end.
  // bore = z in final space too → perpendicular extents (x,y).
  const span2 = fmx[2] - fmn[2]
  const vMuzzle = pts2.filter(p => p[2] <= fmn[2] + span2 * FRAC)
  const vButt = pts2.filter(p => p[2] >= fmx[2] - span2 * FRAC)
  const perpExtent = (vs: number[][]) => {
    const b = bboxOf(vs)
    return Math.max(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1])
  }
  const tMuzzle = perpExtent(vMuzzle)
  const tButt = perpExtent(vButt)
  const orientPass = tMuzzle < tButt * 0.6 && fmn[2] < -0.35
  console.log(`VERIFY: -Z end thinness ${tMuzzle.toFixed(3)} vs +Z end ${tButt.toFixed(3)} -> ${orientPass ? 'muzzle -Z (PASS)' : 'WRONG (FAIL)'}`)
  // bullpup signature must survive: the deep mag (final y < -0.05, i.e.
  // below the grip band whose floor sits at -0.023) must sit BEHIND the
  // grip origin (positive z, butt side) — never ahead of it
  const magPts = pts2.filter(p => p[1] < -0.05)
  const magZ = magPts.length ? bboxOf(magPts) : null
  const magBehind = magZ ? magZ.mn[2] > -0.02 : false
  console.log(`VERIFY: deep-mag (y<-0.10) z-range [${magZ ? magZ.mn[2].toFixed(3) : '-'},${magZ ? magZ.mx[2].toFixed(3) : '-'}] -> ${magBehind ? 'behind grip origin (bullpup PASS)' : 'WRONG (FAIL)'}`)
  // anchor must sit at the origin: map the raw band verts through the bake M
  const bumpMapped = bump.map(p => applyV(M, p))
  const gb2 = bboxOf(bumpMapped)
  const dev = Math.max(Math.abs((gb2.mn[0] + gb2.mx[0]) / 2), Math.abs((gb2.mn[1] + gb2.mx[1]) / 2), Math.abs((gb2.mn[2] + gb2.mx[2]) / 2))
  console.log(`VERIFY: grip band center after bake: [${((gb2.mn[0] + gb2.mx[0]) / 2).toFixed(4)}, ${((gb2.mn[1] + gb2.mx[1]) / 2).toFixed(4)}, ${((gb2.mn[2] + gb2.mx[2]) / 2).toFixed(4)}] deviation ${(dev * 1000).toFixed(2)}mm ${dev < 0.005 ? '(PASS <5mm)' : '(FAIL)'}`)
  if (!orientPass) throw new Error('ORIENTATION VERIFY FAILED — do not stage')
  if (!magBehind) throw new Error('BULLPUP LAYOUT VERIFY FAILED — mag ended up ahead of the grip; orientation is wrong')
  console.log('\nORIENTATION CONTRACT PASSED — safe to compress + stage')
}

main()
