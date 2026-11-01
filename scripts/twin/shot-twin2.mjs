// Task 153 — grab the remaining Twin Villas shots (run 2): flight A, basement,
// tunnel. Run 1's tab closed after 4 shots; this is a fresh browser for the rest.
import { chromium } from 'playwright'

const SHOTS = 'scripts/twin/shots'
const SPOTS = [
  ['flight-a', -25.1, 1.46 + 1.62, 0.86, 0],               // mid flight A looking north/up
  ['basement', -18, -3.2 + 1.62, 0, -Math.PI / 2],         // west basement looking east at tunnel mouth
  ['tunnel', -6, -3.2 + 1.62, 0, -Math.PI / 2],            // inside the tunnel
]

const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))

await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => {
  const e = window.__eng
  if (!e) return false
  const s = e.state()
  return s.map === 'twin' && s.tick > 60
}, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(2000)
console.log('in game on twin, overlay gone')

for (const [name, x, y, z, yaw] of SPOTS) {
  try {
    await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [x, y, z, yaw])
    await p.waitForTimeout(700)
    await p.screenshot({ path: `${SHOTS}/t153-${name}.png` })
    console.log('shot', name)
  } catch (e) {
    console.log('shot', name, 'FAILED:', String(e).slice(0, 120))
    break
  }
}
await b.close()
console.log('done')
