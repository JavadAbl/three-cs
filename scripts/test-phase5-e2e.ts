// PHASE 5 E2E — the 8 new rifles through the REAL game server
// Timeline (freeze + buy window):
//  1. CT buys m4a1s ($2900) then famas ($1700): slot-1 replacement, money trail
//  2. FAMAS FULL-AUTO CADENCE PROOF (Task 105 — burst retired by user):
//     100ms-gap shots accepted (666 RPM cyclic, gate 90-12=78ms), two 40ms
//     spam shots rate-REJECTED, reload after 4 fired rounds
//  3. famas reload round-trip: 4 fired → mag 21 → refill 25/86
//  4. aug + ssg08 + scar20 buys; scar20 auto-sniper cadence: 300ms gap
//     accepted, 100ms follow-up REJECTED
//  5. wrong-team: CT buying galil (T-only) → buyError; the T witness buys
//     galil + g3sg1 and fires (both directions proven)
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const ROOM = 'p5e2e-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

let myId = ''
let phase = ''
let roundNo = 0
let results: Record<string, string> = {}
let finished = false
let moneyByBuy: string[] = []
let witnessShots: string[] = []
let witnessBuyTrail: Array<{ money: number; inventory: string[] }> = []
let ammoEvent: { weapon: string; mag: number; reserve: number } | null = null
let seqStarted = false

function done(key: string, ok: boolean, detail: string) { results[key] = (ok ? 'PASS' : 'FAIL') + ' — ' + detail }

const witness = io(URL, { path: '/' })

sock.on('connect', () => {
  sock.emit('join', { name: 'RifleTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 })
})
witness.on('connect', () => {
  witness.emit('join', { name: 'Witness', room: ROOM, team: 'T', botFill: false, winTarget: 16 })
})

sock.on('joinError', (d: { msg: string }) => { console.log('JOIN ERROR:', d.msg); process.exit(1) })
sock.on('init', (d: { youId: string }) => { myId = d.youId })

sock.on('round', (d: { phase: string; round: number }) => {
  phase = d.phase
  if (d.round) roundNo = d.round
  if (phase === 'freeze' && roundNo === 1 && !seqStarted) {
    seqStarted = true
    runSequence()
  }
})
witness.on('round', (d: { phase: string; round: number }) => {
  if (d.phase === 'freeze' && d.round === 1) {
    // T-side proof: galil budget rifle + g3sg1 auto-sniper, one shot each
    witness.emit('buy', { item: 'galil' })
    setTimeout(() => witness.emit('buy', { item: 'g3sg1' }), 300)
    setTimeout(() => witness.emit('shoot', { weapon: 'g3sg1', origin: [0, 1.6, 0], dir: [1, 0, 0] }), 800)
  }
})

sock.on('buyOk', (d: { money: number; inventory: string[] }) => {
  moneyByBuy.push(`${d.money}:${d.inventory.join(',')}`)
})
witness.on('buyOk', (d: { money: number; inventory: string[] }) => { witnessBuyTrail.push(d) })
sock.on('buyError', (d: { msg: string }) => { done('wrong-team-rejected', d.msg === 'Wrong team weapon', `galil as CT → "${d.msg}"`) })
sock.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => { ammoEvent = d })

witness.on('shot', (d: { id: string; weapon: string }) => {
  if (d.id === myId) witnessShots.push(d.weapon)
})

function shoot(weapon: string) {
  sock.emit('shoot', { weapon, origin: [0, 1.6, 0], dir: [1, 0, 0] })
}

// --- phase A: buys (inside the freeze window) ---
function runSequence() {
  sock.emit('buy', { item: 'galil' })   // wrong-team probe (expect buyError)
  const steps: Array<() => void> = [
    () => sock.emit('buy', { item: 'm4a1s' }), () => shoot('m4a1s'),
    () => sock.emit('buy', { item: 'famas' }),
  ]
  let i = 0
  const tick = () => {
    if (i >= steps.length) { setTimeout(phaseB, 400); return }
    steps[i++]()
    setTimeout(tick, 300)
  }
  setTimeout(tick, 400)
}

// --- phase B: famas full-auto cadence proof + reload, then the roster ---
// t0: prior accepted shot (m4a1s) ≥ 700ms ago. Rate gate: 90-12=78ms.
function phaseB() {
  shoot('famas')                     // 1/4: accepted (opens the sequence)
  setTimeout(() => {
    shoot('famas')                   // +40: gap 40 < 78 → REJECTED
    setTimeout(() => {
      shoot('famas')                 // gap 140 ≥ 78 ✓ (2/4)
      setTimeout(() => {
        shoot('famas')               // gap 100 ≥ 78 ✓ (3/4)
        setTimeout(() => {
          shoot('famas')             // +40: gap 40 < 78 → REJECTED
          setTimeout(() => {
            shoot('famas')           // gap 140 ≥ 78 ✓ (4/4)
            setTimeout(() => {
              sock.emit('reload', { weapon: 'famas' })   // mag 21 → 25/86
              setTimeout(phaseC, 3700) // reloadMs 3300 + margin
            }, 100)
          }, 40)
        }, 100)
      }, 100)
    }, 40)
  }, 40)
}

// --- phase C: aug / ssg08 / scar20 + auto-sniper cadence proof ---
// NOTE: the rate gate uses the CURRENT weapon's fireDelay (per-player
// lastShotAt) — ssg08 needs ≥1238ms after the aug shot, so the gaps are long.
function phaseC() {
  sock.emit('buy', { item: 'aug' })
  setTimeout(() => {
    shoot('aug')                     // aug accepted
    setTimeout(() => {
      sock.emit('buy', { item: 'ssg08' })
      setTimeout(() => {
        shoot('ssg08')               // gap 1400ms ≥ 1238 ✓ accepted
        setTimeout(() => {
          sock.emit('buy', { item: 'scar20' })
          setTimeout(() => {
            shoot('scar20')          // gap 600ms ≥ 238 ✓ accepted
            setTimeout(() => {
              shoot('scar20')        // 300ms ≥ 238 ✓ accepted
              setTimeout(() => {
                shoot('scar20')      // 100ms < 238 → REJECTED
                setTimeout(finish, 400)
              }, 100)
            }, 300)
          }, 300)
        }, 300)
      }, 1100)
    }, 300)
  }, 300)
}

function finish() {
  if (finished) return
  finished = true
  console.log('\n--- money/inventory trail ---')
  for (const t of moneyByBuy) console.log('  buyOk', t)
  console.log('--- witness shots ---', witnessShots.join(' '))
  console.log('--- witness buy trail ---', JSON.stringify(witnessBuyTrail))
  console.log('--- ammo event ---', JSON.stringify(ammoEvent))

  // 1. CT money trail: 16000 → m4a1s 2900 → famas 1700 → aug 3300 → ssg08 1700 → scar20 5000
  const wantMoney = ['13100', '11400', '8100', '6400', '1400']
  const gotMoney = moneyByBuy.map(m => m.split(':')[0])
  const invOk = moneyByBuy.every(m => {
    const inv = m.split(':')[1].split(',')
    return inv.length === 3 && inv[1] === 'usp' && inv[2] === 'knife'
  })
  done('buy-money-trail', JSON.stringify(gotMoney) === JSON.stringify(wantMoney), gotMoney.join(' → '))
  done('slot1-replacement', invOk, 'every purchase keeps [rifle, usp, knife]')
  done('wrong-team-rejected', (results['wrong-team-rejected'] ?? '').startsWith('PASS'), (results['wrong-team-rejected'] ?? 'no buyError seen').replace(/^PASS — |^FAIL — /, ''))

  // 2. T witness: galil then g3sg1, exact money
  done('witness-buys-galil-g3sg1',
    witnessBuyTrail.length === 2 &&
    witnessBuyTrail[0].money === 14200 && witnessBuyTrail[0].inventory[0] === 'galil' &&
    witnessBuyTrail[1].money === 9200 && witnessBuyTrail[1].inventory[0] === 'g3sg1',
    witnessBuyTrail.map(b => `${b.inventory.join(',')} @ $${b.money}`).join(' | '))

  // 3. famas full-auto cadence: exactly 4 accepted shots (100ms+ gaps);
  //    the two 40ms spam shots were rate-rejected by the server
  const famasCount = witnessShots.filter(w => w === 'famas').length
  done('famas-auto-cadence', famasCount === 4,
    '100ms auto shots accepted (666 RPM), 40ms spam rate-rejected ×2')

  // 4. sniper cadence: scar20 fires twice (300ms gap ok, 100ms rejected)
  const scarCount = witnessShots.filter(w => w === 'scar20').length
  done('scar20-cadence', scarCount === 2, '300ms double-tap accepted, 100ms follow-up rate-rejected')

  // 5. reload round-trip: famas 4 fired → 25/86
  done('famas-reload-round-trip',
    !!ammoEvent && ammoEvent.weapon === 'famas' && ammoEvent.mag === 25 && ammoEvent.reserve === 86,
    ammoEvent ? `mag=${ammoEvent.mag} reserve=${ammoEvent.reserve}` : 'no ammo event')

  // 6. shot order (witness observes the exact sequence)
  const wantShots = ['m4a1s', 'famas', 'famas', 'famas', 'famas', 'aug', 'ssg08', 'scar20', 'scar20']
  done('shots-broadcast', JSON.stringify(witnessShots) === JSON.stringify(wantShots), witnessShots.join(' '))

  const need = ['buy-money-trail', 'slot1-replacement', 'wrong-team-rejected', 'witness-buys-galil-g3sg1',
    'famas-auto-cadence', 'scar20-cadence', 'famas-reload-round-trip', 'shots-broadcast']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(24)} ${v}`)
  console.log('=====', allPass ? 'ALL PASS' : 'SOME FAILED', '=====')
  sock.disconnect()
  witness.disconnect()
  process.exit(allPass ? 0 : 1)
}

// watchdog
setTimeout(() => {
  if (finished) return
  finished = true
  if (!results['buy-money-trail']) done('buy-money-trail', false, `never reached freeze (phase=${phase} r${roundNo})`)
  console.log('\n===== RESULTS (watchdog) =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(24)} ${v}`)
  process.exit(1)
}, 60000)
