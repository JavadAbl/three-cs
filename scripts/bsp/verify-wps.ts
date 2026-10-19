// every waypoint must have collision support at/near its y
const { AIMHEAD } = await import('/home/z/my-project/src/game/map-aimhead.ts')
const boxes = AIMHEAD.boxes as Array<{ x: number; y: number; z: number; w: number; h: number; d: number }>
const R = 0.4
let ok = 0, bad: Array<any> = []
for (const w of AIMHEAD.waypoints) {
  let best: number | null = null
  for (const b of boxes) {
    if (w.x + R > b.x - b.w / 2 && w.x - R < b.x + b.w / 2 && w.z + R > b.z - b.d / 2 && w.z - R < b.z + b.d / 2) {
      const t = b.y + b.h / 2
      if (t <= w.y + 0.1 && (best === null || t > best)) best = t
    }
  }
  if (best !== null && w.y - best <= 0.3) ok++
  else bad.push({ id: w.id, y: w.y, best })
}
console.log(`waypoints with floor support: ${ok}/${AIMHEAD.waypoints.length}`)
if (bad.length) console.log('unsupported (first 10):', bad.slice(0, 10))
// graph connectivity: BFS from a CT-side wp must reach T side
const adj = new Map<string, string[]>()
for (const [a, b] of AIMHEAD.waypointEdges as Array<[string, string]>) {
  if (!adj.has(a)) adj.set(a, [])
  if (!adj.has(b)) adj.set(b, [])
  adj.get(a)!.push(b); adj.get(b)!.push(a)
}
const ctWp = AIMHEAD.waypoints.filter(w => w.x < -20).sort((a, b) => b.x - a.x)[0]
const tWp = AIMHEAD.waypoints.filter(w => w.x > 20).sort((a, b) => a.x - b.x)[0]
const seen = new Set([ctWp.id])
const q = [ctWp.id]
while (q.length) {
  const c = q.shift()!
  for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n) }
}
console.log(`BFS from CT wp ${ctWp.id} (${ctWp.x.toFixed(1)},${ctWp.z.toFixed(1)}): reached ${seen.size}/${AIMHEAD.waypoints.length} nodes; T-side reachable: ${seen.has(tWp.id)} (${tWp.id})`)
// largest connected component
const comps: Array<Set<string>> = []
const all = new Set(AIMHEAD.waypoints.map(w => w.id))
for (const w of all) {
  if (comps.some(c => c.has(w))) continue
  const s = new Set([w]); const qq = [w]
  while (qq.length) { const c = qq.shift()!; for (const n of adj.get(c) ?? []) if (!s.has(n)) { s.add(n); qq.push(n) } }
  comps.push(s)
}
comps.sort((a, b) => b.size - a.size)
console.log('connected components:', comps.slice(0, 5).map(c => c.size).join(', '), comps.length > 5 ? '...' : '')
