// Task 144 live probe — the user's two bot symptoms, measured:
//   1. CT bots frozen?  -> per-team cumulative movement in the FIRST 30 s of
//      live (old code: CTs held at spawn until the 50 s rotate)
//   2. T bots flying?   -> max |bot.y - groundY(x,z)| over all live samples,
//      ground = highest box top under the bot (the real collision floor)
import { io } from 'socket.io-client'
import wpData from '../../src/game/map-island-data.json'

const URL = 'http://localhost:3003'
const ROOM = 't144-probe-' + Math.random().toString(36).slice(2, 6)
const sock = io(URL, { path: '/' })

type Box = { x: number; y: number; z: number; w: number; h: number; d: number }
const boxes = (wpData as any).boxes as Box[]
const grid = new Map<string, Box[]>()
const ck = (x: number, z: number) => Math.floor(x / 2.5) + ',' + Math.floor(z / 2.5)
for (const b of boxes) {
  for (let cx = Math.floor((b.x - b.w / 2) / 2.5); cx <= Math.floor((b.x + b.w / 2) / 2.5); cx++)
    for (let cz = Math.floor((b.z - b.d / 2) / 2.5); cz <= Math.floor((b.z + b.d / 2) / 2.5); cz++) {
      const k = cx + ',' + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k)!.push(b)
    }
}
function groundY(x: number, z: number, feetY: number): number {
  // mirrors the server groundAt(): highest box top at most +1.25 m above the
  // feet — tall prop boxes (radar mast legs) must NOT read as "ground"
  let top = -Infinity
  for (const b of grid.get(ck(x, z)) ?? []) {
    if (x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && z >= b.z - b.d / 2 && z <= b.z + b.d / 2) {
      const t = b.y + b.h / 2
      if (t <= feetY + 1.25 && t > top) top = t
    }
  }
  return top
}

let liveStart = 0
let finished = false
const travel = new Map<string, number>()       // cumulative distance while live
const last = new Map<string, [number, number]>()
const maxDy = new Map<string, number>()
const dySamples = new Map<string, number>()
const flightLog: string[] = []
let phase = ''

function sample(rows: Array<any>) {
  for (const r of rows) {
    // snapshot row: [0]=id [1]=x [2]=y [3]=z [12]=alive [16]=team [17]=bot
    const id = r[0] as string
    if (!id || !id.startsWith('bot-') || r[12] !== 1) continue
    const x = r[1] as number, z = r[3] as number, y = r[2] as number
    const key = id
    if (phase === 'live') {
      const prev = last.get(key)
      if (prev) {
        const d = Math.hypot(x - prev[0], z - prev[1])
        if (d < 5) travel.set(key, (travel.get(key) ?? 0) + d)   // ignore round-reset teleports
      }
      const g = groundY(x, z, y)
      if (g > -Infinity) {
        const dy = Math.abs(y - g)
        if (dy > 1.2 && flightLog.length < 20) flightLog.push(`${id} @(${x.toFixed(1)},${z.toFixed(1)}) y=${y.toFixed(2)} ground=${g.toFixed(2)} dy=${dy.toFixed(2)} ${r[16] ?? ''}`)
        maxDy.set(key, Math.max(maxDy.get(key) ?? 0, dy))
        dySamples.set(key, (dySamples.get(key) ?? 0) + 1)
      }
    }
    last.set(key, [x, z])
  }
}

setInterval(() => { if (!finished && liveStart && Date.now() - liveStart > 32_000) { finished = true; report() } }, 1000)
setTimeout(() => { if (!finished) { finished = true; report() } }, 70_000)

function report() {
  const ct = [...travel.entries()].filter(([id]) => id.startsWith('bot-CT'))
  const t = [...travel.entries()].filter(([id]) => id.startsWith('bot-T'))
  const ctDist = ct.map(([, d]) => d)
  const tDist = t.map(([, d]) => d)
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0)
  console.log('\n===== T144 PROBE RESULTS (first 32s of live) =====')
  console.log(`CT bots moving: ${ct.length}, total travel ${sum(ctDist).toFixed(1)}m, avg ${(sum(ctDist) / Math.max(1, ct.length)).toFixed(1)}m`)
  console.log(`T  bots moving: ${t.length}, total travel ${sum(tDist).toFixed(1)}m, avg ${(sum(tDist) / Math.max(1, t.length)).toFixed(1)}m`)
  const ctOk = ct.length > 0 && sum(ctDist) / Math.max(1, ct.length) > 8
  console.log(`CT-FREEZE FIX: ${ctOk ? 'PASS' : 'FAIL ***'} — CT bots walked early (old code: rooted at spawn ~50s)`)
  const worst = [...maxDy.entries()].sort((a, b) => b[1] - a[1])[0]
  const allDy = [...maxDy.values()]
  const avgDy = sum(allDy) / Math.max(1, allDy.length)
  const flyOk = worst ? worst[1] < 1.2 : false
  console.log(`ALTITUDE: worst |y-ground| = ${worst ? worst[1].toFixed(2) : '-'}m (${worst ? worst[0] : '-'}), avg max-per-bot ${avgDy.toFixed(2)}m over ${sum([...dySamples.values()])} samples`)
  flightLog.slice(0, 12).forEach(l => console.log("  " + l))
  console.log(`NO-FLY: ${flyOk ? 'PASS' : 'FAIL ***'} — bots ride the terrain surface (threshold 1.2m)`)
  sock.disconnect()
  process.exit(0)
}

sock.on('connect', () => {
  sock.emit('join', { name: 'T144Probe', room: ROOM, team: 'CT', map: 'island', botFill: true, botDifficulty: 'easy', winTarget: 16 })
})
sock.on('snapshot', (s: any) => {
  sample(s.ps ?? [])
})
sock.on('round', (d: any) => {
  if (d.phase && d.phase !== phase) {
    phase = d.phase
    if (phase === 'live' && !liveStart) liveStart = Date.now()
    console.log(`[phase] ${phase} round=${d.round}`)
  }
})
sock.on('error', (e: any) => { console.log('ERR', e); process.exit(1) })
