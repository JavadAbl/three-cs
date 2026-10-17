const { AIMHEAD } = await import('/home/z/my-project/src/game/map-aimhead.ts')
const wps = AIMHEAD.waypoints
const byId = new Map(wps.map(w => [w.id, w]))
const adj = new Map<string, string[]>()
for (const [a, b] of AIMHEAD.waypointEdges as Array<[string, string]>) {
  if (!adj.has(a)) adj.set(a, [])
  if (!adj.has(b)) adj.set(b, [])
  adj.get(a)!.push(b); adj.get(b)!.push(a)
}
// nearest wp to each team's spawn centroid
const ctC = AIMHEAD.spawns.CT.reduce((a, s) => [a[0] + s.x / 10, a[1] + s.z / 10], [0, 0])
const tC = AIMHEAD.spawns.T.reduce((a, s) => [a[0] + s.x / 10, a[1] + s.z / 10], [0, 0])
const near = (px: number, pz: number) => wps.reduce((b, w) => Math.hypot(w.x - px, w.z - pz) < Math.hypot(b.x - px, b.z - pz) ? w : b, wps[0])
const a = near(ctC[0], ctC[1]), b = near(tC[0], tC[1])
console.log(`CT spawn wp: ${a.id} (${a.x.toFixed(1)},${a.z.toFixed(1)},y=${a.y.toFixed(2)})  T spawn wp: ${b.id} (${b.x.toFixed(1)},${b.z.toFixed(1)},y=${b.y.toFixed(2)})`)
// BFS a → b
const prev = new Map<string, string>()
const q = [a.id], seen = new Set([a.id])
while (q.length) {
  const c = q.shift()!
  if (c === b.id) break
  for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); prev.set(n, c); q.push(n) }
}
if (!seen.has(b.id)) { console.log('CT→T: NOT REACHABLE ✗'); process.exit(1) }
const path = [b.id]
let c = b.id
while (prev.has(c)) { c = prev.get(c)!; path.unshift(c) }
console.log(`CT→T: reachable ✓ path length=${path.length} hops`)
console.log('  path sample:', path.slice(0, 8).join(' → '), '...', path.slice(-4).join(' → '))
// path hop heights
const hs = path.map(id => byId.get(id)!.y)
console.log('  y along path:', hs.filter((_, i) => i % 8 === 0).map(y => y.toFixed(1)).join(' '))
