// End-to-end reload verification: drain mag via 'shoot', reload, expect 'ammo' sync back.
// Also verifies cancellation (weapon switch mid-reload must NOT refill).
import { io } from 'socket.io-client'

const sock = io('http://localhost:3003', { path: '/' })
const log = (...a: unknown[]) => console.log('[probe]', ...a)
let youId = ''
let pass = 0, fail = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; log(`PASS ${name} ${extra}`) } else { fail++; log(`FAIL ${name} ${extra}`) }
}

sock.on('connect', () => {
  sock.emit('join', { name: 'ReloadProbe', room: 'reloadtest', team: 'CT', botFill: true, botDifficulty: 'easy', winTarget: 4 })
})

sock.on('init', (d: any) => { youId = d.youId; log('joined, phase=', d.match.phase) })
sock.on('joinError', (d: any) => { log('joinError', d); process.exit(1) })

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function waitFor(cond: () => boolean, ms: number, label: string): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(200) }
  log(`timeout waiting for ${label}`)
  return false
}

// track ammo events
let ammoEvents: Array<{ weapon: string; mag: number; reserve: number }> = []
sock.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => {
  ammoEvents.push({ ...d })
  log('AMMO EVENT:', JSON.stringify(d))
})

sock.on('round', (d: any) => { if (d.phase === 'live') log('round live') })

async function main() {
  // wait until alive (round started)
  const alive = await waitFor(() => {
    const s = (sock as any).sendBuffer // noop
    return ammoEvents.length >= 0 && Date.now() > 0
  }, 1, '')
  void alive

  // We need to know we're alive; server gives no direct query — use 'shoot' ack via round events.
  // Simplest: wait for freeze->live by listening 'round' events; meanwhile just wait fixed time.
  await wait(12000) // warmup->freeze(8s)->live
  log('assuming live now, starting reload test')

  // ---- TEST 1: drain 5 rounds via 'shoot' (server decrements mag) ----
  for (let i = 0; i < 5; i++) {
    sock.emit('shoot', { weapon: 'usp', origin: [0, 1.6, 0], dir: [0, 0, 1] })
    await wait(200) // respect fireDelay 170ms
  }
  log('fired 5 shots')

  // ---- TEST 2: reload, expect 'ammo' with mag refilled ----
  ammoEvents = []
  sock.emit('reload', { weapon: 'usp' })
  await wait(2600) // usp reloadMs 2200
  const ev = ammoEvents.find(e => e.weapon === 'usp')
  ok('ammo-sync-after-reload', !!ev, ev ? JSON.stringify(ev) : 'no ammo event')
  ok('mag-refilled', ev?.mag === 12, `mag=${ev?.mag}`)
  ok('reserve-drained', ev?.reserve === 19, `reserve=${ev?.reserve}`)

  // ---- TEST 3: cancel by switching mid-reload ----
  // drain 3 more
  for (let i = 0; i < 3; i++) {
    sock.emit('shoot', { weapon: 'usp', origin: [0, 1.6, 0], dir: [0, 0, 1] })
    await wait(200)
  }
  ammoEvents = []
  sock.emit('reload', { weapon: 'usp' })
  await wait(600) // mid-reload
  sock.emit('switch', { wIdx: 1 }) // cancel
  await wait(2400) // past reload end
  const ev2 = ammoEvents.find(e => e.weapon === 'usp')
  ok('reload-cancel-no-ammo', !ev2, ev2 ? 'got unexpected ammo event ' + JSON.stringify(ev2) : 'no ammo event after cancel')

  // ---- TEST 4: reload blocked while reloading (double R) ----
  ammoEvents = []
  sock.emit('reload', { weapon: 'usp' })
  await wait(300)
  sock.emit('reload', { weapon: 'usp' }) // should be ignored (reload in progress)
  await wait(2600)
  const ev3 = ammoEvents.filter(e => e.weapon === 'usp')
  ok('single-refill-on-double-r', ev3.length <= 1 && ev3.length >= 0, `events=${ev3.length}`)
  if (ev3.length) ok('double-r-mag', ev3[0].mag === 12, `mag=${ev3[0].mag}`)

  log(`RESULT: ${pass} passed, ${fail} failed`)
  sock.disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(e => { log('ERROR', e); process.exit(1) })
setTimeout(() => { log('GLOBAL TIMEOUT'); process.exit(1) }, 45000)
