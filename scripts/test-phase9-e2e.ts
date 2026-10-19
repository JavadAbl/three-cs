// PHASE 9 E2E — full-roster smoke + load sanity (plan 9.2).
// PART A: data-driven loop over EVERY buy entry (BUY_ENTRIES is the single
//   source — no hand-written weapon list). CT tester + T tester (T-only guns:
//   tec9/mac10/galil/sg553/g3sg1/sawedoff/molotov route to the T socket),
//   third T socket = pure witness/victim (counts 'shot'/'nade' broadcasts —
//   the shooter never sees their own). Per gun: buy (exact money trail +
//   inventory), 2 legal-cadence shots, reload round-trip (mag refilled,
//   reserve drained by exactly the fired count; taser: single-use drain,
//   dry second shot rejected, no reload). Grenades: buy stack + one throw ->
//   'nade' entity broadcast. Gear: buy -> armor/helmet/kit state.
//   LESSONS baked in (from the first run + diag-round):
//   - players MOVE INCREMENTALLY (hop): single far 'state' emits trip the
//     anti-teleport guard (12m/claim) and victims stay spawn-side -> no LOS
//     -> hit claims silently dropped (rounds never advanced)
//   - damage claims only apply during 'live' (applyDamage phase gate)
//   - buys are legal only in freeze + the first 20s of live -> batches are
//     sized by a TIME BUDGET computed from fireDelay/reloadMs per weapon
//   - rounds advance by eliminating both Ts (usp control kills) -> post 6s
//     -> next freeze; everyone re-hops each round (roundStart teleports).
// PART B: load sanity — 10 sockets (5v5), all negev, 8s sustained barrage at
//   75ms cadence; snapshot inter-arrival gaps (20 Hz nominal 50ms) compared
//   idle vs barrage: p95 budget + max drift prove the tick is never starved
//   (the per-claim O(1) rate-gate architecture, plan 9.2's tick measurement).
import { io } from 'socket.io-client'
import { BUY_ENTRIES, WEAPONS, BuyEntry, WeaponDef } from '../shared/weapons'

const URL = 'http://localhost:3003'
type Sock = ReturnType<typeof io>

let pass = 0, fail = 0
function done(key: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`PASS — ${key} · ${detail}`) }
  else { fail++; console.log(`FAIL — ${key} · ${detail}`) }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- PART A
const ROOM = 'p9smoke-' + Math.random().toString(36).slice(2, 6)
const atk = io(URL, { path: '/' })      // CT tester (CT + neutral entries)
const vt = io(URL, { path: '/' })       // T tester (T-only entries)
const wit = io(URL, { path: '/' })      // T witness/victim (never fires; counts broadcasts)

let myId = '', vtId = '', witId = ''
let phase = '', roundNo = 0
const ATK: [number, number, number] = [0, 0, 40]     // CT tester spot
const VTP: [number, number, number] = [6, 0, 40]     // T tester spot (6m)
const WITP: [number, number, number] = [14, 0, 40]   // witness/victim spot (14m)

type BuyOk = { money: number; inventory: string[]; armor: number; helmet: boolean; hasKit: boolean }
let lastBuyCT: BuyOk | null = null
let lastBuyT: BuyOk | null = null
const shotSeen: Array<{ id: string; weapon: string }> = []
const ammoCT: Array<{ weapon: string; mag: number; reserve: number }> = []
const ammoT: Array<{ weapon: string; mag: number; reserve: number }> = []
const nades: Array<{ id: number; kind: string }> = []
const kills: Array<{ victim: string }> = []
const buyErrs: Array<string> = []
let started = false
const T0 = Date.now()
const tl = (...a: unknown[]) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}]`, ...a)
let lastPhaseAt = 0

atk.on('connect', () => atk.emit('join', { name: 'SmokeCT', room: ROOM, team: 'CT', botFill: false, winTarget: 16 }))
vt.on('connect', () => vt.emit('join', { name: 'SmokeT', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
wit.on('connect', () => wit.emit('join', { name: 'Witness', room: ROOM, team: 'T', botFill: false, winTarget: 16 }))
for (const [s, n] of [[atk, 'CT'], [vt, 'T'], [wit, 'WIT']] as Array<[Sock, string]>) {
  s.on('joinError', (d: { msg: string }) => { console.log(`${n} JOIN ERROR:`, d.msg); process.exit(1) })
}
atk.on('init', (d: { youId: string }) => { myId = d.youId })
vt.on('init', (d: { youId: string }) => { vtId = d.youId })
wit.on('init', (d: { youId: string }) => { witId = d.youId })
atk.on('buyOk', (d: { money: number; inventory: string[]; armor: number; helmet: boolean; hasKit: boolean }) => { lastBuyCT = d })
vt.on('buyOk', (d: { money: number; inventory: string[]; armor: number; helmet: boolean; hasKit: boolean }) => { lastBuyT = d })
atk.on('buyError', (d: { msg: string }) => buyErrs.push(`CT:${d.msg}`))
vt.on('buyError', (d: { msg: string }) => buyErrs.push(`T:${d.msg}`))
atk.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => ammoCT.push(d))
vt.on('ammo', (d: { weapon: string; mag: number; reserve: number }) => ammoT.push(d))
wit.on('shot', (d: { id: string; weapon: string }) => shotSeen.push({ ...d }))
wit.on('nade', (d: { id: number; kind: string }) => nades.push(d))
wit.on('kill', (d: { victim: string }) => kills.push(d))
wit.on('hitConfirm', (d: { victimId: string; dmg: number; hp: number }) =>
  tl(`hitConfirm victim=${d.victimId === vtId ? 'VT' : d.victimId === witId ? 'WIT' : d.victimId} dmg=${d.dmg} hp=${d.hp}`))
atk.on('round', (d: { phase: string; round: number }) => {
  phase = d.phase; roundNo = d.round
  tl(`ROUND phase=${phase} round=${roundNo}`)
  if (phase === 'freeze' && !started) { started = true; setTimeout(main, 300) }
})

// incremental movement — single far emits trip the anti-teleport guard
function hop(s: Sock, id: string, to: [number, number, number], cb: () => void) {
  // NOTE: lastPos tracks the client's last KNOWN position; after roundStart
  // teleports, the first emit may be rejected by the anti-teleport guard if
  // the real spawn is far — so hop re-syncs from the ACTUAL server position
  // via the snapshot before moving (positions reset every round).
  const from = lastPos[id] ?? [0, 0, 0]
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 9))
  let i = 0
  const tick = () => {
    i++
    const t = Math.min(1, i / steps)
    const x = from[0] + (to[0] - from[0]) * t, z = from[2] + (to[2] - from[2]) * t
    lastPos[id] = [x, 0, z]
    s.emit('state', { x, y: 0, z, yaw: 0, pitch: 0, moving: false })
    if (i < steps) setTimeout(tick, 45)
    else setTimeout(cb, 120)
  }
  tick()
}
const lastPos: Record<string, [number, number, number]> = {}
let snapSeq = 0

// server-truth position sync: read the witness's snapshot rows (the players
// Map resets positions at roundStart — client bookkeeping alone drifts)
wit.on('snapshot', (d: { ps: unknown[][] }) => {
  snapSeq++
  try {
    for (const row of d.ps) {
      const id = row[0] as string
      lastPos[id] = [row[1] as number, row[2] as number, row[3] as number]
    }
  } catch { /* snapshot shape drift — non-fatal */ }
})

function dirTo(from: [number, number, number], to: [number, number, number]): [number, number, number] {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
  const l = Math.hypot(dx, dy, dz) || 1
  return [dx / l, dy / l, dz / l]
}
function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  return new Promise(res => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); res(true) }
      else if (Date.now() - t0 > ms) { clearInterval(iv); res(false) }
    }, 25)
  })
}
const waitPhase = (p: string, ms: number) => waitFor(() => phase === p, ms)

const def = (id: string) => (WEAPONS as Record<string, WeaponDef>)[id]

async function buyOnce(s: Sock, which: 'ct' | 't', item: string) {
  if (which === 'ct') lastBuyCT = null; else lastBuyT = null
  const errMark = buyErrs.length
  s.emit('buy', { item })
  // resolve on EITHER buyOk or buyError (fast-fail, no 4s stalls)
  const ok = await waitFor(() => (which === 'ct' ? lastBuyCT : lastBuyT) !== null || buyErrs.length > errMark, 4000)
  const got = which === 'ct' ? lastBuyCT : lastBuyT
  if (!got) tl(`buy ${item} REJECTED at phase=${phase} round=${roundNo}: ${buyErrs[errMark] ?? 'timeout'}`)
  return got
}

async function testGun(e: BuyEntry) {
  const w = def(e.id)
  const isT = w.team === 'T'
  const s = isT ? vt : atk
  const which = isT ? 't' : 'ct'
  const shooterId = isT ? vtId : myId
  const spot = isT ? VTP : ATK
  const b = await buyOnce(s, which, e.id)
  done(`buy ${e.id}`, !!b && b!.money >= 0 && b!.inventory.includes(e.id as never),
    `${isT ? 'T' : 'CT'} money ${b?.money}, inv ok`)
  if (!b) return

  const shots = e.id === 'taser' ? 1 : 2
  const n0 = shotSeen.length
  const d = dirTo(spot, WITP)
  const origin = [spot[0], spot[1] + 1.62, spot[2]]
  for (let i = 0; i < shots; i++) {
    s.emit('shoot', { weapon: e.id, origin, dir: d })
    await sleep(w.fireDelay + 40)
  }
  if (e.id === 'taser') { // drained: the next pull must NOT broadcast
    s.emit('shoot', { weapon: 'taser', origin, dir: d })
    await sleep(450)
  }
  const seen = shotSeen.slice(n0).filter(x => x.id === shooterId && x.weapon === e.id)
  done(`fire ${e.id}`, seen.length === shots, `${seen.length}/${shots} 'shot' broadcasts (witness)`)

  if (e.id === 'taser') return // reserve 0 — reload intentionally impossible
  const ammoArr = isT ? ammoT : ammoCT
  const a0 = ammoArr.length
  s.emit('reload', { weapon: e.id })
  const okAmmo = await waitFor(() => ammoArr.length > a0, w.reloadMs + 4000)
  const a = ammoArr[a0]
  done(`reload ${e.id}`, okAmmo && !!a && a.weapon === e.id && a.mag === w.mag && a.reserve === w.reserve - shots,
    a ? `mag ${a.mag}/${w.mag}, reserve ${a.reserve}/${w.reserve - shots} expected` : 'no ammo event')
}

async function testNade(e: BuyEntry) {
  const w = def(e.id)
  const isT = w.team === 'T'
  const s = isT ? vt : atk
  const which = isT ? 't' : 'ct'
  const spot = isT ? VTP : ATK
  const b = await buyOnce(s, which, e.id)
  const stack = b ? b!.inventory.filter(x => x === e.id).length : 0
  done(`buy ${e.id}`, !!b && stack >= 1, `stack ${stack}/${w.maxCarry ?? 1}`)
  if (!b) return
  const n0 = nades.length
  // throws are live-phase-gated (throwGrenade checks m.phase) — buys ride the
  // freeze window, the throw itself waits for live
  await waitPhase('live', 13000)
  const d = dirTo(spot, WITP)
  s.emit('throw', { weapon: e.id, dir: [d[0], 0.25, d[2]], power: 0.4 })
  await sleep(900)
  const seen = nades.slice(n0).filter(n => n.kind === e.id)
  done(`throw ${e.id}`, seen.length >= 1, `'nade' entity broadcast x${seen.length}`)
}

async function testGear(e: BuyEntry) {
  const b = await buyOnce(atk, 'ct', e.id)
  let ok = !!b
  let detail = ''
  if (e.id === 'kevlar') { ok = ok && b!.armor === 100 && !b!.helmet; detail = `armor ${b?.armor}` }
  if (e.id === 'kevlarhelm') { ok = ok && b!.armor === 100 && b!.helmet; detail = `armor ${b?.armor} helm ${b?.helmet}` }
  if (e.id === 'defusekit') { ok = ok && b!.hasKit; detail = `kit ${b?.hasKit}` }
  done(`buy ${e.id}`, ok, detail)
}

async function endRound() {
  // kill BOTH Ts (vt at VTP, wit at WITP — both already placed) with usp
  // control claims; damage only applies during live
  await waitPhase('live', 13000)
  tl(`endRound: phase=${phase} round=${roundNo} — positions atk=${JSON.stringify(lastPos[myId])} vt=${JSON.stringify(lastPos[vtId])} wit=${JSON.stringify(lastPos[witId])}`)
  for (const id of [vtId, witId]) {
    for (let i = 0; i < 4; i++) {
      atk.emit('hit', { target: id, part: 'body', dist: 12, weapon: 'usp' })
      await sleep(70)
    }
  }
  const killed = await waitFor(() => kills.length >= 2, 5000)
  tl(`endRound: kills=${kills.length} ok=${killed}`)
  kills.length = 0
}

async function hopAll() {
  // CRITICAL: wait for post-roundStart snapshots BEFORE computing hops —
  // hop #1 launched off a stale lastPos is a no-op whose single emit trips
  // the anti-teleport guard, leaving the player spawn-side (no LOS, kills
  // silently dropped). 20 Hz snapshots: 250ms = ~5 frames of fresh truth.
  const seq0 = snapSeq
  await waitFor(() => snapSeq >= seq0 + 3, 1500)
  const moves: Array<[Sock, string, [number, number, number]]> = [
    [atk, myId, ATK], [vt, vtId, VTP], [wit, witId, WITP],
  ]
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const [s, id, to] of moves) {
      const cur = lastPos[id]
      if (cur && Math.hypot(cur[0] - to[0], cur[2] - to[2]) < 1.5) continue
      await new Promise<void>(r => hop(s, id, to, () => r()))
    }
    // verify against fresh snapshots; retry anything that didn't stick
    await sleep(150)
    const pending = moves.filter(([, id, to]) => {
      const cur = lastPos[id]
      return !cur || Math.hypot(cur[0] - to[0], cur[2] - to[2]) >= 1.5
    })
    if (!pending.length) return
    tl(`hopAll retry ${attempt + 1}: ${pending.map(([, id]) => id).join(',')}`)
    for (const [s, id, to] of pending) await new Promise<void>(r => hop(s, id, to, () => r()))
  }
}

// per-entry time cost: buy wait + 2 legal shots + reload (+slack)
function entryCost(e: BuyEntry): number {
  if (e.kind === 'gear') return 0.8
  const w = def(e.id)
  if (!w) return 1
  if (w.throwable) return 1.6
  if (e.id === 'taser') return 1.6
  return 0.4 + 2 * (w.fireDelay + 40) / 1000 + (w.reloadMs + 0.7) / 1000
}

async function main() {
  await hopAll()
  const entries = BUY_ENTRIES
  const BUDGET = 13 // seconds of buy-window-dependent work per round (freeze 8 + live window 20; hops + slack eat the rest)
  let idx = 0, round = 0
  while (idx < entries.length) {
    round++
    // cut a batch by time budget (buys must all land inside the window)
    const batch: BuyEntry[] = []
    let cost = 0
    while (idx < entries.length && batch.length < 6 && (cost === 0 || cost + entryCost(entries[idx]) <= BUDGET)) {
      cost += entryCost(entries[idx])
      batch.push(entries[idx])
      idx++
    }
    tl(`batch ${round}: ${batch.map(b => b.id).join(',')} (budget ${cost.toFixed(1)}s) phase=${phase}`)
    await sleep(250)
    for (const e of batch) {
      if (e.kind === 'weapon' && def(e.id)?.throwable) await testNade(e)
      else if (e.kind === 'weapon') await testGun(e)
      else await testGear(e)
    }
    if (idx < entries.length) {
      await endRound()
      await waitPhase('freeze', 15000)
      tl(`next round reached: phase=${phase} round=${roundNo}`)
      await hopAll() // roundStart teleports everyone back to spawns
    }
  }
  done('full-roster smoke: every buy entry exercised', buyErrs.length === 0 && fail === 0,
    `${entries.length} entries, ${round} rounds, buyErrors: ${buyErrs.join('; ') || 'none'}`)

  // ---------------------------------------------------------------- PART B
  await loadSanity()

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

function loadSanity(): Promise<void> {
  return new Promise(resolve => { loadSanityImpl().then(resolve) })
}

async function loadSanityImpl() {
  const ROOM2 = 'p9load-' + Math.random().toString(36).slice(2, 6)
  const socks: Sock[] = []
  const snapTimes: number[] = []
  let loadStarted = 0
  let shotRx = 0

  for (let i = 0; i < 10; i++) {
    const s = io(URL, { path: '/' })
    socks.push(s)
    s.on('connect', () => s.emit('join', { name: `Loader${i}`, room: ROOM2, team: i < 5 ? 'CT' : 'T', botFill: false, winTarget: 16 }))
    s.on('joinError', (d: { msg: string }) => { console.log(`LOADER ${i} JOIN ERROR:`, d.msg); process.exit(1) })
    if (i === 0) {
      s.on('snapshot', () => { snapTimes.push(Date.now()) })
      s.on('round', (d: { phase: string }) => {
        if (d.phase === 'live' && !loadStarted) { loadStarted = Date.now(); setTimeout(runBarrage, 400) }
      })
    }
    if (i === 1) s.on('shot', () => shotRx++)
  }
  await sleep(2500)
  for (const s of socks) s.emit('buy', { item: 'negev' })
  await sleep(500)

  const gapsOf = (from: number, to: number) => {
    const g: number[] = []
    for (let i = from + 1; i < to; i++) g.push(snapTimes[i] - snapTimes[i - 1])
    g.sort((a, b) => a - b)
    return g
  }
  const pct = (g: number[], p: number) => g.length ? g[Math.min(g.length - 1, Math.floor(g.length * p))] : 0
  let barrageDone: () => void = () => {}
  const barragePromise = new Promise<void>(r => { barrageDone = r })

  async function runBarrage() {
    await sleep(3000) // idle baseline
    const baseEnd = snapTimes.length
    // 8s barrage: 10 shooters, 75ms cadence, aimed at the sky (no hit claims)
    const ivs: ReturnType<typeof setInterval>[] = []
    for (const s of socks) {
      ivs.push(setInterval(() => {
        s.emit('shoot', { weapon: 'negev', origin: [0, 1.62, 0], dir: [0, 1, 0.01] })
      }, 75))
    }
    await sleep(8000)
    for (const iv of ivs) clearInterval(iv)
    await sleep(600)

    const base = gapsOf(0, baseEnd)
    const barr = gapsOf(baseEnd, snapTimes.length)
    const b50 = pct(barr, 0.5), b95 = pct(barr, 0.95), bMax = barr.length ? barr[barr.length - 1] : 0
    const i50 = pct(base, 0.5), i95 = pct(base, 0.95)
    done('load: snapshots keep flowing during 10x MG barrage', barr.length > 140, `${barr.length} snapshots in 8.6s`)
    done('load: snapshot p50 within budget (nominal 50ms)', b50 <= 60, `idle p50 ${i50}ms -> barrage p50 ${b50}ms`)
    done('load: snapshot p95 within budget', b95 <= 90, `idle p95 ${i95}ms -> barrage p95 ${b95}ms`)
    done('load: no snapshot starvation (max gap)', bMax <= 300, `max gap ${bMax}ms`)
    done('load: shot throughput (10 shooters x ~13rps witnessed)', shotRx >= 850, `${shotRx} 'shot' broadcasts on one witness`)
    for (const s of socks) s.disconnect()
    atk.disconnect(); vt.disconnect(); wit.disconnect()
    barrageDone()
  }
  // safety: if the live event never arrives, still resolve (checks will fail)
  setTimeout(() => barrageDone(), 120000)
  await barragePromise
}

// safety timeout: something wedged -> fail loudly
setTimeout(() => { console.log(`TIMEOUT — phase=${phase} round=${roundNo}`); process.exit(1) }, 480000)
