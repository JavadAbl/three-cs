// one-off debug: which waypoints are unreachable from CT spawn, and where?
import { MAPS } from '../../mini-services/game-server/mapdata'
const def = MAPS.island
const adj = new Map<string, string[]>()
for (const w of def.waypoints) adj.set(w.id, [])
for (const [a, b] of def.waypointEdges) { adj.get(a)?.push(b); adj.get(b)?.push(a) }
let start = def.waypoints[0], bd = 1e9
for (const w of def.waypoints) {
  const d = (w.x - def.spawns.CT[0].x) ** 2 + (w.z - def.spawns.CT[0].z) ** 2
  if (d < bd) { bd = d; start = w }
}
const seen = new Set([start.id])
const q = [start.id]
while (q.length) { const c = q.shift()!; for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) } }
const un = def.waypoints.filter(w => !seen.has(w.id))
console.log(`unreachable: ${un.length}`)
// cluster summary: round to 10m cells
const cells = new Map<string, number>()
for (const w of un) { const k = `${Math.round(w.x / 10) * 10},${Math.round(w.z / 10) * 10}`; cells.set(k, (cells.get(k) ?? 0) + 1) }
console.log([...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
// T spawn nearest WP id + whether it's in unreachable set
for (const sp of def.spawns.T) {
  let best = '', d0 = 1e9
  for (const w of def.waypoints) { const d = (w.x - sp.x) ** 2 + (w.z - sp.z) ** 2; if (d < d0) { d0 = d; best = w.id } }
  const wp = def.waypoints.find(w => w.id === best)!
  console.log(`T spawn (${sp.x.toFixed(1)},${sp.z.toFixed(1)}) -> ${best} (${wp.x.toFixed(1)},${wp.z.toFixed(1)},y${wp.y.toFixed(1)}) reachable=${seen.has(best)}`)
}
