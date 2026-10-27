// Task 132 — offline validation of the derived island bot graph cfg.
// Imports the SAME deriveGraphCfg the server runs (mini-services/game-server/
// bots.ts) and proves, against the island data alone:
//   1. every emitted id exists in waypoints
//   2. plant nodes sit on their site pad (y-band + XZ inside r+3)
//   3. bfs connectivity: T-spawn area -> plantA / plantB / via nodes,
//      CT-spawn area -> every hold node
//   4. prints the picks for the worklog / review
// Exit 0 = the server's island GRAPHS entry is wired to a working cfg.
import { MAPS } from '../../mini-services/game-server/mapdata'
import { deriveGraphCfg } from '../../mini-services/game-server/bots'

const def = MAPS.island
const cfg = deriveGraphCfg(def)
const nodeById = new Map(def.waypoints.map(w => [w.id, w]))
const adj = new Map<string, string[]>()
for (const [a, b] of def.waypointEdges) {
  if (!adj.has(a)) adj.set(a, [])
  if (!adj.has(b)) adj.set(b, [])
  adj.get(a)!.push(b); adj.get(b)!.push(a)
}
const pos = (id: string) => nodeById.get(id)!

function bfs(from: string, to: string): number {
  if (from === to) return 0
  const prev = new Map<string, string>()
  const q = [from]
  const seen = new Set([from])
  while (q.length) {
    const c = q.shift()!
    for (const nx of adj.get(c) ?? []) {
      if (seen.has(nx)) continue
      seen.add(nx); prev.set(nx, c)
      if (nx === to) {
        let n = 1, k = to
        while (prev.has(k)) { k = prev.get(k)!; n++ }
        return n - 1
      }
      q.push(nx)
    }
  }
  return -1
}

const allIds = [
  ...cfg.aHold, ...cfg.bHold, ...cfg.midHold,
  cfg.tHoldA, cfg.tHoldB, cfg.plantA, cfg.plantB,
  ...cfg.aRoutes.flat(), ...cfg.bRoutes.flat(),
]
let fails = 0
const missing = allIds.filter(id => !nodeById.has(id))
if (missing.length) { console.log(`FAIL: unknown node ids: ${missing.join(',')}`); fails++ }

const near = (x: number, z: number) => {
  let best = def.waypoints[0], bd = Infinity
  for (const w of def.waypoints) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2
    if (d < bd) { bd = d; best = w }
  }
  return best
}
const tNode = near(...(def.spawns.T.reduce(([ax, az], p) => [ax + p.x / 5, az + p.z / 5], [0, 0]) as [number, number]))
const ctNode = near(...(def.spawns.CT.reduce(([ax, az], p) => [ax + p.x / 5, az + p.z / 5], [0, 0]) as [number, number]))

console.log('== derived island cfg ==')
const show = (id: string) => {
  const w = pos(id)
  return `${id} (${w.x.toFixed(1)}, ${w.y.toFixed(1)}, ${w.z.toFixed(1)})`
}
console.log(`plantA  ${show(cfg.plantA)}   site A: (${def.sites.A.x}, y${def.sites.A.y}, r${def.sites.A.r})`)
console.log(`plantB  ${show(cfg.plantB)}   site B: (${def.sites.B.x}, y${def.sites.B.y}, r${def.sites.B.r})`)
console.log(`aHold   ${cfg.aHold.map(show).join(' | ')}`)
console.log(`bHold   ${cfg.bHold.map(show).join(' | ')}`)
console.log(`midHold ${cfg.midHold.map(show).join(' | ')}`)
console.log(`tHoldA  ${show(cfg.tHoldA)}`)
console.log(`tHoldB  ${show(cfg.tHoldB)}`)
console.log(`aRoutes ${cfg.aRoutes.map(r => r.map(show).join(' -> ')).join('  |  ')}`)
console.log(`bRoutes ${cfg.bRoutes.map(r => r.map(show).join(' -> ')).join('  |  ')}`)

// plant nodes must be on the pad
for (const [id, site] of [[cfg.plantA, def.sites.A], [cfg.plantB, def.sites.B]] as const) {
  const w = pos(id)
  const dxz = Math.hypot(w.x - site.x, w.z - site.z)
  const dy = Math.abs(w.y - site.y)
  const ok = dxz <= site.r + 3 && dy <= 2.5
  console.log(`${ok ? 'PASS' : 'FAIL'} plant ${id}: dXZ=${dxz.toFixed(1)}m dy=${dy.toFixed(2)}m`)
  if (!ok) fails++
}

// connectivity: T reaches both plants + route vias; CT reaches all holds
const tTargets = [cfg.plantA, cfg.plantB, ...cfg.aRoutes.map(r => r[0]), ...cfg.bRoutes.map(r => r[0])]
const ctTargets = [...cfg.aHold, ...cfg.bHold, ...cfg.midHold]
for (const t of tTargets) {
  const hops = bfs(tNode.id, t)
  const ok = hops >= 0
  console.log(`${ok ? 'PASS' : 'FAIL'} T ${tNode.id} -> ${t}: ${hops} hops`)
  if (!ok) fails++
}
for (const t of ctTargets) {
  const hops = bfs(ctNode.id, t)
  const ok = hops >= 0
  console.log(`${ok ? 'PASS' : 'FAIL'} CT ${ctNode.id} -> ${t}: ${hops} hops`)
  if (!ok) fails++
}
console.log(fails === 0 ? '\nALL PASS — island cfg valid' : `\n${fails} FAILURES`)
process.exit(fails === 0 ? 0 : 1)
