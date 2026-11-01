import { chromium } from 'playwright'
const E = Math.PI / 2
const SPOTS = [
  ['r3-hall-staircore', -11, 0, 0, E],
  ['r3-flight-a', -25.1, 1.46, 0.86, 0],
  ['r3-basement', -18, -3.2, 0, -E],
  ['r3-tunnel', -6, -3.2, 0, -E],
]
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
await p.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(2500)
await p.getByRole('button', { name: 'Twin Villas', exact: false }).first().click()
await p.getByRole('button', { name: '▶ PLAY' }).click()
await p.waitForFunction(() => { const e = window.__eng; return e && e.state().map === 'twin' && e.state().tick > 60 }, undefined, { timeout: 90000 })
await p.waitForSelector('[data-loading]', { state: 'detached', timeout: 120000 })
await p.waitForTimeout(1500)
for (const [name, x, y, z, yaw] of SPOTS) {
  try {
    await p.evaluate(([x, y, z, yw]) => window.__eng.teleport(x, y, z, yw), [x, y, z, yaw])
    await p.waitForTimeout(500)
    await p.screenshot({ path: `scripts/twin/shots/t153-${name}.png` })
    console.log('shot', name)
  } catch (e) { console.log('shot', name, 'FAILED'); break }
}
await b.close()
console.log('done')
