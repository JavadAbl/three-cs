// PHASE 4 E2E — the 6 new SMGs through the REAL game server
// Timeline (freeze + early live, buys inside the buy window):
//  1. buy every CT-legal new SMG in price order: exact money decrement per
//     price, slot-1 replacement keeps inventory = [smg, usp, knife]
//  2. wrong-team rejection: CT trying to buy mac10 (T-only) — while the T
//     witness successfully buys mac10 (team flavor proof, both directions)
//  3. fire each SMG: a witness socket observes the 'shot' broadcast with
//     the right weapon id
//  4. mp7 cadence: two shots 70ms apart both pass (fireDelay 67 → gate 55);
//     a 40ms follow-up is REJECTED (server fire-rate anti-cheat)
//  5. bizon reload round-trip: fresh 64/120, fire 1 → reload → 'ammo' 64/119
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const ROOM = 'p4e2e-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

let myId = ''
let phase = ''
let roundNo = 0
let results: Record<string, string> = {}
let finished = false
let moneyByBuy: string[] = []          // ordered buyOk money trail (tester)
let witnessShots: string[] = []        // weapon ids observed by the witness
let witnessBuy: { money: number; inventory: string[] } | null = null
let ammoEvent: { weapon: string; mag: number; reserve: number } | null = null
let seqStarted = false

function done(key: string, ok: boolean, detail: string) { results[key] = (ok ? 'PASS' : 'FAIL') + ' — ' + detail }

const witness = io(URL, { path: '/' })

sock.on('connect', () => {
  sock.emit('join', { name: 'SmgTester', room: ROOM, team: 'CT', botFill: false, winTarget: 16 })
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
  if (d.phase === 'freeze' && d.round === 1 && !witnessBuy) {
    witness.emit('buy', { item: 'mac10' })   // T-legal counterpart of the probe
  }
})

sock.on('buyOk', (d: { money: number; inventory: string[] }) => {
  moneyByBuy.push(`${d.money}:${d.inventory.join(',')}`)
})
witness.on('buyOk', (d: { money: number; inventory: string[] }) => { witnessBuy = d })
sock.on('buyError', (d: { msg: string }) => { done('wrong-team-rejected', d.msg === 'Wrong team weapon', `mac10 as CT → "${d.msg}"`) })
sock.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => { ammoEvent = d })

witness.on('shot', (d: { id: string; weapon: string }) => {
  if (d.id === myId) witnessShots.push(d.weapon)
})

function shoot(weapon: string) {
  sock.emit('shoot', { weapon, origin: [0, 1.6, 0], dir: [1, 0, 0] })
}

// --- phase A: buy + fire loop (300ms steps) ---
function runSequence() {
  sock.emit('buy', { item: 'mac10' })   // wrong-team probe (expect buyError)
  const steps: Array<() => void> = [
    () => sock.emit('buy', { item: 'mp9' }), () => shoot('mp9'),
    () => sock.emit('buy', { item: 'mp7' }), () => shoot('mp7'),
    () => sock.emit('buy', { item: 'ump45' }), () => shoot('ump45'),
    () => sock.emit('buy', { item: 'p90' }), () => shoot('p90'),
    () => sock.emit('buy', { item: 'bizon' }), () => shoot('bizon'),
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
  sock.emit('buy', { item: 'mp7' })     // fresh mp7 for the cadence proof
  setTimeout(() => {
    shoot('mp7')                        // #1 accepted
    setTimeout(() => {
      shoot('mp7')                      // #2: 70ms ≥ gate(55) ✓ accepted
      setTimeout(() => {
        shoot('mp7')                    // #3: 40ms < 55 → rate-REJECTED
        setTimeout(() => {
          sock.emit('buy', { item: 'bizon' })   // fresh 64/120
          setTimeout(() => {
            shoot('bizon')              // gap 630ms ≥ 68 ✓ accepted, mag 63
            sock.emit('reload', { weapon: 'bizon' })
            setTimeout(finish, 3900)    // reloadMs 3400 + margin
          }, 300)
        }, 40)
      }, 70)
    }, 0)
  }, 300)
}

function finish() {
  if (finished) return
  finished = true
  console.log('\n--- money/inventory trail ---')
  for (const t of moneyByBuy) console.log('  buyOk', t)
  console.log('--- witness shots ---', witnessShots.join(' '))
  console.log('--- witness buy ---', JSON.stringify(witnessBuy))
  console.log('--- ammo event ---', JSON.stringify(ammoEvent))

  // 1. buys: exact money trail (16000 start; mp7 bought twice, bizon twice)
  const wantMoney = ['14750', '13250', '11750', '9400', '8000', '6500', '5100']
  const gotMoney = moneyByBuy.map(m => m.split(':')[0])
  const invOk = moneyByBuy.every(m => {
    const inv = m.split(':')[1].split(',')
    return inv.length === 3 && inv[1] === 'usp' && inv[2] === 'knife'
  })
  done('buy-money-trail', JSON.stringify(gotMoney) === JSON.stringify(wantMoney), gotMoney.join(' → '))
  done('slot1-replacement', invOk, 'every purchase keeps [smg, usp, knife]')

  // 2. team flavor, both directions
  done('wrong-team-rejected', (results['wrong-team-rejected'] ?? '').startsWith('PASS'), (results['wrong-team-rejected'] ?? 'no buyError seen').replace(/^PASS — |^FAIL — /, ''))
  done('witness-buys-mac10',
    !!witnessBuy && witnessBuy.money === 14750 && witnessBuy.inventory[0] === 'mac10',
    witnessBuy ? `${witnessBuy.inventory.join(',')} @ $${witnessBuy.money}` : 'no witness buyOk')

  // 3. shots observed by the witness, exact order
  const wantShots = ['mp9', 'mp7', 'ump45', 'p90', 'bizon', 'mp7', 'mp7', 'bizon']
  done('shots-broadcast', JSON.stringify(witnessShots) === JSON.stringify(wantShots), witnessShots.join(' '))
  done('mp7-double-tap', witnessShots.filter(w => w === 'mp7').length === 3,
    '70ms double-tap accepted, 40ms follow-up rate-rejected')

  // 4. bizon reload round-trip (fresh 64/120, fired 1 → refill 64/119)
  done('bizon-reload-round-trip',
    !!ammoEvent && ammoEvent.weapon === 'bizon' && ammoEvent.mag === 64 && ammoEvent.reserve === 119,
    ammoEvent ? `mag=${ammoEvent.mag} reserve=${ammoEvent.reserve}` : 'no ammo event')

  const need = ['buy-money-trail', 'slot1-replacement', 'wrong-team-rejected', 'witness-buys-mac10',
    'shots-broadcast', 'mp7-double-tap', 'bizon-reload-round-trip']
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
