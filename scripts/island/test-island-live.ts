// E2E test for the island map (Task 131 — tropical island, bomb defusal)
// - join island room with bots
// - verify: server serves island, staged geom.json serves, spawn on the CT
//   beach pad (north side, y≈1.6-2.1), round flow freeze→live, bots navigate
//   the island waypoint graph, a T bot CARRIES the C4 (island IS a bomb map —
//   inverse of the office elimination trio)
import { io } from 'socket.io-client'
import wpData from '../../src/game/map-island-data.json'

const URL = 'http://localhost:3003'
const WEB = process.env.WEB_BASE ?? 'http://localhost:3000'   // Next dev/prod host
const ROOM = 'island-test-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })
const ISLAND_WPS = wpData.waypoints as Array<{ id: string; x: number; y: number; z: number }>

/** Task 132 regression: nearest island waypoint's y at the bot's XZ — bots
 * running a WRONG-MAP graph (the dust-fallback launch bug) lerp toward dust2
 * floor heights and sink up to 2.3 m under the terrain within seconds of
 * round start. Sampling every alive bot's |dy| during live catches it. */
function nearestWpY(x: number, z: number): number {
  let best = ISLAND_WPS[0], bd = Infinity
  for (const w of ISLAND_WPS) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2
    if (d < bd) { bd = d; best = w }
  }
  return best.y
}

let myId = ''
let phase = ''
let roundNo = 0
let spawnCheck: string | null = null
let botMoveCheck = false
let lastBotPos = new Map<string, [number, number]>()
let movedBots = 0
let worstDy = 0            // Task 132: worst |bot.y - nearest island WP y| seen
let dySamples = 0
let results: Record<string, string> = {}
let finished = false
let bombCarrierId: string | null = null
let plantSeen = false

function done(k: string, ok: boolean, msg: string) { results[k] = (ok ? 'PASS' : 'FAIL') + ' — ' + msg }
function finish() {
  if (finished) return
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(22)} ${v}`)
  const need = ['map-served', 'geom-served', 'spawn-standable', 'bots-move', 'bots-on-surface', 'round-flow', 'bomb-carrier-seen']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'INCOMPLETE/FAILED', '=====')
  sock.disconnect()
  process.exit(allPass ? 0 : 1)
}

// watchdog: whatever happened after 75s, report
setTimeout(() => { console.log('[timeout] results so far'); finish() }, 75_000)

sock.on('connect', () => {
  ;(async () => {
    // render geometry: staged during review, /assets after acceptance
    const g1 = await fetch(`${WEB}/staging/maps/island/geom.json`, { method: 'HEAD' })
    const g2 = await fetch(`${WEB}/assets/maps/island/geom.json`, { method: 'HEAD' })
    done('geom-served', g1.status === 200 || g2.status === 200,
      g1.status === 200 ? `geom.json served from /staging (${g1.headers.get('content-length')}B)` : g2.status === 200 ? 'geom.json served from /assets' : `staging=${g1.status} assets=${g2.status}`)
  })().catch(e => done('geom-served', false, `fetch error: ${e}`))
  sock.emit('join', { name: 'IslandTester', room: ROOM, team: 'CT', map: 'island', botFill: true, botDifficulty: 'easy', winTarget: 16 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })

sock.on('init', (d: { youId: string; team: string; mapId: string; players: unknown[]; match: { phase: string } }) => {
  myId = d.youId
  console.log(`[init] map=${d.mapId} team=${d.team} players=${d.players.length} phase=${d.match.phase}`)
  if (d.mapId === 'island') done('map-served', true, 'server served island map')
  else { done('map-served', false, `got map ${d.mapId}`); finish() }
  const me = (d.players as any[]).find(p => p.id === myId)
  if (me) console.log('[init] my spawn:', me.x.toFixed(1), me.y.toFixed(1), me.z.toFixed(1), 'yaw', me.yaw.toFixed(2))
})

sock.on('round', (d: { phase: string; round: number; roundWinner: string | null }) => {
  if (phase === 'freeze' && d.phase === 'live' && !results['round-flow']) {
    done('round-flow', true, 'freeze → live transition observed')
  }
  if (d.phase !== phase) console.log(`[round] phase=${d.phase} round=${d.round} winner=${d.roundWinner ?? '-'}`)
  phase = d.phase
  if (d.round) roundNo = d.round
  if (d.phase === 'live' && d.round >= 2) finish()
})

sock.on('snapshot', (d: { ps: unknown[][] }) => {
  for (const row of d.ps) {
    const id = row[0] as string
    const x = row[1] as number, y = row[2] as number, z = row[3] as number
    const alive = row[12] === 1
    if (row[13] === 1 && !bombCarrierId) {
      bombCarrierId = id
      console.log(`[bomb] hasBomb in snapshot — player ${id} (island is a defusal map: EXPECTED)`)
      done('bomb-carrier-seen', true, `C4 carrier active (${id === myId ? 'me' : 'a bot'})`)
    }
    if (id === myId && alive && !spawnCheck && phase === 'freeze') {
      spawnCheck = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`
      console.log(`[spawn] my position in freeze: ${spawnCheck} (expect CT beach pad: north, y≈1.6-2.1)`)
      const okY = y > 0.9 && y < 3.2
      const okSide = z < -38          // CT beach pad is the north shore (-z)
      const inBounds = Math.abs(x) < 95 && Math.abs(z) < 85
      done('spawn-standable', okY && okSide && inBounds,
        `pos=(${spawnCheck}) ${okY ? 'beach y' : 'Y OUT OF RANGE'} ${okSide ? 'north shore' : 'WRONG SIDE'}`)
    }
    if (row[17] === 1) { // bot
      const prev = lastBotPos.get(id)
      if (prev && phase === 'live') {
        const moved = Math.hypot(prev[0] - x, prev[1] - z)
        if (moved > 2) { movedBots++; lastBotPos.delete(id) }
      } else if (phase === 'freeze') {
        lastBotPos.set(id, [x, z])
      }
      // Task 132: bots must stay ON the island surface (wrong-graph bots sink)
      if (phase === 'live') {
        const dy = Math.abs(y - nearestWpY(x, z))
        dySamples++
        if (dy > worstDy) worstDy = dy
      }
    }
  }
  if (movedBots >= 2 && !botMoveCheck) {
    botMoveCheck = true
    done('bots-move', true, `${movedBots} bots navigated island waypoints`)
  }
  // once two bots have walked, judge the surface adherence over what we saw
  if (botMoveCheck && dySamples > 60 && !results['bots-on-surface']) {
    const ok = worstDy <= 1.7
    done('bots-on-surface', ok,
      `worst |y - nearestWP.y| = ${worstDy.toFixed(2)}m over ${dySamples} samples ${ok ? '(on the terrain)' : '— SUNK INTO GROUND (wrong-map graph?)'}`)
  }
  const need = ['map-served', 'geom-served', 'spawn-standable', 'bots-move', 'bots-on-surface', 'round-flow', 'bomb-carrier-seen']
  if (need.every(k => results[k]?.startsWith('PASS')) && roundNo >= 1 && phase === 'live') finish()
})

sock.on('kill', (d: { killerName: string; victimName: string }) => {
  console.log(`[kill] ${d.killerName || 'world'} → ${d.victimName}`)
})

sock.on('bomb', (d: { planted?: boolean }) => {
  if (d.planted) { plantSeen = true; console.log('[bomb] PLANTED (island defusal: expected behavior)') }
})

sock.on('plantProgress', (d: { progress?: number }) => {
  if (!plantSeen) console.log(`[plant] progress=${d.progress?.toFixed(2)}`)
})

sock.on('connect_error', (e: Error) => { console.log('CONNECT ERROR:', e.message); process.exit(1) })
