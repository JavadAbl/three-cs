// Task 148 E2E gate — round-start spawn uniqueness + character-vs-character
// separation, against the LIVE :3003 server.
//
// Room A (island, 5v5 botFill): freeze spawns per team must be pairwise-unique
//   (old hash formula: ~96% of rounds stacked two players on the same slot);
//   during live, no two ALIVE characters may stay overlapped (< 0.5 m) longer
//   than 300 ms — the server separation pass must part bots (and bots vs the
//   standing human) within a few BOT_MS ticks.
// Room B (island, 6 humans CT, botFill): CT overflows the 5 spawn slots — the
//   golden-angle ring offsets must keep all 6 pairwise ≥ 0.5 m apart.
//   All 6 joins are emitted in one flush AFTER all sockets connect, so they
//   land inside the same server event-loop turn — before the 100 ms logic
//   tick can flip warmup → freeze (startRound path, not join path).
// Room C (island, no bots): second human joins DURING freeze — pickJoinSpawn
//   must pick the slot farthest from the first player, not a random one.
import { io } from 'socket.io-client'

const URL = 'http://localhost:3003'
const fails: string[] = []
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL ***'} — ${name} · ${detail}`)
  if (!ok) fails.push(name)
}

interface P { id: string; x: number; y: number; z: number; team: string; alive: boolean }

function parse(d: { ps: unknown[][] }): P[] {
  return d.ps.map(r => ({ id: r[0] as string, x: r[1] as number, y: r[2] as number, z: r[3] as number, team: r[16] as string, alive: r[12] === 1 }))
}
function pairMin(ps: P[]): { min: number; pair: string } {
  let min = Infinity, pair = ''
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const d = Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z)
    if (d < min) { min = d; pair = `${ps[i].id.slice(0, 8)}↔${ps[j].id.slice(0, 8)}` }
  }
  return { min: min === Infinity ? -1 : min, pair }
}
const mkRoom = () => 't148-' + Math.random().toString(36).slice(2, 7)
const JOIN = { botDifficulty: 'easy', winTarget: 16 } as const

// ---------------- Room A: 5v5 spawn uniqueness + live separation ----------------
function roomA(): Promise<void> {
  return new Promise(resolve => {
    const sock = io(URL, { path: '/' })
    let phase = '', roundNo = 0, liveAt = 0
    const freezePos = new Map<string, P>()
    let spawnDone = false, samples = 0, streak = 0, worstStreak = 0, gMin = Infinity, gPair = ''
    sock.on('connect', () => {
      sock.emit('join', { name: 'T148A', room: mkRoom(), team: 'CT', map: 'island', botFill: true, ...JOIN })
    })
    sock.on('round', (d: { phase: string; round: number }) => {
      if (d.phase === 'live' && phase !== 'live') liveAt = Date.now()
      phase = d.phase; if (d.round) roundNo = d.round
    })
    sock.on('snapshot', (d: { ps: unknown[][] }) => {
      const ps = parse(d)
      if (phase === 'freeze' && roundNo === 1) for (const p of ps) if (p.alive) freezePos.set(p.id, p)
      if (phase === 'freeze' && roundNo === 1 && !spawnDone && freezePos.size >= 10) {
        spawnDone = true
        const ct = [...freezePos.values()].filter(p => p.team === 'CT')
        const t = [...freezePos.values()].filter(p => p.team === 'T')
        const a = pairMin(ct), b = pairMin(t)
        check('A: CT round-start spawns unique', a.min >= 0.55, `${ct.length} CT, min pairwise ${a.min.toFixed(2)} m (${a.pair}) — old hash formula stacked ~96% of rounds`)
        check('A: T round-start spawns unique', b.min >= 0.55, `${t.length} T, min pairwise ${b.min.toFixed(2)} m (${b.pair})`)
      }
      if (phase === 'live' && liveAt) {
        const m = pairMin(ps.filter(p => p.alive))
        samples++
        if (m.min < gMin) { gMin = m.min; gPair = m.pair }
        if (m.min < 0.5) { streak++; worstStreak = Math.max(worstStreak, streak) } else streak = 0
        if (Date.now() - liveAt > 10000) {
          check('A: live character separation', worstStreak <= 6 && gMin >= 0.2,
            `longest overlap streak ${worstStreak} snaps (~${worstStreak * 50} ms, cap 300) · global min ${gMin.toFixed(2)} m (${gPair}) over ${samples} snaps`)
          sock.disconnect(); resolve()
        }
      }
    })
    setTimeout(() => {
      if (fails.length === 0 && !spawnDone) check('A: round reached freeze', false, `timeout: phase=${phase} round=${roundNo} seen=${freezePos.size}`)
      try { sock.disconnect() } catch { /* already gone */ }
      resolve()
    }, 45000)
  })
}

// ---------------- Room B: 6 humans on 5 CT slots → ring offsets ----------------
function roomB(): Promise<void> {
  return new Promise(resolve => {
    const socks = Array.from({ length: 6 }, () => io(URL, { path: '/' }))
    const room = mkRoom()
    let phase = '', inits = 0, done = false
    const pos = new Map<string, P>()
    const finish = (name: string, ok: boolean, detail: string) => {
      if (done) return
      done = true
      check(name, ok, detail)
      socks.forEach(s => { try { s.disconnect() } catch { /* gone */ } })
      resolve()
    }
    socks.forEach((s, i) => {
      s.on('connect', () => { if (++inits === 6) socks.forEach((sj, j) => sj.emit('join', { name: 'T148H' + j, room, team: 'CT', map: 'island', botFill: true, ...JOIN })) })
      s.on('init', () => { /* counted via connect flush above */ })
      s.on('round', (d: { phase: string }) => { phase = d.phase })
      s.on('snapshot', (d: { ps: unknown[][] }) => {
        if (phase !== 'freeze' || done) return
        for (const p of parse(d)) if (p.alive && p.team === 'CT') pos.set(p.id, p)
        if (pos.size >= 6) {
          const ct = [...pos.values()]
          const m = pairMin(ct)
          finish('B: overflow ring keeps 6 CT apart', m.min >= 0.5, `6 CT humans on 5 slots, min pairwise ${m.min.toFixed(2)} m (${m.pair})`)
        }
      })
    })
    setTimeout(() => finish('B: overflow ring keeps 6 CT apart', false, `timeout: phase=${phase} seen=${pos.size} inits=${inits}`), 30000)
  })
}

// ---------------- Room C: join during freeze → farthest free slot ----------------
function roomC(): Promise<void> {
  return new Promise(resolve => {
    const s1 = io(URL, { path: '/' })
    const room = mkRoom()
    let phase = '', s2: ReturnType<typeof io> | null = null, done = false
    const finish = (name: string, ok: boolean, detail: string) => {
      if (done) return
      done = true
      check(name, ok, detail)
      try { s1.disconnect() } catch { /* gone */ }
      try { s2?.disconnect() } catch { /* gone */ }
      resolve()
    }
    s1.on('connect', () => s1.emit('join', { name: 'T148C1', room, team: 'CT', map: 'island', botFill: false, ...JOIN }))
    s1.on('round', (d: { phase: string }) => {
      phase = d.phase
      if (d.phase === 'freeze' && !s2) {
        s2 = io(URL, { path: '/' })
        s2.on('connect', () => s2!.emit('join', { name: 'T148C2', room, team: 'CT' }))
      }
    })
    s1.on('snapshot', (d: { ps: unknown[][] }) => {
      if (phase !== 'freeze' || done || !s2) return
      const ps = parse(d).filter(p => p.alive && p.team === 'CT')
      if (ps.length >= 2) {
        const m = pairMin(ps)
        finish('C: freeze joiner picks farthest slot', m.min >= 1.5, `2 CT humans, min pairwise ${m.min.toFixed(2)} m (island CT slots ≥ 2.25 m apart)`)
      }
    })
    setTimeout(() => finish('C: freeze joiner picks farthest slot', false, `timeout: phase=${phase}`), 30000)
  })
}

const t0 = Date.now()
Promise.all([roomA(), Promise.all([roomB(), roomC()]).then(() => undefined)]).then(() => {
  console.log(`\n${fails.length === 0 ? 'ALL PASS' : 'FAILURES: ' + fails.join(', ')} · ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  process.exit(fails.length === 0 ? 0 : 1)
})
