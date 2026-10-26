// ============================================================
// BSP v30 → game map converter (cs_office) — face-driven, LIGHTMAP BAKED
//
// Built on the proven convert2.ts (aim_headshot) skeleton:
//   - render/collision/spawns/waypoints ALL derived from face geometry
//   - no node/leaf contents oracle anywhere
// Office deltas (Task 126):
//   1. SUB-MODELS are real content here: 175 func_walls (desks, paper piles,
//      lights, elevator doors…), 14 func_breakables (window glass), 5
//      func_illusionaries (monitor props, render-only), 1 func_button.
//      SKIPPED: hostage stuff (4 hostage_entity + 2 func_hostage_rescue —
//      user: no hostages feature), 2 func_ladder volumes (invisible, no
//      ladder mechanic), 5 func_buyzone triggers (buy is global in our game),
//      1 func_door (the warehouse roller door — see worklog: rendered-closed
//      would block the garage route, rendered-open is a floating door leaf;
//      the doorway stays open like the rest of the map's doorways).
//   2. LIGHTMAP BAKE: every non-sky face carries a 1-style GoldSrc grayscale
//      lightmap (772 KB). Sampled bilinearly at each vertex → per-vertex
//      color attr in geom.json; materials with vertexColors multiply the
//      CS 1.6 baked sun/shadow look into our render.
//   3. MULTI-LEVEL waypoints: office has 4 floor levels (-544 sump … -48
//      upstairs). convert2's "keep highest per column" pass would delete the
//      ground floor under the 2nd floor — replaced by a vertical-gap dedupe.
//   4. Waypoints must clear furniture: office rooms are full of func_wall
//      desks/couches; every wp is headroom-checked against collision boxes.
//   5. Texture families: 7 NEW office families (carpet, offwall, ceiling,
//      snow, tile, glass, fence) + shared reuse (concrete/brick/metal/plank/
//      dark/crate). fence/glass are render-special (alphaTest lattice /
//      transparent panes).
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { ppm2png } from './ppm2png'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
const OUT_DIR = '/home/z/my-project/public/staging/maps/office'
const SCALE = 0.025          // 1 bsp unit = 0.025 m (72u player = 1.8 m)
const Z_REBASE = 576         // bsp z=-576 (below the -544 sump floor) → our y 0
const THICK = 32             // collision extrusion depth (bsp units)
const PLAYER_R_U = 16        // player radius (bsp units ≈ 0.4 m)
const HEADROOM_U = 74        // player standing height + margin

mkdirSync(`${OUT_DIR}`, { recursive: true })

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
// model index -> entity (sub-model classification)
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) {
  const m = e.model?.match(/^\*(\d+)$/)
  if (m) modelEnt.set(+m[1], e)
}
// which entity classes contribute what
const SOLID_MODELS = new Set(['func_wall', 'func_breakable', 'func_button'])
const RENDER_MODELS = new Set([...SOLID_MODELS, 'func_illusionary'])
function modelRole(mi: number): 'world' | 'solid' | 'render' | 'skip' {
  if (mi === 0) return 'world'
  const cls = modelEnt.get(mi)?.classname ?? ''
  if (RENDER_MODELS.has(cls)) return SOLID_MODELS.has(cls) ? 'solid' : 'render'
  return 'skip'   // func_door, func_ladder, triggers, buyzones, rescue zones
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
    const name = buf.toString('latin1', p, p + 16).replace(/\0.*$/, '')
    miptexs.push({ name, w: dv.getUint32(p + 16, true), h: dv.getUint32(p + 20, true) })
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

// ---------------- office texture families ----------------
// 7 new families + shared reuse. Every miptex name maps to exactly one.
function ourTex(rawName: string): string {
  let n = rawName.toLowerCase()
  // animated textures (+0~light, +a~panel…) → frame-0 base name
  n = n.replace(/^\+[0-9a-b]~?/, '')
  // GoldSrc transparent-texture prefix
  const alpha = n.startsWith('{')
  n = n.replace(/^[{+]+/, '')
  if (alpha) return 'fence'                       // {rail1c, {ladder2* → lattice cutout
  if (n === 'sky' || n === 'aaatrigger') return 'SKIP'
  const has = (...p: string[]) => p.some(x => n.includes(x))
  if (has('snow')) return 'snow'                  // sphinx_snow_1, sphinx_snowrock
  if (has('carpet')) return 'carpet'              // carpet20001, graystripecarpe, couch_* (fabric)
  if (has('couch')) return 'carpet'
  if (has('glass')) return 'glass'                // glass_bright, glass_med
  if (n === 'window_1') return 'glass'
  if (has('ceil', 'fifts_lght', 'fifties_lgt', 'light3c', 'c1a4i_c1a')) return 'ceiling' // drop-ceiling panels + fixtures
  if (has('railing', 'rail1')) return 'fence'    // sphinx_railing_, railing_3
  if (has('bricks_')) return 'brick'              // redbricks_12/13, brownbricks_1
  if (has('lab1_flr', 'tnnl_flr')) return 'tile'  // hallway tile floors
  if (has('asphalt', 'comp_', 'lab1_comp', 'black', 'fade')) return 'dark'  // parking lot + screens
  if (has('wood', 'desk', 'file1', 'file2_sp', 'door_2', 'door_3', 'dr1k', 'c1a1_dr2', 'bks1', 'sphinx_desk')) return 'plank'
  // ^ fifties_dsk*, wood2_1, fifties_dr1k, file cabinets(cabinets are metal but
  //   drawer fronts wood — reads better), bookshelf planks, office desks
  if (has('crate', 'cardboard', 'cardbox', 'ammo0')) return 'crate'         // of_crate*, xcrate*, cardbox*
  if (has('wall_', 'hallway', 'trim', 'paper', 'painting', 'picture', 'poster', 'sign', 'generic', 'of_daddy', 'of_boy', 'of_got_milk',
          'fearferret', 'stripes', 'exit', 'clock', 'lab1_map', 'overhead', 'board_', 'garage_', 'sp_lock', 'step_')) return 'offwall'
  // ^ wall_1/19/20/21, hallway_3/10, sphinx_trim_1..10, posters/paintings, misc HL decor
  if (has('cement', 'crete', 'cinder', 'concrete', 'step_')) return 'concrete'
  if (has('metal', 'elev', 'apc_', 'vent', 'warehousedoor', 'babtech', 'trsh', 'freezer')) return 'metal'
  // ^ elevator doors/trim, APC armor, vents, warehouse roller door, trash cans, freezer
  return 'offwall'                                // default: interior wall paint
}

// ---------------- faces ----------------
interface Face { planenum: number; side: number; firstedge: number; numedges: number; texinfo: number; styles: number[]; lightofs: number }
const faces: Face[] = []
for (let i = 0; i < nFaces; i++) {
  const o = lumps[7].off + i * 20
  faces.push({
    planenum: dv.getUint16(o, true),
    side: dv.getUint8(o + 2),
    firstedge: dv.getInt32(o + 4, true),
    numedges: dv.getUint16(o + 8, true),       // the convert2 v1 bug — read at +8
    texinfo: dv.getInt16(o + 10, true),
    styles: [0, 1, 2, 3].map(k => dv.getUint8(o + 12 + k)),
    lightofs: dv.getInt32(o + 16, true),
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

// ---------------- collect faces per model (hull 0) ----------------
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

// coordinate transform bsp → our game (x, y up, z south)
const tx = (x: number) => +(x * SCALE).toFixed(4)
const ty = (z: number) => +((z + Z_REBASE) * SCALE).toFixed(4)
const tz = (y: number) => +(-y * SCALE).toFixed(4)

// ---------------- validated geometry faces (all included models) ----------------
interface GFace { fi: number; tex: string; n: number[]; vs: number[][]; aabb: number[]; role: 'world' | 'solid' | 'render' }
const gfaces: GFace[] = []
let skipped = 0
{
  const perRole = { world: 0, solid: 0, render: 0, skip: 0 }
  for (let mi = 0; mi < nModels; mi++) {
    const role = modelRole(mi)
    if (role === 'skip') { perRole.skip++; continue }
    for (const fi of collectFaces(modelRoots[mi])) {
      const f = faces[fi]
      if (f.texinfo < 0 || f.texinfo >= nTexinfo) { skipped++; continue }
      const rawName = miptexs[texinfos[f.texinfo].miptex]?.name ?? ''
      const tex = ourTex(rawName)
      if (tex === 'SKIP') { skipped++; continue }
      const vs = faceVerts(f)
      if (!vs.length) { skipped++; continue }
      const pl = planeOf(f.planenum)
      let nrm = pl.n
      if (f.side === 1) nrm = [-nrm[0], -nrm[1], -nrm[2]]
      const xs = vs.map(v => v[0]), ys = vs.map(v => v[1]), zs = vs.map(v => v[2])
      gfaces.push({ fi, tex, n: nrm, vs, aabb: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)], role })
      perRole[role]++
    }
  }
  console.log(`models: world=1 solid=${perRole.solid} render=${perRole.render} skipped=${perRole.skip} entities`)
  console.log(`geometry faces: ${gfaces.length} (skipped sky/trigger/invalid: ${skipped})`)
}

// ---------------- lightmap bake (GoldSrc grayscale, 16u samples, 1 style) ----------------
// Sample grid: sCount = floor(sMax/16) - floor(sMin/16) + 1 (same for t);
// byte index = tIdx * sCount + sIdx (s fastest — Quake/GoldSrc row-major).
// All 8390 lit faces here carry exactly one style (validated by the inventory).
const LIGHT_LUMP_LEN = lumps[8].len
let lmBaked = 0, lmMissing = 0, lmOverflow = 0
const LM_GAMMA = 0.72        // lift darks: interiors get sun-through-windows baked dim (~0.1); pow(0.1,0.72)≈0.19 stays readable
const LM_GAIN = 1.12
function bakeFaceLight(f: Face, vs: number[][]): number[] {
  // returns one [0..1] scalar per vertex (grayscale)
  const out = new Array(vs.length).fill(0.55)
  if (f.lightofs < 0) { lmMissing++; return out }
  const ti = texinfos[f.texinfo]
  const st = vs.map(v => [
    v[0] * ti.s[0] + v[1] * ti.s[1] + v[2] * ti.s[2] + ti.ss,
    v[0] * ti.t[0] + v[1] * ti.t[1] + v[2] * ti.t[2] + ti.st,
  ])
  const sLo = Math.floor(Math.min(...st.map(p => p[0])) / 16)
  const sHi = Math.floor(Math.max(...st.map(p => p[0])) / 16)
  const tLo = Math.floor(Math.min(...st.map(p => p[1])) / 16)
  const tHi = Math.floor(Math.max(...st.map(p => p[1])) / 16)
  const sCount = sHi - sLo + 1, tCount = tHi - tLo + 1
  const nStyles = f.styles.filter(s => s !== 255).length
  const need = nStyles * sCount * tCount
  if (f.lightofs + need > LIGHT_LUMP_LEN) { lmOverflow++; return out }
  const base = lumps[8].off + f.lightofs
  const at = (i: number, j: number) => dv.getUint8(base + j * sCount + i) / 255
  for (let k = 0; k < vs.length; k++) {
    const fu = Math.max(0, Math.min(sCount - 1, st[k][0] / 16 - sLo))
    const fv = Math.max(0, Math.min(tCount - 1, st[k][1] / 16 - tLo))
    const i0 = Math.floor(fu), j0 = Math.floor(fv)
    const i1 = Math.min(sCount - 1, i0 + 1), j1 = Math.min(tCount - 1, j0 + 1)
    const a = i1 - i0 < 1e-9 ? 0 : (fu - i0) / (i1 - i0)
    const b = j1 - j0 < 1e-9 ? 0 : (fv - j0) / (j1 - j0)
    const v = (at(i0, j0) * (1 - a) + at(i1, j0) * a) * (1 - b)
            + (at(i0, j1) * (1 - a) + at(i1, j1) * a) * b
    out[k] = Math.min(1.15, Math.pow(v, LM_GAMMA) * LM_GAIN)
  }
  lmBaked++
  return out
}

// ---------------- render geometry groups ----------------
interface Group { tex: string; pos: number[]; norm: number[]; uv: number[]; color: number[]; idx: number[] }
const groups = new Map<string, Group>()
let lmSum = 0, lmCount = 0
for (const gf of gfaces) {
  const f = faces[gf.fi]
  const g = groups.get(gf.tex) ?? { tex: gf.tex, pos: [], norm: [], uv: [], color: [], idx: [] } as Group
  const ti = texinfos[f.texinfo]
  const mt = miptexs[ti.miptex] ?? miptexs[0]
  const tw = mt?.w ?? 128, th = mt?.h ?? 128
  const nOur = [gf.n[0], gf.n[2], -gf.n[1]]
  const light = bakeFaceLight(f, gf.vs)
  const base = g.pos.length / 3
  for (let vi = 0; vi < gf.vs.length; vi++) {
    const v = gf.vs[vi]
    g.pos.push(tx(v[0]), ty(v[2]), tz(v[1]))
    g.norm.push(nOur[0], nOur[1], nOur[2])
    const u = (v[0] * ti.s[0] + v[1] * ti.s[1] + v[2] * ti.s[2] + ti.ss) / tw
    const vv = (v[0] * ti.t[0] + v[1] * ti.t[1] + v[2] * ti.t[2] + ti.st) / th
    g.uv.push(+u.toFixed(4), +(1 - vv).toFixed(4))
    const L = light[vi]
    g.color.push(+L.toFixed(3), +L.toFixed(3), +L.toFixed(3))
    lmSum += L; lmCount++
  }
  for (let k = 1; k < gf.vs.length - 1; k++) {
    if (f.side === 1) g.idx.push(base, base + k + 1, base + k)
    else g.idx.push(base, base + k, base + k + 1)
  }
  groups.set(gf.tex, g)
}
console.log(`lightmap: baked=${lmBaked} missing=${lmMissing} overflow=${lmOverflow} meanL=${(lmSum / Math.max(1, lmCount)).toFixed(3)}`)
console.log('geom groups:', [...groups.keys()].map(k => `${k}(${(groups.get(k)!.idx.length / 3).toFixed(0)}tris)`).join(' '))
console.log(`total render tris: ${[...groups.values()].reduce((a, g) => a + g.idx.length / 3, 0).toFixed(0)}`)
writeFileSync(`${OUT_DIR}/geom.json`, JSON.stringify({ groups: [...groups.values()] }))

// ---------------- collision boxes from faces (world + SOLID models only) ----------------
interface BBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; tex: string }
const boxes: BBox[] = []

const worldMin = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + k * 4, true))
const worldMax = [0, 1, 2].map(k => dv.getFloat32(lumps[14].off + 12 + k * 4, true))
const touchesShell = (aabb: number[]) =>
  aabb[0] <= worldMin[0] + 8 || aabb[1] >= worldMax[0] - 8 ||
  aabb[2] <= worldMin[1] + 8 || aabb[3] >= worldMax[1] - 8

const flat = (vs: number[][], axis: number, tol = 1.5) => {
  const vals = vs.map(v => v[axis])
  return Math.max(...vals) - Math.min(...vals) <= tol
}

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
function gridBands(lo: number, hi: number): number[] {
  const cuts = [lo]
  let s = lo
  while (s < hi - 0.05) {
    const next = Math.min(hi, Math.floor(s / 8) * 8 + 8)
    if (next <= s + 0.05) break
    cuts.push(next)
    s = next
  }
  return cuts
}
function emitStaircase(gf: GFace, up: boolean) {
  const [nx, ny, nz] = gf.n
  const ax = Math.abs(nx) >= Math.abs(ny) ? 0 : 1
  const lo = gf.aabb[ax], hi = gf.aabb[ax + 1]
  const gentle = Math.abs(nz) >= 0.55
  if (!gentle) {
    boxes.push({ x0: gf.aabb[0], x1: gf.aabb[1], y0: gf.aabb[2], y1: gf.aabb[3], z0: gf.aabb[4], z1: gf.aabb[5], tex: 'wall' })
    return
  }
  const cuts = gridBands(lo, hi)
  for (let bi = 0; bi < cuts.length - 1; bi++) {
    const s = cuts[bi], e = cuts[bi + 1]
    let strip = clipAxis(gf.vs, ax, s - 0.01, true)
    strip = clipAxis(strip, ax, e + 0.01, false)
    if (strip.length < 3) continue
    const xs = strip.map(v => v[0]), ys = strip.map(v => v[1]), zs = strip.map(v => v[2])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const z0 = Math.min(...zs), z1 = Math.max(...zs)
    if (up) boxes.push({ x0, x1, y0, y1, z0: z0 - THICK, z1, tex: 'sand' })
    else boxes.push({ x0, x1, y0, y1, z0, z1: z1 + THICK, tex: 'wall' })
  }
}
function polyArea2(vs: number[][], axA: number, axB: number): number {
  let a = 0
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i], q = vs[(i + 1) % vs.length]
    a += p[axA] * q[axB] - q[axA] * p[axB]
  }
  return Math.abs(a / 2)
}
function emitWall(gf: GFace, runAxis: 0 | 1, solidLo: number, solidHi: number) {
  const a = gf.aabb
  const aabbArea = (a[runAxis + 1] - a[runAxis]) * (a[5] - a[4])
  const rectangular = aabbArea <= 1e-6 || polyArea2(gf.vs, runAxis, 2) >= 0.98 * aabbArea
  if (rectangular) {
    if (runAxis === 0) boxes.push({ x0: a[0], x1: a[1], y0: solidLo, y1: solidHi, z0: a[4], z1: a[5], tex: 'brick' })
    else boxes.push({ x0: solidLo, x1: solidHi, y0: a[2], y1: a[3], z0: a[4], z1: a[5], tex: 'brick' })
    return
  }
  const lo = a[runAxis], hi = a[runAxis + 1]
  const cuts = gridBands(lo, hi)
  for (let bi = 0; bi < cuts.length - 1; bi++) {
    const s = cuts[bi], e = cuts[bi + 1]
    let strip = clipAxis(gf.vs, runAxis, s - 0.01, true)
    strip = clipAxis(strip, runAxis, e + 0.01, false)
    if (strip.length < 3) continue
    const xs = strip.map(v => v[0]), ys = strip.map(v => v[1]), zs = strip.map(v => v[2])
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
    const z0 = Math.min(...zs), z1 = Math.max(...zs)
    if (runAxis === 0) boxes.push({ x0, x1, y0: solidLo, y1: solidHi, z0, z1, tex: 'brick' })
    else boxes.push({ x0: solidLo, x1: solidHi, y0, y1, z0, z1, tex: 'brick' })
  }
}
let nFloor = 0, nCeil = 0, nWall = 0, nSlope = 0, nSkip = 0, nFurn = 0
for (const gf of gfaces) {
  if (gf.role === 'render') { nFurn++; continue }        // illusionary props: no collision
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
    emitWall(gf, 1, nx > 0 ? a[0] - THICK : a[1], nx > 0 ? a[0] : a[1] + THICK)
  } else if (Math.abs(ny) >= 0.94 && Math.abs(nx) < 0.34) {   // WALL facing ±y
    nWall++
    emitWall(gf, 0, ny > 0 ? a[2] - THICK : a[3], ny > 0 ? a[2] : a[3] + THICK)
  } else if (Math.abs(nz) >= 0.3) {                  // sloped ramp — staircase walkable
    nSlope++
    emitStaircase(gf, nz > 0)
  } else if (touchesShell(a)) {                      // outside-play diagonal (skyshell, cliffs)
    nSkip++
  } else {                                           // diagonal wall inside play — block via AABB
    nWall++
    boxes.push({ x0: a[0], x1: a[1], y0: a[2], y1: a[3], z0: a[4], z1: a[5], tex: 'wall' })
  }
}
console.log(`collision faces: floor=${nFloor} ceil=${nCeil} wall=${nWall} slope=${nSlope} shellSkip=${nSkip} furnitureNoCollide=${nFurn}`)
console.log(`raw collision boxes: ${boxes.length}`)

// merge: exact-dup removal + band merge (same z-band, edge-adjacent rectangles)
function mergeBoxes(bx: BBox[]): BBox[] {
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
  if (gf.role === 'render') continue
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
        if (Math.abs(fp.z - z) > 220) continue
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
  console.log(`spawn ${e.classname === 'info_player_start' ? 'CT' : 'T '} @(${x},${y},${z}) → floor z=${s.z} @(${s.x},${s.y}) dx=${s.x - x} dy=${s.y - y}`)
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
console.log('CT:', sCT.slice(0, 4).map(p => p.map(v => v.toFixed(1)).join(',')).join('  '))
console.log('T: ', sT.slice(0, 4).map(p => p.map(v => v.toFixed(1)).join(',')).join('  '))

// ---------------- waypoints from floor faces (MULTI-LEVEL, Task 126) ----------------
// convert2 kept only the HIGHEST wp per 32u column (fine for aim's single
// level, catastrophic for office: the 2nd floor would delete the ground
// floor). Here: keep every candidate, dedupe by 32u column with a 24u
// vertical-gap filter (stair steps 8-16u collapse to ~every 3rd step, levels
// 176u apart all survive). Every wp must clear collision (desks/couches are
// solid func_walls — bots must not path onto furniture).
const WP_STEP = 64
interface WPU { x: number; y: number; z: number; id: string }
const wpRaw: WPU[] = []
let wpFurnRejected = 0
for (const fp of floorPolys) {
  const xs = fp.vs.map(v => v[0]), ys = fp.vs.map(v => v[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  for (let wy = y0 + WP_STEP / 2; wy < y1; wy += WP_STEP) {
    for (let wx = x0 + WP_STEP / 2; wx < x1; wx += WP_STEP) {
      if (!inPoly(wx, wy, fp.vs)) continue
      if (distToPolyEdge(wx, wy, fp.vs) < PLAYER_R_U + 8) continue
      if (overlapsU(wx, wy, fp.z + 4, fp.z + HEADROOM_U)) { wpFurnRejected++; continue }
      wpRaw.push({ x: wx, y: fp.z, z: wy, id: '' })
    }
  }
}
// large top surfaces (staircase strips, landings) add their own
for (const b of boxesMerged) {
  if (b.z1 - b.z0 > THICK + 26) continue      // surface strips only, not tall walls
  if (b.z1 > 240) continue                    // playable heights only (our y < ~10m after rebase)
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
// column dedupe with vertical-gap filter (MULTI-LEVEL: keep each level)
const byCol = new Map<string, WPU[]>()
for (const w of wpRaw) {
  const k = `${Math.round(w.x / 32)}_${Math.round(w.z / 32)}`
  if (!byCol.has(k)) byCol.set(k, [])
  byCol.get(k)!.push(w)
}
const wpsClean: WPU[] = []
for (const ws of byCol.values()) {
  ws.sort((a, b) => a.y - b.y)
  let lastY = -9999
  for (const w of ws) {
    if (w.y - lastY > 24) { wpsClean.push(w); lastY = w.y }
  }
}
wpsClean.forEach((w, i) => { w.id = `of${i}` })
console.log(`waypoints: ${wpsClean.length} (furniture-rejected ${wpFurnRejected})`)

// edges: neighbors within reach (140u horiz ≈ 3.5m, 96u vert ≈ stairs)
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
        const dh = Math.hypot(n.x - w.x, n.z - w.z)
        if (dh > 140) continue
        if (Math.abs(n.y - w.y) > 96) continue
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

// spawn yaw: both teams face the map center (playable centroid)
const cenX = (bounds.minX + bounds.maxX) / 2, cenZ = (bounds.minZ + bounds.maxZ) / 2
const yawTo = (from: number[]) => Math.atan2(cenX - from[0], cenZ - from[2])
const yawCT = +yawTo(ctC).toFixed(4), yawT = +yawTo(tC).toFixed(4)
console.log(`spawnYaw: CT=${yawCT} T=${yawT} (center ${cenX.toFixed(1)},${cenZ.toFixed(1)})`)

// ---------------- emit MapDef ----------------
const boxOut = boxesMerged.map(b => ({
  x: +tx((b.x0 + b.x1) / 2).toFixed(3), y: +ty((b.z0 + b.z1) / 2).toFixed(3), z: +tz((b.y0 + b.y1) / 2).toFixed(3),
  w: +((b.x1 - b.x0) * SCALE).toFixed(3), h: +((b.z1 - b.z0) * SCALE).toFixed(3), d: +((b.y1 - b.y0) * SCALE).toFixed(3),
  tex: b.tex,
})).filter(b => b.w > 0.1 || b.d > 0.1)
const wpOut = wpsClean.map(w => ({ id: w.id, x: +tx(w.x).toFixed(2), y: +ty(w.y + 2).toFixed(2), z: +tz(w.z).toFixed(2) }))
const spawnOut = (a: number[][]) => a.map(p => ({ x: p[0], y: p[1], z: p[2] }))

function defTS(withBsp: boolean) {
  return `// GENERATED from cs_office.bsp (BSP v30) by scripts/bsp/convert-office.ts — face-driven + lightmap baked, do not edit
import type { MapDef, Box, WP } from './mapdata'

export const OFFICE: MapDef = {
  id: 'office',
  name: 'Office',
  version: 1,
${withBsp ? `  bsp: { geomUrl: '/staging/maps/office/geom.json' },   // staging per acceptance policy — flip to /assets/maps/office/ on accept
` : ''}  boxes: ${JSON.stringify(boxOut)},
  losBoxes: ${JSON.stringify(boxOut)},
  spawns: {
    CT: ${JSON.stringify(spawnOut(sCT))},
    T: ${JSON.stringify(spawnOut(sT))},
  },
  spawnYaw: { CT: ${yawCT}, T: ${yawT} },
  sites: ${JSON.stringify(sites)},
  waypoints: ${JSON.stringify(wpOut)},
  waypointEdges: ${JSON.stringify(edges)},
  bounds: ${JSON.stringify(bounds)},
}
`
}
writeFileSync('/home/z/my-project/src/game/map-office.ts', defTS(true))
writeFileSync('/home/z/my-project/mini-services/game-server/map-office.ts', defTS(false))
console.log(`wrote map defs (boxes=${boxOut.length}, wps=${wpOut.length})`)

// ---------------- bots GRAPHS snippet ----------------
function nearWp(px: number, pz: number, n = 4): string[] {
  return [...wpsClean].sort((a, b) => Math.hypot(tx(a.x) - px, tz(a.z) - pz) - Math.hypot(tx(b.x) - px, tz(b.z) - pz)).slice(0, n).map(w => w.id)
}
const midX = (ctC[0] + tC[0]) / 2, midZ = (ctC[2] + tC[2]) / 2
// for office: CT = outside/garage side (SW), T = office side (E). Holds:
// aHold around CT spawn, bHold around T spawn, mid at the centroid between.
console.log(`
---- bots.ts GRAPHS entry (office) ----
  office: buildGraph(MAPS.office, {
    aHold: ${JSON.stringify(nearWp(ctC[0], ctC[2], 4))},
    bHold: ${JSON.stringify(nearWp(tC[0], tC[2], 4))},
    midHold: ${JSON.stringify(nearWp(midX, midZ, 4))},
    aRoutes: ${JSON.stringify([[nearWp(tC[0], tC[2], 1)[0], nearWp(midX, midZ, 1)[0]], [nearWp(midX, midZ, 1)[0], nearWp(ctC[0], ctC[2], 1)[0]]])},
    bRoutes: ${JSON.stringify([[nearWp(ctC[0], ctC[2], 1)[0], nearWp(midX, midZ, 1)[0]], [nearWp(midX, midZ, 1)[0], nearWp(tC[0], tC[2], 1)[0]]])},
    tHoldA: ${JSON.stringify(nearWp(tC[0], tC[2], 1)[0])},
    tHoldB: ${JSON.stringify(nearWp(ctC[0], ctC[2], 1)[0])},
    plantA: ${JSON.stringify(nearWp(ctC[0], ctC[2], 1)[0])},
    plantB: ${JSON.stringify(nearWp(tC[0], tC[2], 1)[0])},
    watch: {
${[...nearWp(ctC[0], ctC[2], 4), ...nearWp(tC[0], tC[2], 4), ...nearWp(midX, midZ, 4)]
  .map(id => {
    const w = wpsClean.find(q => q.id === id)!
    // face the ENEMY spawn (the centroid farther from this node)
    const to = Math.hypot(tC[0] - tx(w.x), tC[2] - tz(w.z)) < Math.hypot(ctC[0] - tx(w.x), ctC[2] - tz(w.z)) ? ctC : tC
    return `      ${id}: [${(to[0] - tx(w.x)).toFixed(1)}, ${(to[2] - tz(w.z)).toFixed(1)}],`
  }).join('\n')}
    },
  }),
`)

// ---------------- debug top-down render (floors + light + spawns) ----------------
{
  const W = 300, H = 160
  const x0 = worldMin[0], y0 = worldMin[1]
  const sx = (worldMax[0] - worldMin[0]) / W, sy = (worldMax[1] - worldMin[1]) / H
  const px = Buffer.alloc(W * H * 3)
  const zTop = new Float32Array(W * H).fill(-9999)
  const lTop = new Float32Array(W * H).fill(0)
  for (const fp of floorPolys) {
    const xs = fp.vs.map(v => v[0]), ys = fp.vs.map(v => v[1])
    const ix0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / sx)), ix1 = Math.min(W - 1, Math.ceil((Math.max(...xs) - x0) / sx))
    const iy0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / sy)), iy1 = Math.min(H - 1, Math.ceil((Math.max(...ys) - y0) / sy))
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const wx = x0 + (ix + 0.5) * sx, wy = y0 + (iy + 0.5) * sy
        if (inPoly(wx, wy, fp.vs) && fp.z > zTop[iy * W + ix]) { zTop[iy * W + ix] = fp.z; lTop[iy * W + ix] = 1 }
      }
    }
  }
  // light-probe layer: mean light at floor-center samples
  for (let iy = 0; iy < H; iy++) {
    for (let ix = 0; ix < W; ix++) {
      const k = (iy * W + ix) * 3
      if (zTop[iy * W + ix] === -9999) { px[k] = 14; px[k + 1] = 14; px[k + 2] = 20; continue }
      const t = Math.max(0, Math.min(1, (zTop[iy * W + ix] + 580) / 900))
      px[k] = 30 + t * 150; px[k + 1] = 60 + t * 120; px[k + 2] = 170 - t * 140
    }
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
console.log('DONE')
