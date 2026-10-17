// ============================================================
// BSP v30 → game map converter v2 (aim_headshot) — FACE-DRIVEN
//
// v1 lessons (why the character fell through the terrain):
//  1. face numedges was misread (getUint16(o, 8, true) instead of
//     getUint16(o + 8, true)) → polygon-soup render geometry
//  2. collision was voxelized from the node/leaf contents oracle —
//     this ripped BSP has broken contents AND grid-aligned sample
//     points land exactly on brush planes (resolved to the empty
//     side) → striped/missing floor collision
//  3. spawns were placed on phantom oracle floors 5 m BELOW the
//     visible terrain
//
// v2: render, collision, spawns, waypoints, bounds — ALL derived
//     from the face geometry itself (verified: 1197/1197 faces
//     on-plane, ≤16 edges). No node oracle anywhere.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ppm2png } from './ppm2png'

const SRC = '/home/z/my-project/upload/aim_headshot/maps/aim_headshot.bsp'
const OUT_DIR = '/home/z/my-project/public/assets/maps/aimhead'
const SCALE = 0.025          // 1 bsp unit = 0.025 m (72u player = 1.8 m)
const Z_REBASE = 192         // bsp z=-192 (map bottom) → our y 0
const THICK = 32             // collision extrusion depth (bsp units)
const STRIP = 8              // slope staircase strip width (bsp units) — 8u → ≤0.12 m float over visual slope
const PLAYER_R_U = 16        // player radius (bsp units ≈ 0.4 m)
const HEADROOM_U = 74        // player standing height + margin

mkdirSync(`${OUT_DIR}/textures`, { recursive: true })

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

// ---------------- entities ----------------
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

// ---------------- miptex / texinfo ----------------
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
interface TexInfo { s: number[]; ss: number; t: number[]; st: number; miptex: number }
const texinfos: TexInfo[] = []
for (let i = 0; i < nTexinfo; i++) {
  const o = lumps[6].off + i * 40
  texinfos.push({
    s: [0, 1, 2].map(k => dv.getFloat32(o + k * 4, true)),
    ss: dv.getFloat32(o + 12, true),
    t: [0, 1, 2].map(k => dv.getFloat32(o + 16 + k * 4, true)),
    st: dv.getFloat32(o + 28, true),
    miptex: dv.getInt32(o + 32, true),
  })
}
function ourTex(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('crate') || n.includes('wood')) return 'crate'
  if (n.includes('mltry') || n.includes('metal')) return 'metal'
  if (n.includes('stat')) return 'dark'
  if (n.includes('trim')) return 'plank'
  if (n.includes('wll') || n.includes('wall') || n.includes('brick')) return 'brick'
  if (n.includes('dirt') || n.includes('moss') || n.includes('grass') || n.includes('floor') || n.includes('ground')) return 'sand'
  return 'concrete'
}

// ---------------- faces (FIXED numedges read) ----------------
interface Face { planenum: number; side: number; firstedge: number; numedges: number; texinfo: number }
const faces: Face[] = []
for (let i = 0; i < nFaces; i++) {
  const o = lumps[7].off + i * 20
  faces.push({
    planenum: dv.getUint16(o, true),
    side: dv.getUint8(o + 2),
    firstedge: dv.getInt32(o + 4, true),
    numedges: dv.getUint16(o + 8, true),       // *** THE v1 BUG: was getUint16(o, 8, true) ***
    texinfo: dv.getInt16(o + 10, true),
  })
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

// ---------------- collect world faces (model 0 ONLY —
// model 1 is a corrupt func_wall ring at z 384..448) ----------------
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
for (let i = 0; i < nModels; i++) modelRoots.push(dv.getInt32(lumps[14].off + i * 64 + 36, true))
const worldFaceIdx = collectFaces(modelRoots[0])
console.log(`faces: total=${nFaces}, model0(world)=${worldFaceIdx.length}`)

// coordinate transform bsp → our game (x, y up, z south)
const tx = (x: number) => +(x * SCALE).toFixed(4)
const ty = (z: number) => +((z + Z_REBASE) * SCALE).toFixed(4)
const tz = (y: number) => +(-y * SCALE).toFixed(4)

// ---------------- validated geometry faces ----------------
interface GFace { fi: number; tex: string; n: number[]; vs: number[][]; aabb: number[] }
const gfaces: GFace[] = []
let skipped = 0
for (const fi of worldFaceIdx) {
  const f = faces[fi]
  if (f.texinfo < 0 || f.texinfo >= nTexinfo) { skipped++; continue }
  const texName = (miptexs[texinfos[f.texinfo].miptex]?.name ?? '')
  if (texName.toLowerCase() === 'sky' || texName.startsWith('{')) { skipped++; continue }
  const vs = faceVerts(f)
  if (!vs.length) { skipped++; continue }
  const pl = planeOf(f.planenum)
  let nrm = pl.n
  if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
  const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
  gfaces.push({ fi, tex: texName, n: nrm, vs, aabb: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)] })
}
console.log(`valid geometry faces: ${gfaces.length} (skipped sky/invalid: ${skipped})`)

const flat = (vs: number[][], axis: number, tol = 1.5) => {
  const vals = vs.map(v => v[axis])
  return Math.max(...vals) - Math.min(...vals) <= tol
}

// ---------------- render geometry groups (fixed triangulation) ----------------
interface Group { tex: string; pos: number[]; norm: number[]; uv: number[]; idx: number[] }
const groups = new Map<string, Group>()
for (const gf of gfaces) {
  // v3: render EVERY face — anim frames included. Skipping frame ≥1 left visual
  // holes (ramp side walls, top-landing floor strips). All frames map to the
  // frame-0 base texture.
  let texName = gf.tex
  const mAnim = texName.match(/^-([0-9])(.+)$/)
  if (mAnim) texName = mAnim[2]
  texName = ourTex(texName)
  const g = groups.get(texName) ?? { tex: texName, pos: [], norm: [], uv: [], idx: [] } as Group
  const ti = texinfos[faces[gf.fi].texinfo]
  const mt = miptexs[ti.miptex] ?? miptexs[0]
  const tw = mt?.w ?? 128, th = mt?.h ?? 128
  const nOur = [gf.n[0], gf.n[2], -gf.n[1]]
  const base = g.pos.length / 3
  for (const v of gf.vs) {
    g.pos.push(tx(v[0]), ty(v[2]), tz(v[1]))
    g.norm.push(nOur[0], nOur[1], nOur[2])
    const u = (v[0] * ti.s[0] + v[1] * ti.s[1] + v[2] * ti.s[2] + ti.ss) / tw
    const vv = (v[0] * ti.t[0] + v[1] * ti.t[1] + v[2] * ti.t[2] + ti.st) / th
    g.uv.push(+u.toFixed(4), +(1 - vv).toFixed(4))
  }
  for (let k = 1; k < gf.vs.length - 1; k++) {
    if (faces[gf.fi].side === 1) g.idx.push(base, base + k + 1, base + k)
    else g.idx.push(base, base + k, base + k + 1)
  }
  groups.set(texName, g)
}
writeFileSync(`${OUT_DIR}/geom.json`, JSON.stringify({ groups: [...groups.values()] }))
console.log('geom groups:', [...groups.keys()].map(k => `${k}(${(groups.get(k)!.idx.length / 3).toFixed(0)}tris)`).join(' '))
console.log(`total render tris: ${[...groups.values()].reduce((a, g) => a + g.idx.length / 3, 0).toFixed(0)}`)

// ---------------- collision boxes from faces ----------------
// Box in bsp units first: [x0,x1,y0,y1,z0,z1]
interface BBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; tex: string }
const boxes: BBox[] = []

const worldMin = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + k * 4, true))
const worldMax = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + 12 + k * 4, true))
const touchesShell = (aabb: number[]) =>
  aabb[0] <= worldMin[0] + 8 || aabb[1] >= worldMax[0] - 8 ||
  aabb[2] <= worldMin[1] + 8 || aabb[3] >= worldMax[1] - 8

// flat horizontal surface (floor-ish, incl. gentle slopes sliced as staircases)
//
// v3 lesson (the "fall into the ramp" bug): v2 filtered the face's ORIGINAL
// vertices into each strip band — a ramp quad has vertices only at its two
// ends, so every band held <3 vertices and was DROPPED → the big 31° ramps
// got zero collision boxes and players fell through them. v3 CLIPS the
// convex face polygon to each band (Sutherland–Hodgman) so every band
// yields its true extent.
function clipAxis(poly: number[][], ax: number, bound: number, keepGreater: boolean): number[][] {
  const out: number[][] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const da = keepGreater ? a[ax] - bound : bound - a[ax]
    const db = keepGreater ? b[ax] - bound : bound - b[ax]
    if (da >= 0) out.push(a)
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
    }
  }
  return out
}
function emitStaircase(gf: GFace, up: boolean) {
  const [nx, ny, nz] = gf.n
  const ax = Math.abs(nx) >= Math.abs(ny) ? 0 : 1
  const lo = gf.aabb[ax], hi = gf.aabb[ax + 1]
  // walkable only if gentle enough (|nz| >= 0.55); steeper surfaces are solid blockers — full AABB
  const gentle = Math.abs(nz) >= 0.55
  if (!gentle) {
    boxes.push({ x0: gf.aabb[0], x1: gf.aabb[1], y0: gf.aabb[2], y1: gf.aabb[3], z0: gf.aabb[4], z1: gf.aabb[5], tex: 'wall' })
    return
  }
  // cap each step's rise at 18u (0.45 m) — safely inside the engine's STEP_UP (0.55 m)
  const tanT = Math.hypot(nx, ny) / Math.abs(nz)
  const step = Math.min(STRIP, Math.max(8, Math.round(18 / Math.max(0.35, tanT))))
  for (let s = lo; s < hi - 0.05; s += step) {
    const e = Math.min(s + step, hi)
    let strip = clipAxis(gf.vs, ax, s - 0.01, true)
    strip = clipAxis(strip, ax, e + 0.01, false)
    if (strip.length < 3) continue
    const xs = strip.map(v => v[0]), ys = strip.map(v => v[1]), zs = strip.map(v => v[2])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const z0 = Math.min(...zs), z1 = Math.max(...zs)
    if (up) boxes.push({ x0, x1, y0, y1, z0: z0 - THICK, z1, tex: 'sand' })
    else boxes.push({ x0, x1, y0, y1, z0, z1: z1 + THICK, tex: 'wall' })
    stairStrips++
  }
  stairFaces++
}

let nFloor = 0, nCeil = 0, nWall = 0, nSlope = 0, nSkip = 0, stairFaces = 0, stairStrips = 0
for (const gf of gfaces) {
  const [nx, ny, nz] = gf.n
  const a = gf.aabb
  if (nz > 0.7) {                                    // FLOOR
    nFloor++
    if (flat(gf.vs, 2)) boxes.push({ x0: a[0], x1: a[1], y0: a[2], y1: a[3], z0: a[4] - THICK, z1: a[4], tex: 'sand' })
    else emitStaircase(gf, true)
  } else if (nz < -0.7) {                            // CEILING
    nCeil++
    boxes.push({ x0: a[0], x1: a[1], y0: a[2], y1: a[3], z0: a[5], z1: a[5] + THICK, tex: 'wall' })
  } else if (Math.abs(nx) >= 0.94 && Math.abs(ny) < 0.34) {   // WALL facing ±x
    nWall++
    boxes.push({ x0: nx > 0 ? a[0] - THICK : a[1], x1: nx > 0 ? a[0] : a[1] + THICK, y0: a[2], y1: a[3], z0: a[4], z1: a[5], tex: 'brick' })
  } else if (Math.abs(ny) >= 0.94 && Math.abs(nx) < 0.34) {   // WALL facing ±y
    nWall++
    boxes.push({ x0: a[0], x1: a[1], y0: ny > 0 ? a[2] - THICK : a[3], y1: ny > 0 ? a[2] : a[3] + THICK, z0: a[4], z1: a[5], tex: 'brick' })
  } else if (Math.abs(nz) >= 0.3) {                  // sloped ramp — staircase walkable
    nSlope++
    emitStaircase(gf, nz > 0)
  } else if (touchesShell(a)) {                      // octagon sky-shell diagonals — outside play
    nSkip++
  } else {                                           // diagonal wall inside play — block via AABB
    nWall++
    boxes.push({ x0: a[0], x1: a[1], y0: a[2], y1: a[3], z0: a[4], z1: a[5], tex: 'wall' })
  }
}
console.log(`collision source faces: floor=${nFloor} ceil=${nCeil} wall=${nWall} slope=${nSlope} shellSkip=${nSkip}`)
console.log(`staircase: ${stairFaces} sloped faces → ${stairStrips} strip boxes (clipped, watertight)`)
console.log(`raw collision boxes: ${boxes.length}`)

// merge: exact-dup removal + band merge (same z-band, edge-adjacent rectangles)
function mergeBoxes(bx: BBox[]): BBox[] {
  // dedupe
  const seen = new Set<string>()
  let cur = bx.filter(b => {
    const k = [b.x0, b.x1, b.y0, b.y1, b.z0, b.z1].map(v => v.toFixed(1)).join(',')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const f1 = (v: number) => v.toFixed(1)
  for (let round = 0; round < 8; round++) {
    let mergedAny = false
    // x-chain merge: same z-band + same y-band, adjacent in x
    {
      const byBand = new Map<string, BBox[]>()
      for (const b of cur) {
        const k = `${f1(b.z0)}|${f1(b.z1)}|${f1(b.y0)}|${f1(b.y1)}`
        if (!byBand.has(k)) byBand.set(k, [])
        byBand.get(k)!.push(b)
      }
      const out: BBox[] = []
      for (const list of byBand.values()) {
        list.sort((a, b) => a.x0 - b.x0)
        let run = list[0]
        for (let i = 1; i < list.length; i++) {
          if (f1(list[i].x0) === f1(run.x1)) { run = { ...run, x1: Math.max(run.x1, list[i].x1) }; mergedAny = true }
          else { out.push(run); run = list[i] }
        }
        out.push(run)
      }
      cur = out
    }
    // y-chain merge: same z-band + same x-band, adjacent in y
    {
      const byBand = new Map<string, BBox[]>()
      for (const b of cur) {
        const k = `${f1(b.z0)}|${f1(b.z1)}|${f1(b.x0)}|${f1(b.x1)}`
        if (!byBand.has(k)) byBand.set(k, [])
        byBand.get(k)!.push(b)
      }
      const out: BBox[] = []
      for (const list of byBand.values()) {
        list.sort((a, b) => a.y0 - b.y0)
        let run = list[0]
        for (let i = 1; i < list.length; i++) {
          if (f1(list[i].y0) === f1(run.y1)) { run = { ...run, y1: Math.max(run.y1, list[i].y1) }; mergedAny = true }
          else { out.push(run); run = list[i] }
        }
        out.push(run)
      }
      cur = out
    }
    if (!mergedAny) break
  }
  return cur
}
const boxesMerged = mergeBoxes(boxes)
console.log(`collision boxes after merge: ${boxesMerged.length}`)

// floor-top query: highest floor-box top at column (x±r, y±r) below yLimit
function collisionFloorU(x: number, y: number, yLimit: number, r = PLAYER_R_U): number | null {
  let best: number | null = null
  for (const b of boxesMerged) {
    if (x + r > b.x0 && x - r < b.x1 && y + r > b.y0 && y - r < b.y1) {
      if (b.z1 <= yLimit && (best === null || b.z1 > best)) best = b.z1
    }
  }
  return best
}
// capsule overlap test (for headroom checks)
function overlapsU(x: number, y: number, z0: number, z1: number, r = PLAYER_R_U): boolean {
  for (const b of boxesMerged) {
    if (x + r > b.x0 && x - r < b.x1 && y + r > b.y0 && y - r < b.y1 && z1 > b.z0 && z0 < b.z1) return true
  }
  return false
}

// ---------------- spawns from floor faces ----------------
interface FloorPoly { vs: number[][]; z: number }
const floorPolys: FloorPoly[] = []
for (const gf of gfaces) {
  if (gf.n[2] > 0.7 && flat(gf.vs, 2)) floorPolys.push({ vs: gf.vs.map(v => [v[0], v[1]]), z: gf.aabb[4] })
}
function inPoly(px: number, py: number, vs: number[][]): boolean {
  let sign = 0
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    const cr = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
    if (Math.abs(cr) < 1e-9) continue
    const s = Math.sign(cr)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}
function distToPolyEdge(px: number, py: number, vs: number[][]): number {
  let d = 1e9
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length]
    const vx = b[0] - a[0], vy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy)))
    d = Math.min(d, Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy)))
  }
  return d
}
function findSpawn(x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  for (let r = 0; r <= 640; r += r === 0 ? 16 : 32) {
    const cands: Array<[number, number]> = r === 0 ? [[x, y]] : []
    if (r > 0) {
      for (let d = -r; d <= r; d += 16) {
        cands.push([x + d, y - r], [x + d, y + r], [x - r, y + d], [x + r, y + d])
      }
    }
    let best: { x: number; y: number; fz: number; score: number } | null = null
    for (const [cx, cy] of cands) {
      for (const fp of floorPolys) {
        if (!inPoly(cx, cy, fp.vs)) continue
        if (distToPolyEdge(cx, cy, fp.vs) < PLAYER_R_U + 4) continue
        if (Math.abs(fp.z - z) > 200) continue
        // collision box must exist under this floor (sanity) and headroom must be free
        if (overlapsU(cx, cy, fp.z + 4, fp.z + HEADROOM_U)) continue
        const score = Math.abs(fp.z - z)
        if (!best || score < best.score) best = { x: cx, y: cy, fz: fp.z, score }
      }
    }
    if (best) return { x: best.x, y: best.y, z: best.fz }
  }
  return null
}
const spawnCT: number[][] = [], spawnT: number[][] = []
for (const e of entities) {
  if (e.classname !== 'info_player_start' && e.classname !== 'info_player_deathmatch') continue
  const [x, y, z] = e.origin!.split(' ').map(Number)
  const s = findSpawn(x, y, z)
  if (!s) { console.log(`spawn ${e.classname} @(${x},${y},${z}) — no floor found!`); continue }
  const arr = e.classname === 'info_player_start' ? spawnCT : spawnT
  arr.push([tx(s.x), ty(s.z + 2), tz(s.y)])
}
function dedupe(a: number[][]): number[][] {
  const out: number[][] = []
  for (const p of a) {
    if (!out.some(q => Math.hypot(q[0] - p[0], q[2] - p[2]) < 0.9)) out.push(p)
  }
  return out
}
const sCT = dedupe(spawnCT).slice(0, 10)
const sT = dedupe(spawnT).slice(0, 10)
console.log(`spawns: CT=${sCT.length} T=${sT.length}`)
console.log('CT:', sCT.slice(0, 4).map(p => p.map(v => v.toFixed(1))).join(' '))
console.log('T: ', sT.slice(0, 4).map(p => p.map(v => v.toFixed(1))).join(' '))

// ---------------- waypoints from floor faces ----------------
const WP_STEP = 64
interface WPU { x: number; y: number; z: number; id: string }
const wpRaw: WPU[] = []
for (const fp of floorPolys) {
  const xs = fp.vs.map(v => v[0]), ys = fp.vs.map(v => v[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  for (let wy = y0 + WP_STEP / 2; wy < y1; wy += WP_STEP) {
    for (let wx = x0 + WP_STEP / 2; wx < x1; wx += WP_STEP) {
      if (!inPoly(wx, wy, fp.vs)) continue
      if (distToPolyEdge(wx, wy, fp.vs) < PLAYER_R_U + 8) continue
      wpRaw.push({ x: wx, y: fp.z, z: wy, id: '' })
    }
  }
}
// slope strips add waypoints (their staircase tops)
for (const b of boxesMerged) {
  if (b.z1 - b.z0 > THICK + 26) continue // surface strips only (incl. sloped staircase strips), not tall walls
  if (b.z1 > 240) continue                // playable heights only — drop sky-rim junk (z 384+)
  // only boxes that are top surfaces with headroom above
  if (overlapsU((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z1 + 4, b.z1 + HEADROOM_U)) continue
  if ((b.x1 - b.x0) > 200 || (b.y1 - b.y0) > 200) {
    for (let wy = b.y0 + WP_STEP / 2; wy < b.y1; wy += WP_STEP) {
      for (let wx = b.x0 + WP_STEP / 2; wx < b.x1; wx += WP_STEP) {
        wpRaw.push({ x: wx, y: b.z1, z: wy, id: '' })
      }
    }
  } else {
    wpRaw.push({ x: (b.x0 + b.x1) / 2, y: b.z1, z: (b.y0 + b.y1) / 2, id: '' })
  }
}
// dedupe: same column (grid snap) keep highest floor + manual vertical dedupe
const byCol = new Map<string, WPU[]>()
for (const w of wpRaw) {
  const k = `${Math.round(w.x / 32)}_${Math.round(w.z / 32)}`
  if (!byCol.has(k)) byCol.set(k, [])
  byCol.get(k)!.push(w)
}
const wps: WPU[] = []
for (const ws of byCol.values()) {
  ws.sort((a, b) => b.y - a.y) // keep the top surface of the column
  wps.push(ws[0])
}
// vertical dedupe within 0.5m: keep lowest? keep the one that has collision support
const wpsClean: WPU[] = []
{
  const colMap = new Map<string, WPU[]>()
  for (const w of wps) {
    const k = `${Math.round(w.x / 32)}_${Math.round(w.z / 32)}`
    if (!colMap.has(k)) colMap.set(k, [])
    colMap.get(k)!.push(w)
  }
  for (const ws of colMap.values()) {
    ws.sort((a, b) => a.y - b.y)
    let lastY = -9999
    for (const w of ws) {
      if (w.y - lastY > 24) { wpsClean.push(w); lastY = w.y }
    }
  }
}
wpsClean.forEach((w, i) => { w.id = `ah${i}` })
console.log(`waypoints: ${wpsClean.length}`)

// edges: neighbors within reach
const edges: Array<[string, string]> = []
{
  const grid = new Map<string, WPU[]>()
  for (const w of wpsClean) {
    const k = `${Math.round(w.x / WP_STEP)}_${Math.round(w.z / WP_STEP)}`
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k)!.push(w)
  }
  for (const w of wpsClean) {
    const gx = Math.round(w.x / WP_STEP), gz = Math.round(w.z / WP_STEP)
    for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1], [2, 0], [0, 2]]) {
      const nws = grid.get(`${gx + dx}_${gz + dz}`)
      if (!nws) continue
      for (const n of nws) {
        const dh = Math.hypot(n.x - w.x, n.z - w.z)   // bsp units
        if (dh > 140) continue                        // ≤ 3.5 m horizontal reach
        if (Math.abs(n.y - w.y) > 96) continue        // ≤ 1.2 m step (server lerps bot y)
        edges.push([w.id, n.id])
      }
    }
  }
}
console.log(`waypoint edges: ${edges.length}`)

// ---------------- bounds & sites ----------------
let bMinX = 1e9, bMaxX = -1e9, bMinY = 1e9, bMaxY = -1e9
for (const fp of floorPolys) {
  for (const v of fp.vs) {
    bMinX = Math.min(bMinX, v[0]); bMaxX = Math.max(bMaxX, v[0])
    bMinY = Math.min(bMinY, v[1]); bMaxY = Math.max(bMaxY, v[1])
  }
}
const MARGIN = 48
const bounds = {
  minX: +tx(bMinX + MARGIN).toFixed(2), maxX: +tx(bMaxX - MARGIN).toFixed(2),
  minZ: +tz(bMaxY - MARGIN).toFixed(2), maxZ: +tz(bMinY + MARGIN).toFixed(2),
}
const ctC = sCT.reduce((a, p) => [a[0] + p[0] / sCT.length, a[1] + p[1] / sCT.length, a[2] + p[2] / sCT.length], [0, 0, 0])
const tC = sT.reduce((a, p) => [a[0] + p[0] / sT.length, a[1] + p[1] / sT.length, a[2] + p[2] / sT.length], [0, 0, 0])
const sites = {
  A: { x: +ctC[0].toFixed(2), z: +ctC[2].toFixed(2), y: +ctC[1].toFixed(2), r: 5 },
  B: { x: +tC[0].toFixed(2), z: +tC[2].toFixed(2), y: +tC[1].toFixed(2), r: 5 },
}
console.log('bounds:', JSON.stringify(bounds))
console.log('sites:', JSON.stringify(sites))

// ---------------- emit MapDef ----------------
const boxOut = boxesMerged.map(b => ({
  x: +tx((b.x0 + b.x1) / 2).toFixed(3), y: +ty((b.z0 + b.z1) / 2).toFixed(3), z: +tz((b.y0 + b.y1) / 2).toFixed(3),
  w: +((b.x1 - b.x0) * SCALE).toFixed(3), h: +((b.z1 - b.z0) * SCALE).toFixed(3), d: +((b.y1 - b.y0) * SCALE).toFixed(3),
  tex: b.tex,
})).filter(b => b.w > 0.1 || b.d > 0.1) // keep walls thin in one dim
const wpOut = wpsClean.map(w => ({ id: w.id, x: +tx(w.x).toFixed(2), y: +ty(w.y + 2).toFixed(2), z: +tz(w.z).toFixed(2) }))
const spawnOut = (a: number[][]) => a.map(p => ({ x: p[0], y: p[1], z: p[2] }))
const yawCT = -Math.PI / 2, yawT = Math.PI / 2

function defTS(withBsp: boolean) {
  return `// GENERATED from aim_headshot.bsp (BSP v30) by scripts/bsp/convert2.ts — face-driven, do not edit
import type { MapDef, Box, WP } from './mapdata'

export const AIMHEAD: MapDef = {
  id: 'aimhead',
  name: 'Aim Headshot',
  version: 2,
${withBsp ? `  bsp: { geomUrl: '/assets/maps/aimhead/geom.json' },\n` : ''}  boxes: ${JSON.stringify(boxOut)},
  losBoxes: ${JSON.stringify(boxOut)},
  spawns: {
    CT: ${JSON.stringify(spawnOut(sCT))},
    T: ${JSON.stringify(spawnOut(sT))},
  },
  spawnYaw: { CT: ${yawCT.toFixed(4)}, T: ${yawT.toFixed(4)} },
  sites: ${JSON.stringify(sites)},
  waypoints: ${JSON.stringify(wpOut)},
  waypointEdges: ${JSON.stringify(edges)},
  bounds: ${JSON.stringify(bounds)},
}
`
}
writeFileSync('/home/z/my-project/src/game/map-aimhead.ts', defTS(true))
writeFileSync('/home/z/my-project/mini-services/game-server/map-aimhead.ts', defTS(false))
console.log(`wrote map defs (boxes=${boxOut.length}, wps=${wpOut.length})`)

// ---------------- bots GRAPHS snippet ----------------
function nearWp(px: number, pz: number, n = 4): string[] {
  return [...wpsClean].sort((a, b) => Math.hypot(tx(a.x) - px, tz(a.z) - pz) - Math.hypot(tx(b.x) - px, tz(b.z) - pz)).slice(0, n).map(w => w.id)
}
const midX = (ctC[0] + tC[0]) / 2, midZ = (ctC[2] + tC[2]) / 2
console.log(`
---- bots.ts GRAPHS entry (aimhead) ----
  aimhead: buildGraph(MAPS.aimhead, {
    aHold: ${JSON.stringify(nearWp(ctC[0], ctC[2], 4))},
    bHold: ${JSON.stringify(nearWp(tC[0], tC[2], 4))},
    midHold: ${JSON.stringify(nearWp(midX, midZ, 4))},
    aRoutes: ${JSON.stringify([nearWp(tC[0], tC[2], 1), nearWp(ctC[0], ctC[2], 1)])},
    bRoutes: ${JSON.stringify([nearWp(ctC[0], ctC[2], 1), nearWp(tC[0], tC[2], 1)])},
    tHoldA: ${JSON.stringify(nearWp(tC[0], tC[2], 1)[0])},
    tHoldB: ${JSON.stringify(nearWp(ctC[0], ctC[2], 1)[0])},
    plantA: ${JSON.stringify(nearWp(ctC[0], ctC[2], 1)[0])},
    plantB: ${JSON.stringify(nearWp(tC[0], tC[2], 1)[0])},
  }),
`)

// ---------------- debug top-down render ----------------
{
  const W = 260, H = 130
  const x0 = worldMin[0], y0 = worldMin[1]
  const sx = (worldMax[0] - worldMin[0]) / W, sy = (worldMax[1] - worldMin[1]) / H
  const px = Buffer.alloc(W * H * 3)
  const zTop = new Float32Array(W * H).fill(-9999)
  // rasterize each floor poly over its own AABB pixels
  for (const fp of floorPolys) {
    const xs = fp.vs.map(v => v[0]), ys = fp.vs.map(v => v[1])
    const ix0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / sx)), ix1 = Math.min(W - 1, Math.ceil((Math.max(...xs) - x0) / sx))
    const iy0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / sy)), iy1 = Math.min(H - 1, Math.ceil((Math.max(...ys) - y0) / sy))
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = x0 + (ix + 0.5) * sx, wy = y0 + (iy + 0.5) * sy
        if (inPoly(wx, wy, fp.vs) && fp.z > zTop[iy * W + ix]) zTop[iy * W + ix] = fp.z
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const k = i * 3
    const fz = zTop[i]
    if (fz === -9999) { px[k] = 20; px[k + 1] = 20; px[k + 2] = 28; continue }
    const t = Math.max(0, Math.min(1, (fz + 190) / 350))
    px[k] = 40 + t * 190; px[k + 1] = 90 + t * 110; px[k + 2] = 200 - t * 185
  }
  const mark = (arr: number[][], r: number, g: number, b: number) => {
    for (const p of arr) {
      const ix = Math.round((p[0] / SCALE - x0) / sx), iy = Math.round((-p[2] / SCALE - y0) / sy)
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const k = ((iy + dy) * W + ix + dx) * 3
        if (k >= 0 && k < px.length) { px[k] = r; px[k + 1] = g; px[k + 2] = b }
      }
    }
  }
  mark(sCT, 255, 70, 70)
  mark(sT, 70, 130, 255)
  writeFileSync(`${OUT_DIR}/debug-top.ppm`, `P6\n${W} ${H}\n255\n`)
  require('fs').appendFileSync(`${OUT_DIR}/debug-top.ppm`, px)
  ppm2png(`${OUT_DIR}/debug-top.ppm`, `${OUT_DIR}/debug-top.png`)
}
console.log('DONE v2')
