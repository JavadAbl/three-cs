// Multi-map live bot test: bots must navigate without clipping solids or getting stuck,
// CTs must rotate (B doors / cat), rounds/kills/plants must flow.
// Usage: bun scripts/test-map-live.ts [dust2|dust] [seconds]
import { io } from 'socket.io-client'
import { MAPS } from '../mini-services/game-server/mapdata'
import type { MapId } from '../mini-services/game-server/mapdata'

const mapId = ((process.argv[2] as MapId) === 'dust' ? 'dust' : 'dust2') as MapId
const RUN_MS = Number(process.argv[3] ?? 90000)
const def = MAPS[mapId]
const sock = io('http://localhost:3003', { path: '/' })
const room = `livetest-${mapId}-${Math.floor(Math.random() * 1e6)}`

interface P { id: string; name: string; x: number; y: number; z: number; team: string; alive: number; bot: number }
const players = new Map<string, P>()
const stuckTimes = new Map<string, number>()
const siteVisits = new Set<string>()
const zoneVisits = { mid: new Set<string>(), long: new Set<string>(), tunnels: new Set<string>(), cat: new Set<string>(), bDoors: new Set<string>() }
let kills = 0, rounds = 0, plants = 0, clipCount = 0

// per-map zone boxes for route-usage stats (x0, x1, z0, z1)
const ZONES: Record<string, Array<[number, number, number, number]>> = {
  dust2: {
    mid: [[-4, 8, -12, 26]],
    long: [[34, 44, -12, 18]],
    tunnels: [[-26, -18, -14, 26]],
    cat: [[16, 22, -32, -10]],
    bDoors: [[-20, -10, -36, -30]],
  },
  dust: {
    mid: [[-6, 8, -9, 30]],
    long: [[30, 48, -26, 8]],
    tunnels: [[-34, -26, -16, 24]],
    cat: [[12, 17, -26, -13]],
    bDoors: [[-22, -14, -27, -21]],
  },
}

function insideSolid(p: P): boolean {
  // feet tolerance 0.5 (stairs), head 1.7
  for (const b of def.losBoxes) {
    if (p.x + 0.3 > b.x - b.w / 2 && p.x - 0.3 < b.x + b.w / 2 &&
        p.y + 1.7 > b.y - b.h / 2 && p.y + 0.5 < b.y + b.h / 2 &&
        p.z + 0.3 > b.z - b.d / 2 && p.z - 0.3 < b.z + b.d / 2) return true
  }
  return false
}

sock.on('connect', () => {
  console.log(`connected: map=${mapId} room=${room}`)
  sock.emit('join', { name: 'Observer', room, team: 'CT', map: mapId, botFill: true, botDifficulty: 'normal', winTarget: 4 })
})

sock.on('init', (d: { mapId?: string }) => {
  if (d.mapId && d.mapId !== mapId) console.log(`WARN server map is ${d.mapId}, expected ${mapId}`)
})

sock.on('snapshot', (d: { ps: unknown[][] }) => {
  for (const row of d.ps) {
    const p: P = {
      id: row[0] as string, name: row[15] as string, x: row[1] as number, y: row[2] as number,
      z: row[3] as number, team: row[16] as string, alive: row[12] as number, bot: row[17] as number,
    }
    if (!p.bot) continue
    const prev = players.get(p.id)
    if (p.alive) {
      const movingFlag = (row[7] as number) === 1
      if (prev && movingFlag && Math.hypot(p.x - prev.x, p.z - prev.z) < 0.05) {
        const s = (stuckTimes.get(p.id) ?? 0) + 0.1
        stuckTimes.set(p.id, s)
        if (s > 1.5 && s % 1 < 0.15) console.log(`STUCK ${p.name} (${p.team}) at (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`)
      } else {
        stuckTimes.set(p.id, 0)
      }
    }
    const moving = (row[7] as number) === 1
    if (p.alive && moving && insideSolid(p)) {
      clipCount++
      if (clipCount % 10 === 1) console.log(`CLIP(moving) ${p.name} (${p.team}) at (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`)
    }
    // zone usage
    for (const [zone, boxes] of Object.entries(ZONES[mapId])) {
      for (const [x0, x1, z0, z1] of boxes) {
        if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1) (zoneVisits as Record<string, Set<string>>)[zone].add(p.name)
      }
    }
    if (Math.hypot(p.x - def.sites.A.x, p.z - def.sites.A.z) < def.sites.A.r + 1 || Math.hypot(p.x - def.sites.B.x, p.z - def.sites.B.z) < def.sites.B.r + 1) siteVisits.add(p.name)
    players.set(p.id, p)
  }
})

sock.on('kill', (d: { killerName: string; victimName: string; weapon: string }) => {
  kills++
  if (kills <= 12) console.log(`KILL: ${d.killerName || 'world'} -> ${d.victimName} (${d.weapon})`)
})
sock.on('round', (d: { phase: string; round: number; scores: { CT: number; T: number } }) => {
  if (d.phase === 'live') { rounds++; console.log(`ROUND ${d.round} LIVE  CT:${d.scores.CT} T:${d.scores.T}`) }
})
sock.on('bomb', (d: { planted?: boolean }) => {
  if (d.planted) { plants++; console.log('BOMB PLANTED') }
})

setTimeout(() => {
  console.log(`\n============ RESULTS (${mapId}) ============`)
  console.log(`rounds live: ${rounds}, kills: ${kills}, plants: ${plants}`)
  console.log(`bot-in-solid samples: ${clipCount} (0 or near-0 expected)`)
  for (const [zone, set] of Object.entries(zoneVisits)) {
    console.log(`${zone}: ${set.size} distinct bots`)
  }
  console.log(`distinct bots reaching a site: ${siteVisits.size}`)
  const stuck = [...stuckTimes.entries()].filter(([, v]) => v > 3)
  console.log(`stuck bots (>3s): ${stuck.length}`)
  const ok = clipCount <= 2 && stuck.length === 0 && siteVisits.size >= 3 && rounds >= 1
  console.log(ok ? 'BOT TEST PASSED' : 'BOT TEST FAILED')
  process.exit(ok ? 0 : 1)
}, RUN_MS)
