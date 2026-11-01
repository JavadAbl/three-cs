// Task 150 audit v2: what does the user ACTUALLY not see? Compare the BSP
// source's face coverage against (a) the RENDERED geom.json triangles (what
// the player sees) and (b) collision boxes (what blocks movement), on a
// coarse XZ grid. Cluster + name the gaps.
import { readFileSync } from 'fs'

const SRC = '/home/z/my-project/upload/cs_office.bsp'
const CELL = 64            // bsp units per cell = 1.6 m
const buf = readFileSync(SRC)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
const L = (i: number) => ({ off: dv.getInt32(4 + i * 8, true), len: dv.getInt32(8 + i * 8, true) })
const lumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(L)
const nVerts = lumps[3].len / 12
const nEdges = lumps[12].len / 4
const nFaces = lumps[7].len / 20
const nTexinfo = lumps[6].len / 40
const nSurfedges = lumps[13].len / 4
const nLeaves = lumps[10].len / 28

const entRaw = buf.toString('latin1', lumps[0].off, lumps[0].off + lumps[0].len)
const entities: Array<Record<string, string>> = []
for (const m of entRaw.match(/\{[^{}]*\}/g) ?? []) {
  const e: Record<string, string> = {}
  for (const kv of m.match(/"([^"]+)"\s+"([^"]*)"/g) ?? []) {
    const mm = kv.match(/"([^"]+)"\s+"([^"]*)"/)!
    e[mm[1]] = mm[2]
  }
  entities.push(e)
}
const modelEnt = new Map<number, Record<string, string>>()
for (const e of entities) { const m = e.model?.match(/^\*(\d+)$/); if (m) modelEnt.set(+m[1], e) }
const SOLID = new Set(['func_wall', 'func_breakable', 'func_button'])
const RENDER = new Set([...SOLID, 'func_illusionary'])
function modelRole(mi: number): 'world' | 'solid' | 'render' | 'skip' {
  if (mi === 0) return 'world'
  const cls = modelEnt.get(mi)?.classname ?? ''
  if (RENDER.has(cls)) return SOLID.has(cls) ? 'solid' : 'render'
  return 'skip'
}
const miptexs: string[] = []
{
  const base = lumps[2].off
  const num = dv.getInt32(base, true)
  for (let i = 0; i < num; i++) {
    const rel = dv.getInt32(base + 4 + i * 4, true)
    if (rel === -1) { miptexs.push(`wad${i}`); continue }
    const p = base + rel
    miptexs.push(buf.toString('latin1', p, p + 16).replace(/\0.*$/, ''))
  }
}
const OPEN_DOOR_FACES = new Set([1278, 1279, 2424, 2425])
function faceTex(fi: number): string {
  const o = lumps[7].off + fi * 20
  const ti = dv.getInt16(o + 10, true)
  if (ti < 0 || ti >= nTexinfo) return '?'
  return miptexs[dv.getInt32(lumps[6].off + ti * 40 + 32, true)] ?? '?'
}
function faceVerts(fi: number): number[][] {
  const o = lumps[7].off + fi * 20
  const firstedge = dv.getInt32(o + 4, true)
  const numedges = dv.getUint16(o + 8, true)
  const out: number[][] = []
  if (numedges < 3 || numedges > 32) return out
  if (firstedge < 0 || firstedge + numedges > nSurfedges) return out
  for (let k = 0; k < numedges; k++) {
    const se = dv.getInt32(lumps[13].off + (firstedge + k) * 4, true)
    if (Math.abs(se) >= nEdges) return out
    const e = lumps[12].off + Math.abs(se) * 4
    const v = dv.getUint16(se >= 0 ? e : e + 2, true)
    if (v >= nVerts) return out
    out.push([dv.getFloat32(lumps[3].off + v * 12, true), dv.getFloat32(lumps[3].off + v * 12 + 4, true), dv.getFloat32(lumps[3].off + v * 12 + 8, true)])
  }
  return out.length >= 3 ? out : []
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

interface Cell { zMin: number; zMax: number; tex: Record<string, number> }
const bsp = new Map<string, Cell>()
let faceCount = 0, skippedSky = 0, skippedRole = 0, skippedDoor = 0
const nModels = lumps[14].len / 64
for (let mi = 0; mi < nModels; mi++) {
  const role = modelRole(mi)
  const roots = collectFaces(dv.getInt32(lumps[14].off + mi * 64 + 36, true))
  if (role === 'skip') { skippedRole += roots.length; continue }
  for (const fi of roots) {
    const tex = faceTex(fi)
    if (tex === 'sky' || tex === 'aaatrigger') { skippedSky++; continue }
    if (OPEN_DOOR_FACES.has(fi)) { skippedDoor++; continue }
    const vs = faceVerts(fi)
    if (!vs.length) continue
    faceCount++
    for (const v of vs) {
      const key = Math.floor(v[0] / CELL) + ',' + Math.floor(v[1] / CELL)
      let c = bsp.get(key)
      if (!c) { c = { zMin: Infinity, zMax: -Infinity, tex: {} }; bsp.set(key, c) }
      if (v[2] < c.zMin) c.zMin = v[2]
      if (v[2] > c.zMax) c.zMax = v[2]
      c.tex[tex] = (c.tex[tex] ?? 0) + 1
    }
  }
}
console.log(`BSP: ${faceCount} faces → ${bsp.size} cells (${(bsp.size * CELL * CELL * 0.025 * 0.025).toFixed(0)} m²)`)

// ---- RENDER coverage from geom.json (game coords → bsp units for the same grid)
const geom: any = JSON.parse(readFileSync('/home/z/my-project/public/assets/maps/office/geom.json', 'utf8'))
const geomCell = new Map<string, number>()
let triCount = 0
for (const g of geom.groups) {
  const pos: number[] = g.pos
  for (let i = 0; i + 2 < pos.length; i += 3) {
    // each float triple is a vertex of a triangle soup (idx references pos)
    const bx = pos[i] / 0.025, by = -pos[i + 2] / 0.025
    const key = Math.floor(bx / CELL) + ',' + Math.floor(by / CELL)
    geomCell.set(key, (geomCell.get(key) ?? 0) + 1)
    if (i % 9 === 0) triCount++
  }
}
console.log(`GEOM: ${geom.groups.length} groups → ${geomCell.size} cells; ~${(triCount / 1).toFixed(0)} vertex-samples`)

// ---- what BSP has that the RENDER does not
const missRender = [...bsp.entries()].filter(([k]) => !geomCell.has(k))
console.log(`\nNOT RENDERED (bsp cell, no geom vertex): ${missRender.length} cells (${(missRender.length * CELL * CELL * 0.025 * 0.025).toFixed(0)} m²)`)
const seen = new Set<string>()
const regions: Array<{ cells: string[]; area: number; cx: number; cy: number; zMin: number; zMax: number; tex: Record<string, number> }> = []
for (const [k0] of missRender) {
  if (seen.has(k0)) continue
  const q = [k0], cells: string[] = []
  const agg = { cx: 0, cy: 0, zMin: Infinity, zMax: -Infinity, tex: {} as Record<string, number> }
  while (q.length) {
    const k = q.pop()!
    if (seen.has(k)) continue
    seen.add(k)
    const c = bsp.get(k)
    if (!c || geomCell.has(k)) continue
    cells.push(k)
    const [gx, gy] = k.split(',').map(Number)
    agg.cx += gx; agg.cy += gy
    agg.zMin = Math.min(agg.zMin, c.zMin); agg.zMax = Math.max(agg.zMax, c.zMax)
    for (const [t, n] of Object.entries(c.tex)) agg.tex[t] = (agg.tex[t] ?? 0) + n
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = (gx + dx) + ',' + (gy + dy)
      if (!seen.has(nk) && bsp.has(nk) && !geomCell.has(nk)) q.push(nk)
    }
  }
  if (cells.length) {
    agg.cx /= cells.length; agg.cy /= cells.length
    regions.push({ cells, area: cells.length * CELL * CELL * 0.025 * 0.025, ...agg })
  }
}
regions.sort((a, b) => b.area - a.area)
const gameX = (bx: number) => +(bx * 0.025).toFixed(0)
const gameZ = (by: number) => +(-by * 0.025).toFixed(0)
const gameY = (bz: number) => +((bz + 576) * 0.025).toFixed(1)
console.log(`=== VISUALLY MISSING REGIONS (top 20 of ${regions.length}) ===`)
for (const r of regions.slice(0, 20)) {
  const top = Object.entries(r.tex).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t}(${n})`).join(' ')
  console.log(`  ${r.area.toFixed(0).padStart(4)} m² · game(x≈${gameX(r.cx * CELL)}, z≈${gameZ(r.cy * CELL)}) · bsp-z ${r.zMin}→${r.zMax} (game-y ${gameY(r.zMin)}→${gameY(r.zMax)}) · tex: ${top}`)
}

// ---- waypoint reachability upstairs: how many waypoints exist at y > 9?
// (import via dynamic eval of the map-office module is heavy; read losBoxes
//  from the generated TS via a regex-free side channel: use the server copy)
