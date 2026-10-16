// Regression test for the 3 reported bugs:
// 1. bought weapons persist after death        → after dying in round 1, round-2 inventory = default pistol+knife
// 2. scoreboard doesn't update after kills     → own kills/deaths must appear in snapshot rows (row[18]/[19])
// 3. money not added after round end           → money at next freeze > last money seen during live
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const ROOM = 'bugfix-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

let myId = ''
let myTeam: 'CT' | 'T' = 'CT'
let phase = ''
let roundNo = 0
let bought = false
let diedOnce = false
let lastLiveMoney: number | null = null
let moneyAtFreeze2: number | null = null
let invSyncs: Array<{ inventory: string[]; wIdx: number }> = []
let results: Record<string, string> = {}
let finished = false
let victimA: ReturnType<typeof io> | null = null
let victimB: ReturnType<typeof io> | null = null
let killTested = false
let lastSelfKills = 0
let myKillsAfterKill = -1

function done(key: string, ok: boolean, detail: string) { results[key] = (ok ? 'PASS' : 'FAIL') + ' — ' + detail }
function fail(key: string, msg: string) { done(key, false, msg) }

sock.on('connect', () => {
  sock.emit('join', { name: 'BugTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })

sock.on('init', (d: { youId: string; team: 'CT' | 'T'; money: number; inventory: string[]; match: { phase: string } }) => {
  myId = d.youId
  myTeam = d.team
  console.log(`[init] team=${d.team} money=${d.money} inv=[${d.inventory.join(',')}]`)
})

sock.on('round', (d: { phase: string; round: number; roundWinner: string | null }) => {
  phase = d.phase
  if (d.round) roundNo = d.round
  console.log(`[round] phase=${d.phase} round=${d.round} winner=${d.roundWinner ?? '-'}`)
})

sock.on('invSync', (d: { inventory: string[]; wIdx: number }) => {
  invSyncs.push(d)
  console.log(`[invSync] inv=[${d.inventory.join(',')}] wIdx=${d.wIdx}`)
})

sock.on('buyOk', (d: { money: number; inventory: string[] }) => {
  console.log(`[buyOk] money=${d.money} inv=[${d.inventory.join(',')}]`)
})

sock.on('buyError', (d: { msg: string }) => console.log('[buyError]', d.msg))

sock.on('kill', (d: { killerName: string; victimName: string }) => {
  console.log(`[kill] ${d.killerName || 'world'} → ${d.victimName}`)
})

// ---------- main assertions live in the snapshot stream ----------
sock.on('snapshot', (d: { ps: unknown[][] }) => {
  const me = d.ps.find(r => r[0] === myId)
  if (!me) return
  const money = me[20] as number
  const kills = me[18] as number
  const held = me[14] as string

  if (kills > lastSelfKills) {
    console.log(`[self-kills] snapshot reports my kills = ${kills}`)
    myKillsAfterKill = kills
    lastSelfKills = kills
  }

  // round 1 freeze: buy the CT rifle
  if (phase === 'freeze' && roundNo === 1 && !bought) {
    bought = true
    sock.emit('buy', { item: 'm4' })
  }

  // once holding the rifle in live: run kill test then die
  if (phase === 'live' && roundNo === 1 && held === 'm4' && !killTested) {
    killTested = true
    killVictimA()
    // die after the kill registers (fall damage, 400ms server debounce)
    setTimeout(() => sock.emit('selfdamage', { dmg: 85, reason: 'fall' }), 1500)
    setTimeout(() => sock.emit('selfdamage', { dmg: 85, reason: 'fall' }), 2400)
  }

  if (phase === 'live') lastLiveMoney = money

  if (phase === 'freeze' && roundNo >= 2 && moneyAtFreeze2 === null) {
    moneyAtFreeze2 = money
    // ---- BUG 1: weapons stripped after death ----
    const last = invSyncs.length ? invSyncs[invSyncs.length - 1] : null
    if (last) {
      const hasRifle = last.inventory.some(w => w !== 'usp' && w !== 'glock' && w !== 'knife' && w !== 'c4')
      done('weapons-stripped', !hasRifle, `round-2 inventory after death = [${last.inventory.join(',')}]`)
    } else {
      fail('weapons-stripped', 'no invSync received at round reset')
    }
    // ---- BUG 3: money added at round end ----
    if (lastLiveMoney !== null) {
      done('money-added', money > lastLiveMoney, `live=${lastLiveMoney} → next freeze=${money} (+${money - lastLiveMoney})`)
    } else {
      fail('money-added', 'no live-phase money sample')
    }
    // ---- BUG 2: scoreboard kills ----
    if (myKillsAfterKill > 0) done('scoreboard-kills', true, `own kills visible in snapshot = ${myKillsAfterKill}`)
    else fail('scoreboard-kills', 'no kill visible in own snapshot row')
    finish()
  }
})

// ---------- victims ----------
function spawnVictims() {
  victimA = io(URL, { path: '/' })
  victimA.on('connect', () => victimA!.emit('join', { name: 'VictimA', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
  victimB = io(URL, { path: '/' })
  victimB.on('connect', () => victimB!.emit('join', { name: 'VictimB', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
}
setTimeout(spawnVictims, 1500)

let victimAId = ''
sock.on('playerJoined', (p: { id: string; name: string }) => {
  console.log(`[playerJoined] ${p.name}`)
  if (p.name === 'VictimA') victimAId = p.id
})

function killVictimA() {
  if (!victimAId) { console.log('[killtest] victimA id unknown — skip'); return }
  console.log('[killtest] shooting VictimA (usp, 8 hits)')
  let hits = 0
  const shoot = () => {
    if (hits >= 8) return
    hits++
    sock.emit('shoot', { weapon: 'usp', origin: [0, 1.6, 0], dir: [1, 0, 0] })
    sock.emit('hit', { target: victimAId, part: hits >= 7 ? 'head' : 'body', dist: 2, weapon: 'usp' })
    setTimeout(shoot, 40)
  }
  shoot()
}

function finish() {
  if (finished) return
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(18)} ${v}`)
  const allPass = Object.values(results).length === 3 && Object.values(results).every(v => v.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'SOME FAILED', '=====')
  sock.disconnect()
  victimA?.disconnect()
  victimB?.disconnect()
  process.exit(allPass ? 0 : 1)
}

// watchdog
setTimeout(() => {
  if (finished) return
  finished = true
  if (!results['weapons-stripped']) fail('weapons-stripped', `test did not reach round-2 freeze (phase=${phase} round=${roundNo})`)
  if (!results['money-added']) fail('money-added', `test did not reach round-2 freeze (phase=${phase} round=${roundNo})`)
  if (!results['scoreboard-kills']) fail('scoreboard-kills', myKillsAfterKill === -1 ? 'no kill registered' : 'unexpected state')
  console.log('\n===== RESULTS (watchdog) =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(18)} ${v}`)
  process.exit(1)
}, 70000)
