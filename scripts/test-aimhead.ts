// E2E test for the aimhead BSP-converted map
// - join aimhead room with bots
// - verify: spawn positions sane (standable), round flow, bots navigate,
//   the identity-files-served guard (Task 90: 5 aztec surfaces x albedo+bump+normal
//   must ship with the repo — any 404 = silent shared-fallback / bump-only downgrade),
//   and the Task-85 no-bomb trio (aim maps are elimination-only)
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const WEB = process.env.WEB_BASE ?? 'http://localhost:3000'   // Next dev/prod host serving /assets
const ROOM = 'aimhead-test-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

let myId = ''
let phase = ''
let roundNo = 0
let spawnCheck: string | null = null
let botMoveCheck = false
let lastBotPos = new Map<string, [number, number]>()
let movedBots = 0
let killsSeen = 0
let results: Record<string, string> = {}
let finished = false
let botFill = true
// Task 85 no-bomb regression: aim maps are elimination-only — nothing bomb-related
// may EVER appear (old code: a T bot gets flagged carrier in startRound, c4 lands in
// an inventory, carrier bots stream plantProgress and the planted 'bomb' event)
let bombCarrierSeen = false
let c4Seen = false
let bombPlantedSeen = false
let plantProgressSeen = false

function done(k: string, ok: boolean, msg: string) { results[k] = (ok ? 'PASS' : 'FAIL') + ' — ' + msg }
function fail(k: string, msg: string) { done(k, false, msg) }
function finish() {
  if (finished) return
  done('no-bomb-carrier', !bombCarrierSeen, bombCarrierSeen ? 'a player carried the C4 on an aim map' : 'no hasBomb flag in any snapshot row')
  done('no-c4-inventory', !c4Seen, c4Seen ? 'c4 appeared in an inventory sync' : 'no c4 in any inventory sync')
  done('no-plant-events', !bombPlantedSeen && !plantProgressSeen, (bombPlantedSeen || plantProgressSeen) ? 'plant activity streamed on an aim map' : 'no bomb/plantProgress events')
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(20)} ${v}`)
  const need = ['map-served', 'spawn-standable', 'bots-move', 'round-flow', 'identity-files-served', 'no-bomb-carrier', 'no-c4-inventory', 'no-plant-events']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'INCOMPLETE/FAILED', '=====')
  sock.disconnect()
  process.exit(allPass ? 0 : 1)
}

sock.on('connect', () => {
  // Task 90: the aimhead identity dir ships 5 aztec surfaces x (albedo+bump+normal).
  // All 15 must be 200 over HTTP — a 404 would silently fall back to the shared
  // desert set (albedo/bump) or the bump-only look (normal) with no other test noticing.
  ;(async () => {
    const missing: string[] = []
    for (const s of ['sand', 'brick', 'dark', 'metal', 'plank']) {
      for (const suffix of ['', '_bump', '_normal']) {
        const r = await fetch(`${WEB}/assets/textures/maps/aimhead/${s}${suffix}.jpg`, { method: 'HEAD' })
        if (r.status !== 200) missing.push(`${s}${suffix}.jpg=${r.status}`)
      }
    }
    done('identity-files-served', missing.length === 0,
      missing.length === 0 ? 'all 15 aimhead identity files served'
        : `missing: ${missing.join(', ')}`)
  })().catch(e => done('identity-files-served', false, `fetch error: ${e}`))
  sock.emit('join', { name: 'MapTester', room: ROOM, team: 'CT', map: 'aimhead', botFill: true, botDifficulty: 'easy', winTarget: 16 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })

sock.on('init', (d: { youId: string; team: string; mapId: string; players: unknown[]; match: { phase: string } }) => {
  myId = d.youId
  console.log(`[init] map=${d.mapId} team=${d.team} players=${d.players.length} phase=${d.match.phase}`)
  if (d.mapId === 'aimhead') done('map-served', true, 'server served aimhead map')
  else done('map-served', false, `got map ${d.mapId}`)
  const me = d.players.find((p: any) => p.id === myId) as any
  if (me) {
    console.log('[init] my spawn:', me.x.toFixed(1), me.y.toFixed(1), me.z.toFixed(1), 'yaw', me.yaw.toFixed(2))
  }
})

sock.on('round', (d: { phase: string; round: number; roundWinner: string | null; buyTime?: boolean }) => {
  if (phase === 'freeze' && d.phase === 'live' && !results['round-flow']) {
    done('round-flow', true, 'freeze → live transition observed')
  }
  if (d.phase !== phase) console.log(`[round] phase=${d.phase} round=${d.round} winner=${d.roundWinner ?? '-'}`)
  phase = d.phase
  if (d.round) roundNo = d.round
  if (d.phase === 'live' && d.round >= 2) finishIfReady()
})

sock.on('snapshot', (d: { ps: unknown[][] }) => {
  const rt = performance.now()
  for (const row of d.ps) {
    const id = row[0] as string
    const x = row[1] as number, y = row[2] as number, z = row[3] as number
    const alive = row[12] === 1
    if (row[13] === 1 && !bombCarrierSeen) { bombCarrierSeen = true; console.log('[REGRESSION] hasBomb flag in snapshot, player:', id) }
    if (id === myId && alive && !spawnCheck && phase === 'freeze') {
      spawnCheck = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`
      console.log(`[spawn] my position in freeze: ${spawnCheck} (y should be a floor level, x west for CT)`)
      const okY = y > -1 && y < 12
      const okX = x < 0 // CT = west side
      done('spawn-standable', okY && okX, `pos=(${spawnCheck}) ${okY ? 'y in range' : 'Y OUT OF RANGE'} ${okX ? 'west side' : 'WRONG SIDE'}`)
    }
    if (row[17] === 1) { // bot
      const prev = lastBotPos.get(id)
      if (prev && phase === 'live') {
        const moved = Math.hypot(prev[0] - x, prev[1] - z)
        if (moved > 2) { movedBots++; lastBotPos.delete(id) }
      } else if (phase === 'freeze') {
        lastBotPos.set(id, [x, z])
      }
    }
  }
  if (movedBots >= 2 && !botMoveCheck) {
    botMoveCheck = true
    done('bots-move', true, `${movedBots} bots navigated waypoints`)
  }
  finishIfReady()
})

sock.on('kill', (d: { killerName: string; victimName: string }) => {
  killsSeen++
  console.log(`[kill] ${d.killerName || 'world'} → ${d.victimName} (${killsSeen})`)
})

sock.on('bomb', (d: { planted?: boolean }) => {
  if (d.planted) { bombPlantedSeen = true; console.log('[REGRESSION] bomb planted on aim map!') }
})

sock.on('plantProgress', (d: { progress?: number }) => {
  plantProgressSeen = true
  console.log('[REGRESSION] plantProgress on aim map:', d.progress)
})

sock.on('invSync', (d: { inventory: string[] }) => {
  if (d.inventory.includes('c4')) { c4Seen = true; console.log('[REGRESSION] inventory sync carries C4:', d.inventory.join(',')) }
})

function finishIfReady() {
  if (results['map-served'] && results['spawn-standable'] && results['bots-move'] && (roundNo >= 2 || results['round-flow'])) {
    if (results['round-flow']) finish()
  }
}

setTimeout(() => {
  if (!results['map-served']) fail('map-served', 'no init')
  if (!results['spawn-standable']) fail('spawn-standable', 'never alive in freeze')
  if (!results['bots-move']) fail('bots-move', `only ${movedBots} bots moved`)
  if (!results['round-flow']) fail('round-flow', `phase=${phase} round=${roundNo}`)
  finish()
}, 55000)
