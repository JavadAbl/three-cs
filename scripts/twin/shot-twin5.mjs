// Task 153 (run 4) — REAL in-game shots. The sandbox browser can't reach
// :3003 (XTransformPort is a deployed-platform proxy), which put the red
// GAME SERVER UNREACHABLE dialog over every window view. Fix locally:
//   1. addInitScript wraps window.io to force POLLING transport (route-able)
//   2. page.route forwards every ?XTransformPort=3003 request to :3003
// => the engine actually connects, joins the twin room, bots fill in, the
//    dialog never appears, and the duel shots show live cross-street play.
import { chromium } from 'playwright'

const E = Math.PI / 2
const SHOTS = 'scripts/twin/shots'
const SPOTS = [
  ['r4-l1-window-duel', -10.5, 3.4, 0, -E],
  ['r4-l2-window-duel', -10.5, 6.8, 0, -E],
  ['r4-l0-window-room', -13, 0, -12, -E],
  ['r4-street-facade', -5, 0, 0, -E],
]

const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu-sandbox'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))

// 1) force polling transport so requests are HTTP-interceptable
await p.addInitScript(() => {
  const waitIo = () => {
    if (typeof window.io === 'function' && !window.io.__wrapped) {
      const orig = window.io
      const wrapped = (u, o) => orig(u, { ...(o || {}), transports: ['polling'] })
      wrapped.__wrapped = true
      window.io = wrapped
    } else if (!window.io?.__wrapped) setTimeout(waitIo, 50)
  }
  waitIo()
})

// 2) forward ?XTransformPort=3003 traffic to the game server
await p.route('**/*', async route => {
  const req = route.request()
  const url = req.url()
  if (!url.includes('XTransformPort=3003')) return route.continue()
  const target = url.replace('http://localhost:3000', 'http://localhost:3003')
  try {
    const headers = { ...req.headers() }
    delete headers.host
    delete headers.origin
    delete headers.referer
    const body = req.postDataBuffer()
    const r = await fetch(target, { method: req.method(), headers, body: body ?? undefined })
    const buf = Buffer.from(await r.arrayBuffer())
    const h = {}
    r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v })
    await route.fulfill({ status: r.status, headers: h, body: buf })
  } catch (e) {
    await route.abort()
  }
})

await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()

// wait for engine + a LIVE match (server phases come through now)
await p.waitForFunction(() => {
  const e = window.__eng
  if (!e) return false
  const s = e.state()
  return s.map === 'twin' && s.tick > 60 && (s.phase === 'freeze' || s.phase === 'live' || s.phase === 'warmup')
}, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(6000)   // let bots spawn/settle
console.log('in game on twin (server connected)')

for (const [name, x, y, z, yaw] of SPOTS) {
  try {
    await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [x, y, z, yaw])
    await p.waitForTimeout(700)
    await p.screenshot({ path: `${SHOTS}/t153-${name}.png` })
    console.log('shot', name)
  } catch (e) {
    console.log('shot', name, 'FAILED:', String(e).slice(0, 100))
    break
  }
}
await b.close()
console.log('done')
