// PHASE 7 E2E — the 2 machine guns + sustained fire through the REAL game
// server. Three sockets: CT attacker + two T victims on dust2.
//  R1: negev buy ($1700, 16000→14300) → SUSTAINED FIRE: 25 shots at 80ms
//      cadence all accepted (plan 7.1: rate gate handles 12.5 rps with zero
//      tick pressure) → 26th accepted → +40ms spam REJECTED (gate 63ms) →
//      3-rd body kill of victim1 at 9.4m (35/35/kill, exact hitConfirm
//      trail 65→30) → $300 reward mid-round → reload round-trip
//      (121 fired → 150/271 after 5.7s) → kill victim2 → round ends
//  R2: m249 buy ($5200, 16000→10800) → 10-shot sustained cadence + 40ms
//      spam rejection → 4-rd body kill of victim1 at 25.6m (30 each — two
//      falloff steps: 31×0.98²→29.77→30; hp 70→40→10) → $300 reward →
//      kill victim2 → elimination ends the round
// Positions: dust2 waypoints tspawn(0,40) → midEnt(5,32)=9.4m / tE(24,31)=25.6m,
// LOS pre-verified IN-TEST with the server's own ray-AABB (mapdata import).
import { io } from 'socket.io-client'
import { MAPS, rayHitsAABB } from '../mini-services/game-server/mapdata'
import type { Box } from '../mini-services/game-server/mapdata'

const URL = 'http://localhost:3003'
const ROOM = 'p7e2e-' + Math.random().toString(36).slice(2, 6)

// --- server-identical LOS check (fails LOUD before firing if geometry moves)
function losClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz)
  if (len < 0.01) return true
  const nx = dx / len, ny = dy / len, nz = dz / len
  for (const b of (MAPS.dust2.losBoxes as readonly Box[])) {
    if (rayHitsAABB(ax, ay, az, nx, ny, nz, b, len)) return false
  }
  return true
}

type Sock = ReturnType<typeof io>
const sock = io(URL, { path: '/' })     // CT attacker
const victim = io(URL, { path: '/' })   // T victim 1
const victim2 = io(URL, { path: '/' })  // T victim 2 (keeps rounds alive for reward reads)

let myId = '', victId = '', vict2Id = ''
let phase = '', roundNo = 0
let finished = false
let seq = 0
const results: Record<string, string> = {}
function done(key: string, ok: boolean, detail: string) { results[key] = (ok ? 'PASS' : 'FAIL') + ' — ' + detail }

const buyTrail: Array<{ money: number; inventory: string[] }> = []
const hitConfirms: Array<{ victimId: string; dmg: number; hs: boolean; hp: number }> = []
const kills: Array<{ weapon: string; headshot: boolean; victim: string }> = []
const shotsSeen: Array<{ weapon: string; seed?: number }> = []
let ammoSeen: { weapon: string; mag: number; reserve: number } | null = null
let myMoney = -1
let sustainedSeen = 0   // broadcast count snapshot BEFORE the kill shots
let m249SustainedSeen = 0
const pos: Record<string, [number, number, number]> = {}

sock.on('connect', () => sock.emit('join', { name: 'SpoolTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 }))
victim.on('connect', () => victim.emit('join', { name: 'TargetDummy', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
victim2.on('connect', () => victim2.emit('join', { name: 'SpareDummy', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })
victim.on('joinError', (d: { msg: string }) => { console.log('VICTIM JOIN ERROR:', d.msg); process.exit(1) })
victim2.on('joinError', (d: { msg: string }) => { console.log('VICTIM2 JOIN ERROR:', d.msg); process.exit(1) })
sock.on('init', (d: { youId: string }) => { myId = d.youId })
victim.on('init', (d: { youId: string }) => { victId = d.youId })
victim2.on('init', (d: { youId: string }) => { vict2Id = d.youId })

sock.on('buyOk', (d: { money: number; inventory: string[] }) => buyTrail.push(d))
// 'shot'/'hitConfirm'/'kill' are ROOM broadcasts (the shooter never sees
// their own 'shot') — one witness listener catches everything, incl. victim2's
victim.on('hitConfirm', (d: { victimId: string; dmg: number; hs: boolean; hp: number }) => hitConfirms.push(d))
victim.on('kill', (d: { weapon: string; headshot: boolean; victim: string }) => kills.push(d))
victim.on('shot', (d: { id: string; weapon: string; seed?: number }) => { if (d.id === myId) shotsSeen.push({ weapon: d.weapon, seed: d.seed }) })
sock.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => { ammoSeen = d })
sock.on('snapshot', (d: { ps: unknown[][] }) => {
  for (const row of d.ps) {
    const id = row[0] as string
    pos[id] = [row[1] as number, row[2] as number, row[3] as number]
    if (id === myId) myMoney = row[20] as number
  }
})

// --- hop helper: chain ≤10m state updates (server anti-teleport gate) ---
function hop(s: Sock, id: string, to: [number, number, number], cb: () => void) {
  const from = pos[id] ?? [0, 0, 0]
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 10))
  let i = 0
  const tick = () => {
    i++
    const t = Math.min(1, i / steps)
    s.emit('state', {
      x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t,
      z: from[2] + (to[2] - from[2]) * t, yaw: 0, pitch: 0, moving: false,
    })
    if (i < steps) setTimeout(tick, 40)
    else setTimeout(cb, 120)
  }
  tick()
}

function dirTo(from: [number, number, number], to: [number, number, number]): [number, number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  const l = Math.hypot(dx, dy, dz)
  return [dx / l, dy / l, dz / l]
}
function dist3(a: [number, number, number], b: [number, number, number]) { return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) }

function waitFor(ph: string, cb: () => void) {
  if (phase === ph) { setTimeout(cb, 150); return }
  const iv = setInterval(() => { if (phase === ph) { clearInterval(iv); setTimeout(cb, 150) } }, 100)
  setTimeout(() => clearInterval(iv), 45000)
}

sock.on('round', (d: { phase: string; round: number }) => {
  phase = d.phase
  if (d.round) roundNo = d.round
  if (phase === 'freeze' && roundNo === 1 && seq === 0) { seq = 1; setTimeout(round1, 400) }
  if (phase === 'freeze' && roundNo === 2 && seq === 2) { seq = 3; setTimeout(round2, 400) }
})

// waypoints (validated clear by scripts/validate_map.ts + edge connectivity)
const TSPAWN: [number, number, number] = [0, 0, 40]
const MIDENT: [number, number, number] = [5, 0, 32]    // 9.43m from tspawn
const MIDENT2: [number, number, number] = [6.5, 0, 33] // beside victim1
const TE: [number, number, number] = [24, 0, 31]       // 25.6m from tspawn

function fire(weapon: string, to: [number, number, number]) {
  sock.emit('shoot', { weapon, origin: [TSPAWN[0], TSPAWN[1] + 1.62, TSPAWN[2]], dir: dirTo(TSPAWN, to) })
}
function hitClaim(weapon: string, target: string, dist: number, part = 'body') {
  sock.emit('hit', { target, part, dist, weapon })
}

/** Sustained fire at a fixed cadence — the Phase 7 core: the rate gate must
 *  accept a full MG stream (25 negev / 10 m249 shots at 80ms) and still
 *  reject a follow-up inside the gate window. doneCb fires tailMs after the
 *  last shot so the caller controls the follow-up gap precisely. */
function burstFire(weapon: string, n: number, gapMs: number, tailMs: number, to: [number, number, number], doneCb: () => void) {
  let i = 0
  const tick = () => {
    i++
    fire(weapon, to)
    if (i < n) setTimeout(tick, gapMs)
    else setTimeout(doneCb, tailMs)
  }
  tick()
}

/** kill a victim with n body shots: shoot+hit pairs at 80ms cadence */
function killWith(weapon: string, target: string, dist: number, n: number, doneCb: () => void) {
  let i = 0
  const tick = () => {
    fire(weapon, [TSPAWN[0] + 1, 0, TSPAWN[2] - 1])
    hitClaim(weapon, target, dist)
    i++
    if (i < n) setTimeout(tick, 80)
    else setTimeout(doneCb, 700)
  }
  tick()
}

// ---------------- ROUND 1: negev — sustained spool + kill + reload ----------------
function round1() {
  sock.emit('buy', { item: 'negev' })
  setTimeout(() => waitFor('live', () => {
    hop(sock, myId, TSPAWN, () => {
      hop(victim, victId, MIDENT, () => {
        hop(victim2, vict2Id, MIDENT2, () => {
          const d = dist3(TSPAWN, MIDENT)
          if (!losClear(TSPAWN[0], 1.62, TSPAWN[2], MIDENT[0], 1.62, MIDENT[2])) {
            done('r1-los-clear', false, `tspawn→midEnt blocked?! d=${d.toFixed(1)}`); finish(); return
          }
          // 25 sustained shots at 80ms (12.5 rps — plan 7.1's "sustained 15 rps
          // without tick pressure" class of load); callback fires +80ms after
          // the last shot so the 26th lands at a LEGAL gap
          burstFire('negev', 25, 80, 80, MIDENT, r1SpamGate)
        })
      })
    })
  }), 300)
}

function r1SpamGate() {
  // 26th shot: exactly +80ms after shot 25 — LEGAL (gate is 75-12=63ms)
  fire('negev', MIDENT)
  setTimeout(() => {
    // 27th at +40ms — under the 63ms gate — REJECTED (no broadcast, no drain)
    fire('negev', MIDENT)
    setTimeout(r1Kill, 300)
  }, 40)
}

function r1Kill() {
  // snapshot the cadence result BEFORE the kill shots add their own broadcasts
  sustainedSeen = shotsSeen.filter(s => s.weapon === 'negev').length
  // 3 body hits at 9.43m: 35 each (no falloff step) → 65 → 30 → kill
  killWith('negev', victId, 9.4, 3, r1Checkpoint)
}

function r1Checkpoint() {
  const buy = buyTrail.find(b => b.inventory[0] === 'negev')
  done('r1-negev-buy', !!buy && buy.money === 14300 && buy.inventory.length === 3,
    buy ? `$${buy.money} [${buy.inventory.join(',')}]` : 'no buyOk')
  const negevShots = shotsSeen.filter(s => s.weapon === 'negev')
  // snapshot taken before the 3 kill shots: 25 sustained + 1 legal 26th = 26;
  // the +40ms 27th dropped (gate 63ms). No seed — single-ray ballistics.
  done('r1-sustained-25-at-80ms-all-accepted', sustainedSeen === 26,
    `${sustainedSeen} broadcasts pre-kill (want 26: 25 sustained + 1 legal; 40ms spam dropped)`)
  done('r1-single-ray-no-seed', negevShots.every(s => s.seed === undefined), 'no seed on MG broadcasts')
  const mine = hitConfirms.filter(h => h.victimId === victId)
  // 3 confirms — the killing blow emits hp 0 as well: 65 → 30 → 0
  done('r1-negev-damage-35-exact', mine.length === 3 && mine.every(h => h.dmg === 35) &&
    mine[0].hp === 65 && mine[1].hp === 30 && mine[2].hp === 0,
    mine.map(h => `${h.dmg}→hp${h.hp}`).join(' | ') || 'none')
  const kill = kills.find(k => k.weapon === 'negev' && k.victim === victId)
  done('r1-kill-event', !!kill && kill.headshot === false, kills.map(k => k.weapon).join(','))
  // reward: 14300 + 300 = 14600 — readable NOW because victim2 keeps the round alive
  done('r1-kill-reward-300', myMoney === 14600, `money ${myMoney}`)
  // reload round-trip: 26 + 3 = 29 fired → mag 121 → refill 29 → 150/271
  // (the rejected 27th spam shot never drained ammo — the point of the gate)
  sock.emit('reload', { weapon: 'negev' })
  setTimeout(r1ReloadCheck, 6300)
}

function r1ReloadCheck() {
  done('r1-negev-reload-round-trip', !!ammoSeen && ammoSeen.weapon === 'negev' && ammoSeen.mag === 150 && ammoSeen.reserve === 271,
    ammoSeen ? `mag=${ammoSeen.mag} reserve=${ammoSeen.reserve} (fired 29, refill 29)` : 'no ammo event')
  // end the round: kill victim2 too (elimination)
  killWith('negev', vict2Id, 9.4, 3, () => { seq = 2 })
}

// ---------------- ROUND 2: m249 — cadence + 25.6m falloff kill ----------------
function round2() {
  hitConfirms.length = 0
  kills.length = 0
  shotsSeen.length = 0
  ammoSeen = null
  sock.emit('buy', { item: 'm249' })
  setTimeout(() => waitFor('live', () => {
    hop(sock, myId, TSPAWN, () => {
      hop(victim, victId, TE, () => {
        const d = dist3(TSPAWN, TE)
        if (!losClear(TSPAWN[0], 1.62, TSPAWN[2], TE[0], 1.62, TE[2])) {
          done('r2-los-clear', false, `tspawn→tE blocked?! d=${d.toFixed(1)}`); finish(); return
        }
        // 10 sustained at 80ms; callback at +40ms so the follow-up lands
        // INSIDE the 68ms gate (80-12) — rejected, 10 broadcasts total
        burstFire('m249', 10, 80, 40, TE, r2SpamGate)
      })
    })
  }), 300)
}

function r2SpamGate() {
  // 11th shot at +40ms after the 10th — under the 68ms gate (80-12) — REJECTED
  fire('m249', TE)
  setTimeout(r2Kill, 300)
}

function r2Kill() {
  m249SustainedSeen = shotsSeen.filter(s => s.weapon === 'm249').length
  // 4 body hits at 25.6m: 31 × 0.98^2 = 29.77 → 30 each → 70 → 40 → 10 → kill
  killWith('m249', victId, 25.6, 4, r2Checkpoint)
}

function r2Checkpoint() {
  const buy = buyTrail.find(b => b.inventory[0] === 'm249')
  done('r2-m249-buy', !!buy && buy.money === 10800 && buy.inventory.length === 3,
    buy ? `$${buy.money} [${buy.inventory.join(',')}]` : 'no buyOk')
  const m249Shots = shotsSeen.filter(s => s.weapon === 'm249')
  // snapshot before the 4 kill shots: 10 sustained accepted; the +40ms 11th
  // dropped (gate 68ms) — 10 broadcasts
  done('r2-m249-cadence (10 sustained ok, 40ms spam rejected)',
    m249SustainedSeen === 10, `${m249SustainedSeen} broadcasts pre-kill (want 10)`)
  const mine = hitConfirms.filter(h => h.victimId === victId)
  // 4 confirms incl. the killing hp-0: 70 → 40 → 10 → 0
  done('r2-m249-falloff-30@25.6m', mine.length === 4 && mine.every(h => h.dmg === 30) &&
    mine[0].hp === 70 && mine[1].hp === 40 && mine[2].hp === 10 && mine[3].hp === 0,
    mine.map(h => `${h.dmg}→hp${h.hp}`).join(' | ') || 'none')
  const kill = kills.find(k => k.weapon === 'm249' && k.victim === victId)
  done('r2-kill-event', !!kill, kills.map(k => k.weapon).join(','))
  done('r2-kill-reward-300', myMoney === 11100, `money ${myMoney} (want 11100 = 10800 + 300)`)
  // end the match: kill victim2 (elimination ends round 2)
  killWith('m249', vict2Id, 25.6, 4, () => setTimeout(finish, 600))
}

function finish() {
  if (finished) return
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(44)} ${v}`)
  const need = ['r1-negev-buy', 'r1-sustained-25-at-80ms-all-accepted', 'r1-single-ray-no-seed',
    'r1-negev-damage-35-exact', 'r1-kill-event', 'r1-kill-reward-300', 'r1-negev-reload-round-trip',
    'r2-m249-buy', 'r2-m249-cadence (10 sustained ok, 40ms spam rejected)',
    'r2-m249-falloff-30@25.6m', 'r2-kill-event', 'r2-kill-reward-300']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'SOME FAILED', '=====')
  sock.disconnect(); victim.disconnect(); victim2.disconnect()
  process.exit(allPass ? 0 : 1)
}

setTimeout(() => {
  if (finished) return
  finished = true
  if (!results['r1-negev-buy']) done('r1-negev-buy', false, `never reached freeze (phase=${phase} r${roundNo})`)
  console.log('\n===== RESULTS (watchdog) =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(44)} ${v}`)
  process.exit(1)
}, 220000)
