// E2E test for dust2 (Task 90) — first dedicated dust2 suite
// - join a dust2 room with bots
// - verify: map served, spawn sane, round flow, bots navigate,
//   the Task-90 identity-files-served (10 scoped normal maps must ship with
//   the repo — any 404 = silent relief downgrade), and the POSITIVE bomb
//   regression: dust2 is a defuse map, so startRound MUST assign a C4
//   carrier (the mirror of the aim-map no-bomb trio from Tasks 85/87)
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const WEB = process.env.WEB_BASE ?? 'http://localhost:3000'   // Next dev/prod host serving /assets
const ROOM = 'dust2-test-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

let myId = ''
let phase = ''
let roundNo = 0
let spawnCheck: string | null = null
let botMoveCheck = false
let lastBotPos = new Map<string, [number, number]>()
let movedBots = 0
let results: Record<string, string> = {}
let finished = false
// Task 90 positive regression: dust2 KEEPS the defuse objective — a carrier
// must be flagged at startRound (human joins CT, so a T bot carries)
let bombCarrierSeen = false

function done(k: string, ok: boolean, msg: string) { results[k] = (ok ? 'PASS' : 'FAIL') + ' — ' + msg }
function fail(k: string, msg: string) { done(k, false, msg) }
function finish() {
  if (finished) return
  done('bomb-carrier-seen', bombCarrierSeen, bombCarrierSeen ? 'a T player carries the C4 (defuse objective intact)' : 'no hasBomb flag ever appeared — carrier assignment broken')
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(22)} ${v}`)
  const need = ['map-served', 'spawn-standable', 'bots-move', 'round-flow', 'identity-files-served', 'bomb-carrier-seen']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'INCOMPLETE/FAILED', '=====')
  sock.disconnect()
  process.exit(allPass ? 0 : 1)
}

sock.on('connect', () => {
  // Task 90: the dust2 scoped-identity dir ships ONLY the 10 normal maps
  // (albedo/bump stay shared via the loader chain). All 10 must be 200 over
  // HTTP — a 404 would silently keep the bump-only look with no other test
  // noticing.
  ;(async () => {
    const surfaces = ['sand', 'wall', 'brick', 'concrete', 'crate', 'plank', 'metal', 'dark', 'door', 'doorBlue']
    const missing: string[] = []
    for (const s of surfaces) {
      const r = await fetch(`${WEB}/assets/textures/maps/dust2/${s}_normal.jpg`, { method: 'HEAD' })
      if (r.status !== 200) missing.push(`${s}_normal.jpg=${r.status}`)
    }
    done('identity-files-served', missing.length === 0,
      missing.length === 0 ? 'all 10 dust2 normal maps served'
        : `missing: ${missing.join(', ')}`)
  })().catch(e => done('identity-files-served', false, `fetch error: ${e}`))
  sock.emit('join', { name: 'Dust2Tester', room: ROOM, team: 'CT', map: 'dust2', botFill: true, botDifficulty: 'easy', winTarget: 16 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })

sock.on('init', (d: { youId: string; team: string; mapId: string; players: unknown[]; match: { phase: string } }) => {
  myId = d.youId
  console.log(`[init] map=${d.mapId} team=${d.team} players=${d.players.length} phase=${d.match.phase}`)
  if (d.mapId === 'dust2') done('map-served', true, 'server served dust2 map')
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
  for (const row of d.ps) {
    const id = row[0] as string
    const x = row[1] as number, y = row[2] as number, z = row[3] as number
    const alive = row[12] === 1
    if (row[13] === 1) {
      if (!bombCarrierSeen) console.log(`[carrier] player ${id} hasBomb=1 (defuse objective live)`)
      bombCarrierSeen = true
    }
    if (id === myId && alive && !spawnCheck && phase === 'freeze') {
      spawnCheck = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`
      console.log(`[spawn] my position in freeze: ${spawnCheck}`)
      const okY = y > -1 && y < 20 // BSP ground floors vary; just sanity-range
      done('spawn-standable', okY, `pos=(${spawnCheck}) ${okY ? 'y in range' : 'Y OUT OF RANGE'}`)
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

function finishIfReady() {
  if (results['map-served'] && results['spawn-standable'] && results['bots-move'] && bombCarrierSeen && (roundNo >= 2 || results['round-flow'])) {
    if (results['round-flow'] && bombCarrierSeen) finish()
  }
}

setTimeout(() => {
  if (!results['map-served']) fail('map-served', 'no init')
  if (!results['spawn-standable']) fail('spawn-standable', 'never alive in freeze')
  if (!results['bots-move']) fail('bots-move', `only ${movedBots} bots moved`)
  if (!results['round-flow']) fail('round-flow', `phase=${phase} round=${roundNo}`)
  finish()
}, 75000)
