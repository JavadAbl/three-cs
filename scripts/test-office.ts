// E2E test for the office BSP-converted map (Task 126 — cs_office import)
// - join office room with bots
// - verify: spawn on the CT garage level (SW, y≈6), round flow, bots navigate
//   the multi-level waypoint graph, the STAGED identity files serve over the
//   /assets→/staging chain (7 photo families x albedo+bump+normal), the
//   geom.json render geometry serves, and the no-bomb trio (office is an
//   elimination map — user: no hostages feature, and the map carries no bomb
//   sites of its own)
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const WEB = process.env.WEB_BASE ?? 'http://localhost:3000'   // Next dev/prod host
const ROOM = 'office-test-' + Math.random().toString(36).slice(2, 6)
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
// no-bomb regression trio (same as aim maps)
let bombCarrierSeen = false
let c4Seen = false
let bombPlantedSeen = false
let plantProgressSeen = false

function done(k: string, ok: boolean, msg: string) { results[k] = (ok ? 'PASS' : 'FAIL') + ' — ' + msg }
function fail(k: string, msg: string) { done(k, false, msg) }
function finish() {
  if (finished) return
  done('no-bomb-carrier', !bombCarrierSeen, bombCarrierSeen ? 'a player carried the C4 on an elimination map' : 'no hasBomb flag in any snapshot row')
  done('no-c4-inventory', !c4Seen, c4Seen ? 'c4 appeared in an inventory sync' : 'no c4 in any inventory sync')
  done('no-plant-events', !bombPlantedSeen && !plantProgressSeen, (bombPlantedSeen || plantProgressSeen) ? 'plant activity streamed on an elimination map' : 'no bomb/plantProgress events')
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(22)} ${v}`)
  const need = ['map-served', 'geom-served', 'identity-files-served', 'spawn-standable', 'bots-move', 'round-flow', 'no-bomb-carrier', 'no-c4-inventory', 'no-plant-events']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'INCOMPLETE/FAILED', '=====')
  sock.disconnect()
  process.exit(allPass ? 0 : 1)
}

/** office identity resolves through the loader chain: /assets first, then
 * /staging (acceptance policy v3 — staged set evaluates live). Pass = the
 * FIRST 200 in the chain; fail only if every hop 404s. */
async function chainFetch(base: string): Promise<{ status: number; url: string }> {
  const hops = [
    `${WEB}/assets/textures/maps/office/${base}`,
    `${WEB}/staging/textures/maps/office/${base}`,
  ]
  for (const url of hops) {
    try {
      const r = await fetch(url, { method: 'HEAD' })
      if (r.status === 200) return { status: 200, url }
      if (r.status !== 404) return { status: r.status, url }
    } catch (e) {
      return { status: -1, url }
    }
  }
  return { status: 404, url: hops[hops.length - 1] }
}

sock.on('connect', () => {
  ;(async () => {
    // 7 photo families ship albedo+bump+normal (glass/fence stay procedural)
    const missing: string[] = []
    for (const s of ['carpet', 'offwall', 'ceiling', 'snow', 'tile', 'brick', 'plank']) {
      for (const suffix of ['', '_bump', '_normal']) {
        const r = await chainFetch(`${s}${suffix}.jpg`)
        if (r.status !== 200) missing.push(`${s}${suffix}.jpg=${r.status}`)
      }
    }
    done('identity-files-served', missing.length === 0,
      missing.length === 0 ? 'all 21 office identity files served (assets→staging chain)'
        : `missing: ${missing.join(', ')}`)
    // render geometry: staged during review, /assets after acceptance
    const g1 = await fetch(`${WEB}/staging/maps/office/geom.json`, { method: 'HEAD' })
    const g2 = await fetch(`${WEB}/assets/maps/office/geom.json`, { method: 'HEAD' })
    done('geom-served', g1.status === 200 || g2.status === 200,
      g1.status === 200 ? 'geom.json served from /staging' : g2.status === 200 ? 'geom.json served from /assets' : `staging=${g1.status} assets=${g2.status}`)
  })().catch(e => done('identity-files-served', false, `fetch error: ${e}`))
  sock.emit('join', { name: 'OfficeTester', room: ROOM, team: 'CT', map: 'office', botFill: true, botDifficulty: 'easy', winTarget: 16 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })

sock.on('init', (d: { youId: string; team: string; mapId: string; players: unknown[]; match: { phase: string } }) => {
  myId = d.youId
  console.log(`[init] map=${d.mapId} team=${d.team} players=${d.players.length} phase=${d.match.phase}`)
  if (d.mapId === 'office') done('map-served', true, 'server served office map')
  else done('map-served', false, `got map ${d.mapId}`)
  const me = d.players.find((p: any) => p.id === myId) as any
  if (me) {
    console.log('[init] my spawn:', me.x.toFixed(1), me.y.toFixed(1), me.z.toFixed(1), 'yaw', me.yaw.toFixed(2))
  }
})

sock.on('round', (d: { phase: string; round: number; roundWinner: string | null }) => {
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
    if (row[13] === 1 && !bombCarrierSeen) { bombCarrierSeen = true; console.log('[REGRESSION] hasBomb flag in snapshot, player:', id) }
    if (id === myId && alive && !spawnCheck && phase === 'freeze') {
      spawnCheck = `${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`
      console.log(`[spawn] my position in freeze: ${spawnCheck} (expect CT garage level: SW, y≈6)`)
      // CT spawns: garage floor bsp -336 → our y 6.0; ONE spawn sits
      // deliberately on the -272 landing (entity z=-236, map-author placed)
      // → y 7.65. Both are legal CT levels; centroid (−27.7, 44.2) = SW side.
      const okY = y > 4.5 && y < 8.5
      const okSide = x < -5 && z > 20     // SW courtyard/garage side
      done('spawn-standable', okY && okSide, `pos=(${spawnCheck}) ${okY ? 'garage level y' : 'Y OUT OF RANGE'} ${okSide ? 'SW side' : 'WRONG SIDE'}`)
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
  console.log(`[kill] ${d.killerName || 'world'} → ${d.victimName}`)
})

sock.on('bomb', (d: { planted?: boolean }) => {
  if (d.planted) { bombPlantedSeen = true; console.log('[REGRESSION] bomb planted on elimination map!') }
})

sock.on('plantProgress', (d: { progress?: number }) => {
  plantProgressSeen = true
  console.log('[REGRESSION] plantProgress on elimination map:', d.progress)
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
  if (!results['geom-served']) fail('geom-served', 'geom.json never fetched')
  if (!results['identity-files-served']) fail('identity-files-served', 'identity chain never probed')
  if (!results['spawn-standable']) fail('spawn-standable', 'never alive in freeze')
  if (!results['bots-move']) fail('bots-move', `only ${movedBots} bots moved`)
  if (!results['round-flow']) fail('round-flow', `phase=${phase} round=${roundNo}`)
  finish()
}, 55000)
