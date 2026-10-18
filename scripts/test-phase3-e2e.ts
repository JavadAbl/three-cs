// PHASE 3 E2E — the 8 new pistols through the REAL game server
// Timeline (freeze + early live, buys inside the buy window):
//  1. buy every CT-legal new pistol: exact money decrement per price, slot-2
//     replacement keeps inventory = [current, knife]
//  2. wrong-team rejection: CT trying to buy tec9 (T-only)
//  3. fire each pistol: a witness socket (other player) observes the 'shot'
//     broadcast with the right weapon id
//  4. cz75 auto-cadence: two shots 90ms apart both pass (fireDelay 75)
//  5. revolver slow trigger: legal shot, then a 90ms follow-up is REJECTED
//  6. zeus one-use: rate-legal 2nd taser shot is REJECTED by empty mag
//  7. reload round-trip: fresh cz75, fire 1, reload → 'ammo' 12/23
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const ROOM = 'p3e2e-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

let myId = ''
let phase = ''
let roundNo = 0
let results: Record<string, string> = {}
let finished = false
let moneyByBuy: string[] = []          // ordered buyOk money trail
let witnessShots: string[] = []        // weapon ids observed by the witness
let ammoEvent: { weapon: string; mag: number; reserve: number } | null = null
let seqStarted = false

function done(key: string, ok: boolean, detail: string) { results[key] = (ok ? 'PASS' : 'FAIL') + ' — ' + detail }

const witness = io(URL, { path: '/' })

sock.on('connect', () => {
  sock.emit('join', { name: 'PistolTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 })
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

sock.on('buyOk', (d: { money: number; inventory: string[] }) => {
  moneyByBuy.push(`${d.money}:${d.inventory.join(',')}`)
})
sock.on('buyError', (d: { msg: string }) => { done('wrong-team-rejected', d.msg === 'Wrong team weapon', `tec9 as CT → "${d.msg}"`) })
sock.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => { ammoEvent = d })

witness.on('shot', (d: { id: string; weapon: string }) => {
  if (d.id === myId) witnessShots.push(d.weapon)
})

function shoot(weapon: string) {
  sock.emit('shoot', { weapon, origin: [0, 1.6, 0], dir: [1, 0, 0] })
}

// --- phase A: buy + fire loop (300ms steps; revolver fires later — its
// 1000ms fireDelay can't fit the loop cadence) ---
function runSequence() {
  sock.emit('buy', { item: 'tec9' })   // wrong-team probe (expect buyError)
  const steps: Array<() => void> = [
    () => sock.emit('buy', { item: 'p250' }), () => shoot('p250'),
    () => sock.emit('buy', { item: 'fiveseven' }), () => shoot('fiveseven'),
    () => sock.emit('buy', { item: 'cz75' }), () => shoot('cz75'),
    () => sock.emit('buy', { item: 'elites' }), () => shoot('elites'),
    () => sock.emit('buy', { item: 'revolver' }),            // bought, fires in phase B
    () => sock.emit('buy', { item: 'taser' }), () => shoot('taser'),
  ]
  let i = 0
  const tick = () => {
    if (i >= steps.length) { setTimeout(phaseB, 400); return }
    steps[i++]()
    setTimeout(tick, 300)
  }
  setTimeout(tick, 400)
}

// --- phase B: mechanics proofs (T0 = entry; prior accepted shot ≥ 700ms ago) ---
function phaseB() {
  shoot('cz75')                    // cz75 #2: gap vs taser ≈ 700ms ≥ 63 ✓ accepted
  setTimeout(() => {
    shoot('cz75')                  // cz75 #3: 90ms cadence ≥ 63 ✓ accepted (auto feel)
    setTimeout(() => {
      shoot('revolver')            // gap vs cz75#3 = 1100ms ≥ 988 ✓ accepted
      setTimeout(() => {
        shoot('revolver')          // 90ms follow-up < 988 → rate-REJECTED (slow trigger)
        setTimeout(() => {
          shoot('taser')           // gap 690ms ≥ 388 ✓ rate-pass, mag 0 → ammo-REJECTED (one use)
          setTimeout(() => {
            sock.emit('buy', { item: 'cz75' })   // fresh 12/24
            setTimeout(() => {
              shoot('cz75')        // fresh cz75, accepted, mag 11
              sock.emit('reload', { weapon: 'cz75' })
              setTimeout(finish, 2600)
            }, 300)
          }, 600)
        }, 90)
      }, 90)
    }, 1100)
  }, 90)
}

function finish() {
  if (finished) return
  finished = true
  console.log('\n--- money/inventory trail ---')
  for (const t of moneyByBuy) console.log('  buyOk', t)
  console.log('--- witness shots ---', witnessShots.join(' '))
  console.log('--- ammo event ---', JSON.stringify(ammoEvent))

  // 1. buys: exact money trail + slot-2 replacement
  const wantMoney = ['15700', '15200', '14700', '14200', '13600', '13400', '12900']
  const gotMoney = moneyByBuy.map(m => m.split(':')[0])
  const invOk = moneyByBuy.every(m => {
    const inv = m.split(':')[1].split(',')
    return inv.length === 2 && inv[1] === 'knife'
  })
  done('buy-money-trail', JSON.stringify(gotMoney) === JSON.stringify(wantMoney), gotMoney.join(' → '))
  done('slot2-replacement', invOk, 'every purchase keeps [pistol, knife]')
  done('wrong-team-rejected', (results['wrong-team-rejected'] ?? '').startsWith('PASS'), (results['wrong-team-rejected'] ?? 'no buyError seen').replace(/^PASS — |^FAIL — /, ''))

  // 2. shots observed by the witness, exact order
  const wantShots = ['p250', 'fiveseven', 'cz75', 'elites', 'taser', 'cz75', 'cz75', 'revolver', 'cz75']
  done('shots-broadcast', JSON.stringify(witnessShots) === JSON.stringify(wantShots), witnessShots.join(' '))
  done('revolver-slow-trigger', witnessShots.filter(w => w === 'revolver').length === 1, 'rapid 2nd revolver shot rejected')
  done('taser-one-use', witnessShots.filter(w => w === 'taser').length === 1, 'rate-legal 2nd taser shot rejected by empty mag')
  done('cz75-auto-cadence', witnessShots.filter(w => w === 'cz75').length === 4, '90ms cz75 double-tap accepted')

  // 3. reload round-trip (fresh cz75 12/24, fired 1 → refill 12/23)
  done('reload-round-trip',
    !!ammoEvent && ammoEvent.weapon === 'cz75' && ammoEvent.mag === 12 && ammoEvent.reserve === 23,
    ammoEvent ? `mag=${ammoEvent.mag} reserve=${ammoEvent.reserve}` : 'no ammo event')

  const need = ['buy-money-trail', 'slot2-replacement', 'wrong-team-rejected', 'shots-broadcast',
    'revolver-slow-trigger', 'taser-one-use', 'cz75-auto-cadence', 'reload-round-trip']
  const allPass = need.every(k => results[k]?.startsWith('PASS'))
  console.log('\n===== RESULTS =====')
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(22)} ${v}`)
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
  for (const [k, v] of Object.entries(results)) console.log(`${k.padEnd(22)} ${v}`)
  process.exit(1)
}, 45000)
