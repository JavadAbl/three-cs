/**
 * stage-guns-pack.ts — bake spec-compliant fixups into the Quaternius
 * "Ultimate Guns Pack" GLBs and stage them per roster ID.
 *
 * Input : /home/z/my-project/staging/ultimate-guns-pack/*.glb  (CC0, raw pack)
 * Output: scripts/.tmp/guns-fixed/<weaponId>.glb
 *         (afterwards scripts/stage-guns-pack.sh Draco-compresses these into
 *          public/staging/models/weapons/<weaponId>.glb — gitignored staging,
 *          web-served for live evaluation; acceptance = mv + git add)
 *
 * Fixups baked into each file (Task 46 weapon GLB spec):
 *   1. SCALE  — pack models are authored at arbitrary stylized sizes
 *               (bbox 1.17..7.29 units); uniform scale brings the longest
 *               dimension to the weapon's REAL length in meters.
 *   2. ORIENT — longest axis is +X in the pack; rotate so the MUZZLE points
 *               −Z (spec). Muzzle end auto-detected per model: guns/knives
 *               taper toward the muzzle, so the end with the smaller average
 *               cross-section (vertex-slice profile along the long axis) is
 *               the muzzle. Printed per file for eyeball verification.
 *   3. ANCHOR — translate so the GRIP sits at the origin (spec: origin at
 *               grip). Grip position approximated per weapon class by
 *               fractions of the rotated bbox: fz from the rear face
 *               forward, fy up from the bottom face; X centered.
 *
 * Implementation: raw GLB container parse (magic/JSON/BIN chunks), BIN chunk
 * read with DataView for the real vertex slice profile, then the fixup is
 * written as a `matrix` on the mesh node (node.matrix replaces its TRS —
 * glTF spec forbids both). The BIN chunk is copied verbatim. Result stays a
 * plain, valid GLB that the Draco chain (compress-glb.sh) accepts.
 *
 * Run: bun scripts/stage-guns-pack.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const PACK_DIR = '/home/z/my-project/staging/ultimate-guns-pack'
const OUT_DIR = '/home/z/my-project/scripts/.tmp/guns-fixed'

// ---------------------------------------------------------------- route table
// rosterId -> { src, len (m), fz (grip z, fraction from rear), fy (grip y,
//               fraction up from bottom), dual? }
// fz/fy tuned against the class silhouettes: pistol grips sit at the very
// rear (fz .12); long guns grip ~1/3 forward of the rear face (fz .32);
// knife handles at the rear (fz .18).
type Route = { src: string; len: number; fz: number; fy: number; dual?: boolean }
const ROUTES: Record<string, Route> = {
  // ---- knife (bayonet — no moving parts, exact fit)
  knife:      { src: 'Bayonet.glb', len: 0.28, fz: 0.18, fy: 0.50 },
  // ---- pistols
  glock:      { src: 'Pistol.glb',              len: 0.22, fz: 0.12, fy: 0.42 },
  usp:        { src: 'Pistol-Z7aOjJu583.glb',   len: 0.24, fz: 0.12, fy: 0.42 },
  p250:       { src: 'Pistol-J3i9KDQ3kt.glb',   len: 0.22, fz: 0.12, fy: 0.42 },
  cz75:       { src: 'Pistol-J3i9KDQ3kt.glb',   len: 0.24, fz: 0.12, fy: 0.42 },
  fiveseven:  { src: 'Pistol-J3i9KDQ3kt.glb',   len: 0.22, fz: 0.12, fy: 0.42 },
  tec9:       { src: 'Pistol.glb',              len: 0.33, fz: 0.15, fy: 0.45 },
  hkp2000:    { src: 'Pistol-Z7aOjJu583.glb',   len: 0.23, fz: 0.12, fy: 0.42 },
  deagle:     { src: 'Pistol-52kQzphmeF.glb',   len: 0.27, fz: 0.10, fy: 0.45 },
  elites:     { src: 'Pistol-J3i9KDQ3kt.glb',   len: 0.22, fz: 0.12, fy: 0.42, dual: true },
  revolver:   { src: 'Revolver.glb',            len: 0.26, fz: 0.14, fy: 0.45 },
  // ---- SMGs
  mp5:        { src: 'Submachine Gun.glb',          len: 0.67, fz: 0.30, fy: 0.45 },
  mp9:        { src: 'Submachine Gun-nsP3JukU73.glb', len: 0.55, fz: 0.30, fy: 0.45 },
  mac10:      { src: 'Submachine Gun-nsP3JukU73.glb', len: 0.55, fz: 0.30, fy: 0.45 },
  mp7:        { src: 'Submachine Gun-nsP3JukU73.glb', len: 0.60, fz: 0.32, fy: 0.45 },
  ump45:      { src: 'Submachine Gun.glb',          len: 0.62, fz: 0.30, fy: 0.45 },
  p90:        { src: 'Submachine Gun-nsP3JukU73.glb', len: 0.50, fz: 0.35, fy: 0.50 },
  bizon:      { src: 'Submachine Gun.glb',          len: 0.66, fz: 0.30, fy: 0.45 },
  // ---- shotguns
  nova:       { src: 'Shotgun.glb',              len: 1.02, fz: 0.30, fy: 0.45 },
  xm1014:     { src: 'Shotgun Short Stock.glb',  len: 0.90, fz: 0.30, fy: 0.45 },
  mag7:       { src: 'Shotgun Short Stock.glb',  len: 0.76, fz: 0.28, fy: 0.45 },
  sawedoff:   { src: 'Shotgun Sawed Off.glb',    len: 0.55, fz: 0.15, fy: 0.45 },
  // ---- rifles
  ak47:       { src: 'Assault Rifle.glb',           len: 0.88, fz: 0.32, fy: 0.45 },
  m4:         { src: 'Assault Rifle-Bgvuu4CUMV.glb', len: 0.84, fz: 0.32, fy: 0.45 },
  m4a1s:      { src: 'Assault Rifle-Bgvuu4CUMV.glb', len: 0.90, fz: 0.32, fy: 0.45 },
  galil:      { src: 'Assault Rifle-fpLucho45C.glb', len: 0.85, fz: 0.32, fy: 0.45 },
  sg553:      { src: 'Assault Rifle-fpLucho45C.glb', len: 0.90, fz: 0.32, fy: 0.45 },
  famas:      { src: 'Bullpup.glb',                 len: 0.76, fz: 0.45, fy: 0.48 },
  aug:        { src: 'Bullpup.glb',                 len: 0.79, fz: 0.45, fy: 0.48 },
  // ---- snipers (AWP = the green one)
  awp:        { src: 'Sniper Rifle-ASOMZIErq3.glb', len: 1.12, fz: 0.32, fy: 0.45 },
  ssg08:      { src: 'Sniper Rifle.glb',            len: 1.06, fz: 0.32, fy: 0.45 },
  scar20:     { src: 'Sniper Rifle-TKaBjAEofL.glb', len: 1.15, fz: 0.32, fy: 0.45 },
  g3sg1:      { src: 'Sniper Rifle-i65hEldsw6.glb', len: 1.23, fz: 0.32, fy: 0.45 },
}
// (m249/negev/taser/c4/grenades stay procedural — no pack model / procedural is better)

// ---------------------------------------------------------------- GLB raw I/O
interface ParsedGLB { json: any; bin: Buffer }
function parseGLB(path: string): ParsedGLB {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${basename(path)}: not a GLB`)
  const version = buf.readUInt32LE(4)
  if (version !== 2) throw new Error(`${basename(path)}: glTF version ${version}, expected 2`)
  let off = 12
  let json: any = null
  let bin: Buffer | null = null
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off)
    const type = buf.readUInt32LE(off + 4)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942) bin = Buffer.from(data)
    off += 8 + len + ((4 - (len % 4)) % 4) // chunk data padded to 4-byte alignment
  }
  if (!json) throw new Error(`${basename(path)}: no JSON chunk`)
  if (!bin) throw new Error(`${basename(path)}: no BIN chunk (unexpected for a mesh GLB)`)
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
  out.writeUInt32LE(0x46546c67, off); off += 4  // magic
  out.writeUInt32LE(2, off); off += 4           // version
  out.writeUInt32LE(total, off); off += 4       // total length
  out.writeUInt32LE(jsonLen, off); off += 4     // JSON chunk length (padded)
  out.writeUInt32LE(0x4e4f534a, off); off += 4  // "JSON"
  jsonBuf.copy(out, off)
  if (jsonPad) out.fill(0x20, off + jsonBuf.length, off + jsonLen) // pad with spaces
  off += jsonLen
  out.writeUInt32LE(binLen, off); off += 4      // BIN chunk length (padded)
  out.writeUInt32LE(0x004e4942, off); off += 4  // "BIN\0"
  bin.copy(out, off)
  off += bin.length
  writeFileSync(path, out)
}

// ---------------------------------------------------------------- math (column-major 4x4)
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

// ---------------------------------------------------------------- geometry access
/** world-space positions of every POSITION accessor (dedup by accessor idx) */
function worldPositions(g: ParsedGLB): number[][] {
  const j = g.json
  const accs = j.accessors ?? []
  const views = j.bufferViews ?? []
  const meshes = j.meshes ?? []
  const nodes = j.nodes ?? []
  const seen = new Set<number>()
  const out: number[][] = []
  for (const n of nodes) {
    if (n.mesh === undefined) continue
    const M = nodeMatrix(n) // pack files: mesh nodes sit under an identity root
    for (const p of meshes[n.mesh].primitives ?? []) {
      const ai = p.attributes?.POSITION
      if (ai === undefined || seen.has(ai)) continue
      seen.add(ai)
      const a = accs[ai]
      if (a.type !== 'VEC3' || a.componentType !== 5126) continue // f32
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
  return out
}

/**
 * Muzzle direction per SOURCE FILE (muzzle = barrel/blade tip end along the
 * file's long X axis): +1 = muzzle at +X max, -1 = muzzle at −X min.
 *
 * History: an automated peak-|y| slice heuristic scored 8/33 (low-poly front
 * sights stack higher above the bore than flat buttstocks, so it kept picking
 * the stock end). Signs below were then established visually: side-view
 * contact sheet (scripts/verify-guns-orientation.ts) reviewed by VLM with a
 * forced-choice pass per unique source file at large render size.
 */
export const MUZZLE_SIGN: Record<string, number> = {
  // rifles
  'Assault Rifle.glb': +1,
  'Assault Rifle-Bgvuu4CUMV.glb': -1,
  'Assault Rifle-fpLucho45C.glb': +1,
  'Bullpup.glb': +1,
  // pistols / revolvers
  'Pistol.glb': +1,
  'Pistol-52kQzphmeF.glb': +1,
  'Pistol-J3i9KDQ3kt.glb': +1,
  'Pistol-Z7aOjJu583.glb': +1,
  'Revolver.glb': +1,
  // shotguns
  'Shotgun.glb': +1,
  'Shotgun Short Stock.glb': -1,
  'Shotgun Sawed Off.glb': -1,
  // snipers
  'Sniper Rifle.glb': +1,
  'Sniper Rifle-ASOMZIErq3.glb': -1,
  'Sniper Rifle-TKaBjAEofL.glb': -1,
  'Sniper Rifle-i65hEldsw6.glb': -1,
  // SMGs
  'Submachine Gun.glb': -1,
  'Submachine Gun-nsP3JukU73.glb': +1,
  // knife
  'Bayonet.glb': +1,
}

// ---------------------------------------------------------------- route exports
export type { Route }
export { ROUTES }

// ---------------------------------------------------------------- main
/**
 * Fixup pipeline (bakes scale + muzzle-−Z rotation + grip anchor into each
 * pack model's mesh-node matrix). Runs only when executed directly;
 * verify-guns-orientation.ts imports the tables without side effects.
 */
export function stageAll(): void {
  mkdirSync(OUT_DIR, { recursive: true })

  const report: string[] = []
  for (const [id, route] of Object.entries(ROUTES)) {
  const srcPath = join(PACK_DIR, route.src)
  if (!existsSync(srcPath)) { report.push(`!! ${id}: MISSING SOURCE ${route.src}`); continue }
  const g = parseGLB(srcPath)
  const j = g.json

  // mesh node = the non-root node carrying a mesh (pack layout: RootNode -> meshNode)
  const meshNodes = (j.nodes ?? []).filter((n: any) => n.mesh !== undefined)
  if (meshNodes.length !== 1) { report.push(`!! ${id}: expected 1 mesh node, got ${meshNodes.length}`); continue }
  const meshNode = meshNodes[0]

  const pts = worldPositions(g)
  if (!pts.length) { report.push(`!! ${id}: no position data`); continue }

  // world bbox
  let xMin = Infinity, yMin = Infinity, zMin = Infinity
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity
  for (const p of pts) {
    if (p[0] < xMin) xMin = p[0]; if (p[0] > xMax) xMax = p[0]
    if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]
    if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2]
  }
  const L = Math.max(xMax - xMin, yMax - yMin, zMax - zMin)
  const k = route.len / L

  const sign = MUZZLE_SIGN[route.src]
  if (sign !== 1 && sign !== -1) { report.push(`!! ${id}: no MUZZLE_SIGN entry for source "${route.src}"`); continue }
  const ry = sign > 0 ? Math.PI / 2 : -Math.PI / 2 // +X→−Z / −X→−Z

  // rotation about Y (column-major)
  const c = Math.cos(ry), s = Math.sin(ry)
  const R = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]

  // M_new = T · R · S · M_old   (S first: uniform k; then rotate; then anchor)
  const M_old = nodeMatrix(meshNode)
  const S = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1]
  let M = mul(R, S)
  M = mul(M, M_old)

  // rotated bbox → anchor translation.
  // the corners below are already WORLD-space (bbox of worldPositions, which
  // includes M_old) — so only R·S may be applied on top, never M_old again.
  const M_rs = mul(R, S)
  let rxMin = Infinity, ryMin2 = Infinity, rzMin = Infinity
  let rxMax = -Infinity, ryMax2 = -Infinity, rzMax = -Infinity
  for (let i = 0; i < 8; i++) {
    const corner: [number, number, number] = [
      (i & 1) ? xMax : xMin, (i & 2) ? yMax : yMin, (i & 4) ? zMax : zMin,
    ]
    const w = applyV(M_rs, corner)
    if (w[0] < rxMin) rxMin = w[0]; if (w[0] > rxMax) rxMax = w[0]
    if (w[1] < ryMin2) ryMin2 = w[1]; if (w[1] > ryMax2) ryMax2 = w[1]
    if (w[2] < rzMin) rzMin = w[2]; if (w[2] > rzMax) rzMax = w[2]
  }
  const cx = (rxMin + rxMax) / 2
  const gy = ryMin2 + route.fy * (ryMax2 - ryMin2)
  const gz = rzMax + route.fz * (rzMin - rzMax) // fz forward FROM the rear face (+Z)
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, -gy, -gz, 1]
  M = mul(T, M)

  // bake: matrix replaces TRS (spec forbids both)
  delete meshNode.translation
  delete meshNode.rotation
  delete meshNode.scale
  meshNode.matrix = M.map(v => Number(v.toFixed(7)))

  const outPath = join(OUT_DIR, `${id}.glb`)
  writeGLB(outPath, j, g.bin)

  const tipZ = rzMin - gz
    report.push(
      `${id.padEnd(10)} <- ${route.src.padEnd(34)} len=${route.len}m k=${k.toFixed(4)} muzzle=${sign > 0 ? '+X' : '-X'} ` +
      `final bbox z=[${(rzMin - gz).toFixed(3)}, ${(rzMax - gz).toFixed(3)}] y=[${(ryMin2 - gy).toFixed(3)}, ${(ryMax2 - gy).toFixed(3)}] tip.z=${tipZ.toFixed(3)}`
    )
  }

  console.log(report.join('\n'))
  console.log(`\n${report.filter(r => r.startsWith('!!')).length} errors; ${report.filter(r => !r.startsWith('!!')).length} files written to ${OUT_DIR}`)
}

if (import.meta.main) stageAll()
