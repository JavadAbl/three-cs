// PHASE 6 E2E — the 4 shotguns + multi-pellet ballistics through the REAL
// game server. Three sockets: CT attacker + two T victims on dust2.
//  R1: nova buy ($1050) → 9-pellet kill of victim1 at 9.4m (exact 234
//      aggregate, ONE hitConfirm, kill event, seed broadcast, $900 reward
//      readable mid-round because victim2 keeps the round alive) → then
//      victim2 dies too → elimination ends the round
//  R2: mag7 buy → 8 pellets at 25.6m (falloff math: 8×6=48, hp 52) →
//      split-resend REJECTED (budget) → out-of-cone claim REJECTED →
//      legacy single-ray 'hit' bypass REJECTED → pump rate gate (100ms
//      follow-up dropped) → reload round-trip 5/29 → close-range kill
//  R3: xm1014 buy → auto cadence (400ms ok, 150ms rejected) → 160 close kill
// Positions: dust2 waypoints tspawn(0,40) → midEnt(5,32)=9.4m / tE(24,31)=25.6m,
// LOS pre-verified IN-TEST with the server's own ray-AABB (mapdata import).
import { io } from 'socket.io-client'
import { MAPS, rayHitsAABB } from '../mini-services/game-server/mapdata'
import type { Box } from '../mini-services/game-server/mapdata'

const URL = 'http://localhost:3003'
const ROOM = 'p6e2e-' + Math.random().toString(36).slice(2, 6)

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
const victim2 = io(URL, { path: '/' })  // T victim 2 (keeps R1 alive for the reward read)

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
const pos: Record<string, [number, number, number]> = {}

sock.on('connect', () => sock.emit('join', { name: 'ShellTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 }))
victim.on('connect', () => victim.emit('join', { name: 'TargetDummy', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
victim2.on('connect', () => victim2.emit('join', { name: 'SpareDummy', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })
victim.on('joinError', (d: { msg: string }) => { console.log('VICTIM JOIN ERROR:', d.msg); process.exit(1) })
victim2.on('joinError', (d: { msg: string }) => { console.log('VICTIM2 JOIN ERROR:', d.msg); process.exit(1) })
sock.on('init', (d: { youId: string }) => { myId = d.youId })
victim.on('init', (d: { youId: string }) => { victId = d.youId })
victim2.on('init', (d: { youId: string }) => { vict2Id = d.youId })

sock.on('buyOk', (d: { money: number; inventory: string[] }) => buyTrail.push(d))
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
  if (phase === 'freeze' && roundNo === 3 && seq === 4) { seq = 5; setTimeout(round3, 400) }
})

// waypoints (validated clear by scripts/validate_map.ts + edge connectivity)
const TSPAWN: [number, number, number] = [0, 0, 40]
const MIDENT: [number, number, number] = [5, 0, 32]    // 9.43m from tspawn
const MIDENT2: [number, number, number] = [6.5, 0, 33] // beside victim1
const TE: [number, number, number] = [24, 0, 31]       // 25.6m from tspawn

function fire(weapon: string, seed: number, to: [number, number, number]) {
  sock.emit('shoot', { weapon, origin: [TSPAWN[0], TSPAWN[1] + 1.62, TSPAWN[2]], dir: dirTo(TSPAWN, to), seed })
}
function claim(weapon: string, n: number, target: string, part = 'body') {
  sock.emit('pellets', { weapon, pellets: Array.from({ length: n }, () => ({ target, part })) })
}

// ---------------- ROUND 1: nova close-range aggregate kill ----------------
function round1() {
  sock.emit('buy', { item: 'nova' })
  setTimeout(() => waitFor('live', () => {
    hop(sock, myId, TSPAWN, () => {
      hop(victim, victId, MIDENT, () => {
        hop(victim2, vict2Id, MIDENT2, () => {
          const d = dist3(TSPAWN, MIDENT)
          if (!losClear(TSPAWN[0], 1.62, TSPAWN[2], MIDENT[0], 1.62, MIDENT[2])) {
            done('r1-los-clear', false, `tspawn→midEnt blocked?! d=${d.toFixed(1)}`); finish(); return
          }
          fire('nova', 424242, MIDENT)
          claim('nova', 9, victId)
          setTimeout(round1Check, 700)
        })
      })
    })
  }), 300)
}

function round1Check() {
  const novaBuy = buyTrail.find(b => b.inventory[0] === 'nova')
  done('r1-nova-buy', !!novaBuy && novaBuy.money === 14950 && novaBuy.inventory.length === 3,
    novaBuy ? `$${novaBuy.money} [${novaBuy.inventory.join(',')}]` : 'no buyOk')
  // 9.43m → 0 falloff steps → 9 × 26 = 234, one hitConfirm for victim1
  const mine = hitConfirms.filter(h => h.victimId === victId)
  done('r1-aggregate-damage-234', mine.length === 1 && mine[0].dmg === 234 && mine[0].hp === 0,
    mine.map(h => `${h.dmg}→hp${h.hp}`).join(' | ') || 'none')
  const kill = kills.find(k => k.weapon === 'nova' && k.victim === victId)
  done('r1-kill-event', !!kill && kill.headshot === false, kills.map(k => k.weapon).join(','))
  const shot = shotsSeen.find(s => s.weapon === 'nova')
  done('r1-seed-broadcast', !!shot && shot.seed === 424242, shot ? `seed ${shot.seed}` : 'no shot seen')
  // reward: 14950 + 900 = 15850 — readable NOW because victim2 keeps the round alive
  done('r1-kill-reward-900', myMoney === 15850, `money ${myMoney}`)
  // end the round: kill victim2 too (elimination)
  fire('nova', 424243, MIDENT2)
  claim('nova', 9, vict2Id)
  setTimeout(() => { seq = 2 }, 800)
}

// ---------------- ROUND 2: mag7 + anti-cheat battery ----------------
function round2() {
  hitConfirms.length = 0
  kills.length = 0
  shotsSeen.length = 0
  ammoSeen = null
  sock.emit('buy', { item: 'mag7' })
  setTimeout(() => waitFor('live', () => {
    hop(sock, myId, TSPAWN, () => {
      hop(victim, victId, TE, () => {
        const d = dist3(TSPAWN, TE)
        if (!losClear(TSPAWN[0], 1.62, TSPAWN[2], TE[0], 1.62, TE[2])) {
          done('r2-los-clear', false, `tspawn→tE blocked?! d=${d.toFixed(1)}`); finish(); return
        }
        // A: legit 8-pellet claim at 25.6m — falloff floor(2.56)=2 steps → 30×0.2025→6 → 8×6=48
        fire('mag7', 1111, TE)
        claim('mag7', 8, victId)
        setTimeout(step2Resend, 600)
      })
    })
  }), 300)
}

let confirmsAfterBypass = -1

function step2Resend() {
  // B: split resend on the SAME shot — budget exhausted → rejected
  claim('mag7', 4, victId)
  setTimeout(step3Cone, 600)
}

function step3Cone() {
  // C: fresh shot aimed 45° AWAY from the victim — cone gate rejects the claim
  sock.emit('shoot', { weapon: 'mag7', origin: [0, 1.62, 40], dir: [Math.SQRT1_2, 0, -Math.SQRT1_2], seed: 2222 })
  claim('mag7', 8, victId, 'head')
  setTimeout(step4Bypass, 600)
}

function step4Bypass() {
  // D: legacy single-ray 'hit' with a shotgun — the server must refuse
  sock.emit('hit', { target: victId, part: 'body', dist: 2, weapon: 'mag7' })
  setTimeout(() => {
    // checkpoint: exactly ONE hitConfirm so far (A) — B/C/D all rejected
    confirmsAfterBypass = hitConfirms.filter(h => h.victimId === victId).length
    step5Rate()
  }, 600)
}

function step5Rate() {
  // E: pump rate gate — two shots 100ms apart; the second is dropped
  fire('mag7', 3333, TE)
  setTimeout(() => { fire('mag7', 4444, TE); setTimeout(step6Reload, 700) }, 100)
}

function step6Reload() {
  // F: reload round-trip — mag after 3 accepted shots (1111/2222/3333): 5-3=2 → 5/29
  sock.emit('reload', { weapon: 'mag7' })
  setTimeout(step7CloseKill, 3200)
}

function step7CloseKill() {
  // G: both victims hop CLOSE; full loads at 9.4m → 240 each → elimination
  // ends the round (victim2 respawns each round — must die again, or the
  // round rides the full 115s timer and round 3 never starts in time)
  hop(victim, victId, MIDENT, () => {
    hop(victim2, vict2Id, MIDENT2, () => {
      fire('mag7', 5555, MIDENT)
      claim('mag7', 8, victId)
      setTimeout(() => {
        fire('mag7', 5556, MIDENT2)   // +900ms: past the 833ms pump gate
        claim('mag7', 8, vict2Id)
        setTimeout(round2Check, 800)
      }, 900)
    })
  })
}

function round2Check() {
  const mag7Buy = buyTrail.find(b => b.inventory[0] === 'mag7')
  done('r2-mag7-buy', !!mag7Buy && mag7Buy.money >= 13000 && mag7Buy.inventory.length === 3,
    mag7Buy ? `$${mag7Buy.money} [${mag7Buy.inventory.join(',')}]` : 'no buyOk')
  const mine = hitConfirms.filter(h => h.victimId === victId)
  const first = mine.find(h => h.dmg === 48)
  done('r2-falloff-math-48@25m', !!first && first.hp === 52, mine.map(h => `${h.dmg}→hp${h.hp}`).join(' | '))
  done('r2-anticheat-battery (resend/cone/bypass rejected)', confirmsAfterBypass === 1,
    `${confirmsAfterBypass} hitConfirm(s) at the checkpoint (want 1)`)
  const seeds = shotsSeen.filter(s => s.weapon === 'mag7').map(s => s.seed)
  // accepted: 1111 (A) / 2222 (C) / 3333 (E1) / 5555+5556 (double kill, post-reload);
  // dropped: 4444 (E2 fired +100ms — under the 833ms pump gate)
  done('r2-pump-rate-gate (4444 dropped, post-reload kills accepted)',
    seeds.length === 5 && [1111, 2222, 3333, 5555, 5556].every(s => seeds.includes(s)) && !seeds.includes(4444),
    seeds.join(','))
  done('r2-reload-round-trip', !!ammoSeen && ammoSeen.weapon === 'mag7' && ammoSeen.mag === 5 && ammoSeen.reserve === 29,
    ammoSeen ? `mag=${ammoSeen.mag} reserve=${ammoSeen.reserve}` : 'no ammo event')
  const kill = kills.find(k => k.weapon === 'mag7' && k.victim === victId)
  const closeLoad = mine.find(h => h.dmg === 240)
  done('r2-close-kill-240', !!kill && !!closeLoad, `kill ${!!kill}, 240dmg ${!!closeLoad}`)
  seq = 4
}

// ---------------- ROUND 3: xm1014 auto cadence + close kill ----------------
function round3() {
  hitConfirms.length = 0
  kills.length = 0
  shotsSeen.length = 0
  sock.emit('buy', { item: 'xm1014' })
  setTimeout(() => waitFor('live', () => {
    hop(sock, myId, TSPAWN, () => {
      hop(victim, victId, MIDENT, () => {
        fire('xm1014', 6001, MIDENT)
        setTimeout(() => {
          fire('xm1014', 6002, MIDENT)          // +400ms ≥ 338 → accepted
          setTimeout(() => {
            fire('xm1014', 6003, MIDENT)        // +150ms < 338 → rejected
            setTimeout(() => {
              fire('xm1014', 6004, MIDENT)      // +400ms later: the kill shot
              claim('xm1014', 8, victId)
              setTimeout(round3Check, 800)
            }, 450)
          }, 150)
        }, 400)
      })
    })
  }), 300)
}

function round3Check() {
  const xmBuy = buyTrail.find(b => b.inventory[0] === 'xm1014')
  done('r3-xm1014-buy', !!xmBuy && xmBuy.inventory.length === 3, xmBuy ? `$${xmBuy.money}` : 'no buyOk')
  const seeds = shotsSeen.filter(s => s.weapon === 'xm1014').map(s => s.seed)
  done('r3-xm-cadence (400 ok, 150 rejected)', seeds.length === 3 && seeds.includes(6001) && seeds.includes(6002) && seeds.includes(6004) && !seeds.includes(6003),
    seeds.join(','))
  const kill = kills.find(k => k.weapon === 'xm1014')
  const load = hitConfirms.find(h => h.victimId === victId && h.dmg === 160)
  done('r3-xm-close-kill-160', !!kill && !!load, `kill ${!!kill} 160dmg ${!!load}`)
  finish()
}

function finish() {
  if (finished) return
  finished = true
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(40)} ${v}`)
  const need = ['r1-nova-buy', 'r1-aggregate-damage-234', 'r1-kill-event', 'r1-seed-broadcast',
    'r1-kill-reward-900', 'r2-mag7-buy', 'r2-falloff-math-48@25m',
    'r2-anticheat-battery (resend/cone/bypass rejected)', 'r2-pump-rate-gate (4444 dropped, post-reload kills accepted)',
    'r2-reload-round-trip', 'r2-close-kill-240', 'r3-xm1014-buy', 'r3-xm-cadence (400 ok, 150 rejected)', 'r3-xm-close-kill-160']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('=====', allPass ? 'ALL PASS' : 'SOME FAILED', '=====')
  sock.disconnect(); victim.disconnect(); victim2.disconnect()
  process.exit(allPass ? 0 : 1)
}

setTimeout(() => {
  if (finished) return
  finished = true
  if (!results['r1-nova-buy']) done('r1-nova-buy', false, `never reached freeze (phase=${phase} r${roundNo})`)
  console.log('\n===== RESULTS (watchdog) =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(40)} ${v}`)
  process.exit(1)
}, 220000)
