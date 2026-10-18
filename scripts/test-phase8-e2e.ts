// PHASE 8 E2E — grenades & equipment through the REAL game server.
// Three sockets: CT attacker + two T victims on dust2 (open T-spawn ground,
// LOS pre-verified with the server's own ray-AABB).
//  R1: buy the full utility belt (he/flash×2/smoke/inc/decoy + kit, money
//      16000→14150) · 3rd flash rejected (max 2) · control usp hit 32 dmg at
//      12m · anti-cheat (throw without owning / rate gate) · HE kill after a
//      3-shot soften → weapon 'he' + $300 mid-round · flash blind > 2.5s on a
//      facing victim · incendiary DoT ticks (8 dmg × 2+) · decoy gunfire loop
//      (≥2 shots, mimics usp) · smoke pops and BLOCKS the 12m usp LOS gate ·
//      point-blank (≤3m) still connects · close-kill ends the round
//  R2: survivors keep kit + leftover flash (kit rebuy → 'Already have a kit';
//      flash rebuy stacks to 2) · fresh smoke blocks, then EXPIRES after 18s
//      and shots connect again · victim plants at A · kit defuse halves the
//      channel: defuse completes in ~5s (< 6.5s vs the kitless 10s) → CT wins
import { io } from 'socket.io-client'
import { MAPS, rayHitsAABB } from '../mini-services/game-server/mapdata'
import type { Box } from '../mini-services/game-server/mapdata'

const URL = 'http://localhost:3003'
const ROOM = 'p8e2e-' + Math.random().toString(36).slice(2, 6)

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
const sock = io(URL, { path: '/' })       // CT attacker
const victim = io(URL, { path: '/' })     // T victim 1 (HE target, R2 planter)
const victim2 = io(URL, { path: '/' })    // T victim 2 (flash/fire/smoke target)

let myId = '', victId = '', vict2Id = ''
let phase = '', roundNo = 0
let finished = false
let seq = 0
const results: Record<string, string> = {}
function done(key: string, ok: boolean, detail = '') { results[key] = (ok ? 'PASS' : 'FAIL') + ' — ' + detail }

const buyTrail: Array<{ money: number; inventory: string[] }> = []
const buyErrors: string[] = []
const hitConfirms: Array<{ victimId: string; dmg: number; hs: boolean; hp: number }> = []
const kills: Array<{ weapon: string; victim: string }> = []
const nades: Array<{ id: number; kind: string }> = []
const nadeFx: Array<{ kind: string; pos: number[] }> = []
const bounces: Array<{ id: number; speed: number }> = []
const decoyShots: Array<{ weapon: string }> = []
let flashSeen: { ms: number } | null = null
let myMoney = -1
let myKit = false
let snapGs = 0, snapSm = 0, snapFi = 0   // snapshot overlay presence counters
const pos: Record<string, [number, number, number]> = {}
const bombCarrier: Record<string, number> = {}   // row[13] hasBomb — join order is a connection race, so the carrier must be READ, not assumed

sock.on('connect', () => sock.emit('join', { name: 'NadeTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 }))
victim.on('connect', () => victim.emit('join', { name: 'TargetA', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
victim2.on('connect', () => victim2.emit('join', { name: 'TargetB', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })
victim.on('joinError', (d: { msg: string }) => { console.log('V1 JOIN ERROR:', d.msg); process.exit(1) })
victim2.on('joinError', (d: { msg: string }) => { console.log('V2 JOIN ERROR:', d.msg); process.exit(1) })
sock.on('init', (d: { youId: string }) => { myId = d.youId })
victim.on('init', (d: { youId: string }) => { victId = d.youId })
victim2.on('init', (d: { youId: string }) => { vict2Id = d.youId })

sock.on('buyOk', (d: { money: number; inventory: string[]; hasKit?: boolean }) => {
  buyTrail.push(d)
  if (d.hasKit !== undefined) myKit = d.hasKit
})
sock.on('buyError', (d: { msg: string }) => buyErrors.push(d.msg))
victim.on('hitConfirm', (d: { victimId: string; dmg: number; hs: boolean; hp: number }) => hitConfirms.push(d))
victim.on('kill', (d: { weapon: string; victim: string }) => kills.push(d))
victim.on('nade', (d: { id: number; kind: string }) => nades.push(d))

victim.on('nadeFx', (d: { kind: string; pos: number[] }) => nadeFx.push(d))
victim.on('gBounce', (d: { id: number; speed: number }) => bounces.push(d))
victim.on('decoyShot', (d: { weapon: string }) => decoyShots.push(d))
victim2.on('flash', (d: { ms: number }) => { if (!flashSeen) flashSeen = d })
sock.on('snapshot', (d: { ps: unknown[][]; gs?: unknown[][]; sm?: unknown[][]; fi?: unknown[][] }) => {
  for (const row of d.ps) {
    const id = row[0] as string
    pos[id] = [row[1] as number, row[2] as number, row[3] as number]
    bombCarrier[id] = row[13] as number
    if (id === myId) { myMoney = row[20] as number; myKit = row[21] === 1 }
  }
  if (d.gs) snapGs++
  if (d.sm) snapSm++
  if (d.fi) snapFi++
})

function hop(s: Sock, id: string, to: [number, number, number], yaw: number, cb: () => void) {
  const from = pos[id] ?? [0, 0, 0]
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 10))
  let i = 0
  const tick = () => {
    i++
    const t = Math.min(1, i / steps)
    s.emit('state', {
      x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t,
      z: from[2] + (to[2] - from[2]) * t, yaw, pitch: 0, moving: false,
    })
    if (i < steps) setTimeout(tick, 40)
    else setTimeout(cb, 150)
  }
  tick()
}

function dirTo(from: [number, number, number], to: [number, number, number]): [number, number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  const l = Math.hypot(dx, dy, dz)
  return [dx / l, dy / l, dz / l]
}

function waitFor(ph: string, cb: () => void) {
  if (phase === ph) { setTimeout(cb, 200); return }
  const iv = setInterval(() => { if (phase === ph) { clearInterval(iv); setTimeout(cb, 200) } }, 100)
  setTimeout(() => clearInterval(iv), 60000)
}

sock.on('round', (d: { phase: string; round: number }) => {
  phase = d.phase
  if (d.round) roundNo = d.round
  if (phase === 'freeze' && roundNo === 1 && seq === 0) { seq = 1; setTimeout(round1, 400) }
  if (phase === 'freeze' && roundNo === 2 && seq === 4) { seq = 5; setTimeout(round2, 400) }
})

const ATK: [number, number, number] = [0, 0, 40]     // CT attacker spot
const V1: [number, number, number] = [6, 0, 40]      // victim 1 (6m)
const V2: [number, number, number] = [14, 0, 40]     // victim 2 (14m)

// ---------------------------------------------------------------- round 1
function round1() {
  // ---- buys: the full utility belt (order: weapons then gear then kit)
  const belt = ['he', 'flash', 'flash', 'smoke', 'inc', 'decoy', 'defusekit']
  let i = 0
  const nextBuy = () => {
    if (i < belt.length) { sock.emit('buy', { item: belt[i++] }, () => setTimeout(nextBuy, 60)) }
    else setTimeout(afterBuys, 250)
  }
  nextBuy()

  function afterBuys() {
    const b = buyTrail
    done('utility belt buys (7 items, 16000→13950, money charged)',
      b.length === 7 && b[6].money === 13950 &&
      b[0].money === 15700 && b[1].money === 15500 &&
      b[0].inventory.includes('he') && b[6].inventory.filter((w: string) => w === 'flash').length === 2,
      `money ${b[6]?.money}, he-step ${b[0]?.money}`)
    done('kit purchased (buyOk hasKit)', myKit === true)

    // 3rd flash → rejected (carry limit)
    sock.emit('buy', { item: 'flash' }, (r: { ok?: boolean; msg?: string }) => {
      done('3rd flash rejected (max carry 2)', !r?.ok && /Max 2/.test(r?.msg ?? buyErrors[buyErrors.length - 1] ?? ''), `${r?.msg ?? buyErrors[buyErrors.length - 1]}`)
      startLive()
    })
  }

  function startLive() {
    waitFor('live', () => {
      hop(sock, myId, ATK, Math.PI / 2, () => {           // attacker to the T-spawn test ground FIRST
        hop(victim, victId, V1, Math.PI, () => {
          hop(victim2, vict2Id, V2, Math.PI / 2, () => { // victim2 FACES the attacker (flash target)
            setTimeout(antiCheat, 300)
          })
        })
      })
    })
  }

  // ---- anti-cheat: bogus throws produce nothing
  function antiCheat() {
    const before = nades.length
    sock.emit('throw', { weapon: 'awp', dir: [1, 0, 0], power: 1 })        // not a throwable
    sock.emit('throw', { weapon: 'molotov', dir: [1, 0, 0], power: 1 })    // not owned (CT)
    setTimeout(() => {
      done('anti-cheat: non-throwable / unowned throws spawn nothing',
        nades.length === before, `${nades.length - before} spawns`)

      // ---- control shot: usp 32 dmg at 12m through open air (pre-smoke)
      const hc0 = hitConfirms.length
      const d = dirTo(ATK, [V2[0], V2[1] + 1.5, V2[2]])
      sock.emit('shoot', { weapon: 'usp', dir: d })
      setTimeout(() => sock.emit('hit', { target: vict2Id, part: 'body', dist: 14, weapon: 'usp' }), 90)
      setTimeout(() => {
        const hcs = hitConfirms.slice(hc0)
        done('control usp hit lands 32 dmg at 12m (pre-smoke)',
          hcs.some(h => h.victimId === vict2Id && h.dmg === 32 && h.hp === 68),
          hcs.map(h => `${h.dmg}→${h.hp}`).join(','))
        setTimeout(rateGate, 200)
      }, 400)
    }, 300)
  }

  // ---- rate gate + blind: the rate-gate flash IS the blind test (one flash
  //      consumed; flash #2 stays in the belt for the R2 persistence check)
  function rateGate() {
    const before = nades.length
    const d = dirTo(ATK, [V2[0], V2[1] + 1.0, V2[2]])
    sock.emit('throw', { weapon: 'flash', dir: [d[0], d[1] + 0.15, d[2]], power: 0.45 })
    setTimeout(() => sock.emit('throw', { weapon: 'flash', dir: d, power: 0.45 }), 220)  // < 900ms
    setTimeout(() => {
      const spawns = nades.length - before
      done('rate gate: double throw within 900ms spawns exactly one',
        spawns === 1, `${spawns} spawns`)
      done('flash blinds the facing victim (server flash event > 2.5s)',
        !!flashSeen && flashSeen.ms > 2500, flashSeen ? `${flashSeen.ms}ms` : 'no event')

      // ---- soften victim1 with 2 usp shots (35 each at 6m → 30 hp), then HE kill
      let shots = 0
      const shooter = () => {
        if (shots >= 2) { setTimeout(heKill, 250); return }
        const d1 = dirTo(ATK, [V1[0], V1[1] + 1.5, V1[2]])
        sock.emit('shoot', { weapon: 'usp', dir: d1 })
        setTimeout(() => sock.emit('hit', { target: victId, part: 'body', dist: 6, weapon: 'usp' }), 80)
        shots++
        setTimeout(shooter, 260)
      }
      shooter()
    }, 2700)
  }

  // ---- HE kill: lob at victim1's feet; any dmg ≥ 4 kills; weapon 'he' + $300
  function heKill() {
    const moneyBefore = myMoney
    // flat underhand lob: lands ~4.5m, rolls to ~6m, detonates ON victim1
    // (a lofted throw carries past her and splashes victim2 at 14m)
    sock.emit('throw', { weapon: 'he', dir: [0.995, 0.05, 0], power: 0.45 })
    setTimeout(() => {
      const kill = kills.find(k => k.victim === victId && k.weapon === 'he')
      done('HE kill lands (softened 4hp target, weapon he)',
        !!kill && hitConfirms.some(h => h.victimId === victId && h.hp <= 0),
        kills.map(k => `${k.weapon}→${k.victim}`).join(',') || 'no kill')
      done('HE kill pays the $300 grenade reward mid-round',
        myMoney - moneyBefore === 300, `${moneyBefore}→${myMoney}`)
      setTimeout(fireZone, 300)
    }, 2600)
  }

  // ---- incendiary: throw at victim2's line, then walk her into the zone
  function fireZone() {
    const d = dirTo(ATK, [V2[0], V2[1], V2[2]])
    sock.emit('throw', { weapon: 'inc', dir: [d[0], 0.2, d[2]], power: 0.45 })
    setTimeout(() => {
      const fx = nadeFx.filter(f => f.kind === 'inc' || f.kind === 'molotov')
      // fire zone lands ~5-6m out on the ATK→V2 line: walk victim2 onto it
      const mid: [number, number, number] = [5.5, 0, 40]
      hop(victim2, vict2Id, mid, 0, () => {
        const hc0 = hitConfirms.length
        setTimeout(() => {
          const ticks = hitConfirms.slice(hc0).filter(h => h.victimId === vict2Id && h.dmg === 8)
          done('incendiary DoT ticks burn 8 dmg each (≥2 ticks in 1.5s)',
            ticks.length >= 2, `${ticks.length} ticks`)
          done('fire zone rides the snapshot (fi overlay seen)', snapFi > 0, `${snapFi} snapshots`)
          // OUT of the zone before the 7s burn kills her (68hp < 112 total)
          hop(victim2, vict2Id, V2, Math.PI / 2, () => setTimeout(decoyTest, 600))
        }, 1500)
      })
    }, 1800)
  }

  // ---- decoy: rests, then mimics the attacker's usp on a loop
  function decoyTest() {
    const d = dirTo(ATK, [V2[0], 0, V2[2]])
    sock.emit('throw', { weapon: 'decoy', dir: [d[0], 0.15, d[2]], power: 0.45 })
    setTimeout(() => {
      done('decoy loop fires fake gunshots at rest (≥2 shots, mimics usp)',
        decoyShots.length >= 2 && decoyShots.every(s => s.weapon === 'usp'),
        decoyShots.map(s => s.weapon).join(','))
      done('gBounce broadcasts seen (hard landings tick)', bounces.length > 0, `${bounces.length} bounces`)
      setTimeout(smokeBlock, 300)
    }, 4200)
  }

  // ---- smoke pops between attacker and victim2 (12m) → usp LOS gate blocks
  function smokeBlock() {
    hop(victim2, vict2Id, V2, Math.PI / 2, () => {
      const d = dirTo(ATK, [V2[0], 0, V2[2]])
      sock.emit('throw', { weapon: 'smoke', dir: [d[0], 0.15, d[2]], power: 0.45 })
      // wait for pop + pop-in window (flight ~0.8s, rest 400ms, pop-in 300ms)
      setTimeout(() => {
        done('smoke popped (nadeFx + snapshot sm overlay)',
          nadeFx.some(f => f.kind === 'smoke') && snapSm > 0, `fx=${nadeFx.filter(f => f.kind === 'smoke').length}, sm=${snapSm}`)
        // shot through the smoke → REJECTED (no hitConfirm)
        const hc0 = hitConfirms.length
        const dd = dirTo(ATK, [V2[0], V2[1] + 1.5, V2[2]])
        sock.emit('shoot', { weapon: 'usp', dir: dd })
        setTimeout(() => sock.emit('hit', { target: vict2Id, part: 'body', dist: 14, weapon: 'usp' }), 90)
        setTimeout(() => {
          const leaked = hitConfirms.slice(hc0).filter(h => h.victimId === vict2Id)
          done('smoke volume BLOCKS the 12m hit-validation LOS',
            leaked.length === 0, leaked.length ? `leaked ${leaked.length}` : 'blocked')

          // point-blank (≤3m) still connects through smoke (leniency rule)
          hop(sock, myId, [V2[0] - 2, 0, V2[2]], Math.PI / 2, () => {
            const hc1 = hitConfirms.length
            sock.emit('shoot', { weapon: 'usp', dir: [1, 0, 0] })
            setTimeout(() => sock.emit('hit', { target: vict2Id, part: 'body', dist: 2, weapon: 'usp' }), 80)
            setTimeout(() => {
              const pb = hitConfirms.slice(hc1).filter(h => h.victimId === vict2Id)
              done('point-blank (2m) connects through smoke (≤3m leniency)',
                pb.length >= 1, pb.map(h => h.dmg).join(','))
              // finish victim2 → elimination ends round 1
              const finish = () => {
                sock.emit('shoot', { weapon: 'usp', dir: [1, 0, 0] })
                setTimeout(() => sock.emit('hit', { target: vict2Id, part: 'head', dist: 2, weapon: 'usp' }), 80)
                setTimeout(() => {
                  if (kills.some(k => k.victim === vict2Id)) { seq = 4 }
                  else setTimeout(finish, 400)
                }, 500)
              }
              finish()
            }, 450)
          })
        }, 500)
      }, 2600)
    })
  }
}

// ---------------------------------------------------------------- round 2
function round2() {
  // survivors keep kit + leftover flash — rebuys prove server-side state
  sock.emit('buy', { item: 'defusekit' }, (r: { ok?: boolean; msg?: string }) => {
    done('survivor keeps the kit (rebuy → Already have a kit)',
      !r?.ok && /Already have/.test(r?.msg ?? ''), r?.msg ?? '')
    sock.emit('buy', { item: 'flash' }, (r2: { ok?: boolean; money?: number }) => {
      const inv = buyTrail[buyTrail.length - 1]
      done('survivor keeps leftover flash (rebuy stacks to 2)',
        !!r2?.ok && inv.inventory.filter((w: string) => w === 'flash').length === 2,
        `flash×${inv.inventory.filter((w: string) => w === 'flash').length}`)
      sock.emit('buy', { item: 'smoke' }, (r3: { ok?: boolean }) => {
        done('R2 smoke rebuy (R1 smoke was thrown)', !!r3?.ok)

      waitFor('live', () => {
        hop(victim2, vict2Id, V2, Math.PI / 2, () => {           // victim2 = the smoke target again
          hop(victim, victId, V2, Math.PI, () => {
            hop(sock, myId, ATK, Math.PI / 2, () => setTimeout(smokeCycle, 300))
          })
        })
      })
      })
    })
  })

  // ---- fresh smoke: blocks, then EXPIRES after 18s and hits connect again
  function smokeCycle() {
    const d = dirTo(ATK, [V2[0], 0, V2[2]])
    sock.emit('throw', { weapon: 'smoke', dir: [d[0], 0.15, d[2]], power: 0.45 })
    setTimeout(() => {
      // blocked window
      const hc0 = hitConfirms.length
      const dd = dirTo(ATK, [V2[0], V2[1] + 1.5, V2[2]])
      sock.emit('shoot', { weapon: 'usp', dir: dd })
      setTimeout(() => sock.emit('hit', { target: vict2Id, part: 'body', dist: 14, weapon: 'usp' }), 90)
      setTimeout(() => {
        done('R2 fresh smoke blocks again (control)',
          hitConfirms.slice(hc0).filter(h => h.victimId === vict2Id).length === 0)

        // ---- wait out the 18s cloud, then the shot connects
        setTimeout(() => {
          const hc1 = hitConfirms.length
          sock.emit('shoot', { weapon: 'usp', dir: dd })
          setTimeout(() => sock.emit('hit', { target: vict2Id, part: 'body', dist: 14, weapon: 'usp' }), 90)
          setTimeout(() => {
            done('smoke expires after ~18s — LOS gate opens again',
              hitConfirms.slice(hc1).some(h => h.victimId === vict2Id && h.dmg > 0),
              hitConfirms.slice(hc1).filter(h => h.victimId === vict2Id).map(h => h.dmg).join(','))
            setTimeout(plantAndDefuse, 300)
          }, 600)
        }, 19000)
      }, 500)
    }, 2600)
  }

  // ---- plant at A, then kit defuse (~5s) → CT win
  function plantAndDefuse() {
    const A: [number, number, number] = [30, 2, -30]   // dust2 site A
    // The carrier is the first-joined human T — socket.io connection order does
    // NOT follow creation order (victim2 can connect first), so plant with the
    // socket that actually carries the bomb (snapshot row[13]), not a hard-coded one.
    const planterSock: Sock = bombCarrier[vict2Id] ? victim2 : victim
    const planterId = bombCarrier[vict2Id] ? vict2Id : victId
    hop(planterSock, planterId, A, 0, () => {
      planterSock.emit('useDown')
      setTimeout(() => planterSock.emit('useUp'), 3400)      // plant 3.2s
      setTimeout(() => {
        // bomb planted (40s fuse): attacker hops to the bomb and defuses
        const bombPos: [number, number, number] = [A[0], A[1], A[2]]
        hop(sock, myId, [bombPos[0] + 1, bombPos[1], bombPos[2]], Math.PI, () => {
          const defuseStart = Date.now()
          sock.emit('useDown')
          let roundEnded = 0
          const iv = setInterval(() => {
            if ((phase === 'post' || phase === 'over') && !roundEnded) roundEnded = Date.now()
          }, 100)
          setTimeout(() => {
            sock.emit('useUp')
            clearInterval(iv)
            const defuseMs = roundEnded - defuseStart
            done('kit halves the defuse: channel completes ~5s (< 6.5s)',
              roundEnded > 0 && defuseMs < 6500 && defuseMs > 3500,
              `${defuseMs}ms (kitless would be 10s)`)
            finish()
          }, 8000)
        })
      }, 4200)
    })
  }
}

function finish() {
  if (finished) return
  finished = true
  setTimeout(() => {
    console.log('\n================ RESULTS ================')
    let ok = 0, bad = 0
    for (const [k, v] of Object.entries(results)) {
      console.log(`${v.startsWith('PASS') ? '✓' : '✗'} ${k}: ${v}`)
      if (v.startsWith('PASS')) ok++; else bad++
    }
    console.log(`\n${ok} passed, ${bad} failed / ${ok + bad} total`)
    sock.close(); victim.close(); victim2.close()
    process.exit(bad > 0 ? 1 : 0)
  }, 1200)
}

// hard timeout safety
setTimeout(() => { finish() }, 170000)
