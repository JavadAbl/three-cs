// scripts/island/step-study.ts — Task 131 hotfix #3 parametric study.
// User report: "in some places an invisible object blocks me — I have to
// jump to bypass it, but there is nothing in my way."
//
// The island terrain colliders are STAIRCASE boxes (AABB-only engine):
// every cell's collider is a flat-top box, so walking UPHILL means walking
// into the vertical face of the next-higher cell. engine.ts auto-steps rises
// <= STEP_UP (0.55); anything taller is a wall. gen.ts currently subdivides
// only cells with corner variance > 0.9 — so moderate slopes (12-36 deg:
// A-hill flanks, cove walls, pad shoulders, the wading ring) leave 0.55-0.9m
// rises = INVISIBLE WALLS on smooth-looking ground.
//
// FINAL config under test (mirrors the planned gen.ts change):
//   colBoxes: fine staircase (variance > 0.5 subdivides, down to 0.625m) for
//             every top-level cell whose min corner is above chest depth
//             (-2.5); deeper sea keeps the committed variance-0.9 tree
//             byte-identical (nobody walks there — failsafe yanks at feet -6).
//             Every terrain collider carries stair:true.
//   losBoxes: UNCHANGED committed set (variance-0.9 tree, hMin > 0.95) —
//             server vision/grenades see zero change.
//   engine:   step-up limit per box: stair ? 0.95 : 0.55.
// Blocked step = rise > limit. "Invisible" = collider rise exceeds the
// VISIBLE terrain rise by > 0.2m (the wall is taller than what you can see).
// NB: sample-pair rises at 1.25-1.77m AGGREGATE 2-3 fine cells — the wall/
// invisible counts here are therefore upper bounds for comparison between
// configs (the permanent per-cell-exact gate lives in collider-probe.ts,
// which ray-walks blocked candidates at 0.3m).
// Run: bun scripts/island/step-study.ts
import { readFileSync } from 'fs'
import { height } from './gen'   // side effect: deterministic regen (byte-identical)

const data = JSON.parse(readFileSync('src/game/map-island-data.json', 'utf8')) as {
  boxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>
  losBoxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>
  waypoints: Array<{ id: string; x: number; z: number; y: number }>
  waypointEdges: Array<[string, string]>
}
const jsonBytes = readFileSync('src/game/map-island-data.json', 'utf8').length
const perBoxBytes = jsonBytes / (data.boxes.length + data.losBoxes.length)

const BOUNDS = { minX: -95, maxX: 95, minZ: -85, maxZ: 85 }
const RES_LOS = 2.5

interface Cell { x0: number; z0: number; s: number; top: number; hMin: number }
interface Cfg { varFine: number; varDeep: number; deepMin: number }

// top-level `fine` decision freezes at the 2.5m parent (children inherit), so
// deep sea reproduces the committed variance-0.9 tree EXACTLY
function emitCells(cfg: Cfg): Cell[] {
  const cells: Cell[] = []
  const rec = (x: number, z: number, size: number, fine: boolean) => {
    const h0 = height(x, z), h1 = height(x + size, z), h2 = height(x, z + size), h3 = height(x + size, z + size)
    const hMin = Math.min(h0, h1, h2, h3), hMax = Math.max(h0, h1, h2, h3)
    if (hMax < -5.8) return                       // == terrainQuad deep-sea skip
    if (hMax - hMin > (fine ? cfg.varFine : cfg.varDeep) && size > 0.7) {
      const s2 = size / 2
      rec(x, z, s2, fine); rec(x + s2, z, s2, fine); rec(x, z + s2, s2, fine); rec(x + s2, z + s2, s2, fine)
      return
    }
    cells.push({ x0: x, z0: z, s: size, top: hMin - 0.22, hMin })
  }
  for (let x = BOUNDS.minX; x < BOUNDS.maxX; x += RES_LOS) {
    for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += RES_LOS) {
      const h0 = height(x, z), h1 = height(x + RES_LOS, z), h2 = height(x, z + RES_LOS), h3 = height(x + RES_LOS, z + RES_LOS)
      const hMin = Math.min(h0, h1, h2, h3), hMax = Math.max(h0, h1, h2, h3)
      if (hMax < -5.8) continue
      rec(x, z, RES_LOS, hMin > cfg.deepMin)
    }
  }
  return cells
}

function cellLookup(cells: Cell[]): (x: number, z: number) => Cell | null {
  const hash = new Map<string, Cell[]>()
  for (const c of cells) {
    const k = `${Math.floor((c.x0 - BOUNDS.minX) / RES_LOS)},${Math.floor((c.z0 - BOUNDS.minZ) / RES_LOS)}`
    if (!hash.has(k)) hash.set(k, [])
    hash.get(k)!.push(c)
  }
  return (x: number, z: number) => {
    const list = hash.get(`${Math.floor((x - BOUNDS.minX) / RES_LOS)},${Math.floor((z - BOUNDS.minZ) / RES_LOS)}`)
    if (!list) return null
    for (const c of list) if (x >= c.x0 && x <= c.x0 + c.s && z >= c.z0 && z <= c.z0 + c.s) return c
    return null
  }
}

function scan(cfg: Cfg, label: string, stairLimit: number) {
  const cells = emitCells(cfg)
  const at = cellLookup(cells)
  const los = data.losBoxes.length            // losBoxes stay committed-identical
  const fine = cells.filter(c => c.s < RES_LOS).length
  const coarse = cells.length - fine
  let blocked = 0, invis = 0, samples = 0, maxRise = 0
  const worstInvis: Array<{ x: number; z: number; rise: number; vis: number }> = []
  const worstAll: Array<{ x: number; z: number; rise: number; vis: number }> = []
  const G = 1.25
  for (let x = BOUNDS.minX + 1; x < BOUNDS.maxX; x += G) {
    for (let z = BOUNDS.minZ + 1; z < BOUNDS.maxZ; z += G) {
      if (height(x, z) < 0.95) continue
      const a = at(x, z); if (!a) continue
      for (const [dx, dz] of [[G, 0], [-G, 0], [0, G], [0, -G], [G, G], [G, -G], [-G, G], [-G, -G]] as const) {
        const qx = x + dx, qz = z + dz
        if (height(qx, qz) < 0.95) continue       // walkable-to-walkable steps only
        const b = at(qx, qz); if (!b) continue
        samples++
        const rise = b.top - a.top                // stair cells -> stairLimit
        const vis = height(qx, qz) - height(x, z) // visible terrain rise over this step
        if (rise > stairLimit) {
          blocked++
          maxRise = Math.max(maxRise, rise)
          worstAll.push({ x: qx, z: qz, rise, vis })
          if (rise - vis > 0.2) { invis++; worstInvis.push({ x: qx, z: qz, rise, vis }) }
        }
      }
    }
  }
  worstInvis.sort((p, q) => q.rise - p.rise)
  worstAll.sort((p, q) => q.rise - p.rise)
  // navgraph route scan: every edge walked at 0.5m steps
  const wpById = new Map(data.waypoints.map(w => [w.id, w]))
  let badEdges = 0, edgeSteps = 0
  let worstEdge: { a: string; b: string; rise: number; x: number; z: number } | null = null
  for (const [ia, ib] of data.waypointEdges) {
    const A = wpById.get(ia), B = wpById.get(ib)
    if (!A || !B) continue
    const len = Math.hypot(B.x - A.x, B.z - A.z)
    let prev = A
    let bad = false
    for (let t = 0.5; t <= len; t += 0.5) {
      const k = Math.min(1, t / len)
      const cur = { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k }
      const ca = at(prev.x, prev.z), cb = at(cur.x, cur.z)
      if (ca && cb) {
        edgeSteps++
        const rise = cb.top - ca.top
        if (rise > stairLimit) {
          bad = true
          if (!worstEdge || rise > worstEdge.rise) worstEdge = { a: ia, b: ib, rise, x: cur.x, z: cur.z }
        }
      }
      prev = cur
    }
    if (bad) badEdges++
  }
  const estMB = ((cells.length + los) * perBoxBytes / 1e6).toFixed(2)
  console.log(`\n== ${label} ==`)
  console.log(`  colBoxes: ${cells.length} (fine ${fine}, committed-coarse ${coarse})  losBoxes: ${los} (committed)  ~json ${estMB} MB`)
  console.log(`  walkable steps sampled: ${samples}`)
  console.log(`  BLOCKED (rise > ${stairLimit} stair limit): ${blocked}  INVISIBLE (rise > visual+0.2): ${invis}  maxRise ${maxRise.toFixed(2)}`)
  console.log(`  navgraph: ${badEdges} edges blocked of ${data.waypointEdges.length}${worstEdge ? ` — worst ${worstEdge.rise.toFixed(2)}m on ${worstEdge.a}->${worstEdge.b} @ (${worstEdge.x.toFixed(1)}, ${worstEdge.z.toFixed(1)})` : ''}`)
  if (worstInvis.length) {
    console.log('  worst INVISIBLE leftovers (should all be honest cliffs => check vis ≈ rise):')
    for (const w of worstInvis.slice(0, 5)) console.log(`    rise ${w.rise.toFixed(2)} vis ${w.vis.toFixed(2)} @ (${w.x.toFixed(1)}, ${w.z.toFixed(1)}) h=${height(w.x, w.z).toFixed(1)}`)
  }
  if (worstAll.length) {
    console.log('  worst blocked (any):')
    for (const w of worstAll.slice(0, 4)) console.log(`    rise ${w.rise.toFixed(2)} vis ${w.vis.toFixed(2)} @ (${w.x.toFixed(1)}, ${w.z.toFixed(1)}) h=${height(w.x, w.z).toFixed(1)}`)
  }
}

console.log(`current emitted: boxes=${data.boxes.length} losBoxes=${data.losBoxes.length} json=${(jsonBytes / 1e6).toFixed(2)} MB (${perBoxBytes.toFixed(0)} B/box)`)
scan({ varFine: 0.9, varDeep: 0.9, deepMin: -2.5 }, 'C0 current shipped (no flag, limit 0.55)', 0.55)
scan({ varFine: 0.5, varDeep: 0.9, deepMin: -2.5 }, 'FINAL candidate (fine 0.5 + flag limit 0.95)', 0.95)
scan({ varFine: 0.35, varDeep: 0.9, deepMin: -2.5 }, 'fallback (fine 0.35 + flag limit 0.95)', 0.95)
