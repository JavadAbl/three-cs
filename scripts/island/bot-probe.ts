// Task 132 bugfix probe — dump live bot positions vs nearest ISLAND waypoint.
// Evidence harness for "bots fall into the ground when they start moving":
// if the server runs bots on the wrong graph (dust fallback), bot (x,y,z)
// drift toward dust2 coordinates and their y diverges from every island
// waypoint surface. Print a per-bot nearest-waypoint delta table.
import { io } from 'socket.io-client'
import data from '../../src/game/map-island-data.json'

const URL = 'http://localhost:3003'
const ROOM = 'island-probe-' + Math.random().toString(36).slice(2, 6)
const WPS = data.waypoints as Array<{ id: string; x: number; y: number; z: number }>
const sock = io(URL, { path: '/' })

let phase = ''
let dumped = 0

function nearest(x: number, z: number) {
  let best = WPS[0], bd = Infinity
  for (const w of WPS) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2
    if (d < bd) { bd = d; best = w }
  }
  return { w: best, d: Math.sqrt(bd) }
}

sock.on('connect', () => {
  sock.emit('join', { name: 'Probe', room: ROOM, team: 'CT', map: 'island', botFill: true, botDifficulty: 'easy', winTarget: 16 })
})
sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })
sock.on('round', (d: { phase: string }) => { phase = d.phase })
sock.on('snapshot', (d: { ps: unknown[][] }) => {
  if (phase !== 'live' || dumped >= 3) return
  // dump at 8s / 18s / 28s after live to see progression
  dumped++
  const bots = d.ps.filter(r => r[17] === 1 && r[12] === 1)
  console.log(`\n===== live dump ${dumped} (${bots.length} alive bots) =====`)
  console.log('id            team  x      y      z      | nearestWP   wpY    xyDist  |dy|')
  for (const r of bots as unknown[][]) {
    const id = String(r[0]).slice(0, 12)
    const team = r[15] as string
    const x = r[1] as number, y = r[2] as number, z = r[3] as number
    const n = nearest(x, z)
    const dy = Math.abs(y - n.w.y)
    console.log(
      `${id.padEnd(12)} ${String(team).padEnd(5)} ${x.toFixed(1).padStart(6)} ${y.toFixed(1).padStart(6)} ${z.toFixed(1).padStart(6)}  | ` +
      `${n.w.id.padEnd(8)} ${n.w.y.toFixed(1).padStart(5)} ${n.d.toFixed(1).padStart(6)}  ${dy.toFixed(2).padStart(5)}`)
  }
  if (dumped === 3) {
    console.log('\n(probe done — leave match)')
    sock.disconnect()
    setTimeout(() => process.exit(0), 500)
  }
})
setTimeout(() => { console.log('[timeout]'); process.exit(1) }, 60_000)
