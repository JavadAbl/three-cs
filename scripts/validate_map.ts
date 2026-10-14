// Map v4 validation: bot path clearance, spawn clearance, window vault, connectivity
import { MAP_BOXES, LOS_BOXES, WAYPOINTS, WAYPOINT_EDGES, SPAWNS } from '../mini-services/game-server/dust2'

const R = 0.35      // bot radius
const FEET_TOL = 0.5 // allow feet to sink this far into steps (bots lerp y on stairs)
const H = 1.7

function solidAt(x: number, y0: number, y1: number, z: number): boolean {
  for (const b of LOS_BOXES) {
    if (x + R > b.x - b.w / 2 && x - R < b.x + b.w / 2 &&
        y1 > b.y - b.h / 2 && y0 < b.y + b.h / 2 &&
        z + R > b.z - b.d / 2 && z - R < b.z + b.d / 2) return true
  }
  return false
}

let fails = 0

// --- waypoint nodes must be clear ---
for (const w of WAYPOINTS) {
  if (solidAt(w.x, w.y + FEET_TOL, w.y + H, w.z)) {
    console.log(`FAIL node ${w.id} (${w.x},${w.y},${w.z}) inside solid`)
    fails++
  }
}

// --- edges must be walkable ---
const byId = new Map(WAYPOINTS.map(w => [w.id, w]))
for (const [a, b] of WAYPOINT_EDGES) {
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
for (const [team, list] of Object.entries(SPAWNS)) {
  for (const s of list) {
    if (solidAt(s.x, s.y + 0.1, s.y + H, s.z)) { console.log(`FAIL ${team} spawn (${s.x},${s.z}) blocked`); fails++ }
    else console.log(`ok ${team} spawn (${s.x},${s.z})`)
  }
}

// --- window vault: crouched body crossing the window plane at z=-17.5 ---
{
  const clear = !solidAt(-6.5, 1.05, 2.35, -17.5) // feet on sill (y1.0), crouch height 1.3
  if (!clear) { console.log('FAIL window vault blocked'); fails++ } else console.log('ok window vault passable (crouch)')
}

// --- connectivity: every waypoint reachable from tspawn ---
{
  const adj = new Map<string, string[]>()
  for (const [a, b] of WAYPOINT_EDGES) {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b); adj.get(b)!.push(a)
  }
  const seen = new Set(['tspawn'])
  const q = ['tspawn']
  while (q.length) { const c = q.shift()!; for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) } }
  for (const w of WAYPOINTS) if (!seen.has(w.id)) { console.log(`FAIL waypoint ${w.id} unreachable`); fails++ }
  console.log(`connectivity: ${seen.size}/${WAYPOINTS.length} reachable`)
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
