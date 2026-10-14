// Map v4 live test: bots must navigate without clipping solids or getting stuck,
// CTs must rotate to B (new B-doors route), rounds/kills/plants must flow.
import { io } from 'socket.io-client'
import { LOS_BOXES } from '../mini-services/game-server/dust2'

const sock = io('http://localhost:3003', { path: '/' })
const room = 'v4test-' + Math.floor(Math.random() * 1e6)

interface P { id: string; name: string; x: number; y: number; z: number; team: string; alive: number; bot: number }
const players = new Map<string, P>()
const stuckTimes = new Map<string, number>()
const visitedBDoors = new Set<string>() // CTs that entered B doors corridor x -22..-14 z -27..-21
const visitedWindow = new Set<string>() // anyone in window corridor z -19..-16 x -24..-8
const siteVisits = new Set<string>()    // bot id -> visited A or B site
let kills = 0, rounds = 0, plants = 0, clipCount = 0

function insideSolid(p: P): boolean {
  // feet tolerance 0.5 (stairs), head 1.7
  for (const b of LOS_BOXES) {
    if (p.x + 0.3 > b.x - b.w / 2 && p.x - 0.3 < b.x + b.w / 2 &&
        p.y + 1.7 > b.y - b.h / 2 && p.y + 0.5 < b.y + b.h / 2 &&
        p.z + 0.3 > b.z - b.d / 2 && p.z - 0.3 < b.z + b.d / 2) return true
  }
  return false
}

sock.on('connect', () => {
  console.log('connected to room', room)
  sock.emit('join', { name: 'Observer', room, team: 'CT', botFill: true, botDifficulty: 'normal', winTarget: 8 })
})

sock.on('snapshot', (d: { ps: unknown[][] }) => {
  for (const row of d.ps) {
    const p: P = {
      id: row[0] as string, name: row[15] as string, x: row[1] as number, y: row[2] as number,
      z: row[3] as number, team: row[16] as string, alive: row[12] as number, bot: row[17] as number,
    }
    if (!p.bot) continue
    const prev = players.get(p.id)
    // stuck detection: alive, moved < 0.05 over 3s
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
    // clip detection (only while walking = real pathing issue; standing clips are cosmetic combat strafe)
    const moving = (row[7] as number) === 1
    if (p.alive && moving && insideSolid(p)) {
      clipCount++
      if (clipCount % 10 === 1) console.log(`CLIP(moving) ${p.name} (${p.team}) at (${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`)
    }
    // route usage
    if (p.team === 'CT' && p.x > -22 && p.x < -14 && p.z > -27 && p.z < -21) visitedBDoors.add(p.name)
    if (p.x > -24 && p.x < -8 && p.z > -19 && p.z < -16) visitedWindow.add(p.name)
    if (Math.hypot(p.x - 27, p.z - -33) < 9 || Math.hypot(p.x - -34, p.z - -29) < 9) siteVisits.add(p.name)
    players.set(p.id, p)
  }
})

sock.on('kill', (d: { killerName: string; victimName: string; weapon: string }) => {
  kills++
  if (kills <= 15) console.log(`KILL: ${d.killerName || 'world'} -> ${d.victimName} (${d.weapon})`)
})
sock.on('round', (d: { phase: string; round: number; scores: { CT: number; T: number } }) => {
  if (d.phase === 'live') { rounds++; console.log(`ROUND ${d.round} LIVE  CT:${d.scores.CT} T:${d.scores.T}`) }
})
sock.on('bomb', (d: { planted?: boolean; exploded?: boolean; defused?: boolean }) => {
  if (d.planted) { plants++; console.log('BOMB PLANTED') }
  else console.log('bomb:', JSON.stringify(d))
})
sock.on('toast', (d: { msg: string }) => { if (d.msg.includes('bomb')) console.log('toast:', d.msg) })

setTimeout(() => {
  console.log('\n================ RESULTS ================')
  console.log(`rounds live: ${rounds}, kills: ${kills}, plants: ${plants}`)
  console.log(`bot-in-solid samples: ${clipCount} (0 or near-0 expected)`)
  console.log(`CT bots used B doors: ${[...visitedBDoors].join(', ') || 'NONE'}`)
  console.log(`players in window corridor: ${[...visitedWindow].join(', ') || 'none (bots do not use window — humans only)'}`)
  console.log(`distinct bots reaching a site: ${siteVisits.size}`)
  const stuck = [...stuckTimes.entries()].filter(([, v]) => v > 3)
  console.log(`stuck bots (>3s): ${stuck.length}`)
  process.exit(0)
}, 75000)
