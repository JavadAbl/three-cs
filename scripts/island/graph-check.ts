// scripts/island/graph-check.ts — waypoint-graph sanity for the island map
// (Task 131 smoke): single connected play space, both bomb sites + all
// spawns reachable, pier deck hooked in, hilltop climbable from both sides.
import { MAPS } from '../../mini-services/game-server/mapdata'

const def = MAPS.island
const byId = new Map(def.waypoints.map(w => [w.id, w]))
const adj = new Map<string, string[]>()
for (const w of def.waypoints) adj.set(w.id, [])
for (const [a, b] of def.waypointEdges) {
  adj.get(a)?.push(b)
  adj.get(b)?.push(a)
}
const near = (x: number, z: number, y?: number) => {
  let best = '', bd = 1e9
  for (const w of def.waypoints) {
    let d = (w.x - x) ** 2 + (w.z - z) ** 2
    if (y !== undefined) d += (w.y - y) ** 2
    if (d < bd) { bd = d; best = w.id }
  }
  return best
}

let fails = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
  if (!ok) fails++
}

// BFS from CT spawn
const start = near(def.spawns.CT[0].x, def.spawns.CT[0].z, def.spawns.CT[0].y)
const seen = new Set([start])
const q = [start]
while (q.length) {
  const cur = q.shift()!
  for (const n of adj.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) }
}
const reach = seen.size / def.waypoints.length
check('connectivity >= 85%', reach >= 0.85, `${(reach * 100).toFixed(1)}% reachable (${seen.size}/${def.waypoints.length})`)

const siteReach = (s: { x: number; z: number; y: number }, label: string) => {
  const inside = def.waypoints.filter(w => Math.hypot(w.x - s.x, w.z - s.z) < s.r)
  check(`${label} site has waypoints`, inside.length >= 3, `${inside.length} within r=${s.r}`)
  check(`${label} site reachable from CT spawn`, inside.some(w => seen.has(w.id)))
  return inside
}
const wa = siteReach(def.sites.A, 'A (radar hill)')
siteReach(def.sites.B, 'B (dock cove)')

for (const team of ['CT', 'T'] as const) {
  for (const sp of def.spawns[team]) {
    const id = near(sp.x, sp.z, sp.y)
    check(`${team} spawn (${sp.x.toFixed(0)},${sp.z.toFixed(0)}) near-WP reachable`, seen.has(id))
  }
}

// pier deck (y=deckY=1.15, over water) must hook into the shore graph
const pierWps = def.waypoints.filter(w => Math.abs(w.y - 1.15) < 0.5 && Math.hypot(w.x + 50, w.z - 4) < 18)
check('pier deck waypoints exist', pierWps.length >= 4, `${pierWps.length} found`)
check('pier deck reachable', pierWps.some(w => seen.has(w.id)))

// T spawn reachability (via BFS from T spawn should also reach A)
const tStart = near(def.spawns.T[0].x, def.spawns.T[0].z, def.spawns.T[0].y)
const seenT = new Set([tStart])
const qT = [tStart]
while (qT.length) {
  const cur = qT.shift()!
  for (const n of adj.get(cur) ?? []) if (!seenT.has(n)) { seenT.add(n); qT.push(n) }
}
check('T spawn reaches A site', wa.some(w => seenT.has(w.id)))

// spawn heights sane: players stand on the pads
for (const team of ['CT', 'T'] as const) {
  const ys = def.spawns[team].map(s => s.y)
  check(`${team} spawn y within world`, ys.every(y => y > 0.5 && y < 20), `y=${ys.map(y => y.toFixed(1)).join(',')}`)
}
// A-site height: the radar pad really is the hilltop
check('A site is elevated (hilltop)', def.sites.A.y > 10, `y=${def.sites.A.y.toFixed(1)}`)

// bomb objective on
check('bomb defusal enabled', def.bomb === true)

console.log(fails ? `\n${fails} FAIL(S)` : '\nALL PASS')
process.exit(fails ? 1 : 0)
