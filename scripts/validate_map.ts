// Multi-map validation: bot path clearance, spawn clearance, map-specific vaults, connectivity
import { MAPS, MAP_LIST } from '../mini-services/game-server/mapdata'

const R = 0.35      // bot radius
const FEET_TOL = 0.5 // allow feet to sink this far into steps (bots lerp y on stairs)
const H = 1.7

function makeSolidAt(los: Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>) {
  return (x: number, y0: number, y1: number, z: number): boolean => {
    for (const b of los) {
      if (x + R > b.x - b.w / 2 && x - R < b.x + b.w / 2 &&
          y1 > b.y - b.h / 2 && y0 < b.y + b.h / 2 &&
          z + R > b.z - b.d / 2 && z - R < b.z + b.d / 2) return true
    }
    return false
  }
}

// map-specific crouch-vault windows: [x, z, feetY, ceilY]
const VAULTS: Record<string, Array<[number, number, number, number]>> = {
  dust: [[-6.5, -17.5, 1.05, 2.35]],
  dust2: [[0, -22, 1.05, 2.35]],
}

let totalFails = 0
for (const { id } of MAP_LIST) {
  const def = MAPS[id]
  const solidAt = makeSolidAt(def.losBoxes)
  let fails = 0
  console.log(`\n===== MAP ${def.name} (v${def.version}, ${def.boxes.length} boxes) =====`)

  // --- waypoint nodes must be clear ---
  for (const w of def.waypoints) {
    if (solidAt(w.x, w.y + FEET_TOL, w.y + H, w.z)) {
      console.log(`FAIL node ${w.id} (${w.x},${w.y},${w.z}) inside solid`)
      fails++
    }
  }

  // --- edges must be walkable ---
  const byId = new Map(def.waypoints.map(w => [w.id, w]))
  for (const [a, b] of def.waypointEdges) {
    const A = byId.get(a), B = byId.get(b)
    if (!A || !B) { console.log(`FAIL edge ${a}-${b}: missing node`); fails++; continue }
    const len = Math.hypot(B.x - A.x, B.z - A.z)
    const steps = Math.max(2, Math.ceil(len / 0.25))
    let blocked = false
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = A.x + (B.x - A.x) * t
      const z = A.z + (B.z - A.z) * t
      const y = A.y + (B.y - A.y) * t
      if (solidAt(x, y + FEET_TOL, y + H, z)) { blocked = true; console.log(`FAIL edge ${a}->${b} blocked near (${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`); fails++; break }
    }
    if (!blocked) console.log(`ok edge ${a}->${b}`)
  }

  // --- spawns clear ---
  for (const [team, list] of Object.entries(def.spawns)) {
    for (const s of list) {
      if (solidAt(s.x, s.y + 0.1, s.y + H, s.z)) { console.log(`FAIL ${team} spawn (${s.x},${s.z}) blocked`); fails++ }
      else console.log(`ok ${team} spawn (${s.x},${s.z})`)
    }
  }

  // --- vault windows ---
  for (const [x, z, fy, cy] of VAULTS[id] ?? []) {
    const clear = !solidAt(x, fy, cy, z) // feet on sill (y1.0), crouch height 1.3
    if (!clear) { console.log(`FAIL vault window at (${x},${z}) blocked`); fails++ } else console.log(`ok vault window at (${x},${z}) passable (crouch)`)
  }

  // --- connectivity: every waypoint reachable from tspawn ---
  {
    const adj = new Map<string, string[]>()
    for (const [a, b] of def.waypointEdges) {
      if (!adj.has(a)) adj.set(a, [])
      if (!adj.has(b)) adj.set(b, [])
      adj.get(a)!.push(b); adj.get(b)!.push(a)
    }
    const seen = new Set(['tspawn'])
    const q = ['tspawn']
    while (q.length) { const c = q.shift()!; for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) } }
    for (const w of def.waypoints) if (!seen.has(w.id)) { console.log(`FAIL waypoint ${w.id} unreachable`); fails++ }
    console.log(`connectivity: ${seen.size}/${def.waypoints.length} reachable`)
  }

  console.log(fails === 0 ? `MAP ${def.name}: ALL CHECKS PASSED` : `MAP ${def.name}: ${fails} FAILURES`)
  totalFails += fails
}

console.log(totalFails === 0 ? '\nALL MAPS PASSED' : `\n${totalFails} TOTAL FAILURES`)
process.exit(totalFails === 0 ? 0 : 1)
