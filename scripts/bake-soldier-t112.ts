// ============================================================
// bake-soldier-t112.ts — v2: A-pose ARM-LOWERing surgery for the user's
// soldier_character.glb (evaluation as the game's character model).
//
// FINDINGS (Task 112):
//  - The GLB's Sketchfab_model node carries matrix rotX(-90 deg) — the figure
//    ALREADY STANDS in three.js (7.05 x 10.0 x 2.99 raw). Do NOT wrap/rotate
//    the scene (v1 of this script did and staged a supine figure — the
//    "exploded spiky" in-game mess). usermodel.buildProto() normalizes scale
//    (1.79 m), grounds, centers and Y-flips on its own.
//  - The figure is in T-POSE. The auto-rigger's spatial skin rules + bone
//    positions assume hanging A-pose arms (|x| 0.2..0.44 after normalize).
//    T-pose arms reach |x| 0.63 -> every bone swing (walk/aim/death) flings
//    arm vertices through huge arcs = spiky shards on posed characters.
//
// SURGERY (this script): rotate the arm vertex regions down into A-pose, in
// RAW geometry space. Standing coords map as X_s=x_raw, Y_s=z_raw (up),
// Z_s=-y_raw — so lowering an arm is a rotation about the raw-Y axis through
// the shoulder pivot line (x=±PX, z=PZ), by ±ANGLE with a smooth blend band
// (X0..X0+XB) so the shoulder seam stays continuous. Normals rotated the
// same way. POSITION accessor min/max recomputed. Buffer length unchanged
// (in-place edit) — only JSON stats change.
//
// Usage:  npx tsx scripts/bake-soldier-t112.ts   (tune via env:
//   ANGLE=75 X0=1.75 XB=0.30 ZLO=7.4 ZHI=9.7 PX=1.9 PZ=8.4)
// Output: public/staging/models/human.glb (evaluation slot, gitignored)
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = '/home/z/my-project/upload/soldier_character.glb'
const OUT = '/home/z/my-project/public/staging/models/human.glb'
const ANGLE = (parseFloat(process.env.ANGLE ?? '75')) * (Math.PI / 180)
const X0 = parseFloat(process.env.X0 ?? '1.75')      // arm selection |x| >= X0 (raw)
const XB = parseFloat(process.env.XB ?? '0.30')      // blend band width
const ZLO = parseFloat(process.env.ZLO ?? '7.4')     // shoulder z band (raw = standing up-axis)
const ZHI = parseFloat(process.env.ZHI ?? '9.7')
const PX = parseFloat(process.env.PX ?? '1.9')       // shoulder pivot |x| (raw)
const PZ = parseFloat(process.env.PZ ?? '8.4')      // shoulder pivot z (raw)

interface ParsedGLB { json: any; bin: Buffer }
function parseGLB(path: string): ParsedGLB {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  let off = 12, json: any = null, bin: Buffer | null = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942) bin = Buffer.from(data)
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json || !bin) throw new Error('missing chunks')
  return { json, bin }
}
function writeGLB(path: string, json: any, bin: Buffer): void {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4
  const binPad = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length + binPad
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonBuf.length + jsonPad, 12); out.writeUInt32LE(0x4e4f534a, 16)
  jsonBuf.copy(out, 20)
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBuf.length + i] = 0x20
  const at = 20 + jsonBuf.length + jsonPad
  out.writeUInt32LE(bin.length + binPad, at); out.writeUInt32LE(0x004e4942, at + 4)
  bin.copy(out, at + 8)
  writeFileSync(path, out)
}

const { json, bin } = parseGLB(SRC)

// ---- surgery
let movedPos = 0, movedNor = 0
const touchedMeshes: string[] = []
for (const mesh of json.meshes) {
  let meshTouched = false
  for (const prim of mesh.primitives) {
    const posA = prim.attributes?.POSITION
    const norA = prim.attributes?.NORMAL
    if (posA === undefined) continue
    const pa = json.accessors[posA]
    if (pa.componentType !== 5126 || pa.type !== 'VEC3') throw new Error('POSITION not f32 VEC3')
    const pv = json.bufferViews[pa.bufferView]
    const pBase = (pv.byteOffset || 0) + (pa.byteOffset || 0)
    const pStride = pv.byteStride || 12
    const na = norA !== undefined ? json.accessors[norA] : null
    const nv = na ? json.bufferViews[na.bufferView] : null
    const nBase = na && nv ? (nv.byteOffset || 0) + (na.byteOffset || 0) : -1
    const nStride = nv?.byteStride || 12

    const mn: number[] = [Infinity, Infinity, Infinity]
    const mx: number[] = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < pa.count; i++) {
      let x = bin.readFloatLE(pBase + i * pStride + 0)
      let y = bin.readFloatLE(pBase + i * pStride + 4)
      let z = bin.readFloatLE(pBase + i * pStride + 8)
      const ax = Math.abs(x)
      // arm region + smooth blend
      if (ax > X0 && z > ZLO && z < ZHI) {
        const t = Math.min(1, (ax - X0) / XB)
        const a = ANGLE * t * Math.sign(x)
        const c = Math.cos(a), s = Math.sin(a)
        // rotation about raw-Y through pivot (sign(x)*PX, PZ):
        const dx = x - Math.sign(x) * PX, dz = z - PZ
        const rx = dx * c + dz * s
        const rz = -dx * s + dz * c
        x = Math.sign(x) * PX + rx
        z = PZ + rz
        movedPos++
        meshTouched = true
        if (nBase >= 0 && na) {
          const nx = bin.readFloatLE(nBase + i * nStride + 0)
          const ny = bin.readFloatLE(nBase + i * nStride + 4)
          const nz = bin.readFloatLE(nBase + i * nStride + 8)
          bin.writeFloatLE(nx * c + nz * s, nBase + i * nStride + 0)
          bin.writeFloatLE(ny, nBase + i * nStride + 4)
          bin.writeFloatLE(-nx * s + nz * c, nBase + i * nStride + 8)
          movedNor++
        }
      }
      bin.writeFloatLE(x, pBase + i * pStride + 0)
      bin.writeFloatLE(z, pBase + i * pStride + 8)
      mn[0] = Math.min(mn[0], x); mn[1] = Math.min(mn[1], y); mn[2] = Math.min(mn[2], z)
      mx[0] = Math.max(mx[0], x); mx[1] = Math.max(mx[1], y); mx[2] = Math.max(mx[2], z)
    }
    pa.min = mn.map((v) => +v.toFixed(6))
    pa.max = mx.map((v) => +v.toFixed(6))
  }
  if (meshTouched) touchedMeshes.push(mesh.name ?? '(unnamed)')
}

console.log(`arm surgery: ${movedPos.toLocaleString()} positions + ${movedNor.toLocaleString()} normals rotated (${(ANGLE * 180 / Math.PI).toFixed(0)} deg, blend ${(X0).toFixed(2)}..${(X0 + XB).toFixed(2)})`)
console.log('touched meshes:', touchedMeshes.join(', '))
console.log('selection band: |x| >', X0, ' z in', `[${ZLO}, ${ZHI}]`, ' pivots (±' + PX + ',', PZ + ')')

writeGLB(OUT, json, bin)
console.log('wrote', OUT, (readFileSync(OUT).length / 1048576).toFixed(2), 'MB')
