// E2E test for the Twin Villas map (Task 153 — two facing villas, window
// duels, basement tunnel, NO bomb).
// - join a twin room with bots
// - verify: server serves twin, CT spawns inside the WEST villa, round flow
//   freeze→live, bots navigate (street + doors), bots CLIMB to L1 (stair
//   core works), bots take the BASEMENT tunnel (min y < -2.5), nobody ever
//   carries the C4 (elimination-only), no bot clips solids, bots stay on
//   surfaces (multi-floor ground-follow).
import { io } from 'socket.io-client'
import { MAPS } from '../../mini-services/game-server/mapdata'

const URL = process.env.GAME_URL ?? 'http://localhost:3003'
const ROOM = 'twin-test-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })
const def = MAPS.twin

let myId = ''
let phase = ''
let roundNo = 0
let spawnCheck = ''
let results: Record<string, string> = {}
let finished = false
let movedBots = 0
let lastBotPos = new Map<string, [number, number]>()
let maxY = -99, minY = 99           // multi-floor reach evidence
let bombCarrierSeen = false
let clipCount = 0
let worstDy = 0, dySamples = 0

const WPS = def.waypoints
function nearestWpY(x: number, z: number, y: number): number | null {
  // y-banded nearest (a waypoint directly above/below must not mask a sink)
  let best: number | null = null, bd = Infinity
  for (const w of WPS) {
    if (Math.abs(w.y - y) > 2.0) continue
    const d = (w.x - x) ** 2 + (w.z - z) ** 2
    if (d < bd) { bd = d; best = w.y }
  }
  return bd < 144 ? best : null   // within 12 m of some waypoint
}

function insideSolid(x: number, y: number, z: number): boolean {
  for (const b of def.losBoxes) {
    if (x + 0.3 > b.x - b.w / 2 && x - 0.3 < b.x + b.w / 2 &&
        y + 1.7 > b.y - b.h / 2 && y + 0.5 < b.y + b.h / 2 &&
        z + 0.3 > b.z - b.d / 2 && z - 0.3 < b.z + b.d / 2) return true
  }
  return false
}

function done(k: string, ok: boolean, msg: string) { results[k] = (ok ? 'PASS' : 'FAIL') + ' — ' + msg }
const NEED = ['map-served', 'spawn-in-west-villa', 'round-flow', 'bots-move', 'bots-climb-l1', 'bots-tunnel', 'no-bomb', 'no-clip', 'bots-on-surface']
function finish() {
  if (finished) return
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(22)} ${v}`)
  const allPass = NEED.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'INCOMPLETE/FAILED', '=====')
  sock.disconnect()
  process.exit(allPass ? 0 : 1)
}

// watchdog: whatever happened after 150s, report
setTimeout(() => { console.log('[timeout] results so far'); finish() }, 150_000)

sock.on('connect', () => {
  console.log(`connected: room=${ROOM}`)
  sock.emit('join', { name: 'TwinTester', room: ROOM, team: 'CT', map: 'twin', botFill: true, botDifficulty: 'easy', winTarget: 6 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })

sock.on('init', (d: { youId: string; team: string; mapId: string; players: unknown[]; match: { phase: string } }) => {
  myId = d.youId
  console.log(`[init] map=${d.mapId} team=${d.team} players=${d.players.length} phase=${d.match.phase}`)
  if (d.mapId === 'twin') done('map-served', true, 'server served twin map')
  else { done('map-served', false, `got map ${d.mapId}`); finish() }
})

sock.on('round', (d: { phase: string; round: number; roundWinner: string | null }) => {
  if (phase === 'freeze' && d.phase === 'live' && !results['round-flow']) {
    done('round-flow', true, 'freeze → live transition observed')
  }
  if (d.phase !== phase) console.log(`[round] phase=${d.phase} round=${d.round} winner=${d.roundWinner ?? '-'}`)
  phase = d.phase
  if (d.round) roundNo = d.round
})

sock.on('snapshot', (d: { ps: unknown[][] }) => {
  for (const row of d.ps) {
    const id = row[0] as string
    const x = row[1] as number, y = row[2] as number, z = row[3] as number
    const alive = row[12] === 1
    if (row[13] === 1) bombCarrierSeen = true   // hasBomb — must NEVER be set on twin
    if (id === myId && alive && !spawnCheck && phase === 'freeze') {
      spawnCheck = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`
      const inVilla = x < -8.9 && x > -28 && Math.abs(z) < 19
      const onL0 = y > -0.5 && y < 1.0
      done('spawn-in-west-villa', inVilla && onL0,
        `pos=(${spawnCheck}) ${inVilla ? 'west villa' : 'OUTSIDE VILLA'} ${onL0 ? 'L0' : `y=${y.toFixed(1)}`}`)
    }
    if (row[17] === 1 && alive) { // bot
      if (phase === 'live') {
        if (y > maxY) maxY = y
        if (y < minY) minY = y
        const prev = lastBotPos.get(id)
        if (prev) {
          const moved = Math.hypot(prev[0] - x, prev[1] - z)
          if (moved > 2) { movedBots++; lastBotPos.delete(id) }
        } else if (prev === undefined) {
          lastBotPos.set(id, [x, z])
        }
        const moving = (row[7] as number) === 1
        if (moving && insideSolid(x, y, z)) {
          clipCount++
          if (clipCount % 10 === 1) console.log(`CLIP ${row[15]} at (${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`)
        }
        const wy = nearestWpY(x, z, y)
        if (wy !== null) { dySamples++; if (Math.abs(y - wy) > worstDy) worstDy = Math.abs(y - wy) }
      }
    }
  }
  if (movedBots >= 2 && !results['bots-move']) {
    done('bots-move', true, `${movedBots} bots navigated the twin graph`)
  }
  if (results['bots-move'] && maxY > 3.0 && !results['bots-climb-l1']) {
    done('bots-climb-l1', true, `bot reached y=${maxY.toFixed(1)} (L1/L2 = stair core works)`)
  }
  if (results['bots-move'] && minY < -2.5 && !results['bots-tunnel']) {
    done('bots-tunnel', true, `bot reached y=${minY.toFixed(1)} (basement/tunnel route taken)`)
  }
  if (dySamples > 150 && !results['bots-on-surface']) {
    const ok = worstDy <= 1.7
    done('bots-on-surface', ok, `worst |y-nearestWP.y|=${worstDy.toFixed(2)}m over ${dySamples} samples`)
  }
  if (roundNo >= 2) {
    if (!results['no-bomb']) done('no-bomb', !bombCarrierSeen, bombCarrierSeen ? 'a C4 carrier was set — twin must be elimination-only' : `no hasBomb flag in any snapshot through round ${roundNo}`)
    if (!results['no-clip']) done('no-clip', clipCount <= 3, `${clipCount} solid clips by moving bots`)
  }
  if (NEED.every(k => results[k]?.startsWith('PASS')) && roundNo >= 2) finish()
})

sock.on('kill', (d: { killerName: string; victimName: string }) => {
  console.log(`[kill] ${d.killerName || 'world'} → ${d.victimName}`)
})

sock.on('bomb', (d: { planted?: boolean }) => {
  if (d.planted) { console.log('[bomb] PLANTED — MUST NOT HAPPEN on twin'); done('no-bomb', false, 'bomb planted event on a no-bomb map'); finish() }
})

sock.on('connect_error', (e: Error) => { console.log('CONNECT ERROR:', e.message); process.exit(1) })
