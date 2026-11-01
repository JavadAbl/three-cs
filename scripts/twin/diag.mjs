import { chromium } from 'playwright'
const b = await chromium.launch({ args: ['--disable-dev-shm-usage'] })
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('crash', () => console.log('[EVENT] renderer CRASHED'))
p.on('close', () => console.log('[EVENT] page CLOSED'))
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 150)))
await p.addInitScript(() => {
  const waitIo = () => {
    if (typeof window.io === 'function' && !window.io.__wrapped) {
      const orig = window.io; const w = (u, o) => orig(u, { ...(o || {}), transports: ['polling'] }); w.__wrapped = true; window.io = w
    } else if (!window.io?.__wrapped) setTimeout(waitIo, 50)
  }; waitIo()
})
await p.route('**/*', async route => {
  const req = route.request(); const url = req.url()
  if (!url.includes('XTransformPort=3003')) return route.continue()
  const target = url.replace('http://localhost:3000', 'http://localhost:3003')
  try {
    const headers = { ...req.headers() }; delete headers.host; delete headers.origin; delete headers.referer
    const body = req.postDataBuffer()
    const r = await fetch(target, { method: req.method(), headers, body: body ?? undefined })
    const buf = Buffer.from(await r.arrayBuffer())
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v })
    await route.fulfill({ status: r.status, headers: h, body: buf })
  } catch { await route.abort() }
})
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => { const e = window.__eng; if (!e) return false; const s = e.state(); return s.map === 'twin' && s.tick > 60 }, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
console.log('in game; idling 25s...')
for (let i = 0; i < 5; i++) {
  await p.waitForTimeout(5000)
  const st = await p.evaluate(() => { const s = window.__eng.state(); return { tick: s.tick, phase: s.phase } }).catch(e => 'GONE: ' + String(e).slice(0, 60))
  console.log(`t+${(i + 1) * 5}s`, JSON.stringify(st))
}
console.log('canvas test:', await p.evaluate(() => { const c = document.querySelector('canvas'); if (!c) return 'no canvas'; const d = c.toDataURL('image/jpeg', 0.7); return d.length > 5000 ? `ok ${d.length}B` : `suspicious ${d.length}B` }).catch(e => 'GONE'))
await b.close()
