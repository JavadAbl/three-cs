// Task 153 gate — Twin Villas static geometry verification.
// Everything checkable without a server:
//   1. waypoint nodes clear (bot capsule R .35 / feet tol .5 / H 1.7)
//   2. waypoint edges walkable (0.25-step sampling)
//   3. spawns clear, on the right side per team, pairwise >= 2.0 m apart
//   4. graph connected from 'tspawn' (every node reachable)
//   5. the FEATURE: aligned window lanes across the street are clear LOS
//      at eye height on every floor + door lane + basement tunnel lane
//   6. a control ray through a solid pier IS blocked (guard vs #5 vacuous)
//   7. windows are crouch-vaultable (sill 1.0 / lintel 2.6 openings)
//   8. 180° symmetry: every villa box has a mirrored twin
//   9. bomb === false, spawnYaw set, bounds sane
// Usage: bun scripts/twin/verify-twin.ts   (exit 0 = pass)
import { MAPS, rayHitsAABB } from '../../mini-services/game-server/mapdata'

const def = MAPS.twin
const R = 0.35, FEET_TOL = 0.5, H = 1.7
let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok || detail) console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` · ${detail}` : ''}`)
  ok ? pass++ : fail++
}
function solidAt(x: number, y0: number, y1: number, z: number): boolean {
  for (const b of def.losBoxes) {
    if (x + R > b.x - b.w / 2 && x - R < b.x + b.w / 2 &&
        y1 > b.y - b.h / 2 && y0 < b.y + b.h / 2 &&
        z + R > b.z - b.d / 2 && z - R < b.z + b.d / 2) return true
  }
  return false
}

console.log(`Twin Villas v${def.version}: ${def.boxes.length} boxes, ${def.waypoints.length} waypoints, ${def.waypointEdges.length} edges`)

// 1) nodes clear
{
  let bad = 0
  for (const w of def.waypoints) {
    if (solidAt(w.x, w.y + FEET_TOL, w.y + H, w.z)) { console.log(`  node ${w.id} (${w.x},${w.y},${w.z}) INSIDE SOLID`); bad++ }
  }
  check('waypoint nodes clear', bad === 0, `${def.waypoints.length} nodes`)
}

// 2) edges walkable
{
  let bad = 0
  const byId = new Map(def.waypoints.map(w => [w.id, w]))
  for (const [a, b] of def.waypointEdges) {
    const A = byId.get(a), B = byId.get(b)
    if (!A || !B) { console.log(`  edge ${a}-${b}: missing node`); bad++; continue }
    const len = Math.hypot(B.x - A.x, B.z - A.z)
    const steps = Math.max(2, Math.ceil(len / 0.25))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t, y = A.y + (B.y - A.y) * t
      if (solidAt(x, y + FEET_TOL, y + H, z)) {
        console.log(`  edge ${a}->${b} blocked near (${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)})`)
        bad++; break
      }
    }
  }
  check('waypoint edges walkable', bad === 0, `${def.waypointEdges.length} edges`)
}

// 3) spawns: clear + side + pairwise spacing
{
  let bad = 0
  for (const [team, list] of Object.entries(def.spawns)) {
    const wantX = team === 'CT' ? -1 : 1
    for (const s of list) {
      if (solidAt(s.x, s.y + 0.1, s.y + H, s.z)) { console.log(`  ${team} spawn (${s.x},${s.z}) blocked`); bad++ }
      if (Math.sign(s.x) !== wantX) { console.log(`  ${team} spawn (${s.x},${s.z}) on WRONG side`); bad++ }
      if (Math.abs(s.y) > 0.01) { console.log(`  ${team} spawn y=${s.y} not on L0`); bad++ }
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z)
      if (d < 2.0) { console.log(`  ${team} spawns ${i},${j} only ${d.toFixed(2)}m apart`); bad++ }
    }
  }
  check('spawns clear + CT west / T east + >=2m apart', bad === 0, `${def.spawns.CT.length} CT + ${def.spawns.T.length} T`)
}

// 4) connectivity from tspawn
{
  const adj = new Map<string, string[]>()
  for (const [a, b] of def.waypointEdges) {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b); adj.get(b)!.push(a)
  }
  const seen = new Set(['tspawn']), q = ['tspawn']
  while (q.length) { const c = q.shift()!; for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) } }
  const missing = def.waypoints.filter(w => !seen.has(w.id)).map(w => w.id)
  check('graph fully connected from tspawn', missing.length === 0, `${seen.size}/${def.waypoints.length} reachable${missing.length ? ` · MISSING: ${missing.join(',')}` : ''}`)
}

// 5) the feature: aligned window/door/tunnel lanes are CLEAR at eye height
// (bot standing eye = floor + 1.5; same z on both facades by symmetry)
{
  const lanes: Array<[string, number, number]> = [
    ['L0 window z=-12', -12, 1.5], ['L0 window z=+12', 12, 1.5],
    ['ground door z=0', 0, 1.5],
    ['L1 window z=-12', -12, 3.4 + 1.5], ['L1 window z=0', 0, 3.4 + 1.5], ['L1 window z=+12', 12, 3.4 + 1.5],
    ['L2 window z=-12', -12, 6.8 + 1.5], ['L2 window z=0', 0, 6.8 + 1.5], ['L2 window z=+12', 12, 6.8 + 1.5],
  ]
  let bad = 0
  for (const [name, z, y] of lanes) {
    let hit = false
    for (const b of def.losBoxes) if (rayHitsAABB(-8.45, y, z, 1, 0, 0, b, 16.9)) { hit = true; break }
    if (hit) { console.log(`  lane ${name} (y ${y}) BLOCKED`); bad++ }
  }
  check('window duel lanes clear across the street', bad === 0, `${lanes.length} lanes at eye height`)
  // basement tunnel lane (eye = -3.2 + 1.5)
  let tunHit = false
  for (const b of def.losBoxes) if (rayHitsAABB(-7.9, -1.7, 0, 1, 0, 0, b, 15.8)) { tunHit = true; break }
  check('basement tunnel lane clear', !tunHit, 'full tunnel at eye height')
}

// 6) control: a ray through a solid pier must be BLOCKED (proves #5 isn't vacuous)
{
  let hit = false
  for (const b of def.losBoxes) if (rayHitsAABB(-5, 1.5, 6, -1, 0, 0, b, 7)) { hit = true; break }
  check('control ray through solid facade BLOCKED', hit, 'street -> west pier at z=6 (dir -x)')
}

// 7) windows crouch-vaultable (feet on sill 1.05, crouch top 2.35 < lintel 2.6)
{
  let bad = 0
  for (const x of [-8.45, 8.45]) for (const z of [-12, 12]) {
    if (solidAt(x, 1.05, 2.35, z)) { console.log(`  vault (${x},${z}) blocked`); bad++ }
  }
  check('ground windows crouch-vaultable', bad === 0, 'sill 1.0 .. lintel 2.6')
}

// 8) 180° symmetry: every box must have a mirrored counterpart (±0.01)
{
  const key = (x: number, y: number, z: number, w: number, h: number, d: number, t: string) =>
    `${t}|${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}|${w.toFixed(2)},${h.toFixed(2)},${d.toFixed(2)}`
  const set = new Set(def.boxes.map(b => key(b.x, b.y, b.z, b.w, b.h, b.d, b.tex)))
  const unmatched = def.boxes.filter(b => !set.has(key(-b.x, b.y, -b.z, b.w, b.h, b.d, b.tex)))
  check('180° box symmetry (west villa == east villa)', unmatched.length === 0,
    unmatched.length ? `${unmatched.length} unmatched (e.g. ${unmatched[0].tex} @ ${unmatched[0].x},${unmatched[0].z})` : 'all boxes mirror-paired')
}

// 9) registry semantics
{
  check('bomb disabled (elimination-only)', def.bomb === false)
  check('spawnYaw set (CT faces east, T west)',
    def.spawnYaw?.CT === -Math.PI / 2 && def.spawnYaw?.T === Math.PI / 2,
    `CT ${def.spawnYaw?.CT?.toFixed(2)} / T ${def.spawnYaw?.T?.toFixed(2)}`)
  check('bounds = two villas + street', def.bounds.minX === -28 && def.bounds.maxX === 28 && def.bounds.minZ === -20 && def.bounds.maxZ === 20)
  check('tspawn waypoint exists (validate/derive convention)', def.waypoints.some(w => w.id === 'tspawn'))
}

console.log(fail === 0 ? `\n${pass} passed, 0 failed` : `\n${pass} passed, ${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
